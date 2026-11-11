"""Pure IPMS rules: no database, no web framework — unit-tested in tests/test_ipms_logic.py."""
from __future__ import annotations

import re
from decimal import Decimal

BAG_KG = Decimal("25")
TON_KG = Decimal("1000")

# Where stock can live, and what can live there.
MATERIAL_LOCATIONS = ("GROUND_FLOOR", "FIRST_FLOOR")
ROLL_STORE = "ROLL_STORE"
FINISHED_STORE = "FINISHED_STORE"
ALL_LOCATIONS = (*MATERIAL_LOCATIONS, ROLL_STORE, FINISHED_STORE)
LOCATION_LABELS = {
    "GROUND_FLOOR": "Ground Floor",
    "FIRST_FLOOR": "1st Floor Production",
    "ROLL_STORE": "Roll Store",
    "FINISHED_STORE": "Finished Goods Store",
}
PRODUCT_STORE = {"ROLL": ROLL_STORE, "FINISHED": FINISHED_STORE}

# Extruder wastage and cutting trim go back into the plant as regrind.
REGRIND_MATERIAL = "RP REGRIND"
REGRIND_BRAND = "RP"
REGRIND_LOCATION = "FIRST_FLOOR"

DEFAULT_REORDER_BELOW_KG = Decimal("10000")   # below 10 t: reorder
DEFAULT_OPTIMAL_ABOVE_KG = Decimal("20000")   # above 20 t: optimal; between: buffer

STATUS_LABELS = {"REORDER": "Reorder Warning", "BUFFER": "Buffer Stock", "OPTIMAL": "Optimal Stock"}


def kg(value) -> Decimal:
    if isinstance(value, Decimal):
        return value
    if value in (None, ""):
        return Decimal("0")
    return Decimal(str(value))


def stock_status(quantity_kg, reorder_below_kg=None, optimal_above_kg=None) -> str:
    """REORDER below the reorder line, OPTIMAL above the optimal line, BUFFER in between."""
    q = kg(quantity_kg)
    low = kg(reorder_below_kg) if reorder_below_kg is not None else DEFAULT_REORDER_BELOW_KG
    high = kg(optimal_above_kg) if optimal_above_kg is not None else DEFAULT_OPTIMAL_ABOVE_KG
    if q < low:
        return "REORDER"
    if q > high:
        return "OPTIMAL"
    return "BUFFER"


def normalize_product_code(text) -> str:
    """One spelling per size, so '12*13*30mic', '12 * 13 * 30 MIC' and '12x13x30MIC' match.

    Upper-cases, drops whitespace, writes dimension separators as '*', and drops a
    '*' that sits directly before a unit ('10*250*G' -> '10*250G').
    """
    s = re.sub(r"\s+", "", str(text or "")).upper()
    s = s.replace("×", "*")
    s = re.sub(r"(?<=\d)X(?=\d)", "*", s)
    s = re.sub(r"\*+", "*", s)
    s = re.sub(r"\*(?=[A-Z])", "", s)
    return s.strip("*")


def normalize_material_name(text) -> str:
    return re.sub(r"\s+", " ", str(text or "")).strip()


def bags(quantity_kg) -> Decimal:
    return kg(quantity_kg) / BAG_KG


def merge_lines(lines) -> dict:
    """Sum ledger lines that touch the same (item_kind, item_id, location)."""
    merged: dict = {}
    for item_kind, item_id, location, delta in lines:
        key = (item_kind, int(item_id), location)
        merged[key] = merged.get(key, Decimal("0")) + kg(delta)
    return {k: v for k, v in merged.items() if v != 0}


def location_accepts(item_kind: str, product_kind: str | None, location: str) -> bool:
    if item_kind == "MATERIAL":
        return location in MATERIAL_LOCATIONS
    if item_kind == "PRODUCT":
        return PRODUCT_STORE.get(product_kind or "") == location
    return False


def allocate_auto(quantity, first_floor_kg, ground_floor_kg) -> list[tuple[str, Decimal]]:
    """Split a draw across the floors: 1st floor running stock first, then Ground Floor.

    Returns what to take from where; any shortfall is left on the last location so
    the stock engine reports it as insufficient stock.
    """
    need = kg(quantity)
    take_ff = min(max(kg(first_floor_kg), Decimal("0")), need)
    rest = need - take_ff
    parts = []
    if take_ff > 0:
        parts.append(("FIRST_FLOOR", take_ff))
    if rest > 0:
        parts.append(("GROUND_FLOOR", rest))
    return parts


def day_register(rows, *, thresholds=None) -> list[dict]:
    """Opening / received / issued / closing for one business day.

    `rows` are per (item, location, document) aggregates:
        {item_kind, item_id, location, before_kg, day_delta_kg}
    where before_kg is everything posted before the day and day_delta_kg is the
    net effect of one document on the day (a document reversed on the same day
    nets to zero and counts as neither received nor issued).
    """
    thresholds = thresholds or {}
    acc: dict = {}
    for r in rows:
        key = (r["item_kind"], int(r["item_id"]), r["location"])
        slot = acc.setdefault(key, {"opening": Decimal("0"), "received": Decimal("0"), "issued": Decimal("0")})
        slot["opening"] += kg(r.get("before_kg"))
        delta = kg(r.get("day_delta_kg"))
        if delta > 0:
            slot["received"] += delta
        elif delta < 0:
            slot["issued"] += -delta
    out = []
    for (item_kind, item_id, location), slot in acc.items():
        closing = slot["opening"] + slot["received"] - slot["issued"]
        low, high = thresholds.get((item_kind, item_id), (None, None))
        out.append({
            "item_kind": item_kind, "item_id": item_id, "location": location,
            "opening_kg": slot["opening"], "received_kg": slot["received"],
            "issued_kg": slot["issued"], "closing_kg": closing,
            "status": stock_status(closing, low, high) if item_kind == "MATERIAL" else None,
        })
    return out


def production_totals(entries) -> dict:
    gross = sum((kg(e["gross_kg"]) for e in entries), Decimal("0"))
    wastage = sum((kg(e["wastage_kg"]) for e in entries), Decimal("0"))
    return {"gross_kg": gross, "wastage_kg": wastage, "net_kg": gross - wastage,
            "wastage_percent": (wastage / gross * 100) if gross else Decimal("0")}


def shift_report(entries) -> dict:
    """Plant (extruders) and cutting, per AM/PM shift, as on the plant's daily sheet."""
    report = {}
    for shift in ("AM", "PM"):
        report[shift] = {}
        for section, kind in (("plant", "EXTRUSION"), ("cutting", "CUTTING")):
            items = [e for e in entries if e["shift"] == shift and e["kind"] == kind]
            report[shift][section] = {"entries": items, **production_totals(items)}
    report["day_and_night"] = {
        section: production_totals([e for e in entries if e["kind"] == kind])
        for section, kind in (("plant", "EXTRUSION"), ("cutting", "CUTTING"))
    }
    return report

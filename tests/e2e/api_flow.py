"""End-to-end IPMS scenario against a disposable API + database.

    VP_E2E_BASE=http://127.0.0.1:3901 VP_E2E_EMAIL=... VP_E2E_PASSWORD=... python tests/e2e/api_flow.py

Refuses the production API. Run it only against a throwaway database: it writes stock.
"""
import json
import os
import sys
import urllib.error
import urllib.request

BASE = os.environ["VP_E2E_BASE"].rstrip("/")
if "avlokai.com" in BASE:
    sys.exit("Refusing to run the E2E scenario against production")

TOKEN = None
PASSED = 0


def call(method, path, body=None, expect=200):
    req = urllib.request.Request(BASE + path, method=method,
                                 data=json.dumps(body).encode() if body is not None else None)
    req.add_header("Content-Type", "application/json")
    if TOKEN:
        req.add_header("Authorization", f"Bearer {TOKEN}")
    try:
        with urllib.request.urlopen(req) as resp:
            status, raw = resp.status, resp.read()
    except urllib.error.HTTPError as err:
        status, raw = err.code, err.read()
    if status != expect:
        raise AssertionError(f"{method} {path}: expected {expect}, got {status}: {raw[:400]!r}")
    if raw[:2] == b"PK":
        return raw
    return json.loads(raw) if raw else None


def check(label, condition):
    global PASSED
    if not condition:
        raise AssertionError(label)
    PASSED += 1
    print(f"  ok  {label}")


def stock():
    ov = call("GET", "/stock/overview")
    mats = {m["name"]: m for m in ov["materials"]}
    rolls = {p["code"]: p["quantity_kg"] for p in ov["rolls"]}
    fin = {p["code"]: p["quantity_kg"] for p in ov["finished"]}
    return ov, mats, rolls, fin


def main():
    global TOKEN
    TOKEN = call("POST", "/auth/login", {"email": os.environ["VP_E2E_EMAIL"],
                                         "password": os.environ["VP_E2E_PASSWORD"]})["token"]
    meta = call("GET", "/stock/meta")
    extruder = next(m for m in meta["machines"] if m["type"] == "production")
    cutter = next(m for m in meta["machines"] if m["type"] == "cutting")
    check("thresholds are 10 t / 20 t", meta["thresholds"] == {"reorder_below_kg": 10000, "optimal_above_kg": 20000})
    check("no warehouse location", "WAREHOUSE" not in [l["id"] for l in meta["locations"]])

    call("POST", "/materials", {"name": "OPALENE LLDPE", "brand": "lldpe"})
    call("POST", "/materials", {"name": "WHITE MB", "brand": "masterbatch"})
    call("POST", "/materials", {"name": "opalene lldpe"}, expect=400)
    call("POST", "/receipts", {"material_name": "OPALENE LLDPE", "quantity_bags": 480, "batch_no": "VIPRM-01"})
    call("POST", "/receipts", {"material_name": "WHITE MB", "quantity_kg": 500, "location": "GROUND_FLOOR"})
    call("POST", "/receipts", {"material_name": "WHITE MB", "quantity_kg": 5, "location": "WAREHOUSE"}, expect=400)
    _, mats, _, _ = stock()
    check("480 bags received = 12,000 kg on Ground Floor", mats["OPALENE LLDPE"]["ground_floor_kg"] == 12000)
    check("12 t is buffer stock", mats["OPALENE LLDPE"]["status"] == "BUFFER")

    call("POST", "/transfers", {"material_name": "OPALENE LLDPE", "quantity_kg": 2000,
                                "from_location": "GROUND_FLOOR", "to_location": "FIRST_FLOOR"})
    call("POST", "/transfers", {"material_name": "WHITE MB", "quantity_kg": 9999,
                                "from_location": "GROUND_FLOOR", "to_location": "FIRST_FLOOR"}, expect=400)
    _, mats, _, _ = stock()
    check("transfer moves GF → 1st floor", (mats["OPALENE LLDPE"]["ground_floor_kg"], mats["OPALENE LLDPE"]["first_floor_kg"]) == (10000, 2000))

    opal, mb = mats["OPALENE LLDPE"]["id"], mats["WHITE MB"]["id"]
    call("POST", "/production/extrusion", {
        "machine_id": extruder["id"], "worker_name": "Ravi", "output_size": "25 * 30 * 50 mic", "gross_kg": 300, "wastage_kg": 10,
        "inputs": [{"material_id": opal, "location": "AUTO", "quantity_kg": 280},
                   {"material_id": mb, "location": "GROUND_FLOOR", "quantity_kg": 20}]}, expect=200)
    call("POST", "/production/extrusion", {
        "machine_id": extruder["id"], "worker_name": "Ravi", "output_size": "X", "gross_kg": 100,
        "inputs": [{"material_id": opal, "quantity_kg": 90}]}, expect=400)
    call("POST", "/production/extrusion", {
        "machine_id": cutter["id"], "worker_name": "Ravi", "output_size": "X", "gross_kg": 10,
        "inputs": [{"material_id": opal, "quantity_kg": 10}]}, expect=400)
    _, mats, rolls, _ = stock()
    check("extrusion draws 1st floor running stock first", mats["OPALENE LLDPE"]["first_floor_kg"] == 1720)
    check("blend line drawn from Ground Floor", mats["WHITE MB"]["ground_floor_kg"] == 480)
    check("net roll weight (gross − wastage) in Roll Store", rolls.get("25*30*50MIC") == 290)
    check("wastage becomes RP REGRIND on 1st floor", mats["RP REGRIND"]["first_floor_kg"] == 10)

    ct = call("POST", "/production/cutting", {"machine_id": cutter["id"], "worker_name": "Ravi", "input_size": "25*30*50MIC",
                                              "output_size": "25*30 BAG", "gross_kg": 200, "wastage_kg": 5})
    call("POST", "/production/cutting", {"machine_id": cutter["id"], "worker_name": "Ravi", "input_size": "25*30*50MIC",
                                         "output_size": "25*30 BAG", "gross_kg": 500}, expect=400)
    call("POST", "/production/cutting", {"machine_id": cutter["id"], "worker_name": "Ravi", "input_size": "NO SUCH ROLL",
                                         "output_size": "Z", "gross_kg": 1}, expect=404)
    _, mats, rolls, fin = stock()
    check("cutting consumes rolls, not resin", rolls["25*30*50MIC"] == 90 and mats["OPALENE LLDPE"]["first_floor_kg"] == 1720)
    check("cut output lands in Finished Goods", fin["25*30BAG"] == 195)
    check("cutting trim also to regrind", mats["RP REGRIND"]["first_floor_kg"] == 15)

    entries = call("GET", "/production/entries?kind=EXTRUSION")
    call("DELETE", f"/production/entries/{entries[0]['id']}", expect=400)
    check("extrusion whose rolls were cut cannot be reversed", True)
    call("DELETE", f"/production/entries/{ct['entry']['id']}")
    _, mats, rolls, fin = stock()
    check("cutting reversal restores rolls and empties finished", rolls["25*30*50MIC"] == 290 and fin["25*30BAG"] == 0)
    call("DELETE", f"/production/entries/{ct['entry']['id']}", expect=400)
    check("double reversal refused", True)

    call("POST", "/production/cutting", {"machine_id": cutter["id"], "worker_name": "Ravi", "input_size": "25*30*50MIC",
                                         "output_size": "25*30 BAG", "gross_kg": 100})
    call("POST", "/production/extrusion", {"machine_id": extruder["id"], "output_size": "X", "gross_kg": 10,
                                           "inputs": [{"material_id": opal, "quantity_kg": 10}]}, expect=400)
    check("operator is required on production entries", True)
    tare_run = call("POST", "/production/extrusion", {
        "machine_id": extruder["id"], "worker_name": "Ravi", "output_size": "9*10*75MIC", "gross_kg": 105,
        "tare_kg": 5, "wastage_kg": 4, "inputs": [{"material_id": opal, "location": "AUTO", "quantity_kg": 100}]})
    check("core weight is taken off before net", tare_run["entry"]["net_kg"] == 96)
    _, _, rolls, _ = stock()
    check("roll store gets gross − core − wastage", rolls["9*10*75MIC"] == 96)
    order = call("POST", "/orders", {"order_number": "E2E-1", "client_name": "Test",
                                     "items": [{"item_name": "25*30bag", "required_quantity": 80}]})
    check("order item linked to finished stock", order["items"][0]["product_code"] == "25*30BAG")
    call("POST", "/fulfillment", {"order_number": "E2E-1", "item_index": 0, "supplied_quantity": 50})
    call("POST", "/fulfillment", {"order_number": "E2E-1", "item_index": 0, "supplied_quantity": 40}, expect=400)
    _, _, _, fin = stock()
    check("dispatch takes goods out of Finished Goods", fin["25*30BAG"] == 50)
    call("DELETE", f"/orders/{order['id']}")
    _, _, _, fin = stock()
    check("deleting the order returns its dispatch to stock", fin["25*30BAG"] == 100)

    adj = call("POST", "/adjustments", {"item_kind": "MATERIAL", "material_id": opal, "location": "GROUND_FLOOR",
                                        "reason_type": "COUNT", "counted_kg": 9500, "reason": "Monthly count"})
    check("physical count posts the difference", adj["adjustment"]["delta_kg"] == -500)

    reg = call("GET", "/reports/inventory-register")
    gf = next(z for z in reg["zones"] if z["location"] == "GROUND_FLOOR")
    row = next(r for r in gf["rows"] if r["item_name"] == "OPALENE LLDPE")
    check("register shows received bags and closing", row["received_bags"] == 480 and row["closing_kg"] == 9500)
    check("register keeps batch number", row["batch_no"] == "VIPRM-01")
    check("ground floor zone under 10 t is a reorder warning", gf["subtotal"]["status"] == "REORDER")

    rep = call("GET", "/reports/shift-production")
    dn = rep["day_and_night"]
    check("shift report plant net (with core taken off)", dn["plant"]["net_kg"] == 386 and dn["plant"]["wastage_kg"] == 14)
    check("plant efficiency is net ÷ material", round(dn["plant"]["yield_percent"], 2) == round(386 / 400 * 100, 2))
    check("shift report cutting excludes reversed run", dn["cutting"]["gross_kg"] == 100)

    for path in ("/reports/inventory-register.xlsx", "/reports/shift-production.xlsx",
                 "/reports/production-summary.xlsx"):
        check(f"{path} is an xlsx", call("GET", path)[:2] == b"PK")
    dash = call("GET", "/dashboard")
    check("dashboard reorder list flags low materials", any(m["name"] == "WHITE MB" for m in dash["reorder"]))
    check("ledger and balances agree", call("GET", "/stock/verify")["ok"])
    print(f"\nAll {PASSED} checks passed")


if __name__ == "__main__":
    main()

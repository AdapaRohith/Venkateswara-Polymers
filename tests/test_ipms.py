import os
from datetime import date, datetime, time
from decimal import Decimal

import pytest

os.environ.setdefault("JWT_SECRET", "test-secret-longer-than-sixteen-characters")

from fastapi import HTTPException

from server import (
    build_stock_activity_filters,
    compute_day_ledger,
    derive_business_context,
    normalize_shift,
    parse_business_context,
    parse_quantity_kg,
    validate_transfer_route,
)


# ── Shifts ──

@pytest.mark.parametrize("moment,expected", [
    (datetime(2026, 10, 15, 8, 0), (date(2026, 10, 15), "AM")),
    (datetime(2026, 10, 15, 19, 59), (date(2026, 10, 15), "AM")),
    (datetime(2026, 10, 15, 20, 0), (date(2026, 10, 15), "PM")),
    (datetime(2026, 10, 16, 2, 30), (date(2026, 10, 15), "PM")),
    (datetime(2026, 10, 16, 7, 59), (date(2026, 10, 15), "PM")),
])
def test_night_shift_belongs_to_the_day_it_started(moment, expected):
    assert derive_business_context(moment) == expected


def test_shift_aliases_and_rejection():
    assert normalize_shift("morning") == "AM"
    assert normalize_shift("night") == "PM"
    assert normalize_shift("") is None
    with pytest.raises(HTTPException):
        normalize_shift("noon")


def test_live_entry_keeps_real_clock():
    now = datetime(2026, 10, 15, 10, 0)
    assert parse_business_context({}, now) == (date(2026, 10, 15), "AM", None)


def test_backdated_am_and_pm_entries_get_fixed_shift_clock():
    now = datetime(2026, 10, 15, 10, 0)
    bd, shift, ts = parse_business_context({"business_date": "2026-10-12", "shift": "PM"}, now)
    assert (bd, shift) == (date(2026, 10, 12), "PM")
    assert ts.time() == time(21, 0)
    bd, shift, ts = parse_business_context({"business_date": "2026-10-12", "shift": "AM"}, now)
    assert ts == datetime(2026, 10, 12, 9, 0)


def test_any_day_without_shift_defaults_to_morning():
    now = datetime(2026, 10, 15, 10, 0)
    assert parse_business_context({"date": "2026-10-01"}, now)[1] == "AM"


def test_todays_night_shift_logged_in_the_morning_is_stamped_pm():
    now = datetime(2026, 10, 15, 10, 0)
    bd, shift, ts = parse_business_context({"business_date": "2026-10-15", "shift": "PM"}, now)
    assert (bd, shift, ts) == (date(2026, 10, 15), "PM", datetime(2026, 10, 15, 21, 0))


# ── Explicit entry time (yesterday's shifts keyed in the next morning) ──

def test_typed_time_on_a_past_morning_shift_is_kept():
    now = datetime(2026, 10, 15, 10, 0)
    assert parse_business_context(
        {"business_date": "2026-10-14", "shift": "AM", "entry_time": "11:45"}, now,
    ) == (date(2026, 10, 14), "AM", datetime(2026, 10, 14, 11, 45))


def test_night_shift_time_after_midnight_lands_on_next_calendar_day():
    now = datetime(2026, 10, 15, 10, 0)
    bd, shift, ts = parse_business_context({"business_date": "2026-10-14", "entry_time": "02:30"}, now)
    assert (bd, shift, ts) == (date(2026, 10, 14), "PM", datetime(2026, 10, 15, 2, 30))


def test_time_decides_shift_when_none_given():
    now = datetime(2026, 10, 15, 22, 0)
    assert parse_business_context({"business_date": "2026-10-15", "entry_time": "20:15"}, now)[1] == "PM"
    assert parse_business_context({"business_date": "2026-10-15", "entry_time": "08:00"}, now)[1] == "AM"


def test_typed_time_must_match_the_shift():
    with pytest.raises(HTTPException) as err:
        parse_business_context({"business_date": "2026-10-14", "shift": "AM", "entry_time": "22:00"},
                               datetime(2026, 10, 15, 10, 0))
    assert "PM shift" in err.value.detail


def test_typed_time_cannot_be_in_the_future():
    with pytest.raises(HTTPException):
        parse_business_context({"business_date": "2026-10-15", "entry_time": "18:00"},
                               datetime(2026, 10, 15, 10, 0))


def test_bad_time_is_rejected():
    with pytest.raises(HTTPException):
        parse_business_context({"business_date": "2026-10-14", "entry_time": "25:99"},
                               datetime(2026, 10, 15, 10, 0))


# ── Bags ──

def test_bags_convert_at_25_kg():
    assert parse_quantity_kg({"quantity_bags": 4}) == Decimal("100.000")
    assert parse_quantity_kg({"quantity_bags": "2.5"}) == Decimal("62.500")


def test_explicit_kg_wins_over_bags():
    assert parse_quantity_kg({"quantity_kg": 30, "quantity_bags": 4}) == Decimal("30.000")


@pytest.mark.parametrize("body", [{}, {"quantity_kg": 0}, {"quantity_kg": -5}, {"quantity_bags": "x"}])
def test_quantity_must_be_positive(body):
    with pytest.raises(HTTPException):
        parse_quantity_kg(body)


# ── Transfer routes ──

GF_MACHINE = {"id": 1, "name": "Machine 1", "floor": "GROUND_FLOOR"}
FF_MACHINE = {"id": 6, "name": "Cutting Machine 1", "floor": "FIRST_FLOOR"}


@pytest.mark.parametrize("route", [
    ("WAREHOUSE", None, "GROUND_FLOOR", None),
    ("WAREHOUSE", None, "FIRST_FLOOR", None),
    ("GROUND_FLOOR", None, "FIRST_FLOOR", None),
    ("FIRST_FLOOR", None, "GROUND_FLOOR", None),
    ("GROUND_FLOOR", None, "MACHINE", GF_MACHINE),
    ("MACHINE", GF_MACHINE, "GROUND_FLOOR", None),
    ("FIRST_FLOOR", None, "MACHINE", FF_MACHINE),
    ("GROUND_FLOOR", None, "WAREHOUSE", None),
])
def test_valid_routes(route):
    validate_transfer_route(*route)


@pytest.mark.parametrize("route,message", [
    (("WAREHOUSE", None, "WAREHOUSE", None), "two different"),
    (("WAREHOUSE", None, "MACHINE", GF_MACHINE), "through the machine's floor"),
    (("FIRST_FLOOR", None, "MACHINE", GF_MACHINE), "Ground Floor"),
    (("MACHINE", FF_MACHINE, "GROUND_FLOOR", None), "First Floor"),
    (("MACHINE", GF_MACHINE, "MACHINE", FF_MACHINE), "Release machine stock"),
])
def test_invalid_routes(route, message):
    with pytest.raises(HTTPException) as exc:
        validate_transfer_route(*route)
    assert message in exc.value.detail


# ── Activity feed hides returns ──

def test_activity_feed_hides_returns_by_default():
    where, _ = build_stock_activity_filters()
    assert "STOCK_RETURN" in where
    where, _ = build_stock_activity_filters(include_returns=True)
    assert "STOCK_RETURN" not in where
    where, values = build_stock_activity_filters(source_domain="STOCK_RETURN")
    assert "<> 'STOCK_RETURN'" not in where and values == ["STOCK_RETURN"]


# ── Day ledger math ──

def _move(day, shift, domain, **deltas):
    row = {"material_id": 7, "bd": day, "shift": shift, "source_domain": domain}
    for loc in ("warehouse", "ground_floor", "first_floor", "machines"):
        value = Decimal(str(deltas.get(loc, 0)))
        row[f"{loc}_in"] = max(value, Decimal("0"))
        row[f"{loc}_out"] = min(value, Decimal("0"))
    return row


BALANCES = {"m7": {"material_id": 7, "material_type_id": 3, "material_name": "LLDPE",
                   "WAREHOUSE": Decimal("300"), "GROUND_FLOOR": Decimal("120"),
                   "FIRST_FLOOR": Decimal("40"), "MACHINES": Decimal("10")}}
D1, D2 = date(2026, 10, 14), date(2026, 10, 15)
MOVES = [
    _move(D1, "AM", "RAW_INPUT", warehouse=500),
    _move(D1, "AM", "FLOOR_TRANSFER", warehouse=-200, ground_floor=200),
    _move(D1, "PM", "PRODUCTION", ground_floor=-50),
    _move(D2, "AM", "STOCK_TRANSFER", ground_floor=-40, first_floor=40),
    _move(D2, "AM", "STOCK_TRANSFER", ground_floor=-10, machines=10),
    _move(D2, "PM", "PRODUCTION", ground_floor=-30),
    _move(D2, "PM", "STOCK_RETURN", warehouse=-0.5),
]


def _plant(ledger, field):
    return ledger["materials"][0]["locations"]["PLANT"][field]


def test_today_closing_equals_live_stock():
    ledger = compute_day_ledger(BALANCES, MOVES, D2)
    locs = ledger["materials"][0]["locations"]
    assert locs["WAREHOUSE"]["closing_kg"] == 300
    assert locs["GROUND_FLOOR"]["closing_kg"] == 120
    assert locs["FIRST_FLOOR"]["closing_kg"] == 40
    assert locs["MACHINES"]["closing_kg"] == 10
    assert _plant(ledger, "closing_kg") == 470


def test_yesterdays_closing_is_todays_opening():
    yesterday = compute_day_ledger(BALANCES, MOVES, D1)
    today = compute_day_ledger(BALANCES, MOVES, D2)
    for loc in ("WAREHOUSE", "GROUND_FLOOR", "FIRST_FLOOR", "MACHINES", "PLANT"):
        assert (yesterday["materials"][0]["locations"][loc]["closing_kg"]
                == today["materials"][0]["locations"][loc]["opening_kg"])


def test_am_closing_is_pm_opening_and_shift_flows_add_up():
    gf = compute_day_ledger(BALANCES, MOVES, D2)["materials"][0]["locations"]["GROUND_FLOOR"]
    assert gf["opening_kg"] == 200
    assert gf["am"]["out_kg"] == 50 and gf["am"]["closing_kg"] == 150
    assert gf["pm"]["opening_kg"] == 150 and gf["pm"]["out_kg"] == 30
    assert gf["closing_kg"] == 120
    assert gf["transfer_out_kg"] == 50 and gf["consumed_kg"] == 30


def test_transfers_never_change_plant_total_but_usage_and_returns_do():
    today = compute_day_ledger(BALANCES, MOVES, D2)
    assert _plant(today, "opening_kg") == 500.5
    assert _plant(today, "consumed_kg") == 30
    assert _plant(today, "returned_kg") == 0.5
    assert _plant(today, "transfer_in_kg") == _plant(today, "transfer_out_kg") == 50
    assert _plant(today, "closing_kg") == 470


def test_day_before_ledger_starts_carries_flat_balance():
    before = compute_day_ledger(BALANCES, MOVES, date(2026, 10, 13))
    assert _plant(before, "opening_kg") == _plant(before, "closing_kg") == 50.5

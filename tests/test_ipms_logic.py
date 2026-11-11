from decimal import Decimal

from ipms_logic import (
    allocate_auto, day_register, location_accepts, merge_lines, normalize_product_code,
    shift_report, stock_status,
)


def test_stock_status_bands_are_10_and_20_tons():
    assert stock_status(0) == "REORDER"
    assert stock_status(9999.999) == "REORDER"
    assert stock_status(10000) == "BUFFER"
    assert stock_status(20000) == "BUFFER"
    assert stock_status(20000.001) == "OPTIMAL"


def test_stock_status_uses_per_material_override():
    assert stock_status(600, 500, 1000) == "BUFFER"
    assert stock_status(400, 500, 1000) == "REORDER"


def test_product_codes_collapse_spelling_variants():
    assert normalize_product_code("12*13*30mic") == normalize_product_code("12 * 13 * 30 MIC") == "12*13*30MIC"
    assert normalize_product_code("10*250G") == normalize_product_code("10*250*G") == normalize_product_code("10x250g")
    assert normalize_product_code("10X5X16X300G") == "10*5*16*300G"
    assert normalize_product_code("  ") == ""


def test_locations_only_hold_their_own_kind():
    assert location_accepts("MATERIAL", None, "GROUND_FLOOR")
    assert location_accepts("MATERIAL", None, "FIRST_FLOOR")
    assert not location_accepts("MATERIAL", None, "ROLL_STORE")
    assert location_accepts("PRODUCT", "ROLL", "ROLL_STORE")
    assert not location_accepts("PRODUCT", "ROLL", "FINISHED_STORE")
    assert location_accepts("PRODUCT", "FINISHED", "FINISHED_STORE")
    assert not location_accepts("MATERIAL", None, "WAREHOUSE")


def test_merge_lines_nets_same_key_and_drops_zero():
    merged = merge_lines([("MATERIAL", 1, "GROUND_FLOOR", 5), ("MATERIAL", 1, "GROUND_FLOOR", -5),
                          ("MATERIAL", 2, "FIRST_FLOOR", "2.5")])
    assert merged == {("MATERIAL", 2, "FIRST_FLOOR"): Decimal("2.5")}


def test_auto_allocation_takes_first_floor_then_ground_floor():
    assert allocate_auto(100, 30, 500) == [("FIRST_FLOOR", Decimal("30")), ("GROUND_FLOOR", Decimal("70"))]
    assert allocate_auto(20, 30, 0) == [("FIRST_FLOOR", Decimal("20"))]
    assert allocate_auto(20, 0, 0) == [("GROUND_FLOOR", Decimal("20"))]


def test_day_register_opening_received_issued_closing():
    rows = [
        # opening stock from earlier receipts
        {"item_kind": "MATERIAL", "item_id": 1, "location": "GROUND_FLOOR", "before_kg": 1000, "day_delta_kg": None},
        # received today
        {"item_kind": "MATERIAL", "item_id": 1, "location": "GROUND_FLOOR", "before_kg": None, "day_delta_kg": 250},
        # moved up to 1st floor today
        {"item_kind": "MATERIAL", "item_id": 1, "location": "GROUND_FLOOR", "before_kg": None, "day_delta_kg": -400},
        # a receipt entered and reversed on the same day counts as neither
        {"item_kind": "MATERIAL", "item_id": 1, "location": "GROUND_FLOOR", "before_kg": None, "day_delta_kg": 0},
    ]
    [line] = day_register(rows)
    assert line["opening_kg"] == 1000
    assert line["received_kg"] == 250
    assert line["issued_kg"] == 400
    assert line["closing_kg"] == 850
    assert line["status"] == "REORDER"


def test_shift_report_matches_plant_sheet_arithmetic():
    entries = [
        {"shift": "AM", "kind": "EXTRUSION", "gross_kg": 355.7, "wastage_kg": 10},
        {"shift": "AM", "kind": "EXTRUSION", "gross_kg": 615.9, "wastage_kg": 16.5},
        {"shift": "AM", "kind": "CUTTING", "gross_kg": 791.8, "wastage_kg": 6.3},
        {"shift": "PM", "kind": "EXTRUSION", "gross_kg": 1363.1, "wastage_kg": 14},
    ]
    rep = shift_report(entries)
    assert float(rep["AM"]["plant"]["gross_kg"]) == 971.6
    assert float(rep["AM"]["plant"]["wastage_kg"]) == 26.5
    assert float(rep["AM"]["plant"]["net_kg"]) == 945.1
    assert float(rep["AM"]["cutting"]["net_kg"]) == 785.5
    assert float(rep["day_and_night"]["plant"]["net_kg"]) == 945.1 + 1349.1

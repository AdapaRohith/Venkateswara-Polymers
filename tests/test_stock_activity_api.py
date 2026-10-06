import os

os.environ.setdefault("JWT_SECRET", "test-secret-longer-than-sixteen-characters")

from server import (
    build_stock_activity_filters,
    can_modify_entry,
    normalize_activity_row,
    parse_activity_limit,
)


def test_worker_cannot_modify_another_workers_entry():
    assert can_modify_entry({"id": 9, "role": "worker"}, created_by=10) is False


def test_worker_can_modify_own_entry():
    assert can_modify_entry({"id": 9, "role": "worker"}, created_by=9) is True


def test_owner_can_modify_any_reversible_entry():
    assert can_modify_entry({"id": 1, "role": "owner"}, created_by=10) is True


def test_activity_row_maps_production_to_source_page():
    row = normalize_activity_row({
        "id": 4, "source_domain": "PRODUCTION", "source_id": 21,
        "action": "REVERSE", "quantity_kg": 30,
    })
    assert row["entry_path"] == "/production-log"
    assert row["action_label"] == "Production reversed"


def test_activity_row_marks_legacy_entries_read_only():
    row = normalize_activity_row({
        "id": 7, "source_domain": "RAW_INPUT", "source_id": 8,
        "action": "LEGACY", "quantity_kg": 10,
    })
    assert row["is_legacy"] is True
    assert row["entry_path"] == "/raw-material"


def test_activity_limit_is_capped_at_1000():
    assert parse_activity_limit("5000") == 1000
    assert parse_activity_limit("nope") == 200


def test_activity_filters_are_parameterized():
    where, values = build_stock_activity_filters(
        date_from="2026-10-01", date_to="2026-10-31", material_id="7",
        source_domain="PRODUCTION' OR TRUE --", action="CREATE", operator_id="9",
    )
    assert "PRODUCTION' OR TRUE --" not in where
    assert "$1" in where and "$6" in where
    assert values[3] == "PRODUCTION' OR TRUE --"

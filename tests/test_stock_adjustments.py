import os
from decimal import Decimal

import pytest

os.environ.setdefault("JWT_SECRET", "test-secret-longer-than-sixteen-characters")

from fastapi import HTTPException

from server import adjust_raw_material, apply_manual_stock_adjustment, normalize_stock_adjustment


class FakeConnection:
    def __init__(self, opening=100.0, fail_audit=False):
        self.total = Decimal(str(opening))
        self.fail_audit = fail_audit
        self.audit_args = None
        self.mirror_material_ids = []

    def is_in_transaction(self):
        return True

    async def fetchval(self, query, *args):
        if "SELECT total_quantity_kg" in query and "FOR UPDATE" in query:
            return self.total
        raise AssertionError(f"Unexpected fetchval: {query}")

    async def fetchrow(self, query, *args):
        if "SELECT total_quantity_kg" in query and "FOR UPDATE" in query:
            return {"total_quantity_kg": self.total}
        raise AssertionError(f"Unexpected fetchrow: {query}")

    async def execute(self, query, *args):
        if "INSERT INTO raw_material_totals" in query:
            self.total += Decimal(str(args[1]))
            return "INSERT 0 1"
        if "UPDATE raw_material_totals" in query:
            self.total -= Decimal(str(args[0]))
            return "UPDATE 1"
        if "INSERT INTO stock_adjustments" in query:
            if self.fail_audit:
                raise RuntimeError("audit insert failed")
            self.audit_args = args
            return "INSERT 0 1"
        raise AssertionError(f"Unexpected execute: {query}")


@pytest.mark.parametrize(
    "body, expected",
    [
        (
            {"material_name": "  LLDPE ", "operation": "ADD", "quantity_kg": "12.5", "reason": " Count correction "},
            ("LLDPE", "add", 12.5, "Count correction"),
        ),
        (
            {"material_name": "White M.B", "operation": "remove", "quantity_kg": 2, "reason": "Damaged bag"},
            ("White M.B", "remove", 2.0, "Damaged bag"),
        ),
    ],
)
def test_normalize_stock_adjustment_accepts_valid_signed_actions(body, expected):
    assert normalize_stock_adjustment(body) == expected


@pytest.mark.parametrize(
    "body, detail",
    [
        ({"material_name": "", "operation": "add", "quantity_kg": 1, "reason": "x"}, "Material name is required"),
        ({"material_name": "LLDPE", "operation": "set", "quantity_kg": 1, "reason": "x"}, "Operation must be add or remove"),
        ({"material_name": "LLDPE", "operation": "add", "quantity_kg": 0, "reason": "x"}, "Quantity must be greater than zero"),
        ({"material_name": "LLDPE", "operation": "add", "quantity_kg": 1, "reason": "  "}, "Reason is required"),
    ],
)
def test_normalize_stock_adjustment_rejects_invalid_input(body, detail):
    with pytest.raises(HTTPException) as exc:
        normalize_stock_adjustment(body)
    assert exc.value.status_code == 400
    assert exc.value.detail == detail


@pytest.mark.asyncio
async def test_adjust_raw_material_rejects_worker_before_reading_request():
    with pytest.raises(HTTPException) as exc:
        await adjust_raw_material(None, {"id": 9, "role": "worker"})
    assert exc.value.status_code == 403


@pytest.mark.asyncio
async def test_apply_manual_stock_adjustment_adds_and_records_exact_balances(monkeypatch):
    conn = FakeConnection(opening=100)

    async def record_mirror(_conn, material_id):
        conn.mirror_material_ids.append(material_id)

    monkeypatch.setattr("server.mirror_floor_for_master", record_mirror)
    result = await apply_manual_stock_adjustment(conn, 7, "add", 12.5, "Count correction", 3)

    assert result == {"opening_quantity_kg": 100.0, "closing_quantity_kg": 112.5}
    assert conn.total == Decimal("112.5")
    assert conn.audit_args == (7, "add", 12.5, 100.0, 112.5, "Count correction", 3)
    assert conn.mirror_material_ids == [7]


@pytest.mark.asyncio
async def test_apply_manual_stock_adjustment_removes_and_records_exact_balances(monkeypatch):
    conn = FakeConnection(opening=100)

    async def record_mirror(_conn, material_id):
        conn.mirror_material_ids.append(material_id)

    monkeypatch.setattr("server.mirror_floor_for_master", record_mirror)
    result = await apply_manual_stock_adjustment(conn, 7, "remove", 30, "Damaged bags", 3)

    assert result == {"opening_quantity_kg": 100.0, "closing_quantity_kg": 70.0}
    assert conn.total == Decimal("70.0")
    assert conn.audit_args == (7, "remove", 30.0, 100.0, 70.0, "Damaged bags", 3)
    assert conn.mirror_material_ids == [7]


@pytest.mark.asyncio
async def test_apply_manual_stock_adjustment_rejects_overdraw_without_audit(monkeypatch):
    conn = FakeConnection(opening=5)

    async def record_mirror(_conn, material_id):
        conn.mirror_material_ids.append(material_id)

    monkeypatch.setattr("server.mirror_floor_for_master", record_mirror)
    with pytest.raises(HTTPException) as exc:
        await apply_manual_stock_adjustment(conn, 7, "remove", 6, "Count correction", 3)

    assert exc.value.status_code == 400
    assert "Available: 5.000 kg" in exc.value.detail
    assert conn.total == Decimal("5")
    assert conn.audit_args is None
    assert conn.mirror_material_ids == []


@pytest.mark.asyncio
async def test_apply_manual_stock_adjustment_propagates_audit_failure(monkeypatch):
    conn = FakeConnection(opening=100, fail_audit=True)

    async def record_mirror(_conn, material_id):
        conn.mirror_material_ids.append(material_id)

    monkeypatch.setattr("server.mirror_floor_for_master", record_mirror)
    with pytest.raises(RuntimeError, match="audit insert failed"):
        await apply_manual_stock_adjustment(conn, 7, "add", 5, "Count correction", 3)

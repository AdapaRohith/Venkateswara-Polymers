import os
from decimal import Decimal
from uuid import UUID

import pytest

os.environ.setdefault("JWT_SECRET", "test-secret-longer-than-sixteen-characters")

from fastapi import HTTPException

from server import (
    apply_floor_transfer,
    apply_location_delta,
    lock_stock_locations,
    record_stock_activity,
    reverse_floor_transfer,
    update_floor_transfer_stock,
)


class LedgerFakeConnection:
    def __init__(self, warehouse=500, floor=50, fail_activity=False):
        self.warehouse = Decimal(str(warehouse))
        self.floor = Decimal(str(floor))
        self.fail_activity = fail_activity
        self.lock_order = []
        self.machine_syncs = []
        self.activity_rows = []

    def is_in_transaction(self):
        return True

    async def fetchrow(self, query, *args):
        if "FROM raw_material_totals" in query and "FOR UPDATE" in query:
            self.lock_order.append("warehouse")
            return {"total_quantity_kg": self.warehouse}
        if "FROM floor_material_balance" in query and "FOR UPDATE" in query:
            self.lock_order.append("floor")
            return {"total_quantity_kg": self.floor}
        if "INSERT INTO stock_activity_log" in query:
            if self.fail_activity:
                raise RuntimeError("activity insert failed")
            row = {
                "id": len(self.activity_rows) + 1,
                "action": args[0],
                "source_domain": args[1],
                "source_id": args[2],
                "correlation_id": args[3],
                "material_id": args[4],
                "material_type_id": args[5],
                "quantity_kg": Decimal(str(args[6])),
            }
            self.activity_rows.append(row)
            return row
        raise AssertionError(f"Unexpected fetchrow: {query}")

    async def execute(self, query, *args):
        if "INSERT INTO floor_material_balance" in query:
            return "INSERT 0 0"
        if "UPDATE raw_material_totals" in query:
            self.warehouse = Decimal(str(args[0]))
            return "UPDATE 1"
        if "UPDATE floor_material_balance" in query:
            self.floor = Decimal(str(args[0]))
            return "UPDATE 1"
        raise AssertionError(f"Unexpected execute: {query}")


@pytest.mark.asyncio
async def test_lock_stock_locations_uses_consistent_warehouse_then_floor_order():
    conn = LedgerFakeConnection()

    balances = await lock_stock_locations(conn, material_id=7, material_type_id=3)

    assert conn.lock_order == ["warehouse", "floor"]
    assert balances == {"warehouse_kg": Decimal("500"), "floor_kg": Decimal("50")}


@pytest.mark.asyncio
async def test_location_delta_moves_stock_without_changing_plant_total(monkeypatch):
    conn = LedgerFakeConnection(warehouse=Decimal("500"), floor=Decimal("50"))

    async def sync_machine(_conn, material_type_id):
        conn.machine_syncs.append(material_type_id)

    monkeypatch.setattr("server.sync_machine_assignments", sync_machine)
    receipt = await apply_location_delta(
        conn,
        material_id=7,
        material_type_id=3,
        warehouse_delta=-Decimal("100"),
        floor_delta=Decimal("100"),
    )

    assert receipt == {
        "warehouse_opening_kg": 500.0,
        "warehouse_closing_kg": 400.0,
        "floor_opening_kg": 50.0,
        "floor_closing_kg": 150.0,
        "plant_opening_kg": 550.0,
        "plant_closing_kg": 550.0,
    }
    assert conn.warehouse == Decimal("400")
    assert conn.floor == Decimal("150")
    assert conn.machine_syncs == [3]


@pytest.mark.asyncio
async def test_location_delta_rejects_warehouse_overdraw_without_updates(monkeypatch):
    conn = LedgerFakeConnection(warehouse=5, floor=10)
    monkeypatch.setattr("server.sync_machine_assignments", lambda *_args: None)

    with pytest.raises(HTTPException) as exc:
        await apply_location_delta(
            conn, material_id=7, material_type_id=3,
            warehouse_delta=-6, floor_delta=6,
        )

    assert exc.value.status_code == 400
    assert "Warehouse Stock" in exc.value.detail
    assert conn.warehouse == Decimal("5")
    assert conn.floor == Decimal("10")


@pytest.mark.asyncio
async def test_location_delta_rejects_floor_overdraw_without_updates(monkeypatch):
    conn = LedgerFakeConnection(warehouse=20, floor=5)
    monkeypatch.setattr("server.sync_machine_assignments", lambda *_args: None)

    with pytest.raises(HTTPException) as exc:
        await apply_location_delta(
            conn, material_id=7, material_type_id=3,
            warehouse_delta=0, floor_delta=-6,
        )

    assert exc.value.status_code == 400
    assert "Floor Stock" in exc.value.detail
    assert conn.warehouse == Decimal("20")
    assert conn.floor == Decimal("5")


@pytest.mark.asyncio
async def test_record_stock_activity_propagates_insert_failure():
    conn = LedgerFakeConnection(fail_activity=True)
    balances = {
        "warehouse_opening_kg": 500.0,
        "warehouse_closing_kg": 400.0,
        "floor_opening_kg": 50.0,
        "floor_closing_kg": 150.0,
        "plant_opening_kg": 550.0,
        "plant_closing_kg": 550.0,
    }

    with pytest.raises(RuntimeError, match="activity insert failed"):
        await record_stock_activity(
            conn,
            action="CREATE",
            source_domain="FLOOR_TRANSFER",
            source_id=12,
            correlation_id=UUID(int=12),
            material_id=7,
            material_type_id=3,
            quantity_kg=100,
            balances=balances,
            reason="Move to line 1",
            created_by=9,
        )


@pytest.mark.asyncio
async def test_floor_transfer_decreases_warehouse_and_increases_floor(monkeypatch):
    conn = LedgerFakeConnection(warehouse=500, floor=50)

    async def sync_machine(_conn, material_type_id):
        conn.machine_syncs.append(material_type_id)

    monkeypatch.setattr("server.sync_machine_assignments", sync_machine)
    result = await apply_floor_transfer(
        conn,
        source_id=12,
        material_id=7,
        material_type_id=3,
        quantity_kg=100,
        created_by=9,
        correlation_id=UUID(int=12),
    )

    assert conn.warehouse == Decimal("400")
    assert conn.floor == Decimal("150")
    assert result["plant_closing_kg"] == 550.0
    assert result["activity_id"] == 1
    assert conn.activity_rows[-1]["source_domain"] == "FLOOR_TRANSFER"


@pytest.mark.asyncio
async def test_floor_transfer_update_applies_only_quantity_delta(monkeypatch):
    conn = LedgerFakeConnection(warehouse=400, floor=150)

    async def sync_machine(_conn, _material_type_id):
        return None

    monkeypatch.setattr("server.sync_machine_assignments", sync_machine)
    result = await update_floor_transfer_stock(
        conn,
        {"id": 12, "material_id": 7, "material_type_id": 3, "quantity_kg": 100, "activity_id": 1},
        new_quantity_kg=60,
        created_by=9,
    )

    assert conn.warehouse == Decimal("440")
    assert conn.floor == Decimal("110")
    assert result["warehouse_closing_kg"] == 440.0
    assert result["floor_closing_kg"] == 110.0
    assert conn.activity_rows[-1]["action"] == "UPDATE"


@pytest.mark.asyncio
async def test_delete_floor_transfer_restores_exact_original_quantity(monkeypatch):
    conn = LedgerFakeConnection(warehouse=400, floor=150)

    async def sync_machine(_conn, _material_type_id):
        return None

    monkeypatch.setattr("server.sync_machine_assignments", sync_machine)
    result = await reverse_floor_transfer(
        conn,
        {"id": 12, "material_id": 7, "material_type_id": 3, "quantity_kg": 100, "activity_id": 1},
        created_by=9,
    )

    assert conn.warehouse == Decimal("500")
    assert conn.floor == Decimal("50")
    assert result["activity_id"] == 1
    assert conn.activity_rows[-1]["action"] == "REVERSE"


@pytest.mark.asyncio
async def test_delete_floor_transfer_rejects_quantity_already_consumed(monkeypatch):
    conn = LedgerFakeConnection(warehouse=400, floor=40)

    async def sync_machine(_conn, _material_type_id):
        return None

    monkeypatch.setattr("server.sync_machine_assignments", sync_machine)
    with pytest.raises(HTTPException) as exc:
        await reverse_floor_transfer(
            conn,
            {"id": 12, "material_id": 7, "material_type_id": 3, "quantity_kg": 100, "activity_id": 1},
            created_by=9,
        )

    assert exc.value.status_code == 400
    assert "only 40.000 kg of its 100.000 kg remains on the floor" in exc.value.detail
    assert conn.warehouse == Decimal("400")
    assert conn.floor == Decimal("40")


@pytest.mark.asyncio
async def test_concurrent_floor_transfers_cannot_overdraw_available_stock(monkeypatch):
    conn = LedgerFakeConnection(warehouse=100, floor=0)

    async def sync_machine(_conn, _material_type_id):
        return None

    monkeypatch.setattr("server.sync_machine_assignments", sync_machine)
    await apply_floor_transfer(
        conn, source_id=1, material_id=7, material_type_id=3,
        quantity_kg=70, created_by=9, correlation_id=UUID(int=1),
    )
    with pytest.raises(HTTPException, match="Available: 30.000 kg"):
        await apply_floor_transfer(
            conn, source_id=2, material_id=7, material_type_id=3,
            quantity_kg=70, created_by=9, correlation_id=UUID(int=2),
        )

    assert conn.warehouse == Decimal("30")
    assert conn.floor == Decimal("70")

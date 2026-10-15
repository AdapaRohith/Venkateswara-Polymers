"""End-to-end IPMS scenario against a running API backed by a disposable database.

    VP_E2E_BASE_URL=http://127.0.0.1:3011 \
    VP_E2E_OWNER=e2e-owner@staging.local VP_E2E_WORKER=e2e-worker@staging.local \
    VP_E2E_PASSWORD=... python -m pytest -q tests/e2e

Never point this at production: it creates a material, moves it through every
location, records a return and closes a day.
"""
import os
import uuid
from datetime import date, timedelta

import httpx
import pytest

BASE = os.getenv("VP_E2E_BASE_URL")
pytestmark = pytest.mark.skipif(not BASE, reason="VP_E2E_BASE_URL not set")
if BASE and ("avlokai.com" in BASE or BASE.rstrip("/").endswith(":3000")):
    raise RuntimeError("Refusing to run the destructive E2E scenario against production")

LOCS = ("WAREHOUSE", "GROUND_FLOOR", "FIRST_FLOOR", "MACHINES", "PLANT")
STATE: dict = {}


def login(email):
    r = httpx.post(f"{BASE}/auth/login", json={"email": email, "password": os.environ["VP_E2E_PASSWORD"]})
    assert r.status_code == 200, r.text
    return httpx.Client(base_url=BASE, headers={"Authorization": f"Bearer {r.json()['token']}"}, timeout=30)


@pytest.fixture(scope="module")
def owner():
    return login(os.environ["VP_E2E_OWNER"])


@pytest.fixture(scope="module")
def worker():
    return login(os.environ["VP_E2E_WORKER"])


def ok(response, status=200):
    assert response.status_code == status, f"{response.status_code}: {response.text}"
    return response.json()


def ledger(client, day):
    data = ok(client.get("/stock/ledger", params={"date": day.isoformat()}))
    row = next((m for m in data["materials"] if m["material_name"] == STATE["material"]), None)
    return data, row


def loc(row, name, field="closing_kg"):
    return row["locations"][name][field] if row else 0.0


def test_01_setup_material_and_dates(owner):
    meta = ok(owner.get("/stock/meta"))
    assert meta["bag_kg"] == 25
    assert {m["floor"] for m in meta["machines"]} == {"GROUND_FLOOR", "FIRST_FLOOR"}
    today = date.fromisoformat(meta["live_business_date"])
    STATE.update(d0=today - timedelta(days=2), d1=today - timedelta(days=1), d2=today,
                 material=f"E2E-IPMS-{uuid.uuid4().hex[:6].upper()}")
    gf = [m for m in meta["machines"] if m["floor"] == "GROUND_FLOOR"]
    ff = [m for m in meta["machines"] if m["floor"] == "FIRST_FLOOR"]
    STATE.update(m1=gf[0]["id"], m2=gf[1]["id"], cut=ff[0]["id"])
    ok(owner.post("/materials", json={"name": STATE["material"]}))
    # 40 bags = 1000 kg received two days ago, morning shift.
    receipt = ok(owner.post("/raw-material/add", json={
        "material_name": STATE["material"], "quantity_bags": 40,
        "business_date": STATE["d0"].isoformat(), "shift": "AM"}))
    assert receipt["impact_receipt"]["warehouse_closing_kg"] == 1000


def test_02_transfers_between_locations_with_bags(owner):
    m, d0, d1 = STATE["material"], STATE["d0"], STATE["d1"]
    t1 = ok(owner.post("/stock/transfers", json={
        "material_name": m, "quantity_kg": 600, "from_location": "WAREHOUSE",
        "to_location": "GROUND_FLOOR", "business_date": d0.isoformat(), "shift": "AM"}))
    assert t1["transfer"]["transfer_no"].startswith(f"ST-{d0:%Y%m%d}-")
    assert t1["impact_receipt"]["warehouse_closing_kg"] == 400
    assert t1["impact_receipt"]["floor_closing_kg"] == 600
    assert t1["impact_receipt"]["plant_opening_kg"] == t1["impact_receipt"]["plant_closing_kg"] == 1000
    t2 = ok(owner.post("/stock/transfers", json={
        "material_name": m, "quantity_bags": 8, "from_location": "WAREHOUSE",
        "to_location": "FIRST_FLOOR", "business_date": d0.isoformat(), "shift": "PM"}))
    assert float(t2["transfer"]["quantity_kg"]) == 200
    assert t2["impact_receipt"]["first_floor_closing_kg"] == 200
    t3 = ok(owner.post("/stock/transfers", json={
        "material_name": m, "quantity_kg": 100, "from_location": "GROUND_FLOOR",
        "to_location": "MACHINE", "to_machine_id": STATE["m1"],
        "business_date": d1.isoformat(), "shift": "AM"}))
    assert t3["impact_receipt"]["machine_closing_kg"] == 100
    assert t3["impact_receipt"]["floor_closing_kg"] == 500
    STATE["machine_transfer"] = t3["transfer"]["id"]


def test_03_invalid_routes_are_rejected(owner):
    m = STATE["material"]
    cases = [
        ({"from_location": "WAREHOUSE", "to_location": "MACHINE", "to_machine_id": STATE["m1"]}, "machine's floor"),
        ({"from_location": "FIRST_FLOOR", "to_location": "MACHINE", "to_machine_id": STATE["m1"]}, "Ground Floor"),
        ({"from_location": "MACHINE", "from_machine_id": STATE["m1"], "to_location": "MACHINE",
          "to_machine_id": STATE["m2"]}, "Release machine stock"),
        ({"from_location": "FIRST_FLOOR", "to_location": "GROUND_FLOOR", "quantity_kg": 99999}, "Insufficient First Floor"),
    ]
    for extra, message in cases:
        body = {"material_name": m, "quantity_kg": 10, **extra}
        r = owner.post("/stock/transfers", json=body)
        assert r.status_code == 400 and message in r.text, (extra, r.text)


def test_04_production_batch_ground_floor_only(owner):
    m, d1 = STATE["material"], STATE["d1"]
    rejected = owner.post("/production/batches", json={
        "business_date": d1.isoformat(), "shift": "PM",
        "lines": [{"machine_id": STATE["cut"], "material_name": m, "net_weight": 10}]})
    assert rejected.status_code == 400 and "Ground Floor" in rejected.text
    batch = ok(owner.post("/production/batches", json={
        "business_date": d1.isoformat(), "shift": "PM", "note": "E2E night batch",
        "lines": [
            {"machine_id": STATE["m1"], "material_name": m, "gross_weight": 160, "tare_weight": 10, "size": "E2E-24x36"},
            {"machine_id": STATE["m2"], "material_name": m, "net_weight": 80},
        ]}))["batch"]
    assert batch["batch_no"].startswith(f"PB-{d1:%Y%m%d}-PM-")
    assert batch["total_net_kg"] == 230
    assert batch["from_machine_kg"] == 100       # machine 1's own stock first
    assert batch["from_ground_floor_kg"] == 130  # remainder from Ground Floor
    STATE["batch"] = batch


def test_05_return_removes_stock_and_is_owner_only(owner, worker):
    m, d2 = STATE["material"], STATE["d2"]
    body = {"material_name": m, "quantity_bags": 2, "location": "FIRST_FLOOR",
            "business_date": d2.isoformat(), "shift": "AM", "returned_to": "E2E Supplier",
            "reason": "E2E quality reject"}
    assert worker.post("/stock/returns", json=body).status_code == 403
    assert owner.post("/stock/returns", json={**body, "reason": " "}).status_code == 400
    ret = ok(owner.post("/stock/returns", json=body))["return"]
    assert float(ret["quantity_kg"]) == 50
    STATE["return_no"] = ret["return_no"]


def test_06_live_balances(owner):
    overview = ok(owner.get("/stock/overview"))
    row = next(r for r in overview["materials"] if r["material_name"] == STATE["material"])
    assert (row["warehouse_kg"], row["ground_floor_kg"], row["first_floor_kg"], row["machines_kg"],
            row["plant_kg"]) == (200, 370, 150, 0, 720)


def test_07_closing_carries_forward_to_next_opening(owner):
    days = [STATE["d0"] - timedelta(days=1), STATE["d0"], STATE["d1"], STATE["d2"]]
    ledgers = [ledger(owner, d)[1] for d in days]
    for prev, nxt in zip(ledgers, ledgers[1:]):
        for name in LOCS:
            assert loc(prev, name, "closing_kg") == loc(nxt, name, "opening_kg"), name
    before, d0, d1, d2 = ledgers
    assert before is None or loc(before, "PLANT") == 0
    assert loc(d0, "WAREHOUSE", "received_kg") == 1000
    assert (loc(d0, "WAREHOUSE"), loc(d0, "GROUND_FLOOR"), loc(d0, "FIRST_FLOOR")) == (200, 600, 200)
    # AM closing is PM opening, per location.
    gf = d1["locations"]["GROUND_FLOOR"]
    assert gf["am"]["closing_kg"] == gf["pm"]["opening_kg"] == 500
    assert gf["pm"]["out_kg"] == 130 and gf["closing_kg"] == 370
    mc = d1["locations"]["MACHINES"]
    assert (mc["opening_kg"], mc["am"]["in_kg"], mc["pm"]["out_kg"], mc["closing_kg"]) == (0, 100, 100, 0)
    assert d1["locations"]["PLANT"]["consumed_kg"] == 230
    assert d1["locations"]["PLANT"]["transfer_in_kg"] == d1["locations"]["PLANT"]["transfer_out_kg"]
    assert d2["locations"]["PLANT"]["returned_kg"] == 50
    assert d2["locations"]["PLANT"]["consumed_kg"] == 0
    assert loc(d2, "PLANT") == 720


def test_08_usage_is_day_wise_and_excludes_returns(owner):
    usage = ok(owner.get("/stock/usage", params={"date_from": STATE["d0"].isoformat(),
                                                 "date_to": STATE["d2"].isoformat()}))
    by_day = {d["business_date"]: d for d in usage["days"]}
    d1 = by_day[STATE["d1"].isoformat()]
    mine = next(i for i in d1["materials"] if i["material_name"] == STATE["material"])
    assert (mine["am_kg"], mine["pm_kg"], mine["from_machine_kg"], mine["from_ground_floor_kg"]) == (0, 230, 100, 130)
    d2 = by_day[STATE["d2"].isoformat()]
    assert all(i["material_name"] != STATE["material"] for i in d2["materials"])


def test_09_returns_hidden_from_feed_but_found_by_search(owner):
    feed = ok(owner.get("/stock/activity", params={"limit": 1000}))
    assert all(i["source_domain"] != "STOCK_RETURN" for i in feed["items"])
    with_returns = ok(owner.get("/stock/activity", params={"limit": 1000, "include_returns": 1}))
    assert any(i["source_domain"] == "STOCK_RETURN" for i in with_returns["items"])
    found = ok(owner.get("/stock/search", params={"q": STATE["return_no"]}))
    assert found["results"][0]["kind"] == "RETURN" and found["results"][0]["status"] == "RETURNED"
    by_material = ok(owner.get("/stock/search", params={"q": STATE["material"]}))
    kinds = {r["kind"] for r in by_material["results"]}
    assert {"RETURN", "STOCK", "BATCH", "TRANSFER", "PRODUCTION", "RECEIPT"} <= kinds
    returns = ok(owner.get("/stock/returns", params={"q": "E2E Supplier"}))
    assert any(r["return_no"] == STATE["return_no"] for r in returns)


def test_10_day_close_locks_workers_out_and_tracks_variance(owner, worker):
    d1, m = STATE["d1"], STATE["material"]
    assert worker.post("/stock/day-close", json={"business_date": d1.isoformat()}).status_code == 403
    closed = ok(owner.post("/stock/day-close", json={"business_date": d1.isoformat(), "note": "E2E close"}))
    assert closed["ledger"]["day_closing"]["variance"] == []
    body = {"material_name": m, "quantity_kg": 5, "from_location": "GROUND_FLOOR",
            "to_location": "FIRST_FLOOR", "business_date": d1.isoformat(), "shift": "PM"}
    assert worker.post("/stock/transfers", json=body).status_code == 403
    late = ok(owner.post("/stock/transfers", json=body))
    data, _ = ledger(owner, d1)
    assert data["day_closing"]["variance"] == []  # moves within the plant: plant closing unchanged
    ok(owner.delete(f"/stock/transfers/{late['transfer']['id']}"))
    again = owner.delete(f"/stock/transfers/{late['transfer']['id']}")
    assert again.status_code == 400 and "already been reversed" in again.text


def test_11_reversing_batch_restores_machine_and_floor(owner):
    batch = STATE["batch"]
    ok(owner.delete(f"/production/batches/{batch['id']}"))
    overview = ok(owner.get("/stock/overview"))
    row = next(r for r in overview["materials"] if r["material_name"] == STATE["material"])
    assert (row["ground_floor_kg"], row["machines_kg"], row["plant_kg"]) == (500, 100, 950)
    batches = ok(owner.get("/production/batches", params={"date_from": STATE["d1"].isoformat(),
                                                          "date_to": STATE["d1"].isoformat()}))
    assert next(b for b in batches if b["id"] == batch["id"])["status"] == "REVERSED"
    # Reversal is filed on the batch's own day, so that day's usage disappears.
    _, d1 = ledger(owner, STATE["d1"])
    assert d1["locations"]["PLANT"]["consumed_kg"] == 0
    data, _ = ledger(owner, STATE["d1"])
    assert any(v["material_name"] == STATE["material"] and v["difference_kg"] == 230
               for v in data["day_closing"]["variance"])


def test_12_transfer_reversal_refuses_when_destination_is_short(owner):
    # Machine 1 holds 100 kg again; consume 60 so only 40 remains.
    type_id = next(r["material_type_id"] for r in ok(owner.get("/stock/overview"))["materials"]
                   if r["material_name"] == STATE["material"])
    ok(owner.post("/production/logs", json={
        "machine_id": STATE["m1"], "material_type_id": type_id,
        "gross_weight": 60, "tare_weight": 0, "business_date": STATE["d2"].isoformat(), "shift": "PM"}))
    r = owner.delete(f"/stock/transfers/{STATE['machine_transfer']}")
    assert r.status_code == 400 and "no longer holds" in r.text


def test_13_existing_screens_still_answer(owner, worker):
    for path in ("/floor/stock", "/raw-material/totals", "/production/logs", "/stock/activity",
                 "/floor/transactions", "/raw-material/batches", "/machines", "/stock/machines",
                 "/stock/day-closings", "/stock/transfers"):
        ok(owner.get(path))
    ok(worker.get("/stock/activity", params={"limit": 5}))
    assert worker.get("/raw-material/adjustments").status_code == 403

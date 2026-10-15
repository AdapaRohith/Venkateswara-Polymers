"""Reversible live end-to-end check on a dedicated material.

Creates material IPMS-LIVE-CHECK, receives 4 bags, moves it through every location,
runs a Ground Floor batch, then reverses every step so the material ends at 0 kg.
Touches no existing row (verified separately with fingerprint.py).
"""
import sys
import time

import httpx
from jose import jwt

SECRET, BASE = sys.argv[1], "http://127.0.0.1:3000"
token = jwt.encode({"user_id": 1, "role": "owner", "iat": int(time.time()),
                    "exp": int(time.time()) + 600}, SECRET, algorithm="HS256")
c = httpx.Client(base_url=BASE, headers={"Authorization": f"Bearer {token}"}, timeout=30)
M = "IPMS-LIVE-CHECK"
ok_count = 0


def ok(r, status=200):
    global ok_count
    if r.status_code != status:
        raise SystemExit(f"FAIL {r.request.method} {r.request.url.path}: {r.status_code} {r.text}")
    ok_count += 1
    return r.json()


def balances():
    rows = ok(c.get("/stock/overview"))["materials"]
    row = next((r for r in rows if r["material_name"] == M), None)
    if not row:
        return (0, 0, 0, 0, 0)
    return (row["warehouse_kg"], row["ground_floor_kg"], row["first_floor_kg"], row["machines_kg"], row["plant_kg"])


def check(label, expected):
    got = balances()
    assert got == expected, f"{label}: expected {expected} got {got}"
    print(f"PASS {label:45s} WH/GF/FF/MC/PLANT = {got}")


meta = ok(c.get("/stock/meta"))
day, shift = meta["live_business_date"], meta["live_shift"]
gf = next(m["id"] for m in meta["machines"] if m["floor"] == "GROUND_FLOOR")
ff = next(m["id"] for m in meta["machines"] if m["floor"] == "FIRST_FLOOR")
before = ok(c.get("/stock/ledger", params={"date": day}))["totals"]["PLANT"]

ok(c.post("/materials", json={"name": M}))
raw = ok(c.post("/raw-material/add", json={"material_name": M, "quantity_bags": 4, "note": "IPMS live check"}))
raw_id = raw["data"]["id"]
check("receive 4 bags (100 kg) into Warehouse", (100, 0, 0, 0, 100))
t1 = ok(c.post("/stock/transfers", json={"material_name": M, "quantity_kg": 60, "from_location": "WAREHOUSE",
                                         "to_location": "GROUND_FLOOR", "note": "IPMS live check"}))["transfer"]["id"]
check("Warehouse -> Ground Floor 60 kg", (40, 60, 0, 0, 100))
t2 = ok(c.post("/stock/transfers", json={"material_name": M, "quantity_bags": 1, "from_location": "GROUND_FLOOR",
                                         "to_location": "FIRST_FLOOR", "note": "IPMS live check"}))["transfer"]["id"]
check("Ground Floor -> First Floor 1 bag", (40, 35, 25, 0, 100))
t3 = ok(c.post("/stock/transfers", json={"material_name": M, "quantity_kg": 10, "from_location": "GROUND_FLOOR",
                                         "to_location": "MACHINE", "to_machine_id": gf, "note": "IPMS live check"}))["transfer"]["id"]
check("Ground Floor -> Machine 10 kg", (40, 25, 25, 10, 100))
r = c.post("/production/batches", json={"lines": [{"machine_id": ff, "material_name": M, "net_weight": 1}]})
assert r.status_code == 400 and "Ground Floor" in r.text, r.text
print("PASS First Floor machine rejected from batch")
batch = ok(c.post("/production/batches", json={"note": "IPMS live check", "lines": [
    {"machine_id": gf, "material_name": M, "net_weight": 15, "size": "LIVE-CHECK", "worker_name": "IPMS live check"}]}))["batch"]
assert (batch["from_machine_kg"], batch["from_ground_floor_kg"]) == (10, 5), batch
check("batch 15 kg: 10 from machine, 5 from GF", (40, 20, 25, 0, 85))
led = ok(c.get("/stock/ledger", params={"date": day}))
mine = next(m for m in led["materials"] if m["material_name"] == M)["locations"]["PLANT"]
assert mine["consumed_kg"] == 15 and mine["closing_kg"] == 85 and mine["opening_kg"] == 0, mine
assert led["totals"]["PLANT"]["opening_kg"] == before["opening_kg"], "existing opening changed"
print(f"PASS ledger: opening 0 -> consumed 15 -> closing 85 ({shift} shift); plant opening unchanged")

ok(c.delete(f"/production/batches/{batch['id']}"))
check("reverse batch -> machine 10, GF +5", (40, 25, 25, 10, 100))
for tid, exp, label in ((t3, (40, 35, 25, 0, 100), "reverse GF->Machine"),
                        (t2, (40, 60, 0, 0, 100), "reverse GF->FF"),
                        (t1, (100, 0, 0, 0, 100), "reverse WH->GF")):
    ok(c.delete(f"/stock/transfers/{tid}"))
    check(label, exp)
ok(c.delete(f"/raw-material/batches/{raw_id}"))
check("delete receipt -> back to zero", (0, 0, 0, 0, 0))
after = ok(c.get("/stock/ledger", params={"date": day}))["totals"]["PLANT"]
assert after["closing_kg"] == before["closing_kg"], (before, after)
print(f"PASS plant closing unchanged at {after['closing_kg']} kg; {ok_count} API calls OK")

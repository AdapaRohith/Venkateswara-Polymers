import os
import re
import time
import math
import logging
import asyncio
import orjson
from pathlib import Path
from uuid import uuid4
from contextlib import asynccontextmanager
from decimal import Decimal
from datetime import date as dt_date, datetime, time as dtime, timedelta, timezone

import asyncpg
from dotenv import load_dotenv
from fastapi import FastAPI, Depends, File, Form, HTTPException, Request, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, ORJSONResponse, StreamingResponse
import bcrypt
from jose import JWTError, jwt


def _orjson_default(obj):
    if isinstance(obj, Decimal):
        return float(obj)
    raise TypeError(type(obj))


class AppResponse(ORJSONResponse):
    def render(self, content) -> bytes:
        return orjson.dumps(
            content,
            default=_orjson_default,
            option=orjson.OPT_NON_STR_KEYS | orjson.OPT_SERIALIZE_NUMPY,
        )

load_dotenv()

JWT_SECRET = os.getenv("JWT_SECRET", "")
if not JWT_SECRET or len(JWT_SECRET) < 16:
    raise RuntimeError(
        "JWT_SECRET is missing or too short. Refusing to start — an empty signing key "
        "lets anyone mint an owner token."
    )
JWT_ALGORITHM = "HS256"
# Lifetime for newly issued tokens. Tokens issued before this change carry no `exp`
# and stay valid, so nobody is logged out by the upgrade.
JWT_TTL_SECONDS = int(os.getenv("JWT_TTL_SECONDS", str(30 * 24 * 3600)))
STRICT_TOLERANCE = os.getenv("STRICT_TOLERANCE", "false").lower() == "true"
ISSUE_UPLOAD_DIR = Path(os.getenv("ISSUE_UPLOAD_DIR", "issue_uploads")).resolve()
ISSUE_MAX_FILES = int(os.getenv("ISSUE_MAX_FILES", "5"))
ISSUE_MAX_FILE_MB = int(os.getenv("ISSUE_MAX_FILE_MB", "25"))
ISSUE_ALLOWED_CONTENT_TYPES = {
    "image/jpeg": ".jpg",
    "image/png": ".png",
    "image/webp": ".webp",
    "image/gif": ".gif",
    "video/mp4": ".mp4",
    "video/webm": ".webm",
    "video/quicktime": ".mov",
}

# In-process caches — survive for process lifetime; invalidated on insert
_material_cache: dict[str, int] = {}
_material_type_cache: dict[str, int] = {}
_tolerance_cache: dict = {"value": 10.0, "fetched_at": 0.0}

def pwd_hash(plain: str) -> str:
    return bcrypt.hashpw(plain.encode(), bcrypt.gensalt()).decode()

def pwd_verify(plain: str, hashed: str) -> bool:
    try:
        return bcrypt.checkpw(plain.encode(), hashed.encode())
    except Exception:
        return False

logger = logging.getLogger("uvicorn.error")

# The plant runs on IST and nothing here is multi-region, so the whole stack
# — Postgres session, Python process, and the strings sent to the browser —
# speaks one wall clock. os.environ is set before any datetime.now() call.
APP_TIMEZONE = os.getenv("APP_TIMEZONE", "Asia/Kolkata")
os.environ["TZ"] = APP_TIMEZONE
if hasattr(time, "tzset"):
    time.tzset()


def _parse_clock(text: str, fallback: dtime) -> dtime:
    try:
        return dtime.fromisoformat(text)
    except (TypeError, ValueError):
        return fallback


# The clock time stamped on an entry filed for a past date. Start of the working
# day, so backdated rows sort ahead of anything genuinely logged that day and are
# recognisable as entered-after-the-fact at a glance.
BACKDATED_ENTRY_TIME = _parse_clock(os.getenv("BACKDATED_ENTRY_TIME", "09:00:00"), dtime(9, 0, 0))

pool: asyncpg.Pool = None  # type: ignore


@asynccontextmanager
async def lifespan(app: FastAPI):
    global pool
    pool = await asyncpg.create_pool(
        host=os.getenv("DB_HOST", "localhost"),
        port=int(os.getenv("DB_PORT", "5432")),
        user=os.getenv("DB_USER", ""),
        password=os.getenv("DB_PASSWORD", ""),
        database=os.getenv("DB_NAME", ""),
        min_size=5,
        max_size=20,
        # Every timestamp column is `timestamp without time zone`, so NOW() is
        # truncated using the session time zone. Pinning it to IST means stored
        # wall-clock time is what the floor actually reads off the wall, and
        # `::date` day boundaries fall at IST midnight rather than 05:30 IST.
        server_settings={"timezone": APP_TIMEZONE},
    )
    await initialize_tables()
    yield
    await pool.close()


# A single label only (no dots) in front of the allowed apex domains, so
# `https://evil.attacker.com.avlokai.com.example.net` and friends cannot match, and
# third-party sites parked on shared hosts stay out unless explicitly allowed.
_CORS_EXTRA_ORIGINS = [
    o.strip() for o in os.getenv("CORS_EXTRA_ORIGINS", "").split(",") if o.strip()
]
CORS_ORIGIN_RE = re.compile(
    r"(https://[A-Za-z0-9-]+\.avlokai\.com"
    r"|https://[A-Za-z0-9-]+(-[A-Za-z0-9-]+)*\.vercel\.app"
    r"|https://[A-Za-z0-9-]+\.pages\.dev"
    r"|http://localhost:\d+|http://127\.0\.0\.1:\d+"
    r"|https?://[A-Za-z0-9-]+\.devtunnels\.ms)"
)

CORS_ALLOW_METHODS = {"GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS", "HEAD"}
CORS_ALLOW_HEADERS = {"Content-Type", "Authorization", "X-Internal-Token", "X-Requested-With"}


def _origin_allowed(origin: str) -> bool:
    if not origin:
        return False
    if origin in _CORS_EXTRA_ORIGINS:
        return True
    return bool(CORS_ORIGIN_RE.fullmatch(origin))


def _cors_headers_for_origin(origin: str) -> dict:
    if _origin_allowed(origin):
        return {
            "Access-Control-Allow-Origin": origin,
            "Access-Control-Allow-Credentials": "true",
            "Vary": "Origin",
        }
    return {}


# ── Raw ASGI CORS catch-all ──────────────────────────────────────────────────
# Wraps the FastAPI app at the lowest level so EVERY response gets CORS headers,
# including proxy error pages and responses that bypass Starlette middleware.
class _ASGICorsMiddleware:
    def __init__(self, app, origin_re, allow_methods: set[str], allow_headers: set[str]):
        self.app = app
        self.origin_re = origin_re
        self.allow_methods = allow_methods
        self.allow_headers = allow_headers
        self._allow_headers_str = ", ".join(sorted(
            {h.lower() for h in allow_headers}
            | {"accept", "accept-language", "content-language", "content-type"},
        ))
        self._allow_methods_str = ", ".join(sorted(allow_methods))

    async def __call__(self, scope, receive, send):
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return

        # Decode origin from raw ASGI scope headers
        origin = ""
        for key, val in scope.get("headers", []):
            if key == b"origin":
                origin = val.decode()
                break

        # Handle OPTIONS preflight at the raw ASGI level
        if scope["method"] == "OPTIONS":
            has_acrm = any(k == b"access-control-request-method" for k, _ in scope.get("headers", []))
            if has_acrm:
                if _origin_allowed(origin):
                    await send({
                        "type": "http.response.start",
                        "status": 200,
                        "headers": [
                            (b"access-control-allow-origin", origin.encode()),
                            (b"access-control-allow-credentials", b"true"),
                            (b"access-control-allow-methods", self._allow_methods_str.encode()),
                            (b"access-control-allow-headers", self._allow_headers_str.encode()),
                            (b"access-control-max-age", b"600"),
                            (b"vary", b"Origin"),
                            (b"content-length", b"0"),
                        ],
                    })
                    await send({"type": "http.response.body", "body": b""})
                    return
                # Origin not allowed — let the request proceed, the inner app
                # will return the actual error (401/403/etc.) with CORS headers
                # injected by the send wrapper below.

        # Inject CORS headers into every non-preflight response
        async def send_wrapper(message):
            if message["type"] == "http.response.start" and origin and _origin_allowed(origin):
                headers = list(message.get("headers", []))
                # Only add if not already present (don't double-add)
                existing = {k.lower(): True for k, _ in headers}
                if b"access-control-allow-origin" not in existing:
                    headers.append((b"access-control-allow-origin", origin.encode()))
                if b"access-control-allow-credentials" not in existing:
                    headers.append((b"access-control-allow-credentials", b"true"))
                if b"vary" not in existing:
                    headers.append((b"vary", b"Origin"))
                message["headers"] = headers
            await send(message)

        await self.app(scope, receive, send_wrapper)


app = FastAPI(lifespan=lifespan, default_response_class=AppResponse)

app.add_middleware(
    CORSMiddleware,
    allow_origin_regex=CORS_ORIGIN_RE.pattern,
    allow_credentials=True,
    allow_methods=sorted(CORS_ALLOW_METHODS),
    allow_headers=sorted(CORS_ALLOW_HEADERS),
)


def _cors_headers(request: Request) -> dict:
    return _cors_headers_for_origin(request.headers.get("origin", ""))

# ─────────────────────────── Auth deps ───────────────────────────

# Role and account status live in the database, not in the token. Cached briefly so a
# revoked account or a demoted owner stops working within seconds instead of never.
_ACCOUNT_CACHE_TTL = 30.0
_account_cache: dict[int, tuple[float, dict | None]] = {}


async def _load_account(user_id: int) -> dict | None:
    now = time.monotonic()
    hit = _account_cache.get(user_id)
    if hit and now - hit[0] < _ACCOUNT_CACHE_TTL:
        return hit[1]
    async with pool.acquire() as c:
        r = await c.fetchrow("SELECT id, role, status FROM users WHERE id = $1", user_id)
    account = dict(r) if r else None
    _account_cache[user_id] = (now, account)
    return account


def invalidate_account_cache(user_id=None):
    if user_id is None:
        _account_cache.clear()
        return
    try:
        _account_cache.pop(int(user_id), None)
    except (TypeError, ValueError):
        _account_cache.clear()


async def get_user(request: Request) -> dict:
    header = request.headers.get("Authorization", "")
    parts = header.split(" ")
    if len(parts) != 2 or parts[0] != "Bearer":
        raise HTTPException(401, "Unauthorized")
    try:
        payload = jwt.decode(parts[1], JWT_SECRET, algorithms=[JWT_ALGORITHM])
    except JWTError:
        raise HTTPException(401, "Invalid token")
    derived = payload.get("user_id") or payload.get("id") or payload.get("userId")
    if derived is not None:
        payload.setdefault("id", derived)
        payload.setdefault("user_id", derived)
    uid = user_id_from_token(payload)
    if uid is None:
        raise HTTPException(401, "Invalid token")
    account = await _load_account(uid)
    if not account:
        raise HTTPException(401, "Account no longer exists")
    if str(account.get("status") or "").lower() != "approved":
        raise HTTPException(403, "Account not approved")
    # DB role always wins over whatever the token was minted with.
    payload["role"] = account.get("role")
    return payload


async def owner_only(user: dict = Depends(get_user)) -> dict:
    if user.get("role") != "owner":
        raise HTTPException(403, "Forbidden")
    return user


# ── SSE broadcaster ──────────────────────────────────────────────────────────
_sse_clients: set[asyncio.Queue] = set()

async def broadcast(event_type: str):
    global _sse_clients
    msg = f"event: update\ndata: {{\"type\": \"{event_type}\"}}\n\n"
    dead = set()
    for q in _sse_clients:
        try:
            q.put_nowait(msg)
        except asyncio.QueueFull:
            dead.add(q)
    _sse_clients -= dead

@app.get("/events")
async def sse_stream(request: Request, user=Depends(get_user)):
    q: asyncio.Queue = asyncio.Queue(maxsize=50)
    _sse_clients.add(q)
    async def generator():
        try:
            yield "event: connected\ndata: {}\n\n"
            while True:
                if await request.is_disconnected():
                    break
                try:
                    msg = await asyncio.wait_for(q.get(), timeout=25)
                    yield msg
                except asyncio.TimeoutError:
                    yield ": keepalive\n\n"
        finally:
            _sse_clients.discard(q)
    return StreamingResponse(
        generator(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no", **_cors_headers(request)},
    )


@app.exception_handler(Exception)
async def unhandled_exception_handler(request: Request, exc: Exception):
    logger.exception("Unhandled error: %s", exc)
    return AppResponse(
        status_code=500,
        content={"detail": "Internal server error"},
        headers=_cors_headers(request),
    )


# ─────────────────────────── Helpers ───────────────────────────

def to_num(value, fallback=0.0):
    try:
        v = float(value)
        return v if math.isfinite(v) else fallback
    except (TypeError, ValueError):
        return fallback


def rows(rs) -> list:
    return [dict(r) for r in rs]


def row(r) -> dict | None:
    return dict(r) if r else None


def parse_date(s: str) -> dt_date:
    if isinstance(s, dt_date):
        return s
    try:
        return dt_date.fromisoformat(str(s))
    except (TypeError, ValueError):
        raise HTTPException(400, "Invalid date. Use YYYY-MM-DD")


def parse_required_date(s, field: str = "date") -> dt_date:
    if not s:
        raise HTTPException(400, f"{field} is required")
    return parse_date(s)


def parse_optional_date(s) -> dt_date | None:
    return parse_date(s) if s else None


def parse_entry_timestamp(payload: dict):
    """Honour a caller-supplied entry date so a shift can be logged after the fact.

    Today (or no date at all) returns None, so the column default stands and the
    entry keeps the real clock time it was made at.

    A past date gets BACKDATED_ENTRY_TIME instead of the current clock. When a
    row is typed in says nothing about when the work happened, and stamping "now"
    on it put two entries for the same past shift hours apart purely because one
    was keyed in after lunch. A fixed time keeps every backdated entry for a day
    at the same hour, and reads plainly as "entered later" rather than as a real
    observation.
    """
    raw = (payload or {}).get("production_date") or (payload or {}).get("entry_date") \
        or (payload or {}).get("date")
    d = parse_optional_date(raw)
    if not d or d == dt_date.today():
        return None
    return datetime.combine(d, BACKDATED_ENTRY_TIME)


def build_date_where(date_from, date_to, values: list, column: str) -> str:
    conds = []
    if date_from:
        values.append(parse_date(date_from))
        conds.append(f"{column} >= ${len(values)}::date")
    if date_to:
        values.append(parse_date(date_to))
        conds.append(f"{column} < (${len(values)}::date + INTERVAL '1 day')")
    return f"WHERE {' AND '.join(conds)}" if conds else ""


def is_owner_or_admin(user: dict) -> bool:
    return user.get("role") in {"owner", "admin"}


def require_owner_or_admin(user: dict):
    if not is_owner_or_admin(user):
        raise HTTPException(403, "Forbidden")


def user_id_from_token(user: dict) -> int | None:
    raw = user.get("user_id") or user.get("id") or user.get("userId")
    try:
        return int(raw)
    except (TypeError, ValueError):
        return None


def issue_attachment_url(report_id: int, attachment_id: int) -> str:
    return f"/issue-reports/{report_id}/attachments/{attachment_id}"


def parse_machine_id(value) -> int:
    """Accept 1, '1' or 'M1' from query strings without blowing up on a 500."""
    digits = re.sub(r"\D", "", str(value or ""))
    if not digits:
        raise HTTPException(400, "Invalid machine_id")
    return int(digits)


def get_machine_variants(machine_id) -> list[str]:
    raw = str(machine_id or "").strip()
    if not raw:
        return []
    digits = re.sub(r"\D", "", raw)
    variants = {raw, raw.upper()}
    if digits:
        nd = str(int(digits))
        variants.update([digits, nd, f"M{nd}"])
    return [v for v in variants if v]


def normalize_order_status(s: str) -> str:
    v = str(s or "").strip().lower()
    if v in ("active", "completed", "cancelled"):
        return "completed" if v == "completed" else "cancelled" if v == "cancelled" else "Active"
    return v  # let caller validate


def normalize_movement_type(s: str) -> str:
    v = str(s or "").strip().upper()
    return "ADJUSTMENT" if v == "WASTAGE" else v


def get_expected_qty(payload: dict, actual: float, extra: list = None):
    """The target quantity the caller declared, or None if it declared none.

    Returning `actual` as a fallback made expected == actual, so deviation was always
    0 and the tolerance check could never report a breach. None keeps that case
    honest: the entry is recorded as not measured rather than as passing.
    """
    keys = list(extra or []) + [
        "expected_quantity_kg", "expected_quantity", "expected_net_weight_kg",
        "planned_quantity_kg", "target_quantity_kg", "required_quantity",
    ]
    for k in keys:
        v = payload.get(k)
        if v is not None:
            f = to_num(v, None)
            if f is not None:
                return f
    return None


async def eval_tolerance(expected: float, actual: float, conn) -> dict:
    global _tolerance_cache
    tolerance = _tolerance_cache["value"]
    if time.monotonic() - _tolerance_cache["fetched_at"] > 60:
        try:
            r = await conn.fetchrow("SELECT value FROM system_config WHERE key = 'tolerance_percent' LIMIT 1")
            if r:
                tolerance = to_num(r["value"], 10.0)
            _tolerance_cache = {"value": tolerance, "fetched_at": time.monotonic()}
        except asyncpg.UndefinedTableError:
            _tolerance_cache["fetched_at"] = time.monotonic()
    lower = expected * (1 - tolerance / 100)
    upper = expected * (1 + tolerance / 100)
    deviation = ((actual - expected) / expected * 100) if expected != 0 else 0.0
    status = "BREACH" if (actual < lower or actual > upper) else "OK"
    return {"tolerance_percent": tolerance, "lower_bound": lower, "upper_bound": upper,
            "deviation_percent": deviation, "tolerance_status": status}


async def eval_qty_tolerance(expected, actual: float, conn, ctx: dict = None) -> dict:
    evaluated = expected is not None
    if not evaluated:
        expected = actual
    info = await eval_tolerance(expected, actual, conn)
    if not evaluated:
        # No declared target to measure against — report it, don't pretend it passed.
        info = {**info, "tolerance_status": "OK", "deviation_percent": 0.0}
    elif info["tolerance_status"] == "BREACH":
        logger.warning(f"Tolerance breach: {ctx} expected={expected} actual={actual}")
    return {**info, "expected": expected, "actual": actual, "evaluated": evaluated}


async def get_or_create_material(conn, name: str) -> int:
    n = str(name or "").strip()
    if not n:
        raise ValueError("material_name cannot be empty")
    key = n.lower()
    if key in _material_cache:
        return _material_cache[key]
    r = await conn.fetchrow("SELECT id FROM materials_master WHERE LOWER(name) = LOWER($1) LIMIT 1", n)
    if r:
        _material_cache[key] = r["id"]
        return r["id"]
    r = await conn.fetchrow(
        "INSERT INTO materials_master (name) VALUES ($1) ON CONFLICT (name) DO UPDATE SET name = EXCLUDED.name RETURNING id", n)
    _material_cache[key] = r["id"]
    return r["id"]


async def get_or_create_material_type(conn, name: str) -> int:
    n = str(name or "").strip()
    if not n:
        raise ValueError("material_name cannot be empty")
    key = n.lower()
    if key in _material_type_cache:
        return _material_type_cache[key]
    r = await conn.fetchrow("SELECT id FROM material_types WHERE LOWER(name) = LOWER($1) LIMIT 1", n)
    if r:
        _material_type_cache[key] = r["id"]
        return r["id"]
    r = await conn.fetchrow(
        "INSERT INTO material_types (name) VALUES ($1) ON CONFLICT (name) DO UPDATE SET name = EXCLUDED.name RETURNING id", n)
    _material_type_cache[key] = r["id"]
    return r["id"]


async def get_material_name(conn, material_id) -> str:
    try:
        pid = int(material_id)
        if pid <= 0:
            return ""
    except (TypeError, ValueError):
        return ""
    r = await conn.fetchrow("SELECT name FROM materials_master WHERE id = $1 LIMIT 1", pid)
    return r["name"] if r else ""


async def resolve_material_type_id(conn, material_id, material_name: str):
    try:
        pid = int(material_id) if material_id is not None else 0
    except (TypeError, ValueError):
        pid = 0
    if pid > 0:
        r = await conn.fetchrow("SELECT id FROM material_types WHERE id = $1 LIMIT 1", pid)
        if r:
            return r["id"]
        r = await conn.fetchrow("SELECT name FROM materials_master WHERE id = $1 LIMIT 1", pid)
        if r:
            return await get_or_create_material_type(conn, r["name"])
    mname = str(material_name or "").strip()
    if mname:
        return await get_or_create_material_type(conn, mname)
    return None


def require_tx(conn):
    """Every stock mutation must be inside a transaction — otherwise the
    SELECT ... FOR UPDATE below releases its lock immediately and two concurrent
    writers can both pass the 'enough stock?' check."""
    if not conn.is_in_transaction():
        raise RuntimeError("Stock mutations must run inside a transaction")


async def reverse_raw_batch(conn, batch_row):
    """Undo a raw-material batch's effect on the running total.

    Refuses when the quantity is no longer in raw stock — it has since been issued
    to the floor, or the batch predates a stock reset. Silently skipping the
    reversal would leave the total overstating what is physically there.
    """
    qty = to_num(batch_row["quantity_kg"])
    if qty <= 0:
        return
    available = to_num(await conn.fetchval(
        "SELECT total_quantity_kg FROM raw_material_totals WHERE material_id = $1 FOR UPDATE",
        batch_row["material_id"]))
    if available < qty:
        raise HTTPException(400, (
            f"Cannot delete this entry: only {available:.3f} kg of its {qty:.3f} kg is "
            f"still in raw stock. The material has already been issued to the floor, "
            f"or the entry predates the stock reset."))
    await adjust_raw_total(conn, batch_row["material_id"], -qty)


async def adjust_raw_total(conn, material_id, delta_kg: float):
    require_tx(conn)
    pid = int(material_id)
    delta = to_num(delta_kg)
    if pid <= 0:
        raise ValueError("Invalid material id")
    if not delta:
        return
    # Take the row lock first in both directions so concurrent writers serialise
    # on the same row instead of racing between the check and the update.
    r = await conn.fetchrow(
        "SELECT total_quantity_kg FROM raw_material_totals WHERE material_id = $1 FOR UPDATE", pid)
    if delta > 0:
        await conn.execute(
            """INSERT INTO raw_material_totals (material_id, total_quantity_kg, updated_at)
               VALUES ($1, $2, NOW()) ON CONFLICT (material_id)
               DO UPDATE SET total_quantity_kg = raw_material_totals.total_quantity_kg + $2, updated_at = NOW()""",
            pid, delta)
        await mirror_floor_for_master(conn, pid)
        return
    available = to_num(r["total_quantity_kg"]) if r else 0.0
    required = abs(delta)
    if available < required:
        raise HTTPException(400, f"Insufficient raw stock. Available: {available:.3f} kg")
    await conn.execute(
        "UPDATE raw_material_totals SET total_quantity_kg = total_quantity_kg - $1, updated_at = NOW() WHERE material_id = $2",
        required, pid)
    await mirror_floor_for_master(conn, pid)


async def mirror_floor_for_master(conn, master_id):
    """Refresh the floor mirror for whichever material type shares this name.

    Materials that were never issued to the floor have no `material_types` row and
    nothing to mirror — this deliberately does not create one, so the type list
    stays as short as the operator's picker.
    """
    m = await conn.fetchrow("SELECT name FROM materials_master WHERE id = $1", master_id)
    if not m:
        return
    t = await conn.fetchrow(
        "SELECT id FROM material_types WHERE LOWER(name) = LOWER($1) LIMIT 1", m["name"])
    if t:
        await mirror_floor_from_raw(conn, t["id"], master_id)


async def adjust_floor_balance(conn, material_type_id, delta_kg: float):
    """Move stock for a material type, holding one number for the whole plant.

    There used to be two independent pools: `raw_material_totals` (what the Raw
    Material screen shows) and `floor_material_balance` (what production ate).
    Production only ever touched the floor pool, so the number the operator was
    watching never went down and the two drifted apart with no way to reconcile
    them by eye.

    Now `raw_material_totals` is the only counter. The floor balance and the
    per-machine assignments are mirrors re-derived from it on every change, so
    every screen shows the same kilograms and a production entry visibly reduces
    the stock on hand.
    """
    require_tx(conn)
    pid = int(material_type_id)
    delta = to_num(delta_kg)
    if pid <= 0:
        raise ValueError("Invalid floor material id")
    if not delta:
        return
    master_id = await master_id_for_type(conn, pid)
    if master_id <= 0:
        raise HTTPException(400, "Unable to match this floor material to a stock item")
    if delta < 0:
        # Read first so the shortfall message names the material the way the
        # operator sees it on screen.
        available = to_num(await conn.fetchval(
            "SELECT total_quantity_kg FROM raw_material_totals WHERE material_id = $1", master_id))
        if available < abs(delta):
            name = await get_material_name(conn, master_id)
            raise HTTPException(400, f"Not enough {name} in stock. Available: {available:.3f} kg")
    await adjust_raw_total(conn, master_id, delta)
    await mirror_floor_from_raw(conn, pid, master_id)


async def mirror_floor_from_raw(conn, material_type_id, master_id=None):
    """Re-derive the floor balance (and machine rows) from the stock total.

    Never incremented, always recomputed, so the mirrors cannot drift away from
    `raw_material_totals` no matter which endpoint moved the stock.
    """
    pid = int(material_type_id)
    if pid <= 0:
        return
    if master_id is None:
        master_id = await master_id_for_type(conn, pid)
    qty = to_num(await conn.fetchval(
        "SELECT total_quantity_kg FROM raw_material_totals WHERE material_id = $1", master_id)) \
        if master_id and master_id > 0 else 0.0
    if qty < 0:
        qty = 0.0
    await conn.execute(
        """INSERT INTO floor_material_balance (material_type_id, total_quantity_kg, updated_at)
           VALUES ($1, $2, NOW()) ON CONFLICT (material_type_id)
           DO UPDATE SET total_quantity_kg = EXCLUDED.total_quantity_kg, updated_at = NOW()""",
        pid, qty)
    await sync_machine_assignments(conn, pid)


async def sync_machine_assignments(conn, material_type_id):
    """Mirror the pooled floor balance onto every machine's assignment row.

    Deduction is pooled (floor_material_balance is the single source of truth), so
    each machine's row reports what is actually available to it. Derived on every
    change — never incremented — so it is idempotent and drift-free.
    """
    pid = int(material_type_id)
    if pid <= 0:
        return
    balance = await conn.fetchval(
        "SELECT total_quantity_kg FROM floor_material_balance WHERE material_type_id = $1", pid)
    qty = to_num(balance)
    if qty < 0:
        qty = 0.0
    await conn.execute(
        """INSERT INTO machine_stock_assignments (machine_id, material_type_id, quantity_kg)
           SELECT id::text, $1, $2 FROM machines
           ON CONFLICT (machine_id, material_type_id)
           DO UPDATE SET quantity_kg = EXCLUDED.quantity_kg, updated_at = NOW()""",
        pid, qty)


async def adjust_machine_assignments(conn, material_type_id, delta_kg: float = 0.0):
    """Back-compat shim: assignments are now derived from the floor balance."""
    await sync_machine_assignments(conn, material_type_id)


async def apply_movement_effect(conn, movement: dict, multiplier: int = 1):
    qty = to_num(movement.get("quantity_kg"))
    direction = str(movement.get("direction") or "").upper()
    mt = normalize_movement_type(movement.get("movement_type") or "")
    mat_id = movement.get("material_id")
    mat_name = str(movement.get("material_name") or "").strip() or await get_material_name(conn, mat_id)
    try:
        pid = int(mat_id)
        if pid <= 0:
            raise ValueError()
    except (TypeError, ValueError):
        raise ValueError("Invalid material selected")
    if qty <= 0:
        raise ValueError("Quantity must be greater than zero")
    if direction not in ("IN", "OUT"):
        raise ValueError("direction must be IN or OUT")
    if not mt:
        raise ValueError("movement_type is required")
    if mt == "CONSUMPTION":
        raise ValueError("Production consumption entries must be edited from production history")
    if mt == "FLOOR_TRANSFER":
        # Issuing to the floor moves material within the plant; it does not change
        # how much the plant holds, so the total stays put and only the mirrors
        # are refreshed. Production consumption is what actually reduces stock.
        mt_id = await resolve_material_type_id(conn, pid, mat_name)
        if not mt_id:
            raise ValueError("Unable to resolve floor material")
        await mirror_floor_from_raw(conn, mt_id, pid)
        return
    raw_delta = (qty if direction == "IN" else -qty) * multiplier
    await adjust_raw_total(conn, pid, raw_delta)


async def master_id_for_type(conn, material_type_id) -> int:
    """materials_master id matching a material_types row, matched by name.

    `materials_master` and `material_types` are separate id spaces. Movements are
    recorded in the materials_master space; floor balances in the material_types
    space. Mixing them corrupts unrelated materials, so translate explicitly.
    """
    try:
        pid = int(material_type_id)
    except (TypeError, ValueError):
        return 0
    if pid <= 0:
        return 0
    r = await conn.fetchrow("SELECT name FROM material_types WHERE id = $1 LIMIT 1", pid)
    if not r:
        return 0
    return await get_or_create_material(conn, r["name"])


async def consumption_movement_for_log(conn, log_id: int):
    return await conn.fetchrow(
        """SELECT id, quantity_kg, material_id, material_type_id
             FROM material_movements
            WHERE movement_type = 'CONSUMPTION' AND reference_id = $1
            ORDER BY id DESC LIMIT 1""",
        log_id)


async def upsert_consumption_movement(conn, log_id: int, payload: dict):
    """Record (or correct) the consumption ledger row for a production log.

    The row is the receipt for the floor deduction: reversal reads it back, so the
    quantity and the material type stored here must match what was actually taken.
    """
    qty = to_num(payload.get("net_weight"))
    try:
        mt_id = int(payload.get("material_type_id") or 0)
    except (TypeError, ValueError):
        mt_id = 0
    if log_id <= 0:
        return
    existing = await consumption_movement_for_log(conn, log_id)
    if qty <= 0 or mt_id <= 0:
        if existing:
            await conn.execute("DELETE FROM material_movements WHERE id = $1", existing["id"])
        return
    master_id = await master_id_for_type(conn, mt_id)
    if master_id <= 0:
        if existing:
            await conn.execute("DELETE FROM material_movements WHERE id = $1", existing["id"])
        return
    note = f"Production consumption from machine {payload.get('machine_id')}"
    if existing:
        await conn.execute(
            """UPDATE material_movements
                  SET material_id = $1, material_type_id = $2, quantity_kg = $3,
                      direction = 'OUT', movement_type = 'CONSUMPTION', note = $4
                WHERE id = $5""",
            master_id, mt_id, qty, note, existing["id"])
    else:
        await conn.execute(
            """INSERT INTO material_movements
                   (material_id, material_type_id, quantity_kg, direction, movement_type, reference_id, note)
               VALUES ($1, $2, $3, 'OUT', 'CONSUMPTION', $4, $5)""",
            master_id, mt_id, qty, log_id, note)


async def restore_log_floor_stock(conn, log_row: dict) -> float:
    """Return to the floor exactly what this log took — no more, no less.

    The amount comes from the recorded consumption movement, never recomputed from
    the log's weights. A log that never deducted has no movement and therefore
    restores nothing, so deleting it cannot create stock out of nothing.
    Movements written before this ledger was corrected carry no material_type_id
    and are deliberately not reversed.
    """
    if not log_row:
        return 0.0
    log_id = log_row.get("id")
    if not log_id:
        return 0.0
    mv = await consumption_movement_for_log(conn, int(log_id))
    if not mv:
        return 0.0
    qty = to_num(mv["quantity_kg"])
    mt_id = mv["material_type_id"]
    if qty <= 0 or not mt_id:
        if not mt_id:
            logger.warning(
                "Log %s: consumption movement %s predates the material_type_id ledger; "
                "not restoring floor stock", log_id, mv["id"])
        return 0.0
    await adjust_floor_balance(conn, int(mt_id), qty)
    return qty


async def fetch_order_items(conn, order_id: int) -> list:
    rs = await conn.fetch(
        """SELECT oi.id, oi.order_id, oi.item_name,
               oi.required_quantity::float AS required_quantity,
               COALESCE(oi.unit_price, 0)::float AS unit_price,
               (oi.required_quantity * COALESCE(oi.unit_price, 0))::float AS total_amount,
               COALESCE(SUM(fr.supplied_quantity), 0)::float AS fulfilled_quantity,
               GREATEST(oi.required_quantity - COALESCE(SUM(fr.supplied_quantity), 0), 0)::float AS remaining_quantity,
               oi.created_at
           FROM order_items oi
           LEFT JOIN fulfillment_records fr ON fr.order_item_id = oi.id
           WHERE oi.order_id = $1
           GROUP BY oi.id, oi.order_id, oi.item_name, oi.required_quantity, oi.unit_price, oi.created_at
           ORDER BY oi.created_at ASC, oi.id ASC""",
        order_id)
    return rows(rs)


async def hydrate_orders(conn, orders: list) -> list:
    result = []
    for o in orders:
        items = await fetch_order_items(conn, o["id"])
        result.append({**o, "items": items})
    return result


async def sync_order_status(conn, order_id: int):
    o = await conn.fetchrow("SELECT status FROM orders WHERE id = $1 FOR UPDATE", order_id)
    if not o or o["status"] == "cancelled":
        return o["status"] if o else None
    summary = await conn.fetchrow(
        """SELECT COUNT(*)::int AS total_items,
               COUNT(*) FILTER (WHERE COALESCE(fr.fulfilled_quantity, 0) >= oi.required_quantity)::int AS completed_items
           FROM order_items oi
           LEFT JOIN (SELECT order_item_id, COALESCE(SUM(supplied_quantity), 0) AS fulfilled_quantity
                      FROM fulfillment_records GROUP BY order_item_id) fr ON fr.order_item_id = oi.id
           WHERE oi.order_id = $1""",
        order_id)
    total = summary["total_items"] if summary else 0
    completed = summary["completed_items"] if summary else 0
    next_status = "completed" if total > 0 and total == completed else "Active"
    await conn.execute("UPDATE orders SET status = $1, updated_at = NOW() WHERE id = $2", next_status, order_id)
    return next_status


# ─────────────────────────── Routes ───────────────────────────

@app.get("/")
async def health():
    return "API running"


# ── Materials ──

@app.get("/materials")
async def get_materials(user=Depends(get_user)):
    async with pool.acquire() as c:
        return rows(await c.fetch("SELECT id, name FROM materials_master ORDER BY name"))


@app.post("/materials")
async def post_materials(request: Request, user=Depends(get_user)):
    body = await request.json()
    name = str(body.get("name") or "").strip()
    if not name:
        raise HTTPException(400, "Material name is required")
    async with pool.acquire() as c:
        r = await c.fetchrow("SELECT id, name FROM materials_master WHERE LOWER(TRIM(name)) = LOWER(TRIM($1)) LIMIT 1", name)
        material = dict(r) if r else dict(await c.fetchrow("INSERT INTO materials_master (name) VALUES ($1) RETURNING id, name", name))
        all_mats = rows(await c.fetch("SELECT id, name FROM materials_master ORDER BY name ASC"))
    await broadcast("raw_material")
    return {"selected": material, "materials": all_mats}


# ── Raw material totals ──

@app.get("/raw-material/totals")
async def get_raw_totals(user=Depends(get_user)):
    async with pool.acquire() as c:
        try:
            return rows(await c.fetch(
                "SELECT mm.name AS material_name, rmt.total_quantity_kg, rmt.updated_at FROM raw_material_totals rmt JOIN materials_master mm ON mm.id = rmt.material_id ORDER BY mm.name"))
        except asyncpg.UndefinedTableError:
            pass
        try:
            return rows(await c.fetch("SELECT material_name, total_quantity_kg, updated_at FROM raw_material_totals ORDER BY material_name"))
        except Exception as e:
            raise HTTPException(500, str(e))


# ── Raw material batches ──

@app.get("/raw-material/batches")
async def get_batches(date_from: str = None, date_to: str = None, user=Depends(get_user)):
    async with pool.acquire() as c:
        vals = []
        where = build_date_where(date_from, date_to, vals, "rb.created_at")
        vals.append(500)
        return rows(await c.fetch(
            f"SELECT rb.*, u.name AS created_by_name FROM raw_material_batches rb LEFT JOIN users u ON u.id = rb.created_by {where} ORDER BY rb.created_at DESC LIMIT ${len(vals)}",
            *vals))


@app.put("/raw-material/batches/{batch_id}")
async def update_batch(batch_id: int, request: Request, user=Depends(get_user)):
    require_owner_or_admin(user)
    body = await request.json()
    next_qty = to_num(body.get("quantity_kg"))
    next_name = str(body.get("material_name") or "").strip()
    next_note = body.get("note")
    next_thickness = str(body.get("thickness") or "").strip() or None
    if batch_id <= 0:
        raise HTTPException(400, "Invalid batch id")
    if not next_name or next_qty <= 0:
        raise HTTPException(400, "material_name and quantity_kg are required")
    async with pool.acquire() as c:
        async with c.transaction():
            cur = await c.fetchrow(
                "SELECT id, material_id, material_name, quantity_kg, note, thickness FROM raw_material_batches WHERE id = $1 FOR UPDATE", batch_id)
            if not cur:
                raise HTTPException(404, "Batch not found")
            cur_qty = to_num(cur["quantity_kg"])
            next_mat_id = await get_or_create_material(c, next_name)
            if int(cur["material_id"]) == next_mat_id:
                await adjust_raw_total(c, next_mat_id, next_qty - cur_qty)
            else:
                await adjust_raw_total(c, cur["material_id"], -cur_qty)
                await adjust_raw_total(c, next_mat_id, next_qty)
            updated = await c.fetchrow(
                "UPDATE raw_material_batches SET material_id=$1, material_name=$2, quantity_kg=$3, note=$4, thickness=$5 WHERE id=$6 RETURNING *",
                next_mat_id, next_name, next_qty, next_note, next_thickness, batch_id)
            tol = await eval_qty_tolerance(get_expected_qty(body, next_qty), next_qty, c,
                                           {"op": "batch_update", "batch_id": batch_id})
            if STRICT_TOLERANCE and tol["tolerance_status"] == "BREACH":
                raise HTTPException(400, {"error": "Tolerance breach", "details": tol})
    await broadcast("raw_material")
    return {"success": True, "data": dict(updated), "tolerance": tol}


@app.delete("/raw-material/batches/{batch_id}")
async def delete_batch(batch_id: int, user=Depends(get_user)):
    require_owner_or_admin(user)
    if batch_id <= 0:
        raise HTTPException(400, "Invalid batch id")
    async with pool.acquire() as c:
        async with c.transaction():
            cur = await c.fetchrow("SELECT id, material_id, quantity_kg FROM raw_material_batches WHERE id = $1 FOR UPDATE", batch_id)
            if not cur:
                raise HTTPException(404, "Batch not found")
            await reverse_raw_batch(c, cur)
            await c.execute("DELETE FROM raw_material_batches WHERE id = $1", batch_id)
    await broadcast("raw_material")
    return {"success": True}


@app.post("/raw-material/batches/bulk-delete")
async def bulk_delete_batches(request: Request, user=Depends(get_user)):
    require_owner_or_admin(user)
    body = await request.json()
    ids = [int(v) for v in (body.get("ids") or []) if str(v).lstrip("-").isdigit() and int(v) > 0]
    if not ids:
        raise HTTPException(400, "ids array is required")
    async with pool.acquire() as c:
        async with c.transaction():
            rs_ = await c.fetch(
                "SELECT id, material_id, quantity_kg FROM raw_material_batches WHERE id = ANY($1::int[]) ORDER BY id FOR UPDATE", ids)
            if len(rs_) != len(ids):
                raise HTTPException(404, "One or more batches were not found")
            for r_ in rs_:
                await reverse_raw_batch(c, r_)
            await c.execute("DELETE FROM raw_material_batches WHERE id = ANY($1::int[])", ids)
    await broadcast("raw_material")
    return {"success": True, "deleted": len(ids)}


@app.get("/raw-material/options")
async def get_raw_options(user=Depends(get_user)):
    async with pool.acquire() as c:
        return rows(await c.fetch(
            "SELECT id, name AS material_name FROM materials_master WHERE name IS NOT NULL AND TRIM(name) <> '' ORDER BY name ASC"))


@app.post("/raw-material/options")
async def add_raw_option(request: Request, user=Depends(get_user)):
    body = await request.json()
    normalized = str(body.get("material_name") or "").strip()
    if not normalized:
        raise HTTPException(400, "material_name cannot be empty")
    async with pool.acquire() as c:
        async with c.transaction():
            await c.execute("INSERT INTO materials_master (name) VALUES ($1) ON CONFLICT (name) DO NOTHING", normalized)
            await c.execute("INSERT INTO material_name_mapping (material_name) VALUES ($1) ON CONFLICT DO NOTHING", normalized)
    return {"message": "Material added to options", "material_name": normalized}


@app.post("/raw-material/add")
async def add_raw_material(request: Request, user=Depends(get_user)):
    body = await request.json()
    mat_name = str(body.get("material_name") or "").strip()
    qty = to_num(body.get("quantity_kg"))
    note = body.get("note")
    thickness = str(body.get("thickness") or "").strip() or None
    if not mat_name or qty <= 0:
        raise HTTPException(400, "Invalid input")
    if not user.get("id"):
        raise HTTPException(401, "User not authenticated properly")
    # Stock is often keyed in after the lorry has gone, so the operator can name
    # the day it actually arrived. Absent or today -> the column default stands.
    entry_ts = parse_entry_timestamp(body)
    async with pool.acquire() as c:
        async with c.transaction():
            mat_id = await get_or_create_material(c, mat_name)
            upsert = await c.fetchrow(
                """INSERT INTO raw_material_totals (material_id, total_quantity_kg, updated_at)
                   VALUES ($1, $2, NOW()) ON CONFLICT (material_id)
                   DO UPDATE SET total_quantity_kg = raw_material_totals.total_quantity_kg + $2, updated_at = NOW()
                   RETURNING total_quantity_kg, updated_at""",
                mat_id, qty)
            await mirror_floor_for_master(c, mat_id)
            await c.execute(
                """INSERT INTO raw_material_batches
                       (material_id, material_name, quantity_kg, created_by, note, thickness, created_at)
                   VALUES ($1, $2, $3, $4, $5, $6, COALESCE($7, NOW()))""",
                mat_id, mat_name, qty, user["id"], note or None, thickness, entry_ts)
            tol = await eval_qty_tolerance(get_expected_qty(body, qty), qty, c, {"op": "raw_add", "mat": mat_name})
            if STRICT_TOLERANCE and tol["tolerance_status"] == "BREACH":
                raise HTTPException(400, {"error": "Tolerance breach", "details": tol})
    await broadcast("raw_material")
    return {"message": "Raw material added successfully",
            "data": {"material_name": mat_name, "total_quantity_kg": upsert["total_quantity_kg"]},
            "tolerance": tol}


# ── Floor stock ──

@app.get("/floor/stock")
async def get_floor_stock(user=Depends(get_user)):
    async with pool.acquire() as c:
        return rows(await c.fetch(
            "SELECT mt.id AS material_type_id, mt.name AS material_name, fmb.total_quantity_kg FROM floor_material_balance fmb JOIN material_types mt ON mt.id = fmb.material_type_id ORDER BY mt.name"))


@app.post("/floor/issue-from-raw")
async def issue_from_raw(request: Request, user=Depends(get_user)):
    body = await request.json()
    mat_name = str(body.get("material_name") or "").strip()
    qty = to_num(body.get("quantity_kg"))
    if not mat_name or qty <= 0:
        raise HTTPException(400, "Invalid material_name or quantity_kg")
    async with pool.acquire() as c:
        async with c.transaction():
            mat_id = await get_or_create_material(c, mat_name)
            mt_id = await get_or_create_material_type(c, mat_name)
            # Issuing to the floor is a location change, not a stock change: the
            # kilograms are still in the plant. Stock only falls when production
            # consumes it, so this just refreshes the floor/machine mirrors.
            available = to_num(await c.fetchval(
                "SELECT total_quantity_kg FROM raw_material_totals WHERE material_id = $1", mat_id))
            if available < qty:
                raise HTTPException(400, f"Not enough {mat_name} in stock. Available: {available:.3f} kg")
            await mirror_floor_from_raw(c, mt_id, mat_id)
            machine_count = await c.fetchval("SELECT COUNT(*) FROM machines")
            await c.execute(
                "INSERT INTO material_movements (material_id, quantity_kg, direction, movement_type, reference_id, note, created_by) VALUES ($1, $2, 'OUT', 'FLOOR_TRANSFER', $3, $4, $5)",
                mat_id, qty, None, "Issued to floor and auto-assigned to all machines", user.get("id"))
            tol = await eval_qty_tolerance(get_expected_qty(body, qty), qty, c, {"op": "floor_issue", "mat": mat_name})
            if STRICT_TOLERANCE and tol["tolerance_status"] == "BREACH":
                raise HTTPException(400, {"error": "Tolerance breach", "details": tol})
    await broadcast("floor_stock")
    return {"message": "Material issued to floor and auto-assigned to all machines",
            "data": {"material_name": mat_name, "quantity_kg": qty, "material_type_id": mt_id, "machines_assigned": machine_count},
            "tolerance": tol}


@app.get("/machines/{machine_id}/assigned-stock")
async def get_assigned_stock(machine_id: str, user=Depends(get_user)):
    variants = get_machine_variants(machine_id)
    async with pool.acquire() as c:
        rs_ = rows(await c.fetch(
            """SELECT MIN(msa.machine_id) AS machine_id, msa.material_type_id, mt.name AS material_name,
                   SUM(msa.quantity_kg)::float AS quantity_kg, MIN(msa.assigned_at) AS assigned_at,
                   COALESCE(MAX(fmb.total_quantity_kg), 0)::float AS available_quantity_kg
               FROM machine_stock_assignments msa
               JOIN material_types mt ON mt.id = msa.material_type_id
               LEFT JOIN floor_material_balance fmb ON fmb.material_type_id = msa.material_type_id
               WHERE msa.machine_id = ANY($1::text[])
               GROUP BY msa.material_type_id, mt.name ORDER BY mt.name""",
            variants))
    return {"machine_id": machine_id, "assigned_materials": rs_,
            "total_assigned_kg": sum(r_["quantity_kg"] for r_ in rs_),
            "total_available_kg": sum(r_["available_quantity_kg"] for r_ in rs_)}


# ── Material movements ──

@app.post("/materials/move")
async def move_material(request: Request, user=Depends(get_user)):
    body = await request.json()
    mat_name = str(body.get("material_name") or "").strip()
    qty = to_num(body.get("quantity_kg"))
    direction = str(body.get("direction") or "").upper()
    mt_map = {"INWARD": "INWARD", "FLOOR_TRANSFER": "FLOOR_TRANSFER", "CONSUMPTION": "CONSUMPTION",
              "ADJUSTMENT": "ADJUSTMENT", "WASTAGE": "ADJUSTMENT"}
    resolved_mt = mt_map.get(str(body.get("movement_type") or "").upper(), str(body.get("movement_type") or "").upper())
    if not mat_name or qty <= 0:
        raise HTTPException(400, "Invalid material_name or quantity_kg")
    if direction not in ("IN", "OUT"):
        raise HTTPException(400, "direction must be IN or OUT")
    if not resolved_mt:
        raise HTTPException(400, "movement_type is required")
    async with pool.acquire() as c:
        async with c.transaction():
            mat_id = await get_or_create_material(c, mat_name)
            if direction == "OUT":
                bal = await c.fetchrow("SELECT total_quantity_kg FROM raw_material_totals WHERE material_id = $1 FOR UPDATE", mat_id)
                if not bal:
                    raise HTTPException(400, "Material not found in stock")
                if to_num(bal["total_quantity_kg"]) < qty:
                    raise HTTPException(400, f"Not enough {mat_name} in stock. Available: {to_num(bal['total_quantity_kg'])} kg")
                if resolved_mt == "FLOOR_TRANSFER":
                    # Location change only — the plant still holds the material, so
                    # the total is untouched and the floor mirror is re-derived.
                    mt_row = await c.fetchrow("SELECT id FROM material_types WHERE LOWER(name) = LOWER($1) LIMIT 1", mat_name)
                    mt_id = mt_row["id"] if mt_row else (await c.fetchrow("INSERT INTO material_types (name) VALUES ($1) ON CONFLICT (name) DO UPDATE SET name = EXCLUDED.name RETURNING id", mat_name))["id"]
                    await mirror_floor_from_raw(c, mt_id, mat_id)
                else:
                    await c.execute("UPDATE raw_material_totals SET total_quantity_kg = total_quantity_kg - $1, updated_at = NOW() WHERE material_id = $2", qty, mat_id)
                    await mirror_floor_for_master(c, mat_id)
            else:
                await c.execute(
                    "INSERT INTO raw_material_totals (material_id, total_quantity_kg, updated_at) VALUES ($1, $2, NOW()) ON CONFLICT (material_id) DO UPDATE SET total_quantity_kg = raw_material_totals.total_quantity_kg + $2, updated_at = NOW()",
                    mat_id, qty)
                await mirror_floor_for_master(c, mat_id)
            mv = await c.fetchrow(
                """INSERT INTO material_movements
                       (material_id, quantity_kg, direction, movement_type, reference_id, note, created_by, created_at)
                   VALUES ($1, $2, $3, $4, $5, $6, $7, COALESCE($8, NOW())) RETURNING *""",
                mat_id, qty, direction, resolved_mt, body.get("reference_id"), body.get("note"),
                user.get("id"), parse_entry_timestamp(body))
            tol = await eval_qty_tolerance(get_expected_qty(body, qty), qty, c, {"op": "material_move"})
            if STRICT_TOLERANCE and tol["tolerance_status"] == "BREACH":
                raise HTTPException(400, {"error": "Tolerance breach", "details": tol})
    await broadcast("material_movement")
    return {"success": True, "movement": dict(mv), "tolerance": tol}


# ── Floor transactions ──

@app.get("/floor/transactions")
async def get_floor_transactions(date_from: str = None, date_to: str = None, user=Depends(get_user)):
    async with pool.acquire() as c:
        vals = []
        where = build_date_where(date_from, date_to, vals, "mm.created_at")
        vals.append(500)
        return rows(await c.fetch(
            f"SELECT mm.*, m.name AS material_name, u.name AS created_by_name FROM material_movements mm LEFT JOIN materials_master m ON m.id = mm.material_id LEFT JOIN users u ON u.id = mm.created_by {where} ORDER BY mm.created_at DESC LIMIT ${len(vals)}",
            *vals))


@app.put("/floor/transactions/{mv_id}")
async def update_floor_tx(mv_id: int, request: Request, user=Depends(get_user)):
    require_owner_or_admin(user)
    body = await request.json()
    qty = to_num(body.get("quantity_kg"))
    direction = str(body.get("direction") or "").upper()
    mt = normalize_movement_type(body.get("movement_type") or "")
    mat_name = str(body.get("material_name") or "").strip()
    if mv_id <= 0:
        raise HTTPException(400, "Invalid transaction id")
    if not mat_name or qty <= 0 or direction not in ("IN", "OUT") or not mt:
        raise HTTPException(400, "material_name, quantity_kg, direction and movement_type are required")
    if mt == "CONSUMPTION":
        raise HTTPException(400, "Production consumption entries must be edited from production history")
    async with pool.acquire() as c:
        async with c.transaction():
            cur = await c.fetchrow("SELECT mm.*, m.name AS material_name FROM material_movements mm LEFT JOIN materials_master m ON m.id = mm.material_id WHERE mm.id = $1 FOR UPDATE OF mm", mv_id)
            if not cur:
                raise HTTPException(404, "Transaction not found")
            await apply_movement_effect(c, dict(cur), -1)
            next_mat_id = await get_or_create_material(c, mat_name)
            await apply_movement_effect(c, {"material_id": next_mat_id, "material_name": mat_name, "quantity_kg": qty, "direction": direction, "movement_type": mt}, 1)
            updated = await c.fetchrow(
                "UPDATE material_movements SET material_id=$1, quantity_kg=$2, direction=$3, movement_type=$4, note=$5 WHERE id=$6 RETURNING *",
                next_mat_id, qty, direction, mt, body.get("note"), mv_id)
    await broadcast("material_movement")
    return {"success": True, "data": dict(updated)}


@app.delete("/floor/transactions/{mv_id}")
async def delete_floor_tx(mv_id: int, user=Depends(get_user)):
    require_owner_or_admin(user)
    if mv_id <= 0:
        raise HTTPException(400, "Invalid transaction id")
    async with pool.acquire() as c:
        async with c.transaction():
            cur = await c.fetchrow("SELECT mm.*, m.name AS material_name FROM material_movements mm LEFT JOIN materials_master m ON m.id = mm.material_id WHERE mm.id = $1 FOR UPDATE OF mm", mv_id)
            if not cur:
                raise HTTPException(404, "Transaction not found")
            if normalize_movement_type(cur["movement_type"]) == "CONSUMPTION":
                raise HTTPException(400, "Production consumption entries must be deleted from production history")
            await apply_movement_effect(c, dict(cur), -1)
            await c.execute("DELETE FROM material_movements WHERE id = $1", mv_id)
    await broadcast("material_movement")
    return {"success": True}


@app.post("/floor/transactions/bulk-delete")
async def bulk_delete_floor_tx(request: Request, user=Depends(get_user)):
    require_owner_or_admin(user)
    body = await request.json()
    ids = [int(v) for v in (body.get("ids") or []) if str(v).lstrip("-").isdigit() and int(v) > 0]
    if not ids:
        raise HTTPException(400, "ids array is required")
    async with pool.acquire() as c:
        async with c.transaction():
            rs_ = await c.fetch("SELECT mm.*, m.name AS material_name FROM material_movements mm LEFT JOIN materials_master m ON m.id = mm.material_id WHERE mm.id = ANY($1::int[]) ORDER BY mm.id FOR UPDATE OF mm", ids)
            if len(rs_) != len(ids):
                raise HTTPException(404, "One or more transactions were not found")
            if any(normalize_movement_type(r_["movement_type"]) == "CONSUMPTION" for r_ in rs_):
                raise HTTPException(400, "Production consumption entries must be deleted from production history")
            for r_ in rs_:
                await apply_movement_effect(c, dict(r_), -1)
            await c.execute("DELETE FROM material_movements WHERE id = ANY($1::int[])", ids)
    await broadcast("material_movement")
    return {"success": True, "deleted": len(ids)}


# ── Production logs ──

async def resolve_production_material(c, machine_id, explicit_type_id, explicit_material_id):
    """Work out which floor material a production entry consumes.

    Returns (material_type_id, material_master_id). Preference order: the type id the
    client sent, then any id it sent (disambiguated across both id spaces), then the
    material assigned to that machine.
    """
    mt_id = None
    if explicit_type_id:
        mt_id = await resolve_material_type_id(c, explicit_type_id, "")
    if not mt_id and explicit_material_id:
        mt_id = await resolve_material_type_id(c, explicit_material_id, "")
    if not mt_id:
        assigned = await c.fetchrow(
            """SELECT material_type_id FROM machine_stock_assignments
                WHERE machine_id = ANY($1::text[]) ORDER BY assigned_at DESC LIMIT 1""",
            get_machine_variants(machine_id))
        if assigned:
            mt_id = assigned["material_type_id"]
    if not mt_id:
        return None, 0
    return int(mt_id), await master_id_for_type(c, mt_id)


async def insert_production_log(c, *, machine_id, material_type_id, material_master_id,
                                size, worker_name, gross, tare, created_at, returning="*"):
    """Insert one production log and deduct exactly its net weight from the floor pool.

    Deduction and insert share one transaction, and the consumption movement written
    here is the receipt the reversal path reads back.
    """
    net = gross - tare
    await adjust_floor_balance(c, material_type_id, -net)
    log_row = await c.fetchrow(
        f"""INSERT INTO production_logs
                (machine_id, material_id, material_type_id, size, worker_name,
                 gross_weight, tare_weight, created_at)
            VALUES ($1, $2, $3, $4, $5, $6, $7, COALESCE($8, NOW()))
            RETURNING {returning}""",
        machine_id, material_master_id, material_type_id, size, worker_name,
        gross, tare, created_at)
    await upsert_consumption_movement(c, log_row["id"], {
        "machine_id": machine_id,
        "material_type_id": material_type_id,
        "net_weight": net,
    })
    return log_row


@app.post("/production/logs")
async def create_production_log(request: Request, user=Depends(get_user)):
    body = await request.json()
    machines_list = body.get("machines")
    entry_ts = parse_entry_timestamp(body)
    async with pool.acquire() as c:
        async with c.transaction():
            if machines_list and isinstance(machines_list, list):
                logs = []
                tolerances = []
                for m in machines_list:
                    if not m.get("machine_id"):
                        continue
                    gw = to_num(m.get("gross_weight"))
                    tw = to_num(m.get("tare_weight"))
                    if gw < tw:
                        raise HTTPException(400, f"Machine {m['machine_id']}: Gross weight must be >= tare weight")
                    net = gw - tw
                    if net <= 0:
                        raise HTTPException(400, f"Machine {m['machine_id']}: Net weight must be > 0")
                    machine_no = parse_machine_id(m["machine_id"])
                    mt_id, master_id = await resolve_production_material(
                        c, machine_no, m.get("material_type_id"), m.get("material_id"))
                    if not mt_id or master_id <= 0:
                        raise HTTPException(
                            400, f"Machine {m['machine_id']}: no material selected or assigned")
                    log_row = await insert_production_log(
                        c,
                        machine_id=machine_no, material_type_id=mt_id,
                        material_master_id=master_id, size=m.get("size"),
                        worker_name=(f"User {body.get('entered_by')}" if body.get("entered_by")
                                     else m.get("worker_name")),
                        gross=gw, tare=tw,
                        created_at=parse_entry_timestamp(m) or entry_ts,
                        returning=("id, machine_id, material_id, size, worker_name, "
                                   "gross_weight, tare_weight, created_at"))
                    tol = await eval_qty_tolerance(get_expected_qty(m, net, ["expected_net_weight_kg"]), net, c, {"op": "batch_log", "machine": m["machine_id"]})
                    if STRICT_TOLERANCE and tol["tolerance_status"] == "BREACH":
                        raise HTTPException(400, {"error": "Tolerance breach", "details": tol})
                    logs.append({**dict(log_row), "tolerance": tol})
                    tolerances.append(tol)
                batch_id = f"BATCH_{int(time.time() * 1000)}"
                result = {"message": f"Batch logged: {len(logs)} production entries", "batch_id": batch_id,
                          "inserted": len(logs), "data": logs, "tolerance": tolerances}
            else:
                machine_id = body.get("machine_id")
                if not machine_id:
                    raise HTTPException(400, "machine_id is required")
                machine_id = parse_machine_id(machine_id)
                gw = to_num(body.get("gross_weight"))
                tw = to_num(body.get("tare_weight"))
                if gw < tw:
                    raise HTTPException(400, "Gross weight must be >= tare weight")
                net = gw - tw
                if net <= 0:
                    raise HTTPException(400, "Net weight must be greater than zero")
                mt_id, master_id = await resolve_production_material(
                    c, machine_id, body.get("material_type_id"), body.get("material_id"))
                if not mt_id or master_id <= 0:
                    raise HTTPException(400, "No material selected or assigned to this machine")
                log_row = await insert_production_log(
                    c,
                    machine_id=machine_id, material_type_id=mt_id, material_master_id=master_id,
                    size=body.get("size"), worker_name=body.get("worker_name"),
                    gross=gw, tare=tw, created_at=entry_ts)
                tol = await eval_qty_tolerance(get_expected_qty(body, net, ["expected_net_weight_kg"]), net, c, {"op": "production_log", "machine": machine_id})
                if STRICT_TOLERANCE and tol["tolerance_status"] == "BREACH":
                    raise HTTPException(400, {"error": "Tolerance breach", "details": tol})
                if body.get("worker_name"):
                    await c.execute("INSERT INTO machine_state (machine_id, current_worker) VALUES ($1, $2) ON CONFLICT (machine_id) DO UPDATE SET current_worker = EXCLUDED.current_worker, updated_at = NOW()", machine_id, body["worker_name"])
                result = {"message": "Production logged and pooled floor stock deducted",
                          "data": dict(log_row), "tolerance": tol}
    # Broadcast only once the transaction has committed, so listeners never refetch
    # state that is about to be rolled back.
    await broadcast("production")
    return result


@app.get("/production/logs")
async def get_production_logs(machine_id: str = None, date_from: str = None, date_to: str = None, limit: str = "500", user=Depends(get_user)):
    async with pool.acquire() as c:
        conds, vals = [], []
        if machine_id:
            vals.append(parse_machine_id(machine_id))
            conds.append(f"pl.machine_id = ${len(vals)}")
        if date_from:
            vals.append(parse_date(date_from))
            conds.append(f"pl.created_at >= ${len(vals)}::date")
        if date_to:
            vals.append(parse_date(date_to))
            conds.append(f"pl.created_at < (${len(vals)}::date + INTERVAL '1 day')")
        parsed_limit = min(max(int(limit) if limit.isdigit() else 500, 1), 1000)
        vals.append(parsed_limit)
        where = f"WHERE {' AND '.join(conds)}" if conds else ""
        rs_ = await c.fetch(
            f"""SELECT pl.id, pl.machine_id, pl.material_id, pl.material_type_id, pl.size,
                       pl.worker_name, pl.gross_weight, pl.tare_weight, pl.created_at,
                       m.name AS machine_name,
                       COALESCE(mt.name, mat.name) AS material_name
                  FROM production_logs pl
                  LEFT JOIN machines m ON m.id = pl.machine_id
                  LEFT JOIN material_types mt ON mt.id = pl.material_type_id
                  LEFT JOIN materials_master mat ON mat.id = pl.material_id
                {where} ORDER BY pl.created_at DESC LIMIT ${len(vals)}""",
            *vals)
        return [{**dict(r_), "net_weight": to_num(r_["gross_weight"]) - to_num(r_["tare_weight"])} for r_ in rs_]


@app.put("/production/logs/{log_id}")
async def update_production_log(log_id: int, request: Request, user=Depends(get_user)):
    body = await request.json()
    machine_id_val = int(to_num(body.get("machine_id")))
    gw = to_num(body.get("gross_weight"))
    tw = to_num(body.get("tare_weight"))
    if log_id <= 0:
        raise HTTPException(400, "Invalid production log id")
    if machine_id_val <= 0:
        raise HTTPException(400, "machine_id is required")
    if gw <= 0 or tw < 0 or gw < tw:
        raise HTTPException(400, "Gross weight must be greater than or equal to tare weight")
    net = gw - tw
    if net <= 0:
        raise HTTPException(400, "Net weight must be greater than zero")
    async with pool.acquire() as c:
        async with c.transaction():
            cur = await c.fetchrow(
                """SELECT pl.*, COALESCE(mt.name, mat.name) AS material_name
                     FROM production_logs pl
                     LEFT JOIN material_types mt ON mt.id = pl.material_type_id
                     LEFT JOIN materials_master mat ON mat.id = pl.material_id
                    WHERE pl.id = $1 FOR UPDATE OF pl""",
                log_id)
            if not cur:
                raise HTTPException(404, "Production log not found")
            next_mt_id = await resolve_material_type_id(
                c, body.get("material_type_id") or body.get("material_id"), cur["material_name"])
            if not next_mt_id:
                raise HTTPException(400, "Unable to resolve material for this production log")
            next_master_id = await master_id_for_type(c, next_mt_id)
            if next_master_id <= 0:
                raise HTTPException(400, "Unable to resolve material for this production log")
            # Give back exactly what the old entry took, then take the new amount.
            # Both legs are in this transaction, so the balance is never half-applied.
            await restore_log_floor_stock(c, dict(cur))
            await adjust_floor_balance(c, next_mt_id, -net)
            updated = await c.fetchrow(
                """UPDATE production_logs
                      SET machine_id=$1, material_id=$2, material_type_id=$3, size=$4,
                          worker_name=$5, gross_weight=$6, tare_weight=$7
                    WHERE id=$8 RETURNING *""",
                machine_id_val, next_master_id, next_mt_id, body.get("size"),
                body.get("worker_name"), gw, tw, log_id)
            await upsert_consumption_movement(c, log_id, {
                "machine_id": machine_id_val,
                "material_type_id": next_mt_id,
                "net_weight": net,
            })
            tol = await eval_qty_tolerance(get_expected_qty(body, net, ["expected_net_weight_kg"]), net, c, {"op": "log_update", "log_id": log_id})
            if STRICT_TOLERANCE and tol["tolerance_status"] == "BREACH":
                raise HTTPException(400, {"error": "Tolerance breach", "details": tol})
    await broadcast("production")
    return {"success": True, "data": dict(updated), "tolerance": tol}


@app.delete("/production/logs/{log_id}")
async def delete_production_log(log_id: int, user=Depends(get_user)):
    if log_id <= 0:
        raise HTTPException(400, "Invalid production log id")
    async with pool.acquire() as c:
        async with c.transaction():
            cur = await c.fetchrow("SELECT pl.*, mat.name AS material_name FROM production_logs pl LEFT JOIN materials_master mat ON mat.id = pl.material_id WHERE pl.id = $1 FOR UPDATE OF pl", log_id)
            if not cur:
                raise HTTPException(404, "Production log not found")
            await restore_log_floor_stock(c, dict(cur))
            await c.execute("DELETE FROM material_movements WHERE movement_type = 'CONSUMPTION' AND reference_id = $1", log_id)
            await c.execute("DELETE FROM production_logs WHERE id = $1", log_id)
    await broadcast("production")
    return {"success": True}


@app.post("/production/logs/bulk-delete")
async def bulk_delete_production_logs(request: Request, user=Depends(get_user)):
    body = await request.json()
    ids = [int(v) for v in (body.get("ids") or []) if str(v).lstrip("-").isdigit() and int(v) > 0]
    if not ids:
        raise HTTPException(400, "ids array is required")
    async with pool.acquire() as c:
        async with c.transaction():
            rs_ = await c.fetch("SELECT pl.*, mat.name AS material_name FROM production_logs pl LEFT JOIN materials_master mat ON mat.id = pl.material_id WHERE pl.id = ANY($1::int[]) ORDER BY pl.id FOR UPDATE OF pl", ids)
            if len(rs_) != len(ids):
                raise HTTPException(404, "One or more production logs were not found")
            for r_ in rs_:
                await restore_log_floor_stock(c, dict(r_))
            await c.execute("DELETE FROM material_movements WHERE movement_type = 'CONSUMPTION' AND reference_id = ANY($1::int[])", ids)
            await c.execute("DELETE FROM production_logs WHERE id = ANY($1::int[])", ids)
    await broadcast("production")
    return {"success": True, "deleted": len(ids)}


# ── Reports ──

@app.get("/reports/machines")
async def get_reports_machines(date_from: str = None, date_to: str = None, machine_id: str = None, user=Depends(get_user)):
    async with pool.acquire() as c:
        conds, vals = [], []
        if date_from:
            vals.append(parse_date(date_from)); conds.append(f"pl.created_at >= ${len(vals)}::date")
        if date_to:
            vals.append(parse_date(date_to)); conds.append(f"pl.created_at < (${len(vals)}::date + INTERVAL '1 day')")
        if machine_id:
            vals.append(parse_machine_id(machine_id)); conds.append(f"pl.machine_id = ${len(vals)}")
        where = f"WHERE {' AND '.join(conds)}" if conds else ""
        return rows(await c.fetch(
            f"SELECT m.id AS machine_id, m.name AS machine_name, COUNT(pl.id) AS total_entries, COALESCE(SUM(pl.gross_weight - pl.tare_weight), 0)::float AS total_net_weight_kg, COALESCE(SUM(pl.gross_weight), 0)::float AS total_gross_weight_kg, COALESCE(SUM(pl.tare_weight), 0)::float AS total_tare_weight_kg FROM machines m LEFT JOIN production_logs pl ON pl.machine_id = m.id {where} GROUP BY m.id, m.name ORDER BY m.id",
            *vals))


@app.get("/reports/logs")
async def get_reports_logs(machine_id: str = None, date_from: str = None, date_to: str = None, limit: str = "200", user=Depends(get_user)):
    async with pool.acquire() as c:
        conds, vals = [], []
        if machine_id:
            vals.append(parse_machine_id(machine_id)); conds.append(f"mpl.machine_id = ${len(vals)}")
        if date_from:
            vals.append(parse_date(date_from)); conds.append(f"mpl.created_at >= ${len(vals)}::date")
        if date_to:
            vals.append(parse_date(date_to)); conds.append(f"mpl.created_at < (${len(vals)}::date + INTERVAL '1 day')")
        parsed_limit = min(max(int(limit) if limit.isdigit() else 200, 1), 1000)
        vals.append(parsed_limit)
        where = f"WHERE {' AND '.join(conds)}" if conds else ""
        return rows(await c.fetch(
            f"SELECT mpl.*, m.name AS machine_name, u.name AS entered_by_name FROM machine_production_logs mpl LEFT JOIN machines m ON m.id = mpl.machine_id LEFT JOIN users u ON u.id = mpl.entered_by {where} ORDER BY mpl.created_at DESC LIMIT ${len(vals)}",
            *vals))


# ── Analytics ──

@app.get("/analytics/plant-efficiency")
async def get_plant_efficiency(user=Depends(get_user)):
    async with pool.acquire() as c:
        try:
            rs_ = await c.fetch("SELECT * FROM plant_efficiency")
            return dict(rs_[0]) if rs_ else {}
        except asyncpg.exceptions.UndefinedTableError:
            return {}


@app.get("/analytics/plant-efficiency-v2")
async def get_plant_efficiency_v2(date_from: str = None, date_to: str = None, user=Depends(get_user)):
    async with pool.acquire() as c:
        vals = []
        where = build_date_where(date_from, date_to, vals, "created_at")
        # Input is material actually issued to the shop floor in the period, not
        # material purchased in the period — a delivery received on the 1st is not
        # input to the run, and dividing by it made efficiency read far too low.
        movement_where = where.replace("created_at", "mv.created_at") if where else ""
        r_ = await c.fetchrow(
            f"""SELECT
                  COALESCE(SUM(fi.quantity_kg), 0) AS total_input_kg,
                  COALESCE(SUM(pl.net_weight), 0) AS total_output_kg,
                  CASE WHEN COALESCE(SUM(fi.quantity_kg), 0) = 0 THEN 0
                  ELSE ROUND((COALESCE(SUM(pl.net_weight), 0) / COALESCE(SUM(fi.quantity_kg), 0)) * 100, 2)
                  END AS efficiency_percent
                FROM
                  (SELECT COALESCE(SUM(mv.quantity_kg), 0) AS quantity_kg
                     FROM material_movements mv
                    WHERE mv.movement_type = 'FLOOR_TRANSFER' AND mv.direction = 'OUT'
                      {('AND ' + movement_where[len('WHERE '):]) if movement_where else ''}) fi,
                  (SELECT COALESCE(SUM(gross_weight - tare_weight), 0) AS net_weight FROM production_logs {where}) pl""",
            *vals)
        return dict(r_) if r_ else {"total_input_kg": 0, "total_output_kg": 0, "efficiency_percent": 0}


# ── Inventory ──

@app.get("/inventory/transactions")
async def get_inventory_transactions(date_from: str = None, date_to: str = None, user=Depends(get_user)):
    async with pool.acquire() as c:
        vals = []
        where = build_date_where(date_from, date_to, vals, "rb.created_at")
        vals.append(500)
        return rows(await c.fetch(
            f"SELECT rb.*, u.name AS created_by_name FROM raw_material_batches rb LEFT JOIN users u ON u.id = rb.created_by {where} ORDER BY rb.created_at DESC LIMIT ${len(vals)}",
            *vals))


@app.get("/inventory/balance")
async def get_inventory_balance(user=Depends(get_user)):
    async with pool.acquire() as c:
        return rows(await c.fetch("SELECT material_name, total_quantity_kg, updated_at FROM raw_material_totals ORDER BY material_name"))


# ── Auth ──

@app.post("/auth/register")
async def register(request: Request):
    body = await request.json()
    name = str(body.get("name") or "").strip()
    email = str(body.get("email") or "").strip()
    password = str(body.get("password") or "")
    if not name:
        raise HTTPException(400, "name is required")
    if not email:
        raise HTTPException(400, "email is required")
    if not password:
        raise HTTPException(400, "password is required")
    async with pool.acquire() as c:
        if await c.fetchrow("SELECT id FROM users WHERE email = $1", email):
            raise HTTPException(400, "User already exists")
        await c.execute(
            "INSERT INTO users (name, email, password_hash, role, status) VALUES ($1, $2, $3, 'worker', 'pending')",
            name, email, pwd_hash(password))
    return {"message": "Account created. Awaiting admin approval."}


@app.post("/auth/login")
async def login(request: Request):
    body = await request.json()
    async with pool.acquire() as c:
        user = await c.fetchrow("SELECT * FROM users WHERE email = $1", body.get("email"))
        if not user:
            raise HTTPException(400, "Invalid credentials")
        if user["status"] != "approved":
            raise HTTPException(403, "Account not approved")
        if not pwd_verify(body.get("password", ""), user["password_hash"]):
            raise HTTPException(400, "Invalid credentials")
        now = datetime.now(timezone.utc)
        token = jwt.encode(
            {
                "user_id": user["id"],
                "role": user["role"],
                "iat": int(now.timestamp()),
                "exp": int((now + timedelta(seconds=JWT_TTL_SECONDS)).timestamp()),
            },
            JWT_SECRET, algorithm=JWT_ALGORITHM)
    return {"token": token, "user_id": user["id"], "role": user["role"]}


@app.post("/auth/change-password")
async def change_password(request: Request, user=Depends(get_user)):
    body = await request.json()
    async with pool.acquire() as c:
        r_ = await c.fetchrow("SELECT password_hash FROM users WHERE id = $1", user.get("user_id"))
        if not r_ or not pwd_verify(body.get("old_password", ""), r_["password_hash"]):
            raise HTTPException(400, "Incorrect old password")
        await c.execute("UPDATE users SET password_hash = $1 WHERE id = $2", pwd_hash(body.get("new_password", "")), user.get("user_id"))
    return {"message": "Password updated successfully"}


# ── Admin ──

@app.get("/admin/pending-users")
async def get_pending_users(user=Depends(owner_only)):
    async with pool.acquire() as c:
        return rows(await c.fetch("SELECT id, name, email FROM users WHERE status = 'pending'"))


@app.post("/admin/approve-user")
async def approve_user(request: Request, user=Depends(owner_only)):
    body = await request.json()
    async with pool.acquire() as c:
        await c.execute("UPDATE users SET status = 'approved' WHERE id = $1", body.get("user_id"))
    invalidate_account_cache(body.get("user_id"))
    await broadcast("users")
    return {"message": "User approved"}


@app.post("/admin/reject-user")
async def reject_user(request: Request, user=Depends(owner_only)):
    body = await request.json()
    async with pool.acquire() as c:
        await c.execute("UPDATE users SET status = 'rejected' WHERE id = $1", body.get("user_id"))
    # Drop the cached account immediately: a rejected user must lose access now,
    # not when a 30-second cache entry happens to expire.
    invalidate_account_cache(body.get("user_id"))
    await broadcast("users")
    return {"message": "User rejected"}


# ── Machines ──

@app.get("/machines")
async def get_machines(user=Depends(get_user)):
    async with pool.acquire() as c:
        return rows(await c.fetch("SELECT * FROM machines"))


@app.get("/machines/{machine_id}/state")
async def get_machine_state(machine_id: int, user=Depends(get_user)):
    async with pool.acquire() as c:
        r_ = await c.fetchrow("SELECT current_worker, updated_at FROM machine_state WHERE machine_id = $1", machine_id)
        return dict(r_) if r_ else {"current_worker": None}


# ── Users ──

@app.post("/users")
async def create_user(request: Request, user=Depends(owner_only)):
    body = await request.json()
    async with pool.acquire() as c:
        r_ = await c.fetchrow(
            "INSERT INTO users (email, password_hash, name, role, status) VALUES ($1, $2, $3, $4, 'approved') RETURNING id, email, name, role, status",
            body.get("email"), pwd_hash(body.get("password", "")), body.get("name"), body.get("role") or "worker")
    invalidate_account_cache(r_["id"])
    await broadcast("users")
    return dict(r_)


@app.get("/users")
async def get_users(user=Depends(owner_only)):
    async with pool.acquire() as c:
        return rows(await c.fetch("SELECT id, email, name, role, status FROM users ORDER BY id DESC"))


# ── Orders ──

@app.post("/orders")
async def create_order(request: Request, user=Depends(get_user)):
    body = await request.json()
    order_number = str(body.get("order_number") or "").strip()
    client_name = str(body.get("client_name") or "").strip()
    if not order_number:
        raise HTTPException(400, "order_number is required")
    if not client_name:
        raise HTTPException(400, "client_name is required")
    order_date = parse_optional_date(body.get("order_date"))
    normalized_status = normalize_order_status(body.get("status", "Active"))
    norm_items = [
        {"item_name": str(i.get("item_name") or "").strip(),
         "required_quantity": float(i.get("required_quantity", 0)),
         "unit_price": float(i.get("unit_price") or 0)}
        for i in (body.get("items") or [])
        if str(i.get("item_name") or "").strip() and float(i.get("required_quantity", 0)) > 0
    ]
    async with pool.acquire() as c:
        try:
            async with c.transaction():
                order_row = await c.fetchrow(
                    "INSERT INTO orders (order_number, client_name, status, order_date) VALUES ($1, $2, $3, $4) RETURNING *",
                    order_number, client_name, normalized_status, order_date)
                order = dict(order_row)
                for item in norm_items:
                    await c.execute("INSERT INTO order_items (order_id, item_name, required_quantity, unit_price) VALUES ($1, $2, $3, $4)",
                                    order["id"], item["item_name"], item["required_quantity"], item["unit_price"])
                hydrated = await hydrate_orders(c, [order])
            await broadcast("orders")
            return hydrated[0]
        except asyncpg.UniqueViolationError:
            raise HTTPException(400, "Order number already exists")


@app.get("/orders")
async def get_orders(include_items: str = None, user=Depends(get_user)):
    async with pool.acquire() as c:
        rs_ = rows(await c.fetch("SELECT * FROM orders ORDER BY created_at DESC, id DESC"))
        if str(include_items or "").lower() in ("1", "true", "yes"):
            return await hydrate_orders(c, rs_)
        return rs_


@app.get("/orders/{order_number}/items")
async def get_order_items_by_number(order_number: str, user=Depends(get_user)):
    async with pool.acquire() as c:
        o = await c.fetchrow("SELECT id FROM orders WHERE order_number = $1", order_number)
        if not o:
            raise HTTPException(404, "Order not found")
        return await fetch_order_items(c, o["id"])


@app.get("/orders/{order_id}")
async def get_order(order_id: int, user=Depends(get_user)):
    async with pool.acquire() as c:
        r_ = await c.fetchrow("SELECT * FROM orders WHERE id = $1", order_id)
        if not r_:
            raise HTTPException(404, "Order not found")
        hydrated = await hydrate_orders(c, [dict(r_)])
        return hydrated[0]


@app.delete("/orders/{order_id}")
async def delete_order(order_id: int, user=Depends(get_user)):
    require_owner_or_admin(user)
    async with pool.acquire() as c:
        async with c.transaction():
            # order_items and fulfillment_records cascade away with the order, so say
            # how much delivery history went with it instead of deleting silently.
            counts = await c.fetchrow(
                """SELECT (SELECT COUNT(*) FROM order_items WHERE order_id = $1)::int AS items,
                          (SELECT COUNT(*) FROM fulfillment_records WHERE order_id = $1)::int AS fulfilments""",
                order_id)
            r_ = await c.fetchrow("DELETE FROM orders WHERE id = $1 RETURNING *", order_id)
            if not r_:
                raise HTTPException(404, "Order not found")
    await broadcast("orders")
    return {"message": "Order deleted", "deleted": dict(r_),
            "deleted_items": counts["items"], "deleted_fulfilments": counts["fulfilments"]}


@app.put("/orders/{order_id}/status")
async def update_order_status(order_id: int, request: Request, user=Depends(get_user)):
    body = await request.json()
    normalized = normalize_order_status(body.get("status"))
    if normalized not in ("Active", "completed", "cancelled"):
        raise HTTPException(400, "Invalid order status")
    async with pool.acquire() as c:
        r_ = await c.fetchrow("UPDATE orders SET status = $1, updated_at = NOW() WHERE id = $2 RETURNING *", normalized, order_id)
        if not r_:
            raise HTTPException(404, "Order not found")
    await broadcast("orders")
    return dict(r_)


# ── Fulfillment ──

@app.post("/fulfillment")
async def create_fulfillment(request: Request, user=Depends(get_user)):
    body = await request.json()
    order_number = str(body.get("order_number") or "").strip()
    item_id = body.get("item_id")
    item_index = body.get("item_index")
    note = body.get("note")
    if not order_number:
        raise HTTPException(400, "order_number is required")
    try:
        quantity = float(body.get("supplied_quantity"))
        if quantity <= 0:
            raise ValueError()
    except (TypeError, ValueError):
        raise HTTPException(400, "supplied_quantity must be greater than 0")
    async with pool.acquire() as c:
        async with c.transaction():
            order = await c.fetchrow("SELECT id, status FROM orders WHERE order_number = $1 FOR UPDATE", order_number)
            if not order:
                raise HTTPException(404, "Order not found")
            target = None
            if item_id is not None:
                r_ = await c.fetchrow("SELECT id, item_name, required_quantity FROM order_items WHERE id = $1 AND order_id = $2 FOR UPDATE", int(item_id), order["id"])
                target = dict(r_) if r_ else None
            elif item_index is not None and item_index != "":
                r_ = await c.fetchrow("SELECT id, item_name, required_quantity FROM order_items WHERE order_id = $1 ORDER BY created_at ASC, id ASC OFFSET $2 LIMIT 1 FOR UPDATE", order["id"], int(item_index))
                target = dict(r_) if r_ else None
            if not target:
                raise HTTPException(400, "Valid order item is required")
            fulfilled_row = await c.fetchrow("SELECT COALESCE(SUM(supplied_quantity), 0)::float AS fulfilled_quantity FROM fulfillment_records WHERE order_item_id = $1", target["id"])
            fulfilled_qty = float(fulfilled_row["fulfilled_quantity"]) if fulfilled_row else 0.0
            remaining = float(target["required_quantity"]) - fulfilled_qty
            if remaining < quantity:
                raise HTTPException(400, f"Cannot supply more than remaining quantity ({max(remaining, 0):.2f} kg)")
            insert_row = await c.fetchrow(
                "INSERT INTO fulfillment_records (order_id, order_item_id, supplied_quantity, note, created_by) VALUES ($1, $2, $3, $4, $5) RETURNING *",
                order["id"], target["id"], quantity, note, user.get("id") or user.get("user_id"))
            required_qty = float(target["required_quantity"])
            supplied_total = fulfilled_qty + quantity
            tol = await eval_tolerance(required_qty, supplied_total, c)
            if supplied_total < required_qty - 1e-9:
                # Partial deliveries are normal; the order is only measurable against
                # tolerance once the item is fully supplied.
                tol = {**tol, "tolerance_status": "PENDING"}
            if STRICT_TOLERANCE and tol["tolerance_status"] == "BREACH":
                raise HTTPException(400, {"error": "Tolerance breach", "details": tol})
            await sync_order_status(c, order["id"])
    await broadcast("orders")
    return {**dict(insert_row), "order_number": order_number, "item_name": target["item_name"], "tolerance": tol}


@app.get("/fulfillment")
async def get_fulfillment(order_number: str = None, limit: str = "500", user=Depends(get_user)):
    async with pool.acquire() as c:
        conds, vals = [], []
        if order_number:
            vals.append(order_number.strip()); conds.append(f"o.order_number = ${len(vals)}")
        vals.append(min(max(int(limit) if limit.isdigit() else 500, 1), 1000))
        where = f"WHERE {' AND '.join(conds)}" if conds else ""
        return rows(await c.fetch(
            f"SELECT fr.*, o.order_number, oi.item_name FROM fulfillment_records fr JOIN orders o ON o.id = fr.order_id JOIN order_items oi ON oi.id = fr.order_item_id {where} ORDER BY fr.created_at DESC LIMIT ${len(vals)}",
            *vals))


# ── Wastage ──

@app.post("/wastage")
async def create_wastage(request: Request, user=Depends(get_user)):
    body = await request.json()
    waste_date = parse_required_date(body.get("date"))
    weight = body.get("weight")
    if weight is None or float(weight) <= 0:
        raise HTTPException(400, "weight must be greater than 0")
    async with pool.acquire() as c:
        async with c.transaction():
            # MAX(id)+1 outside a lock lets two simultaneous entries pick the same id
            # and one of them dies on the primary key. Serialise the numbering.
            await c.execute("LOCK TABLE wastage_data IN EXCLUSIVE MODE")
            seq = await c.fetchrow("SELECT COALESCE(MAX(id), 0) + 1 AS next_id, COALESCE(MAX(sno), 0) + 1 AS next_sno FROM wastage_data")
            r_ = await c.fetchrow(
                "INSERT INTO wastage_data (id, sno, date, weight) VALUES ($1, $2, $3, $4) RETURNING id, sno, date, weight",
                seq["next_id"], seq["next_sno"], waste_date, float(weight))
    await broadcast("wastage")
    return AppResponse(status_code=201, content={"message": "Wastage recorded", "data": dict(r_)})


@app.get("/wastage")
async def get_wastage(date_from: str = None, date_to: str = None, user=Depends(get_user)):
    async with pool.acquire() as c:
        vals = []
        where = build_date_where(date_from, date_to, vals, "date")
        vals.append(500)
        return rows(await c.fetch(f"SELECT id, sno, date, weight FROM wastage_data {where} ORDER BY sno DESC LIMIT ${len(vals)}", *vals))


@app.delete("/wastage/{wastage_id}")
async def delete_wastage(wastage_id: int, user=Depends(get_user)):
    require_owner_or_admin(user)
    if wastage_id <= 0:
        raise HTTPException(400, "Invalid id")
    async with pool.acquire() as c:
        r_ = await c.fetchrow("DELETE FROM wastage_data WHERE id = $1 RETURNING id, sno", wastage_id)
        if not r_:
            raise HTTPException(404, "Wastage entry not found")
    await broadcast("wastage")
    return {"message": "Wastage entry deleted", "deleted": dict(r_)}


# ── Trading ──

@app.get("/trading")
async def get_trading(user=Depends(get_user)):
    async with pool.acquire() as c:
        return rows(await c.fetch("SELECT * FROM trading_records ORDER BY date DESC, id DESC"))


@app.post("/trading")
async def create_trading(request: Request, user=Depends(get_user)):
    require_owner_or_admin(user)
    body = await request.json()
    trading_date = parse_optional_date(body.get("date")) or dt_date.today()
    nw = to_num(body.get("net_weight"))
    rate = to_num(body.get("rate"))
    order_number = (body.get("order_number") or "").strip() or None
    trade_type = (body.get("type") or "").strip().upper()
    if trade_type not in ("BUY", "SELL"):
        trade_type = "BUY"  # safe default
    material_name = str(body.get("material_name") or "").strip()
    if not material_name:
        raise HTTPException(400, "material_name is required")
    async with pool.acquire() as c:
        r_ = await c.fetchrow(
            "INSERT INTO trading_records (date, order_number, material_name, net_weight, rate, total_value, type, created_at, updated_at) VALUES ($1, $2, $3, $4, $5, $6, $7, NOW(), NOW()) RETURNING *",
            trading_date, order_number, material_name, nw, rate, nw * rate, trade_type)
    await broadcast("trading")
    return {"success": True, "data": dict(r_)}


@app.put("/trading/{trading_id}")
async def update_trading(trading_id: str, request: Request, user=Depends(get_user)):
    require_owner_or_admin(user)
    body = await request.json()
    trading_date = parse_optional_date(body.get("date"))
    nw = to_num(body.get("net_weight"))
    rate = to_num(body.get("rate"))
    order_number = (body.get("order_number") or "").strip() or None
    trade_type = (body.get("type") or "").strip().upper()
    if trade_type not in ("BUY", "SELL"):
        trade_type = "BUY"
    async with pool.acquire() as c:
        r_ = await c.fetchrow(
            "UPDATE trading_records SET date=$1, order_number=$2, material_name=$3, net_weight=$4, rate=$5, total_value=$6, type=$7, updated_at=NOW() WHERE id=$8::uuid RETURNING *",
            trading_date, order_number, body.get("material_name"), nw, rate, nw * rate, trade_type, trading_id)
    if not r_:
        raise HTTPException(404, "Trading record not found")
    await broadcast("trading")
    return {"success": True, "data": dict(r_)}


@app.delete("/trading/{trading_id}")
async def delete_trading(trading_id: str, user=Depends(get_user)):
    require_owner_or_admin(user)
    async with pool.acquire() as c:
        r_ = await c.fetchrow("DELETE FROM trading_records WHERE id = $1::uuid RETURNING id", trading_id)
        if not r_:
            raise HTTPException(404, "Trading record not found")
    await broadcast("trading")
    return {"success": True}


# ─────────────────────────── Table init ───────────────────────────

# ── Issue reports ──

@app.post("/issue-reports")
async def create_issue_report(
    title: str = Form(...),
    description: str = Form(""),
    page_url: str = Form(""),
    app_version: str = Form(""),
    files: list[UploadFile] = File(default=[]),
    user=Depends(get_user),
):
    clean_title = title.strip()
    if not clean_title:
        raise HTTPException(400, "title is required")
    if len(files) > ISSUE_MAX_FILES:
        raise HTTPException(400, f"Maximum {ISSUE_MAX_FILES} attachments allowed")

    ISSUE_UPLOAD_DIR.mkdir(parents=True, exist_ok=True)
    saved_files = []
    async with pool.acquire() as c:
        async with c.transaction():
            report = await c.fetchrow(
                """INSERT INTO issue_reports (title, description, page_url, app_version, created_by)
                   VALUES ($1, $2, $3, $4, $5)
                   RETURNING id, title, description, page_url, app_version, created_by, status, created_at""",
                clean_title,
                description.strip(),
                page_url.strip(),
                app_version.strip(),
                user_id_from_token(user),
            )

            attachment_rows = []
            try:
                for upload in files:
                    content_type = upload.content_type or "application/octet-stream"
                    extension = ISSUE_ALLOWED_CONTENT_TYPES.get(content_type)
                    if not extension:
                        raise HTTPException(400, f"Unsupported attachment type: {content_type}")

                    stored_name = f"{report['id']}_{uuid4().hex}{extension}"
                    stored_path = ISSUE_UPLOAD_DIR / stored_name
                    saved_files.append(stored_path)
                    size_bytes = 0
                    with stored_path.open("wb") as out:
                        while chunk := await upload.read(1024 * 1024):
                            size_bytes += len(chunk)
                            if size_bytes > ISSUE_MAX_FILE_MB * 1024 * 1024:
                                raise HTTPException(400, f"Each attachment must be {ISSUE_MAX_FILE_MB}MB or less")
                            out.write(chunk)

                    attachment = await c.fetchrow(
                        """INSERT INTO issue_report_attachments
                           (report_id, original_filename, stored_path, content_type, size_bytes)
                           VALUES ($1, $2, $3, $4, $5)
                           RETURNING id, original_filename, content_type, size_bytes, created_at""",
                        report["id"],
                        upload.filename or stored_name,
                        stored_name,
                        content_type,
                        size_bytes,
                    )
                    item = dict(attachment)
                    item["url"] = issue_attachment_url(report["id"], attachment["id"])
                    attachment_rows.append(item)
            except Exception:
                for path in saved_files:
                    try:
                        path.unlink(missing_ok=True)
                    except OSError:
                        logger.warning("Could not remove failed issue attachment: %s", path)
                raise

    await broadcast("issue_reports")
    data = dict(report)
    data["attachments"] = attachment_rows
    return AppResponse(status_code=201, content={"success": True, "data": data})


@app.get("/issue-reports")
async def get_issue_reports(limit: str = "100", user=Depends(get_user)):
    require_owner_or_admin(user)
    safe_limit = min(max(int(limit) if str(limit).isdigit() else 100, 1), 500)
    async with pool.acquire() as c:
        reports = rows(await c.fetch(
            """SELECT ir.*, u.name AS reporter_name, u.email AS reporter_email
               FROM issue_reports ir
               LEFT JOIN users u ON u.id = ir.created_by
               ORDER BY ir.created_at DESC
               LIMIT $1""",
            safe_limit,
        ))
        ids = [r["id"] for r in reports]
        attachment_rows = rows(await c.fetch(
            """SELECT id, report_id, original_filename, content_type, size_bytes, created_at
               FROM issue_report_attachments
               WHERE report_id = ANY($1::int[])
               ORDER BY id ASC""",
            ids,
        )) if ids else []

    grouped = {}
    for attachment in attachment_rows:
        attachment["url"] = issue_attachment_url(attachment["report_id"], attachment["id"])
        grouped.setdefault(attachment["report_id"], []).append(attachment)
    for report in reports:
        report["attachments"] = grouped.get(report["id"], [])
    return {"success": True, "data": reports}


@app.put("/issue-reports/{report_id}")
async def update_issue_report(report_id: int, request: Request, user=Depends(get_user)):
    require_owner_or_admin(user)
    body = await request.json()
    title = body.get("title")
    description = body.get("description")
    status = body.get("status")
    allowed_statuses = {"open", "fixed"}

    if title is not None and not str(title).strip():
        raise HTTPException(400, "title is required")
    if status is not None:
        status = str(status).strip().lower()
        if status not in allowed_statuses:
            raise HTTPException(400, "status must be open or fixed")

    async with pool.acquire() as c:
        current = await c.fetchrow("SELECT * FROM issue_reports WHERE id = $1", report_id)
        if not current:
            raise HTTPException(404, "Issue report not found")

        updated = await c.fetchrow(
            """UPDATE issue_reports
               SET title = $1,
                   description = $2,
                   status = $3,
                   updated_at = NOW()
               WHERE id = $4
               RETURNING *""",
            str(title).strip() if title is not None else current["title"],
            str(description).strip() if description is not None else current["description"],
            status if status is not None else current["status"],
            report_id,
        )

    await broadcast("issue_reports")
    return {"success": True, "data": dict(updated)}


@app.delete("/issue-reports/{report_id}")
async def delete_issue_report(report_id: int, user=Depends(get_user)):
    require_owner_or_admin(user)
    async with pool.acquire() as c:
        async with c.transaction():
            attachments = rows(await c.fetch(
                "SELECT stored_path FROM issue_report_attachments WHERE report_id = $1",
                report_id,
            ))
            deleted = await c.fetchrow("DELETE FROM issue_reports WHERE id = $1 RETURNING id", report_id)
            if not deleted:
                raise HTTPException(404, "Issue report not found")

    for attachment in attachments:
        file_path = (ISSUE_UPLOAD_DIR / attachment["stored_path"]).resolve()
        if ISSUE_UPLOAD_DIR in file_path.parents:
            try:
                file_path.unlink(missing_ok=True)
            except OSError:
                logger.warning("Could not remove issue attachment: %s", file_path)

    await broadcast("issue_reports")
    return {"success": True, "deleted": dict(deleted)}


@app.get("/issue-reports/{report_id}/attachments/{attachment_id}")
async def get_issue_report_attachment(report_id: int, attachment_id: int, user=Depends(get_user)):
    async with pool.acquire() as c:
        attachment = await c.fetchrow(
            """SELECT ira.*, ir.created_by
               FROM issue_report_attachments ira
               JOIN issue_reports ir ON ir.id = ira.report_id
               WHERE ira.id = $1 AND ira.report_id = $2""",
            attachment_id,
            report_id,
        )
    if not attachment:
        raise HTTPException(404, "Attachment not found")
    if not is_owner_or_admin(user) and user_id_from_token(user) != attachment["created_by"]:
        raise HTTPException(403, "Forbidden")

    file_path = (ISSUE_UPLOAD_DIR / attachment["stored_path"]).resolve()
    if ISSUE_UPLOAD_DIR not in file_path.parents or not file_path.exists():
        raise HTTPException(404, "Attachment file not found")
    return FileResponse(
        file_path,
        media_type=attachment["content_type"],
        filename=attachment["original_filename"],
        content_disposition_type="inline",
    )


async def initialize_tables():
    async with pool.acquire() as c:
        await c.execute("CREATE TABLE IF NOT EXISTS system_config (key VARCHAR(255) PRIMARY KEY, value TEXT NOT NULL)")
        await c.execute("INSERT INTO system_config (key, value) VALUES ('tolerance_percent', '10') ON CONFLICT (key) DO NOTHING")
        await c.execute("""CREATE TABLE IF NOT EXISTS orders (
            id SERIAL PRIMARY KEY, order_number VARCHAR(255) UNIQUE,
            client_name VARCHAR(255), status VARCHAR(50) NOT NULL DEFAULT 'Active',
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP, updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP)""")
        await c.execute("ALTER TABLE orders ADD COLUMN IF NOT EXISTS order_date DATE")
        await c.execute("CREATE UNIQUE INDEX IF NOT EXISTS idx_orders_order_number ON orders(order_number) WHERE order_number IS NOT NULL")
        await c.execute("""CREATE TABLE IF NOT EXISTS order_items (
            id SERIAL PRIMARY KEY, order_id INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
            item_name VARCHAR(255) NOT NULL, required_quantity NUMERIC(12, 3) NOT NULL,
            unit_price NUMERIC(12, 2) NOT NULL DEFAULT 0, created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP)""")
        await c.execute("ALTER TABLE order_items ADD COLUMN IF NOT EXISTS unit_price NUMERIC(12, 2) NOT NULL DEFAULT 0")
        await c.execute("CREATE INDEX IF NOT EXISTS idx_order_items_order_id ON order_items(order_id)")
        await c.execute("""CREATE TABLE IF NOT EXISTS fulfillment_records (
            id SERIAL PRIMARY KEY, order_id INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
            order_item_id INTEGER NOT NULL REFERENCES order_items(id) ON DELETE CASCADE,
            supplied_quantity NUMERIC(12, 3) NOT NULL, note TEXT, created_by INTEGER,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP)""")
        await c.execute("CREATE INDEX IF NOT EXISTS idx_fulfillment_records_order_id ON fulfillment_records(order_id)")
        await c.execute("CREATE INDEX IF NOT EXISTS idx_fulfillment_records_order_item_id ON fulfillment_records(order_item_id)")
        await c.execute("""CREATE TABLE IF NOT EXISTS issue_reports (
            id SERIAL PRIMARY KEY,
            title VARCHAR(255) NOT NULL,
            description TEXT NOT NULL DEFAULT '',
            page_url TEXT NOT NULL DEFAULT '',
            app_version VARCHAR(100) NOT NULL DEFAULT '',
            created_by INTEGER,
            status VARCHAR(50) NOT NULL DEFAULT 'open',
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP)""")
        await c.execute("CREATE INDEX IF NOT EXISTS idx_issue_reports_created_at ON issue_reports(created_at DESC)")
        await c.execute("""CREATE TABLE IF NOT EXISTS issue_report_attachments (
            id SERIAL PRIMARY KEY,
            report_id INTEGER NOT NULL REFERENCES issue_reports(id) ON DELETE CASCADE,
            original_filename TEXT NOT NULL,
            stored_path TEXT NOT NULL,
            content_type VARCHAR(100) NOT NULL,
            size_bytes INTEGER NOT NULL DEFAULT 0,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP)""")
        await c.execute("CREATE INDEX IF NOT EXISTS idx_issue_attachments_report_id ON issue_report_attachments(report_id)")
        await c.execute("""CREATE TABLE IF NOT EXISTS machine_stock_assignments (
            id SERIAL PRIMARY KEY, machine_id VARCHAR(10) NOT NULL, material_type_id INTEGER NOT NULL,
            quantity_kg NUMERIC(12, 2) NOT NULL DEFAULT 0,
            assigned_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP, updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            UNIQUE(machine_id, material_type_id))""")
        await c.execute("CREATE INDEX IF NOT EXISTS idx_machine_assignments_machine_id ON machine_stock_assignments(machine_id)")
        await c.execute("CREATE INDEX IF NOT EXISTS idx_machine_assignments_material_type_id ON machine_stock_assignments(material_type_id)")
        # ── Ledger integrity migrations (all additive; existing rows untouched) ──
        # materials_master ids and material_types ids are different id spaces. These
        # columns record the floor material explicitly instead of overloading
        # material_id, which was silently mixing the two.
        await c.execute("ALTER TABLE production_logs ADD COLUMN IF NOT EXISTS material_type_id BIGINT")
        await c.execute("ALTER TABLE material_movements ADD COLUMN IF NOT EXISTS material_type_id BIGINT")
        await c.execute("CREATE INDEX IF NOT EXISTS idx_production_logs_material_type ON production_logs(material_type_id)")
        await c.execute("CREATE INDEX IF NOT EXISTS idx_production_logs_created_at ON production_logs(created_at DESC)")
        await c.execute("""CREATE INDEX IF NOT EXISTS idx_material_movements_consumption_ref
                           ON material_movements(reference_id) WHERE movement_type = 'CONSUMPTION'""")

        # Assignments mirror floor balances, which carry 3 decimals.
        await c.execute("ALTER TABLE machine_stock_assignments ALTER COLUMN quantity_kg TYPE NUMERIC(12, 3)")

        # Last line of defence: the database itself refuses negative stock, so no
        # code path — present or future — can drive a balance below zero.
        for table, column, name in (
            ("raw_material_totals", "total_quantity_kg", "raw_material_totals_nonneg"),
            ("floor_material_balance", "total_quantity_kg", "floor_material_balance_nonneg"),
            ("machine_stock_assignments", "quantity_kg", "machine_stock_assignments_nonneg"),
        ):
            try:
                await c.execute(
                    f"ALTER TABLE {table} ADD CONSTRAINT {name} CHECK ({column} >= 0)")
            except asyncpg.DuplicateObjectError:
                pass
            except Exception as e:  # a pre-existing negative row must not block startup
                logger.warning("Could not add %s: %s", name, e)

        await c.execute("""CREATE TABLE IF NOT EXISTS stock_reset_log (
            id SERIAL PRIMARY KEY,
            reset_at TIMESTAMP NOT NULL DEFAULT NOW(),
            reason TEXT NOT NULL DEFAULT '',
            snapshot JSONB NOT NULL)""")

        logger.info("Database tables initialized successfully")


# ── Wrap with ASGI-level CORS catch-all (after all routes are registered) ─────
# This adds CORS headers to EVERY response at the raw ASGI level, even error
# responses from proxy failures, DB connection errors, etc.
app = _ASGICorsMiddleware(
    app,
    CORS_ORIGIN_RE,
    CORS_ALLOW_METHODS,
    CORS_ALLOW_HEADERS,
)

# ─────────────────────────── Entry point ───────────────────────────

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(
        "server:app",
        host="0.0.0.0",
        port=int(os.getenv("PORT", "3000")),
        loop="uvloop",
        workers=1,
        reload=False,
    )


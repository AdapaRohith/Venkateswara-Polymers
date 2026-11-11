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
from fastapi.responses import FileResponse, ORJSONResponse, Response, StreamingResponse
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


def can_modify_entry(user: dict, created_by: int | None) -> bool:
    """Owners/admins may correct any entry; workers may correct only their own."""
    if is_owner_or_admin(user):
        return True
    actor_id = user_id_from_token(user)
    try:
        return actor_id is not None and int(created_by) == actor_id
    except (TypeError, ValueError):
        return False


def require_entry_owner(user: dict, created_by: int | None):
    if not can_modify_entry(user, created_by):
        raise HTTPException(403, "You can modify only entries you created")


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


# ── Business date + AM/PM shift ──

BAG_KG = Decimal("25")
SHIFTS = ("AM", "PM")

# Morning (AM) shift runs from SHIFT_AM_START to SHIFT_PM_START; the night (PM)
# shift runs from SHIFT_PM_START until the next morning and belongs to the day it
# started on, so work keyed in at 02:00 is filed under the previous day's PM.
SHIFT_AM_START = _parse_clock(os.getenv("SHIFT_AM_START", "08:00:00"), dtime(8, 0, 0))
SHIFT_PM_START = _parse_clock(os.getenv("SHIFT_PM_START", "20:00:00"), dtime(20, 0, 0))
# Clock time stamped on an entry filed for another business date / shift.
SHIFT_ENTRY_TIME = {"AM": BACKDATED_ENTRY_TIME, "PM": _parse_clock(
    os.getenv("BACKDATED_PM_ENTRY_TIME", "21:00:00"), dtime(21, 0, 0))}


def derive_business_context(moment: datetime | None = None) -> tuple[dt_date, str]:
    moment = moment or datetime.now()
    clock = moment.time()
    if SHIFT_AM_START <= clock < SHIFT_PM_START:
        return moment.date(), "AM"
    if clock >= SHIFT_PM_START:
        return moment.date(), "PM"
    return moment.date() - timedelta(days=1), "PM"


def row_business_context(row) -> tuple[dt_date | None, str | None]:
    """The business date/shift an existing entry belongs to (derived for old rows).

    Corrections and reversals are filed on the original entry's day and shift, so
    a deleted mistake disappears from that day's ledger instead of distorting the
    day it was noticed on.
    """
    if not row:
        return None, None
    get = row.get if hasattr(row, "get") else (lambda k: row[k] if k in row else None)
    business_date, shift = get("business_date"), get("shift")
    created_at = get("created_at")
    if (business_date is None or shift is None) and isinstance(created_at, datetime):
        derived_date, derived_shift = derive_business_context(created_at)
        business_date = business_date or derived_date
        shift = shift or derived_shift
    return business_date, shift


def sql_business_date(date_col: str, ts_col: str) -> str:
    """SQL for a row's business date; historical rows derive it from their clock."""
    return (f"COALESCE({date_col}, CASE WHEN {ts_col}::time < '{SHIFT_AM_START.isoformat()}'::time "
            f"THEN ({ts_col}::date - 1) ELSE {ts_col}::date END)")


def sql_shift(shift_col: str, ts_col: str) -> str:
    """SQL for a row's AM/PM shift; historical rows derive it from their clock."""
    return (f"COALESCE({shift_col}, CASE WHEN {ts_col}::time >= '{SHIFT_AM_START.isoformat()}'::time "
            f"AND {ts_col}::time < '{SHIFT_PM_START.isoformat()}'::time THEN 'AM' ELSE 'PM' END)")


def normalize_shift(value) -> str | None:
    text = str(value or "").strip().upper()
    if not text:
        return None
    aliases = {"AM": "AM", "MORNING": "AM", "DAY": "AM", "A": "AM",
               "PM": "PM", "NIGHT": "PM", "EVENING": "PM", "N": "PM"}
    if text not in aliases:
        raise HTTPException(400, "shift must be AM (morning) or PM (night)")
    return aliases[text]


def shift_for_clock(clock: dtime) -> str:
    return "AM" if SHIFT_AM_START <= clock < SHIFT_PM_START else "PM"


def parse_entry_clock(value) -> dtime | None:
    """Optional HH:MM (or HH:MM:SS) the operator typed for when the work happened."""
    text = str(value or "").strip()
    if not text:
        return None
    try:
        parts = [int(p) for p in text.split(":")]
        if len(parts) not in (2, 3):
            raise ValueError
        return dtime(*parts)
    except (TypeError, ValueError) as exc:
        raise HTTPException(400, "entry_time must be HH:MM") from exc


def parse_business_context(payload: dict, now: datetime | None = None):
    """(business_date, shift, created_at) for an entry.

    No date and no shift → the live clock decides both and created_at stays None
    so the column default records the real time. Any other day or shift gets a
    fixed clock (AM 09:00, PM 21:00) so the row reads plainly as filed later.

    An explicit `entry_time` (HH:MM) stamps the entry at that clock instead. The
    shift follows the clock, and night-shift times after midnight land on the
    next calendar day while staying filed under the business date the shift
    started on — the operator who keys in last night's work the next morning
    types the times exactly as they were written on the shop-floor sheet.
    """
    payload = payload or {}
    live_date, live_shift = derive_business_context(now)
    raw_date = (payload.get("business_date") or payload.get("production_date")
                or payload.get("entry_date") or payload.get("date"))
    business_date = parse_optional_date(raw_date) or live_date
    requested_shift = normalize_shift(payload.get("shift"))
    clock = parse_entry_clock(payload.get("entry_time"))
    if clock is not None:
        clock_shift = shift_for_clock(clock)
        if requested_shift and requested_shift != clock_shift:
            raise HTTPException(400, (
                f"{clock:%H:%M} falls in the {clock_shift} shift, not {requested_shift}. "
                f"AM runs {SHIFT_AM_START:%H:%M}–{SHIFT_PM_START:%H:%M}."))
        calendar_day = business_date + timedelta(days=1) if clock < SHIFT_AM_START else business_date
        stamped = datetime.combine(calendar_day, clock)
        if stamped > (now or datetime.now()) + timedelta(minutes=5):
            raise HTTPException(400, f"{stamped:%d %b %Y %H:%M} is in the future")
        return business_date, clock_shift, stamped
    if not requested_shift and business_date in (live_date, (now or datetime.now()).date()):
        # No shift and "today" (calendar or business): the live clock decides,
        # so a night-shift entry at 02:00 still lands on the previous day's PM.
        return live_date, live_shift, None
    shift = requested_shift or "AM"
    if business_date == live_date and shift == live_shift:
        return business_date, shift, None
    return business_date, shift, datetime.combine(business_date, SHIFT_ENTRY_TIME[shift])


def parse_quantity_kg(body: dict, field: str = "quantity_kg") -> Decimal:
    """Quantity in kg from either `quantity_kg` or `quantity_bags` (1 bag = 25 kg)."""
    body = body or {}
    bags = body.get("quantity_bags", body.get("bags"))
    if bags not in (None, "") and body.get(field) in (None, ""):
        try:
            value = Decimal(str(bags)) * BAG_KG
        except Exception as exc:
            raise HTTPException(400, "Bags must be a number") from exc
    else:
        try:
            value = Decimal(str(body.get(field)))
        except Exception as exc:
            raise HTTPException(400, "Quantity must be a number") from exc
    if not value.is_finite() or value <= 0:
        raise HTTPException(400, "Quantity must be greater than zero")
    return value.quantize(Decimal("0.001"))


@app.get("/")
async def health():
    return "API running"

# ═══════════════════════════ IPMS stock engine ═══════════════════════════
#
# Raw material lives on the Ground Floor (receiving bay) and the 1st Floor
# (production running stock). Extruders turn a resin blend into film rolls
# (Roll Store); cutting machines turn rolls into finished goods (Finished Goods
# Store). Dispatches take goods out of either store. Every change is a row in
# stock_ledger; stock_balances is its running total.

from ipms_logic import (  # noqa: E402
    ALL_LOCATIONS, FINISHED_STORE, LOCATION_LABELS, MATERIAL_LOCATIONS, PRODUCT_STORE,
    REGRIND_BRAND, REGRIND_LOCATION, REGRIND_MATERIAL, ROLL_STORE, STATUS_LABELS,
    allocate_auto, day_register, location_accepts, merge_lines, normalize_material_name,
    normalize_product_code, shift_report, stock_status,
)

DOC_TABLES = {
    "RECEIPT": ("stock_receipts", "RC"),
    "TRANSFER": ("stock_transfers", "TR"),
    "EXTRUSION": ("production_entries", "EX"),
    "CUTTING": ("production_entries", "CT"),
    "ADJUSTMENT": ("stock_adjustments", "AD"),
}
QTY_EPS = Decimal("0.001")


def require_tx(conn):
    """Stock writes must run inside a transaction so row locks hold until commit."""
    if not conn.is_in_transaction():
        raise RuntimeError("Stock mutations must run inside a transaction")


def decimal_kg(value) -> Decimal:
    if isinstance(value, Decimal):
        return value
    return Decimal(str(value or 0))


def kg_out(value) -> float:
    return round(float(value or 0), 3)


def floatify(value):
    if isinstance(value, dict):
        return {k: floatify(v) for k, v in value.items()}
    if isinstance(value, list):
        return [floatify(v) for v in value]
    if isinstance(value, Decimal):
        return kg_out(value)
    return value


def parse_kg(value, field: str, *, allow_zero: bool = False) -> Decimal:
    try:
        q = Decimal(str(value))
    except Exception as exc:
        raise HTTPException(400, f"{field} must be a number") from exc
    if not q.is_finite() or q < 0 or (q == 0 and not allow_zero):
        raise HTTPException(400, f"{field} must be greater than zero")
    return q.quantize(QTY_EPS)


async def get_thresholds(c) -> tuple[Decimal, Decimal]:
    cfg = {r["key"]: r["value"] for r in await c.fetch(
        "SELECT key, value FROM system_config WHERE key IN ('reorder_below_kg', 'optimal_above_kg')")}
    return (decimal_kg(cfg.get("reorder_below_kg", 10000)), decimal_kg(cfg.get("optimal_above_kg", 20000)))


async def next_document_no(c, prefix: str, table: str, business_date: dt_date) -> str:
    """Sequential human-readable number per day, e.g. EX-20261111-004."""
    await c.execute("SELECT pg_advisory_xact_lock(hashtext($1))", f"vp-docno-{prefix}")
    stem = f"{prefix}-{business_date:%Y%m%d}"
    count = await c.fetchval(f"SELECT COUNT(*) FROM {table} WHERE doc_no LIKE $1", stem + "-%")
    return f"{stem}-{int(count) + 1:03d}"


async def guard_closed_day(c, user: dict, business_date) -> None:
    """A closed day is signed off: only an owner may still post into it."""
    if business_date is None or is_owner_or_admin(user):
        return
    await c.execute("SELECT pg_advisory_xact_lock_shared(hashtext('vp-day-close'))")
    if await c.fetchval("SELECT 1 FROM stock_day_closings WHERE business_date = $1", business_date):
        raise HTTPException(403, (
            f"{business_date:%d %b %Y} has been closed. Ask an owner to post or correct "
            "entries for a closed day."))


async def item_label(c, item_kind: str, item_id: int) -> str:
    if item_kind == "MATERIAL":
        return await c.fetchval("SELECT name FROM materials WHERE id = $1", item_id) or f"Material {item_id}"
    r_ = await c.fetchrow("SELECT kind, code FROM products WHERE id = $1", item_id)
    if not r_:
        return f"Product {item_id}"
    return f"{'Roll' if r_['kind'] == 'ROLL' else 'Finished'} {r_['code']}"


async def post_ledger(c, *, doc_type: str, doc_id: int, doc_no: str | None, business_date: dt_date,
                      shift: str, lines, created_by, note: str | None = None,
                      is_reversal: bool = False, occurred_at: datetime | None = None) -> list[dict]:
    """Apply stock lines atomically and append them to the ledger.

    Every balance row is locked in one stable order before anything is checked, so
    concurrent writers serialise; any line that would go negative aborts the whole
    document and nothing is written.
    """
    require_tx(c)
    merged = merge_lines(lines)
    if not merged:
        return []
    product_kinds = {}
    product_ids = [k[1] for k in merged if k[0] == "PRODUCT"]
    if product_ids:
        product_kinds = {r_["id"]: r_["kind"] for r_ in await c.fetch(
            "SELECT id, kind FROM products WHERE id = ANY($1::int[])", product_ids)}
    for item_kind, item_id, location in merged:
        if not location_accepts(item_kind, product_kinds.get(item_id), location):
            raise HTTPException(400, f"{await item_label(c, item_kind, item_id)} cannot be stored in "
                                     f"{LOCATION_LABELS.get(location, location)}")
    keys = sorted(merged)
    for item_kind, item_id, location in keys:
        await c.execute(
            """INSERT INTO stock_balances (item_kind, item_id, location, qty_kg)
               VALUES ($1, $2, $3, 0) ON CONFLICT DO NOTHING""", item_kind, item_id, location)
    opening = {}
    for item_kind, item_id, location in keys:
        opening[(item_kind, item_id, location)] = decimal_kg(await c.fetchval(
            """SELECT qty_kg FROM stock_balances
                WHERE item_kind = $1 AND item_id = $2 AND location = $3 FOR UPDATE""",
            item_kind, item_id, location))
    for key in keys:
        if opening[key] + merged[key] < 0:
            item_kind, item_id, location = key
            raise HTTPException(400, (
                f"Not enough {await item_label(c, item_kind, item_id)} in "
                f"{LOCATION_LABELS.get(location, location)}: needs {float(-merged[key]):,.3f} kg, "
                f"available {float(opening[key]):,.3f} kg"))
    receipt = []
    for key in keys:
        item_kind, item_id, location = key
        closing = opening[key] + merged[key]
        await c.execute(
            """UPDATE stock_balances SET qty_kg = $4, updated_at = NOW()
                WHERE item_kind = $1 AND item_id = $2 AND location = $3""",
            item_kind, item_id, location, closing)
        await c.execute(
            """INSERT INTO stock_ledger (occurred_at, business_date, shift, doc_type, doc_id, doc_no,
                       item_kind, item_id, location, delta_kg, balance_after_kg, is_reversal, note, created_by)
               VALUES (COALESCE($1, NOW()), $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)""",
            occurred_at, business_date, shift, doc_type, doc_id, doc_no, item_kind, item_id, location,
            merged[key], closing, is_reversal, note, created_by)
        receipt.append({"item_kind": item_kind, "item_id": item_id, "item_name": await item_label(c, item_kind, item_id),
                        "location": location, "location_label": LOCATION_LABELS[location],
                        "opening_kg": kg_out(opening[key]), "delta_kg": kg_out(merged[key]),
                        "closing_kg": kg_out(closing)})
    return receipt


async def reverse_document(c, *, doc_type: str, doc_id: int, user: dict) -> list[dict]:
    """Post the exact opposite of a document's ledger rows, filed on its own day and shift."""
    table, _ = DOC_TABLES.get(doc_type, ("fulfillment_records", None))
    if doc_type == "DISPATCH":
        doc = await c.fetchrow("SELECT * FROM fulfillment_records WHERE id = $1 FOR UPDATE", doc_id)
    else:
        doc = await c.fetchrow(f"SELECT * FROM {table} WHERE id = $1 FOR UPDATE", doc_id)
    if not doc:
        raise HTTPException(404, "Entry not found")
    require_entry_owner(user, doc["created_by"])
    if doc_type != "DISPATCH" and doc["status"] != "ACTIVE":
        raise HTTPException(400, f"{doc['doc_no']} has already been reversed")
    await guard_closed_day(c, user, doc["business_date"])
    posted = await c.fetch(
        """SELECT item_kind, item_id, location, SUM(delta_kg) AS delta, MIN(business_date) AS bd,
                  MIN(shift) AS shift, MIN(doc_no) AS doc_no
             FROM stock_ledger WHERE doc_type = $1 AND doc_id = $2
            GROUP BY 1, 2, 3""", doc_type, doc_id)
    lines = [(p["item_kind"], p["item_id"], p["location"], -decimal_kg(p["delta"])) for p in posted]
    if not posted:
        return []
    try:
        receipt = await post_ledger(
            c, doc_type=doc_type, doc_id=doc_id, doc_no=posted[0]["doc_no"],
            business_date=posted[0]["bd"], shift=posted[0]["shift"], lines=lines,
            created_by=user_id_from_token(user), note="Reversal", is_reversal=True)
    except HTTPException as exc:
        raise HTTPException(400, f"Cannot reverse this entry — its stock has already moved on. {exc.detail}") from exc
    if doc_type != "DISPATCH":
        await c.execute(
            f"UPDATE {table} SET status = 'REVERSED', reversed_by = $1, reversed_at = NOW() WHERE id = $2",
            user_id_from_token(user), doc_id)
    return receipt


# ── Masters: materials, products, machines ──

async def resolve_material(c, body: dict, *, create: bool = False) -> dict:
    mid = body.get("material_id")
    if mid not in (None, ""):
        r_ = await c.fetchrow("SELECT * FROM materials WHERE id = $1", int(to_num(mid)))
        if not r_:
            raise HTTPException(404, "Material not found")
        return dict(r_)
    name = normalize_material_name(body.get("material_name"))
    if not name:
        raise HTTPException(400, "Choose a material")
    r_ = await c.fetchrow("SELECT * FROM materials WHERE LOWER(BTRIM(name)) = LOWER($1)", name)
    if r_:
        return dict(r_)
    if not create:
        raise HTTPException(404, f"Material '{name}' not found — add it under Raw Material first")
    brand = normalize_material_name(body.get("brand")).upper()
    return dict(await c.fetchrow(
        "INSERT INTO materials (name, brand) VALUES ($1, $2) RETURNING *", name, brand))


async def regrind_material_id(c) -> int:
    r_ = await c.fetchrow("SELECT id FROM materials WHERE LOWER(BTRIM(name)) = LOWER($1)", REGRIND_MATERIAL)
    if r_:
        return r_["id"]
    return await c.fetchval(
        "INSERT INTO materials (name, brand) VALUES ($1, $2) ON CONFLICT DO NOTHING RETURNING id",
        REGRIND_MATERIAL, REGRIND_BRAND) or await c.fetchval(
        "SELECT id FROM materials WHERE LOWER(BTRIM(name)) = LOWER($1)", REGRIND_MATERIAL)


async def get_or_create_product(c, kind: str, code_or_id, *, create: bool = True) -> dict:
    if kind not in PRODUCT_STORE:
        raise HTTPException(400, "Product kind must be ROLL or FINISHED")
    code =normalize_product_code(code_or_id)
    if not code:
        raise HTTPException(400, "Size is required")
    r_ = await c.fetchrow("SELECT * FROM products WHERE kind = $1 AND code = $2", kind, code)
    if r_:
        return dict(r_)
    if not create:
        raise HTTPException(404, f"No {kind.lower()} stock item '{code}'")
    return dict(await c.fetchrow(
        """INSERT INTO products (kind, code) VALUES ($1, $2)
           ON CONFLICT (kind, code) DO UPDATE SET code = EXCLUDED.code RETURNING *""", kind, code))


async def product_by_id(c, product_id, kind: str | None = None) -> dict:
    r_ = await c.fetchrow("SELECT * FROM products WHERE id = $1", int(to_num(product_id)))
    if not r_ or (kind and r_["kind"] != kind):
        raise HTTPException(404, "Stock item not found")
    return dict(r_)


async def fetch_machine(c, machine_id) -> dict:
    r_ = await c.fetchrow("SELECT id, name, type FROM machines WHERE id = $1", parse_machine_id(machine_id))
    if not r_:
        raise HTTPException(404, "Machine not found")
    return dict(r_)


async def balances_map(c) -> dict:
    return {(r_["item_kind"], r_["item_id"], r_["location"]): decimal_kg(r_["qty_kg"])
            for r_ in await c.fetch("SELECT item_kind, item_id, location, qty_kg FROM stock_balances")}


async def material_rows(c) -> list[dict]:
    low, high = await get_thresholds(c)
    bal = await balances_map(c)
    out = []
    for m in await c.fetch("SELECT * FROM materials ORDER BY LOWER(name)"):
        gf = bal.get(("MATERIAL", m["id"], "GROUND_FLOOR"), Decimal("0"))
        ff = bal.get(("MATERIAL", m["id"], "FIRST_FLOOR"), Decimal("0"))
        m_low = m["reorder_below_kg"] if m["reorder_below_kg"] is not None else low
        m_high = m["optimal_above_kg"] if m["optimal_above_kg"] is not None else high
        out.append({
            "id": m["id"], "name": m["name"], "brand": m["brand"], "active": m["active"],
            "reorder_below_kg": kg_out(m["reorder_below_kg"]) if m["reorder_below_kg"] is not None else None,
            "optimal_above_kg": kg_out(m["optimal_above_kg"]) if m["optimal_above_kg"] is not None else None,
            "ground_floor_kg": kg_out(gf), "first_floor_kg": kg_out(ff), "total_kg": kg_out(gf + ff),
            "status": stock_status(gf + ff, m_low, m_high),
            "ground_floor_status": stock_status(gf, m_low, m_high),
            "first_floor_status": stock_status(ff, m_low, m_high),
        })
    return out


async def product_rows(c, kind: str | None = None) -> list[dict]:
    bal = await balances_map(c)
    q = "SELECT * FROM products" + (" WHERE kind = $1" if kind else "") + " ORDER BY kind, code"
    out = []
    for p in await c.fetch(q, *([kind] if kind else [])):
        qty = bal.get(("PRODUCT", p["id"], PRODUCT_STORE[p["kind"]]), Decimal("0"))
        out.append({"id": p["id"], "kind": p["kind"], "code": p["code"], "description": p["description"],
                    "active": p["active"], "location": PRODUCT_STORE[p["kind"]], "quantity_kg": kg_out(qty)})
    return out


@app.get("/stock/meta")
async def get_stock_meta(user=Depends(get_user)):
    live_date, live_shift = derive_business_context()
    async with pool.acquire() as c:
        machines = rows(await c.fetch("SELECT id, name, type FROM machines ORDER BY type DESC, id"))
        low, high = await get_thresholds(c)
    return {
        "locations": [{"id": k, "label": v} for k, v in LOCATION_LABELS.items()],
        "material_locations": list(MATERIAL_LOCATIONS),
        "shifts": [
            {"id": "AM", "label": "Day · AM", "starts": SHIFT_AM_START.isoformat(timespec="minutes"),
             "ends": SHIFT_PM_START.isoformat(timespec="minutes")},
            {"id": "PM", "label": "Night · PM", "starts": SHIFT_PM_START.isoformat(timespec="minutes"),
             "ends": SHIFT_AM_START.isoformat(timespec="minutes")},
        ],
        "default_entry_times": {k: v.isoformat(timespec="minutes") for k, v in SHIFT_ENTRY_TIME.items()},
        "bag_kg": float(BAG_KG),
        "thresholds": {"reorder_below_kg": kg_out(low), "optimal_above_kg": kg_out(high)},
        "status_labels": STATUS_LABELS,
        "regrind_material": REGRIND_MATERIAL,
        "live_business_date": live_date.isoformat(),
        "live_shift": live_shift,
        "machines": machines,
    }


@app.put("/stock/thresholds")
async def update_thresholds(request: Request, user=Depends(get_user)):
    require_owner_or_admin(user)
    body = await request.json()
    low = parse_kg(body.get("reorder_below_kg"), "Reorder level")
    high = parse_kg(body.get("optimal_above_kg"), "Optimal level")
    if high < low:
        raise HTTPException(400, "Optimal level must be at or above the reorder level")
    async with pool.acquire() as c:
        await c.execute(
            """INSERT INTO system_config (key, value) VALUES ('reorder_below_kg', $1), ('optimal_above_kg', $2)
               ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value""", low, high)
    await broadcast("stock")
    return {"reorder_below_kg": kg_out(low), "optimal_above_kg": kg_out(high)}


@app.get("/materials")
async def list_materials(user=Depends(get_user)):
    async with pool.acquire() as c:
        return await material_rows(c)


@app.post("/materials")
async def create_material(request: Request, user=Depends(get_user)):
    require_owner_or_admin(user)
    body = await request.json()
    name = normalize_material_name(body.get("name") or body.get("material_name"))
    if not name:
        raise HTTPException(400, "Material name is required")
    async with pool.acquire() as c:
        if await c.fetchval("SELECT 1 FROM materials WHERE LOWER(BTRIM(name)) = LOWER($1)", name):
            raise HTTPException(400, f"'{name}' already exists")
        low = parse_kg(body["reorder_below_kg"], "Reorder level") if body.get("reorder_below_kg") not in (None, "") else None
        high = parse_kg(body["optimal_above_kg"], "Optimal level") if body.get("optimal_above_kg") not in (None, "") else None
        r_ = await c.fetchrow(
            "INSERT INTO materials (name, brand, reorder_below_kg, optimal_above_kg) VALUES ($1, $2, $3, $4) RETURNING *",
            name, normalize_material_name(body.get("brand")).upper(), low, high)
    await broadcast("stock")
    return dict(r_)


@app.put("/materials/{material_id}")
async def update_material(material_id: int, request: Request, user=Depends(get_user)):
    require_owner_or_admin(user)
    body = await request.json()
    async with pool.acquire() as c:
        cur = await c.fetchrow("SELECT * FROM materials WHERE id = $1", material_id)
        if not cur:
            raise HTTPException(404, "Material not found")
        name = normalize_material_name(body.get("name", cur["name"]))
        if not name:
            raise HTTPException(400, "Material name is required")
        if await c.fetchval("SELECT 1 FROM materials WHERE LOWER(BTRIM(name)) = LOWER($1) AND id <> $2", name, material_id):
            raise HTTPException(400, f"'{name}' already exists")
        def thr(key, label):
            if key not in body:
                return cur[key]
            return parse_kg(body[key], label) if body[key] not in (None, "") else None
        r_ = await c.fetchrow(
            """UPDATE materials SET name = $1, brand = $2, reorder_below_kg = $3, optimal_above_kg = $4,
                      active = $5 WHERE id = $6 RETURNING *""",
            name, normalize_material_name(body.get("brand", cur["brand"])).upper(),
            thr("reorder_below_kg", "Reorder level"), thr("optimal_above_kg", "Optimal level"),
            bool(body.get("active", cur["active"])), material_id)
    await broadcast("stock")
    return dict(r_)


@app.get("/products")
async def list_products(kind: str = None, user=Depends(get_user)):
    async with pool.acquire() as c:
        return await product_rows(c, kind.upper() if kind else None)


@app.post("/products")
async def create_product(request: Request, user=Depends(get_user)):
    body = await request.json()
    kind = str(body.get("kind") or "").upper()
    async with pool.acquire() as c:
        async with c.transaction():
            p = await get_or_create_product(c, kind, body.get("code"))
            if body.get("description") is not None:
                p = dict(await c.fetchrow("UPDATE products SET description = $1 WHERE id = $2 RETURNING *",
                                          str(body["description"]).strip(), p["id"]))
    await broadcast("stock")
    return p


@app.post("/machines")
async def create_machine(request: Request, user=Depends(get_user)):
    require_owner_or_admin(user)
    body = await request.json()
    name = str(body.get("name") or "").strip()
    mtype = str(body.get("type") or "").strip().lower()
    if not name or mtype not in ("production", "cutting"):
        raise HTTPException(400, "Machine name and type (production or cutting) are required")
    async with pool.acquire() as c:
        r_ = await c.fetchrow("INSERT INTO machines (name, type) VALUES ($1, $2) RETURNING id, name, type", name, mtype)
    await broadcast("stock")
    return dict(r_)


@app.put("/machines/{machine_id}")
async def rename_machine(machine_id: int, request: Request, user=Depends(get_user)):
    require_owner_or_admin(user)
    body = await request.json()
    name = str(body.get("name") or "").strip()
    if not name:
        raise HTTPException(400, "Machine name is required")
    async with pool.acquire() as c:
        r_ = await c.fetchrow("UPDATE machines SET name = $1 WHERE id = $2 RETURNING id, name, type", name, machine_id)
    if not r_:
        raise HTTPException(404, "Machine not found")
    await broadcast("stock")
    return dict(r_)


# ── Receipts: raw material arriving at a floor ──

@app.post("/receipts")
async def create_receipt(request: Request, user=Depends(get_user)):
    body = await request.json()
    quantity = parse_quantity_kg(body)
    location = str(body.get("location") or "GROUND_FLOOR").upper()
    if location not in MATERIAL_LOCATIONS:
        raise HTTPException(400, "Receive into the Ground Floor or the 1st Floor")
    business_date, shift, entry_ts = parse_business_context(body)
    async with pool.acquire() as c:
        async with c.transaction():
            await guard_closed_day(c, user, business_date)
            material = await resolve_material(c, body, create=is_owner_or_admin(user))
            doc_no = await next_document_no(c, "RC", "stock_receipts", business_date)
            doc = await c.fetchrow(
                """INSERT INTO stock_receipts (doc_no, material_id, location, quantity_kg, batch_no, supplier, note,
                       business_date, shift, entered_at, created_by)
                   VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, COALESCE($10, NOW()), $11) RETURNING *""",
                doc_no, material["id"], location, quantity,
                str(body.get("batch_no") or "").strip() or None, str(body.get("supplier") or "").strip() or None,
                str(body.get("note") or "").strip() or None, business_date, shift, entry_ts, user_id_from_token(user))
            receipt = await post_ledger(
                c, doc_type="RECEIPT", doc_id=doc["id"], doc_no=doc_no, business_date=business_date, shift=shift,
                lines=[("MATERIAL", material["id"], location, quantity)], created_by=user_id_from_token(user),
                note=doc["batch_no"], occurred_at=entry_ts)
    await broadcast("stock")
    return {"success": True, "receipt": {**dict(doc), "material_name": material["name"]}, "stock_receipt": receipt}


@app.get("/receipts")
async def list_receipts(date_from: str = None, date_to: str = None, user=Depends(get_user)):
    conds, vals = [], []
    if date_from:
        vals.append(parse_date(date_from)); conds.append(f"r.business_date >= ${len(vals)}")
    if date_to:
        vals.append(parse_date(date_to)); conds.append(f"r.business_date <= ${len(vals)}")
    where = f"WHERE {' AND '.join(conds)}" if conds else ""
    async with pool.acquire() as c:
        return rows(await c.fetch(
            f"""SELECT r.*, m.name AS material_name, m.brand, u.name AS created_by_name
                  FROM stock_receipts r JOIN materials m ON m.id = r.material_id
                  LEFT JOIN users u ON u.id = r.created_by
                {where} ORDER BY r.business_date DESC, r.id DESC LIMIT 500""", *vals))


@app.delete("/receipts/{doc_id}")
async def reverse_receipt(doc_id: int, user=Depends(get_user)):
    async with pool.acquire() as c:
        async with c.transaction():
            receipt = await reverse_document(c, doc_type="RECEIPT", doc_id=doc_id, user=user)
    await broadcast("stock")
    return {"success": True, "stock_receipt": receipt}


# ── Transfers between Ground Floor and 1st Floor ──

@app.post("/transfers")
async def create_transfer(request: Request, user=Depends(get_user)):
    body = await request.json()
    quantity = parse_quantity_kg(body)
    src = str(body.get("from_location") or "").upper()
    dst = str(body.get("to_location") or "").upper()
    if src not in MATERIAL_LOCATIONS or dst not in MATERIAL_LOCATIONS or src == dst:
        raise HTTPException(400, "Move material between the Ground Floor and the 1st Floor")
    business_date, shift, entry_ts = parse_business_context(body)
    async with pool.acquire() as c:
        async with c.transaction():
            await guard_closed_day(c, user, business_date)
            material = await resolve_material(c, body)
            doc_no = await next_document_no(c, "TR", "stock_transfers", business_date)
            doc = await c.fetchrow(
                """INSERT INTO stock_transfers (doc_no, material_id, from_location, to_location, quantity_kg, note,
                       business_date, shift, entered_at, created_by)
                   VALUES ($1, $2, $3, $4, $5, $6, $7, $8, COALESCE($9, NOW()), $10) RETURNING *""",
                doc_no, material["id"], src, dst, quantity, str(body.get("note") or "").strip() or None,
                business_date, shift, entry_ts, user_id_from_token(user))
            receipt = await post_ledger(
                c, doc_type="TRANSFER", doc_id=doc["id"], doc_no=doc_no, business_date=business_date, shift=shift,
                lines=[("MATERIAL", material["id"], src, -quantity), ("MATERIAL", material["id"], dst, quantity)],
                created_by=user_id_from_token(user), occurred_at=entry_ts)
    await broadcast("stock")
    return {"success": True, "transfer": {**dict(doc), "material_name": material["name"]}, "stock_receipt": receipt}


@app.get("/transfers")
async def list_transfers(date_from: str = None, date_to: str = None, user=Depends(get_user)):
    conds, vals = [], []
    if date_from:
        vals.append(parse_date(date_from)); conds.append(f"t.business_date >= ${len(vals)}")
    if date_to:
        vals.append(parse_date(date_to)); conds.append(f"t.business_date <= ${len(vals)}")
    where = f"WHERE {' AND '.join(conds)}" if conds else ""
    async with pool.acquire() as c:
        return rows(await c.fetch(
            f"""SELECT t.*, m.name AS material_name, u.name AS created_by_name
                  FROM stock_transfers t JOIN materials m ON m.id = t.material_id
                  LEFT JOIN users u ON u.id = t.created_by
                {where} ORDER BY t.business_date DESC, t.id DESC LIMIT 500""", *vals))


@app.delete("/transfers/{doc_id}")
async def reverse_transfer(doc_id: int, user=Depends(get_user)):
    async with pool.acquire() as c:
        async with c.transaction():
            receipt = await reverse_document(c, doc_type="TRANSFER", doc_id=doc_id, user=user)
    await broadcast("stock")
    return {"success": True, "stock_receipt": receipt}


# ── Production: extrusion (resin → rolls) and cutting (rolls → finished goods) ──

def parse_output(body: dict) -> tuple[Decimal, Decimal, bool]:
    gross = parse_kg(body.get("gross_kg", body.get("gross_weight")), "Gross weight")
    wastage = parse_kg(body.get("wastage_kg") or 0, "Wastage", allow_zero=True)
    if wastage >= gross:
        raise HTTPException(400, "Wastage must be less than the gross weight")
    to_regrind = body.get("wastage_to_regrind", True) not in (False, "false", 0, "0")
    return gross, wastage, to_regrind


async def wastage_lines(c, wastage: Decimal, to_regrind: bool) -> list:
    if wastage > 0 and to_regrind:
        return [("MATERIAL", await regrind_material_id(c), REGRIND_LOCATION, wastage)]
    return []


@app.post("/production/extrusion")
async def create_extrusion(request: Request, user=Depends(get_user)):
    body = await request.json()
    gross, wastage, to_regrind = parse_output(body)
    business_date, shift, entry_ts = parse_business_context(body)
    async with pool.acquire() as c:
        async with c.transaction():
            await guard_closed_day(c, user, business_date)
            machine = await fetch_machine(c, body.get("machine_id"))
            if machine["type"] != "production":
                raise HTTPException(400, f"{machine['name']} is a cutting machine — log it under Cutting")
            roll = await get_or_create_product(c, "ROLL", body.get("output_size") or body.get("size"))
            raw_inputs = body.get("inputs") or []
            if not raw_inputs and (body.get("material_id") or body.get("material_name")):
                raw_inputs = [{"material_id": body.get("material_id"), "material_name": body.get("material_name"),
                               "location": body.get("location") or "AUTO", "quantity_kg": str(gross)}]
            if not raw_inputs:
                raise HTTPException(400, "Add the materials this roll was made from")
            bal = await balances_map(c)
            inputs = []
            for i, line in enumerate(raw_inputs, start=1):
                material = await resolve_material(c, line)
                qty = parse_kg(line.get("quantity_kg"), f"Material line {i} quantity")
                loc = str(line.get("location") or "AUTO").upper()
                if loc == "AUTO":
                    parts = allocate_auto(qty, bal.get(("MATERIAL", material["id"], "FIRST_FLOOR"), 0),
                                          bal.get(("MATERIAL", material["id"], "GROUND_FLOOR"), 0))
                elif loc in MATERIAL_LOCATIONS:
                    parts = [(loc, qty)]
                else:
                    raise HTTPException(400, f"Material line {i}: choose Ground Floor, 1st Floor or Auto")
                for part_loc, part_qty in parts:
                    inputs.append((material, part_loc, part_qty))
                    key = ("MATERIAL", material["id"], part_loc)
                    bal[key] = bal.get(key, Decimal("0")) - part_qty
            used = sum((q for _, _, q in inputs), Decimal("0"))
            if abs(used - gross) > QTY_EPS:
                raise HTTPException(400, (
                    f"Materials used ({float(used):,.3f} kg) must add up to the gross weight "
                    f"({float(gross):,.3f} kg) — the gross is everything the machine consumed."))
            doc_no = await next_document_no(c, "EX", "production_entries", business_date)
            doc = await c.fetchrow(
                """INSERT INTO production_entries (doc_no, kind, machine_id, output_product_id, gross_kg, wastage_kg,
                       wastage_to_regrind, worker_name, note, business_date, shift, entered_at, created_by)
                   VALUES ($1, 'EXTRUSION', $2, $3, $4, $5, $6, $7, $8, $9, $10, COALESCE($11, NOW()), $12)
                   RETURNING *""",
                doc_no, machine["id"], roll["id"], gross, wastage, to_regrind,
                str(body.get("worker_name") or "").strip() or None, str(body.get("note") or "").strip() or None,
                business_date, shift, entry_ts, user_id_from_token(user))
            for material, loc, qty in inputs:
                await c.execute(
                    "INSERT INTO production_inputs (entry_id, material_id, location, quantity_kg) VALUES ($1, $2, $3, $4)",
                    doc["id"], material["id"], loc, qty)
            lines = [("MATERIAL", m["id"], loc, -qty) for m, loc, qty in inputs]
            lines.append(("PRODUCT", roll["id"], ROLL_STORE, gross - wastage))
            lines += await wastage_lines(c, wastage, to_regrind)
            receipt = await post_ledger(
                c, doc_type="EXTRUSION", doc_id=doc["id"], doc_no=doc_no, business_date=business_date, shift=shift,
                lines=lines, created_by=user_id_from_token(user), note=f"{machine['name']} · {roll['code']}",
                occurred_at=entry_ts)
    await broadcast("production")
    await broadcast("stock")
    return {"success": True, "entry": {**dict(doc), "machine_name": machine["name"], "output_code": roll["code"]},
            "stock_receipt": receipt}


@app.post("/production/cutting")
async def create_cutting(request: Request, user=Depends(get_user)):
    body = await request.json()
    gross, wastage, to_regrind = parse_output(body)
    business_date, shift, entry_ts = parse_business_context(body)
    async with pool.acquire() as c:
        async with c.transaction():
            await guard_closed_day(c, user, business_date)
            machine = await fetch_machine(c, body.get("machine_id"))
            if machine["type"] != "cutting":
                raise HTTPException(400, f"{machine['name']} is an extruder — log it under Plant Production")
            if body.get("input_product_id") not in (None, ""):
                roll = await product_by_id(c, body["input_product_id"], "ROLL")
            else:
                roll = await get_or_create_product(c, "ROLL", body.get("input_size"), create=False)
            finished = await get_or_create_product(c, "FINISHED", body.get("output_size") or body.get("size"))
            doc_no = await next_document_no(c, "CT", "production_entries", business_date)
            doc = await c.fetchrow(
                """INSERT INTO production_entries (doc_no, kind, machine_id, input_product_id, output_product_id,
                       gross_kg, wastage_kg, wastage_to_regrind, worker_name, note, business_date, shift,
                       entered_at, created_by)
                   VALUES ($1, 'CUTTING', $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, COALESCE($12, NOW()), $13)
                   RETURNING *""",
                doc_no, machine["id"], roll["id"], finished["id"], gross, wastage, to_regrind,
                str(body.get("worker_name") or "").strip() or None, str(body.get("note") or "").strip() or None,
                business_date, shift, entry_ts, user_id_from_token(user))
            lines = [("PRODUCT", roll["id"], ROLL_STORE, -gross),
                     ("PRODUCT", finished["id"], FINISHED_STORE, gross - wastage)]
            lines += await wastage_lines(c, wastage, to_regrind)
            receipt = await post_ledger(
                c, doc_type="CUTTING", doc_id=doc["id"], doc_no=doc_no, business_date=business_date, shift=shift,
                lines=lines, created_by=user_id_from_token(user),
                note=f"{machine['name']} · {roll['code']} → {finished['code']}", occurred_at=entry_ts)
    await broadcast("production")
    await broadcast("stock")
    return {"success": True, "entry": {**dict(doc), "machine_name": machine["name"], "input_code": roll["code"],
                                       "output_code": finished["code"]}, "stock_receipt": receipt}


async def fetch_production_entries(c, *, date_from=None, date_to=None, kind=None, shift=None,
                                   include_reversed=True, machine_id=None) -> list[dict]:
    conds, vals = [], []
    if date_from:
        vals.append(parse_date(date_from)); conds.append(f"pe.business_date >= ${len(vals)}")
    if date_to:
        vals.append(parse_date(date_to)); conds.append(f"pe.business_date <= ${len(vals)}")
    if kind:
        vals.append(str(kind).upper()); conds.append(f"pe.kind = ${len(vals)}")
    if shift:
        vals.append(normalize_shift(shift)); conds.append(f"pe.shift = ${len(vals)}")
    if machine_id:
        vals.append(parse_machine_id(machine_id)); conds.append(f"pe.machine_id = ${len(vals)}")
    if not include_reversed:
        conds.append("pe.status = 'ACTIVE'")
    where = f"WHERE {' AND '.join(conds)}" if conds else ""
    entries = rows(await c.fetch(
        f"""SELECT pe.*, m.name AS machine_name, op.code AS output_code, ip.code AS input_code,
                   u.name AS created_by_name
              FROM production_entries pe
              JOIN machines m ON m.id = pe.machine_id
              JOIN products op ON op.id = pe.output_product_id
              LEFT JOIN products ip ON ip.id = pe.input_product_id
              LEFT JOIN users u ON u.id = pe.created_by
            {where} ORDER BY pe.business_date DESC, pe.shift DESC, pe.entered_at DESC, pe.id DESC LIMIT 2000""",
        *vals))
    if entries:
        inputs = rows(await c.fetch(
            """SELECT pi.entry_id, pi.material_id, m.name AS material_name, pi.location, pi.quantity_kg
                 FROM production_inputs pi JOIN materials m ON m.id = pi.material_id
                WHERE pi.entry_id = ANY($1::int[]) ORDER BY pi.id""", [e["id"] for e in entries]))
        for e in entries:
            e["inputs"] = [i for i in inputs if i["entry_id"] == e["id"]]
    return entries


@app.get("/production/entries")
async def list_production_entries(kind: str = None, date_from: str = None, date_to: str = None,
                                  shift: str = None, machine_id: str = None, user=Depends(get_user)):
    async with pool.acquire() as c:
        return await fetch_production_entries(c, date_from=date_from, date_to=date_to, kind=kind,
                                              shift=shift, machine_id=machine_id)


@app.delete("/production/entries/{entry_id}")
async def reverse_production_entry(entry_id: int, user=Depends(get_user)):
    async with pool.acquire() as c:
        async with c.transaction():
            kind = await c.fetchval("SELECT kind FROM production_entries WHERE id = $1", entry_id)
            if not kind:
                raise HTTPException(404, "Entry not found")
            receipt = await reverse_document(c, doc_type=kind, doc_id=entry_id, user=user)
    await broadcast("production")
    await broadcast("stock")
    return {"success": True, "stock_receipt": receipt}


# ── Adjustments: physical count, correction, return to supplier, damage ──

@app.post("/adjustments")
async def create_adjustment(request: Request, user=Depends(get_user)):
    require_owner_or_admin(user)
    body = await request.json()
    reason_type = str(body.get("reason_type") or "COUNT").upper()
    if reason_type not in ("COUNT", "CORRECTION", "RETURN", "DAMAGE"):
        raise HTTPException(400, "Reason must be COUNT, CORRECTION, RETURN or DAMAGE")
    reason = str(body.get("reason") or "").strip()
    if not reason:
        raise HTTPException(400, "Write why the stock is being adjusted")
    business_date, shift, entry_ts = parse_business_context(body)
    async with pool.acquire() as c:
        async with c.transaction():
            item_kind = str(body.get("item_kind") or "MATERIAL").upper()
            if item_kind == "MATERIAL":
                item = await resolve_material(c, body)
                location = str(body.get("location") or "").upper()
                if location not in MATERIAL_LOCATIONS:
                    raise HTTPException(400, "Choose the floor being adjusted")
            elif item_kind == "PRODUCT":
                item = await product_by_id(c, body.get("product_id"))
                location = PRODUCT_STORE[item["kind"]]
            else:
                raise HTTPException(400, "item_kind must be MATERIAL or PRODUCT")
            current = decimal_kg(await c.fetchval(
                "SELECT qty_kg FROM stock_balances WHERE item_kind = $1 AND item_id = $2 AND location = $3",
                item_kind, item["id"], location))
            counted = None
            if reason_type == "COUNT":
                counted = parse_kg(body.get("counted_kg"), "Counted quantity", allow_zero=True)
                delta = counted - current
            else:
                delta = parse_kg(body.get("quantity_kg"), "Quantity")
                if reason_type in ("RETURN", "DAMAGE") or str(body.get("direction") or "").lower() == "remove":
                    delta = -delta
            if delta == 0:
                raise HTTPException(400, "The count matches the system stock — nothing to adjust")
            doc_no = await next_document_no(c, "AD", "stock_adjustments", business_date)
            doc = await c.fetchrow(
                """INSERT INTO stock_adjustments (doc_no, item_kind, item_id, location, reason_type, counted_kg,
                       delta_kg, reason, business_date, shift, entered_at, created_by)
                   VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, COALESCE($11, NOW()), $12) RETURNING *""",
                doc_no, item_kind, item["id"], location, reason_type, counted, delta, reason,
                business_date, shift, entry_ts, user_id_from_token(user))
            receipt = await post_ledger(
                c, doc_type="ADJUSTMENT", doc_id=doc["id"], doc_no=doc_no, business_date=business_date,
                shift=shift, lines=[(item_kind, item["id"], location, delta)], created_by=user_id_from_token(user),
                note=f"{reason_type}: {reason}", occurred_at=entry_ts)
    await broadcast("stock")
    return {"success": True, "adjustment": dict(doc), "stock_receipt": receipt}


@app.get("/adjustments")
async def list_adjustments(user=Depends(get_user)):
    async with pool.acquire() as c:
        result = rows(await c.fetch(
            """SELECT a.*, u.name AS created_by_name,
                      CASE WHEN a.item_kind = 'MATERIAL' THEN m.name ELSE p.code END AS item_name
                 FROM stock_adjustments a
                 LEFT JOIN materials m ON a.item_kind = 'MATERIAL' AND m.id = a.item_id
                 LEFT JOIN products p ON a.item_kind = 'PRODUCT' AND p.id = a.item_id
                 LEFT JOIN users u ON u.id = a.created_by
                ORDER BY a.business_date DESC, a.id DESC LIMIT 500"""))
    return result


@app.delete("/adjustments/{doc_id}")
async def reverse_adjustment(doc_id: int, user=Depends(get_user)):
    require_owner_or_admin(user)
    async with pool.acquire() as c:
        async with c.transaction():
            receipt = await reverse_document(c, doc_type="ADJUSTMENT", doc_id=doc_id, user=user)
    await broadcast("stock")
    return {"success": True, "stock_receipt": receipt}


# ── Stock views ──

@app.get("/stock/overview")
async def stock_overview(user=Depends(get_user)):
    async with pool.acquire() as c:
        low, high = await get_thresholds(c)
        materials = await material_rows(c)
        products = await product_rows(c)
    gf = sum(m["ground_floor_kg"] for m in materials)
    ff = sum(m["first_floor_kg"] for m in materials)
    rolls = [p for p in products if p["kind"] == "ROLL"]
    finished = [p for p in products if p["kind"] == "FINISHED"]
    live_date, live_shift = derive_business_context()
    return {
        "live_business_date": live_date.isoformat(), "live_shift": live_shift,
        "thresholds": {"reorder_below_kg": kg_out(low), "optimal_above_kg": kg_out(high)},
        "materials": materials, "rolls": rolls, "finished": finished,
        "totals": {
            "ground_floor_kg": kg_out(gf), "ground_floor_status": stock_status(gf, low, high),
            "first_floor_kg": kg_out(ff), "first_floor_status": stock_status(ff, low, high),
            "raw_total_kg": kg_out(gf + ff), "raw_total_status": stock_status(gf + ff, low, high),
            "roll_store_kg": kg_out(sum(p["quantity_kg"] for p in rolls)),
            "finished_store_kg": kg_out(sum(p["quantity_kg"] for p in finished)),
        },
    }


@app.get("/stock/ledger")
async def stock_ledger(date_from: str = None, date_to: str = None, location: str = None, doc_type: str = None,
                       item_kind: str = None, item_id: str = None, limit: str = "500", user=Depends(get_user)):
    conds, vals = [], []
    if date_from:
        vals.append(parse_date(date_from)); conds.append(f"l.business_date >= ${len(vals)}")
    if date_to:
        vals.append(parse_date(date_to)); conds.append(f"l.business_date <= ${len(vals)}")
    if location:
        vals.append(location.upper()); conds.append(f"l.location = ${len(vals)}")
    if doc_type:
        vals.append(doc_type.upper()); conds.append(f"l.doc_type = ${len(vals)}")
    if item_kind:
        vals.append(item_kind.upper()); conds.append(f"l.item_kind = ${len(vals)}")
    if item_id:
        vals.append(int(to_num(item_id))); conds.append(f"l.item_id = ${len(vals)}")
    vals.append(min(max(int(to_num(limit, 500)), 1), 2000))
    where = f"WHERE {' AND '.join(conds)}" if conds else ""
    async with pool.acquire() as c:
        return rows(await c.fetch(
            f"""SELECT l.*, u.name AS created_by_name,
                       CASE WHEN l.item_kind = 'MATERIAL' THEN m.name ELSE p.code END AS item_name,
                       p.kind AS product_kind
                  FROM stock_ledger l
                  LEFT JOIN materials m ON l.item_kind = 'MATERIAL' AND m.id = l.item_id
                  LEFT JOIN products p ON l.item_kind = 'PRODUCT' AND p.id = l.item_id
                  LEFT JOIN users u ON u.id = l.created_by
                {where} ORDER BY l.occurred_at DESC, l.id DESC LIMIT ${len(vals)}""", *vals))


@app.get("/stock/verify")
async def verify_stock(user=Depends(get_user)):
    """Every balance must equal the sum of its ledger rows."""
    require_owner_or_admin(user)
    async with pool.acquire() as c:
        drift = rows(await c.fetch(
            """SELECT COALESCE(b.item_kind, l.item_kind) AS item_kind, COALESCE(b.item_id, l.item_id) AS item_id,
                      COALESCE(b.location, l.location) AS location,
                      COALESCE(b.qty_kg, 0) AS balance_kg, COALESCE(l.total, 0) AS ledger_kg
                 FROM stock_balances b
                 FULL JOIN (SELECT item_kind, item_id, location, SUM(delta_kg) AS total
                              FROM stock_ledger GROUP BY 1, 2, 3) l
                   ON l.item_kind = b.item_kind AND l.item_id = b.item_id AND l.location = b.location
                WHERE COALESCE(b.qty_kg, 0) <> COALESCE(l.total, 0)"""))
    return {"ok": not drift, "drift": drift}


# ── Reports ──

async def register_data(c, day: dt_date) -> dict:
    """Inventory register for one business day: every store, opening → closing."""
    low, high = await get_thresholds(c)
    agg = rows(await c.fetch(
        """SELECT item_kind, item_id, location,
                  SUM(delta_kg) FILTER (WHERE business_date < $1) AS before_kg,
                  SUM(delta_kg) FILTER (WHERE business_date = $1) AS day_delta_kg
             FROM stock_ledger WHERE business_date <= $1
            GROUP BY item_kind, item_id, location, doc_type, doc_id""", day))
    materials = {m["id"]: dict(m) for m in await c.fetch("SELECT * FROM materials")}
    products = {p["id"]: dict(p) for p in await c.fetch("SELECT * FROM products")}
    batches = {(r_["material_id"], r_["location"]): r_["batch_no"] for r_ in await c.fetch(
        """SELECT DISTINCT ON (material_id, location) material_id, location, batch_no
             FROM stock_receipts WHERE status = 'ACTIVE' AND batch_no IS NOT NULL AND business_date <= $1
            ORDER BY material_id, location, business_date DESC, id DESC""", day)}
    thresholds = {("MATERIAL", mid): (m["reorder_below_kg"] if m["reorder_below_kg"] is not None else low,
                                      m["optimal_above_kg"] if m["optimal_above_kg"] is not None else high)
                  for mid, m in materials.items()}
    lines = day_register(agg, thresholds=thresholds)

    def zone(location):
        items = []
        for ln in lines:
            if ln["location"] != location:
                continue
            if not any((ln["opening_kg"], ln["received_kg"], ln["issued_kg"], ln["closing_kg"])):
                continue
            if ln["item_kind"] == "MATERIAL":
                m = materials.get(ln["item_id"], {})
                name, brand = m.get("name"), m.get("brand")
                batch = batches.get((ln["item_id"], location))
            else:
                p = products.get(ln["item_id"], {})
                name, brand, batch = p.get("code"), p.get("description") or "", None
            items.append({**ln, "item_name": name, "brand": brand, "batch_no": batch,
                          "opening_bags": ln["opening_kg"] / BAG_KG, "received_bags": ln["received_kg"] / BAG_KG,
                          "issued_bags": ln["issued_kg"] / BAG_KG, "closing_bags": ln["closing_kg"] / BAG_KG,
                          "status_label": STATUS_LABELS.get(ln["status"]) if ln["status"] else None})
        items.sort(key=lambda i: (str(i["item_name"] or "").lower()))
        sub = {k: sum((i[k] for i in items), Decimal("0"))
               for k in ("opening_kg", "received_kg", "issued_kg", "closing_kg")}
        sub.update({k.replace("_kg", "_bags"): v / BAG_KG for k, v in list(sub.items())})
        is_raw = location in MATERIAL_LOCATIONS
        sub["status"] = stock_status(sub["closing_kg"], low, high) if is_raw else None
        sub["status_label"] = STATUS_LABELS.get(sub["status"]) if sub["status"] else None
        return {"location": location, "label": LOCATION_LABELS[location], "rows": items, "subtotal": sub}

    zones = [zone(loc) for loc in ALL_LOCATIONS]
    raw = [z for z in zones if z["location"] in MATERIAL_LOCATIONS]
    plant = {k: sum((z["subtotal"][k] for z in raw), Decimal("0"))
             for k in ("opening_kg", "received_kg", "issued_kg", "closing_kg",
                       "opening_bags", "received_bags", "issued_bags", "closing_bags")}
    plant["status"] = stock_status(plant["closing_kg"], low, high)
    plant["status_label"] = STATUS_LABELS[plant["status"]]
    return floatify({
        "business_date": day.isoformat(),
        "thresholds": {"reorder_below_kg": low, "optimal_above_kg": high},
        "zones": zones, "plant_raw_total": plant,
    })


@app.get("/reports/inventory-register")
async def inventory_register(date: str = None, user=Depends(get_user)):
    day = parse_optional_date(date) or derive_business_context()[0]
    async with pool.acquire() as c:
        return await register_data(c, day)


async def shift_report_data(c, day: dt_date) -> dict:
    entries = await fetch_production_entries(c, date_from=day, date_to=day, include_reversed=False)
    entries.sort(key=lambda e: (e["machine_name"], e["entered_at"], e["id"]))
    return floatify({"business_date": day.isoformat(), **shift_report(entries)})


@app.get("/reports/shift-production")
async def shift_production_report(date: str = None, user=Depends(get_user)):
    day = parse_optional_date(date) or derive_business_context()[0]
    async with pool.acquire() as c:
        return await shift_report_data(c, day)


async def summary_data(c, start: dt_date, end: dt_date) -> dict:
    entries = await fetch_production_entries(c, date_from=start, date_to=end, include_reversed=False)
    days = []
    cursor = start
    while cursor <= end:
        day_entries = [e for e in entries if e["business_date"] == cursor]
        rep = shift_report(day_entries)
        days.append({"business_date": cursor.isoformat(),
                     "plant_am": {k: v for k, v in rep["AM"]["plant"].items() if k != "entries"},
                     "plant_pm": {k: v for k, v in rep["PM"]["plant"].items() if k != "entries"},
                     "cutting_am": {k: v for k, v in rep["AM"]["cutting"].items() if k != "entries"},
                     "cutting_pm": {k: v for k, v in rep["PM"]["cutting"].items() if k != "entries"},
                     "plant": rep["day_and_night"]["plant"], "cutting": rep["day_and_night"]["cutting"]})
        cursor += timedelta(days=1)
    machines = {}
    for e in entries:
        slot = machines.setdefault(e["machine_id"], {"machine_id": e["machine_id"], "machine_name": e["machine_name"],
                                                     "kind": e["kind"], "entries": []})
        slot["entries"].append(e)
    machine_rows = []
    for slot in machines.values():
        t = shift_report(slot.pop("entries"))
        section = "plant" if slot["kind"] == "EXTRUSION" else "cutting"
        machine_rows.append({**slot, **t["day_and_night"][section]})
    machine_rows.sort(key=lambda m: (m["kind"], m["machine_name"]))
    usage = rows(await c.fetch(
        """SELECT m.id AS material_id, m.name AS material_name, m.brand, SUM(pi.quantity_kg) AS used_kg
             FROM production_inputs pi JOIN production_entries pe ON pe.id = pi.entry_id
             JOIN materials m ON m.id = pi.material_id
            WHERE pe.status = 'ACTIVE' AND pe.business_date BETWEEN $1 AND $2
            GROUP BY 1, 2, 3 ORDER BY 4 DESC""", start, end))
    sizes = rows(await c.fetch(
        """SELECT pe.kind, p.code, COUNT(*) AS entries, SUM(pe.gross_kg) AS gross_kg,
                  SUM(pe.wastage_kg) AS wastage_kg, SUM(pe.net_kg) AS net_kg
             FROM production_entries pe JOIN products p ON p.id = pe.output_product_id
            WHERE pe.status = 'ACTIVE' AND pe.business_date BETWEEN $1 AND $2
            GROUP BY 1, 2 ORDER BY 1, 6 DESC""", start, end))
    totals = shift_report(entries)["day_and_night"]
    return floatify({"date_from": start.isoformat(), "date_to": end.isoformat(), "days": days,
                     "machines": machine_rows, "material_usage": usage, "sizes": sizes, "totals": totals})


def report_range(date_from, date_to, default_days=14, max_days=93) -> tuple[dt_date, dt_date]:
    end = parse_optional_date(date_to) or derive_business_context()[0]
    start = parse_optional_date(date_from) or end - timedelta(days=default_days - 1)
    if start > end:
        raise HTTPException(400, "date_from must be on or before date_to")
    if (end - start).days + 1 > max_days:
        raise HTTPException(400, f"Choose at most {max_days} days")
    return start, end


@app.get("/reports/production-summary")
async def production_summary(date_from: str = None, date_to: str = None, user=Depends(get_user)):
    start, end = report_range(date_from, date_to)
    async with pool.acquire() as c:
        return await summary_data(c, start, end)


def xlsx_response(content: bytes, filename: str) -> Response:
    return Response(content=content,
                    media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
                    headers={"Content-Disposition": f'attachment; filename="{filename}"', "Cache-Control": "no-store"})


@app.get("/reports/inventory-register.xlsx")
async def inventory_register_xlsx(date: str = None, user=Depends(get_user)):
    from reports_xlsx import inventory_register_workbook
    day = parse_optional_date(date) or derive_business_context()[0]
    async with pool.acquire() as c:
        data = await register_data(c, day)
    return xlsx_response(inventory_register_workbook(data), f"Inventory_Register_{day:%d-%m-%Y}.xlsx")


@app.get("/reports/shift-production.xlsx")
async def shift_production_xlsx(date: str = None, user=Depends(get_user)):
    from reports_xlsx import shift_report_workbook
    day = parse_optional_date(date) or derive_business_context()[0]
    async with pool.acquire() as c:
        data = await shift_report_data(c, day)
    return xlsx_response(shift_report_workbook(data), f"Shift_Production_Report_{day:%d-%m-%Y}.xlsx")


@app.get("/reports/production-summary.xlsx")
async def production_summary_xlsx(date_from: str = None, date_to: str = None, user=Depends(get_user)):
    from reports_xlsx import summary_workbook
    start, end = report_range(date_from, date_to)
    async with pool.acquire() as c:
        data = await summary_data(c, start, end)
    return xlsx_response(summary_workbook(data), f"Production_Summary_{start:%d-%m-%Y}_to_{end:%d-%m-%Y}.xlsx")


@app.get("/dashboard")
async def dashboard(user=Depends(get_user)):
    live_date, live_shift = derive_business_context()
    async with pool.acquire() as c:
        low, high = await get_thresholds(c)
        materials = await material_rows(c)
        products = await product_rows(c)
        today = await shift_report_data(c, live_date)
        summary = await summary_data(c, live_date - timedelta(days=13), live_date)
    gf = sum(m["ground_floor_kg"] for m in materials)
    ff = sum(m["first_floor_kg"] for m in materials)
    return {
        "live_business_date": live_date.isoformat(), "live_shift": live_shift,
        "thresholds": {"reorder_below_kg": kg_out(low), "optimal_above_kg": kg_out(high)},
        "stock": {
            "ground_floor_kg": kg_out(gf), "ground_floor_status": stock_status(gf, low, high),
            "first_floor_kg": kg_out(ff), "first_floor_status": stock_status(ff, low, high),
            "raw_total_kg": kg_out(gf + ff), "raw_total_status": stock_status(gf + ff, low, high),
            "roll_store_kg": kg_out(sum(p["quantity_kg"] for p in products if p["kind"] == "ROLL")),
            "finished_store_kg": kg_out(sum(p["quantity_kg"] for p in products if p["kind"] == "FINISHED")),
        },
        "reorder": [m for m in materials if m["active"] and m["status"] == "REORDER" and m["name"] != REGRIND_MATERIAL],
        "today": {"AM": {s: {k: v for k, v in today["AM"][s].items() if k != "entries"} for s in ("plant", "cutting")},
                  "PM": {s: {k: v for k, v in today["PM"][s].items() if k != "entries"} for s in ("plant", "cutting")},
                  "day_and_night": today["day_and_night"]},
        "trend": summary["days"],
        "totals_14d": summary["totals"],
    }


# ── Day close ──

@app.post("/stock/day-close")
async def close_day(request: Request, user=Depends(get_user)):
    require_owner_or_admin(user)
    body = await request.json()
    day = parse_required_date(body.get("business_date"), "business_date")
    if day > derive_business_context()[0]:
        raise HTTPException(400, "A future day cannot be closed")
    note = str(body.get("note") or "").strip() or None
    async with pool.acquire() as c:
        async with c.transaction():
            await c.execute("SELECT pg_advisory_xact_lock(hashtext('vp-day-close'))")
            register = await register_data(c, day)
            await c.execute(
                """INSERT INTO stock_day_closings (business_date, snapshot, note, closed_by, closed_at)
                   VALUES ($1, $2::jsonb, $3, $4, NOW())
                   ON CONFLICT (business_date) DO UPDATE SET snapshot = EXCLUDED.snapshot, note = EXCLUDED.note,
                       closed_by = EXCLUDED.closed_by, closed_at = NOW()""",
                day, orjson.dumps(register, default=_orjson_default).decode(), note, user_id_from_token(user))
    await broadcast("stock")
    return {"success": True, "business_date": day.isoformat()}


@app.get("/stock/day-closings")
async def list_day_closings(user=Depends(get_user)):
    async with pool.acquire() as c:
        return rows(await c.fetch(
            """SELECT d.business_date, d.closed_at, d.note, u.name AS closed_by_name,
                      (d.snapshot->'plant_raw_total'->>'closing_kg')::float AS raw_closing_kg
                 FROM stock_day_closings d LEFT JOIN users u ON u.id = d.closed_by
                ORDER BY d.business_date DESC LIMIT 120"""))


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


# ── Orders and dispatch ──
#
# Each order item points at a stock item (a finished size, or a roll size when
# rolls are sold as they are). Supplying against an order is a dispatch: it takes
# the goods out of the Finished Goods Store / Roll Store through the ledger.

def normalize_order_status(s: str) -> str:
    v = str(s or "").strip().lower()
    if v in ("active", "completed", "cancelled"):
        return "completed" if v == "completed" else "cancelled" if v == "cancelled" else "Active"
    return v


async def resolve_order_product(c, item: dict) -> dict:
    if item.get("product_id") not in (None, ""):
        return await product_by_id(c, item["product_id"])
    code = normalize_product_code(item.get("item_name"))
    for kind in ("FINISHED", "ROLL"):
        r_ = await c.fetchrow("SELECT * FROM products WHERE kind = $1 AND code = $2", kind, code)
        if r_:
            return dict(r_)
    return await get_or_create_product(c, "FINISHED", code)


async def fetch_order_items(conn, order_id: int) -> list:
    rs = await conn.fetch(
        """SELECT oi.id, oi.order_id, oi.item_name, oi.product_id, p.kind AS product_kind, p.code AS product_code,
               oi.required_quantity::float AS required_quantity,
               COALESCE(oi.unit_price, 0)::float AS unit_price,
               (oi.required_quantity * COALESCE(oi.unit_price, 0))::float AS total_amount,
               COALESCE(SUM(fr.supplied_quantity), 0)::float AS fulfilled_quantity,
               GREATEST(oi.required_quantity - COALESCE(SUM(fr.supplied_quantity), 0), 0)::float AS remaining_quantity,
               COALESCE(sb.qty_kg, 0)::float AS in_stock_kg,
               oi.created_at
           FROM order_items oi
           LEFT JOIN products p ON p.id = oi.product_id
           LEFT JOIN stock_balances sb ON sb.item_kind = 'PRODUCT' AND sb.item_id = oi.product_id
           LEFT JOIN fulfillment_records fr ON fr.order_item_id = oi.id
           WHERE oi.order_id = $1
           GROUP BY oi.id, p.kind, p.code, sb.qty_kg
           ORDER BY oi.created_at ASC, oi.id ASC""",
        order_id)
    return rows(rs)


async def hydrate_orders(conn, orders: list) -> list:
    return [{**o, "items": await fetch_order_items(conn, o["id"])} for o in orders]


async def sync_order_status(conn, order_id: int):
    o = await conn.fetchrow("SELECT status FROM orders WHERE id = $1 FOR UPDATE", order_id)
    if not o or o["status"] == "cancelled":
        return o["status"] if o else None
    summary = await conn.fetchrow(
        """SELECT COUNT(*)::int AS total_items,
               COUNT(*) FILTER (WHERE COALESCE(fr.fulfilled_quantity, 0) >= oi.required_quantity)::int AS completed_items
           FROM order_items oi
           LEFT JOIN (SELECT order_item_id, SUM(supplied_quantity) AS fulfilled_quantity
                      FROM fulfillment_records GROUP BY order_item_id) fr ON fr.order_item_id = oi.id
           WHERE oi.order_id = $1""",
        order_id)
    total = summary["total_items"] if summary else 0
    completed = summary["completed_items"] if summary else 0
    next_status = "completed" if total > 0 and total == completed else "Active"
    await conn.execute("UPDATE orders SET status = $1, updated_at = NOW() WHERE id = $2", next_status, order_id)
    return next_status


@app.post("/orders")
async def create_order(request: Request, user=Depends(get_user)):
    require_owner_or_admin(user)
    body = await request.json()
    order_number = str(body.get("order_number") or "").strip()
    client_name = str(body.get("client_name") or "").strip()
    if not order_number:
        raise HTTPException(400, "order_number is required")
    if not client_name:
        raise HTTPException(400, "client_name is required")
    order_date = parse_optional_date(body.get("order_date"))
    normalized_status = normalize_order_status(body.get("status", "Active"))
    items = [i for i in (body.get("items") or [])
             if (str(i.get("item_name") or "").strip() or i.get("product_id")) and to_num(i.get("required_quantity")) > 0]
    async with pool.acquire() as c:
        try:
            async with c.transaction():
                order = dict(await c.fetchrow(
                    "INSERT INTO orders (order_number, client_name, status, order_date) VALUES ($1, $2, $3, $4) RETURNING *",
                    order_number, client_name, normalized_status, order_date))
                for item in items:
                    product = await resolve_order_product(c, item)
                    await c.execute(
                        """INSERT INTO order_items (order_id, item_name, product_id, required_quantity, unit_price)
                           VALUES ($1, $2, $3, $4, $5)""",
                        order["id"], str(item.get("item_name") or product["code"]).strip(), product["id"],
                        to_num(item.get("required_quantity")), to_num(item.get("unit_price")))
                hydrated = await hydrate_orders(c, [order])
        except asyncpg.UniqueViolationError:
            raise HTTPException(400, "Order number already exists")
    await broadcast("orders")
    return hydrated[0]


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
        return (await hydrate_orders(c, [dict(r_)]))[0]


@app.delete("/orders/{order_id}")
async def delete_order(order_id: int, user=Depends(get_user)):
    """Deleting an order returns everything dispatched against it to stock first."""
    require_owner_or_admin(user)
    async with pool.acquire() as c:
        async with c.transaction():
            dispatched = await c.fetch("SELECT id FROM fulfillment_records WHERE order_id = $1 ORDER BY id", order_id)
            for d in dispatched:
                await reverse_document(c, doc_type="DISPATCH", doc_id=d["id"], user=user)
            r_ = await c.fetchrow("DELETE FROM orders WHERE id = $1 RETURNING *", order_id)
            if not r_:
                raise HTTPException(404, "Order not found")
    await broadcast("orders")
    await broadcast("stock")
    return {"message": "Order deleted", "deleted": dict(r_), "returned_dispatches": len(dispatched)}


@app.put("/orders/{order_id}/status")
async def update_order_status(order_id: int, request: Request, user=Depends(get_user)):
    require_owner_or_admin(user)
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


@app.post("/fulfillment")
async def create_fulfillment(request: Request, user=Depends(get_user)):
    body = await request.json()
    order_number = str(body.get("order_number") or "").strip()
    item_id = body.get("item_id")
    item_index = body.get("item_index")
    if not order_number:
        raise HTTPException(400, "order_number is required")
    quantity = parse_kg(body.get("supplied_quantity"), "supplied_quantity")
    business_date, shift, entry_ts = parse_business_context(body)
    async with pool.acquire() as c:
        async with c.transaction():
            await guard_closed_day(c, user, business_date)
            order = await c.fetchrow("SELECT id, status FROM orders WHERE order_number = $1 FOR UPDATE", order_number)
            if not order:
                raise HTTPException(404, "Order not found")
            if order["status"] == "cancelled":
                raise HTTPException(400, "This order is cancelled")
            target = None
            if item_id is not None:
                target = await c.fetchrow("SELECT * FROM order_items WHERE id = $1 AND order_id = $2 FOR UPDATE",
                                          int(item_id), order["id"])
            elif item_index not in (None, ""):
                target = await c.fetchrow(
                    "SELECT * FROM order_items WHERE order_id = $1 ORDER BY created_at ASC, id ASC OFFSET $2 LIMIT 1 FOR UPDATE",
                    order["id"], int(item_index))
            if not target:
                raise HTTPException(400, "Valid order item is required")
            target = dict(target)
            if not target.get("product_id"):
                product = await resolve_order_product(c, target)
                await c.execute("UPDATE order_items SET product_id = $1 WHERE id = $2", product["id"], target["id"])
                target["product_id"] = product["id"]
            product = await product_by_id(c, target["product_id"])
            fulfilled = decimal_kg(await c.fetchval(
                "SELECT COALESCE(SUM(supplied_quantity), 0) FROM fulfillment_records WHERE order_item_id = $1", target["id"]))
            remaining = decimal_kg(target["required_quantity"]) - fulfilled
            if remaining < quantity:
                raise HTTPException(400, f"Cannot supply more than remaining quantity ({float(max(remaining, 0)):.2f} kg)")
            insert_row = await c.fetchrow(
                """INSERT INTO fulfillment_records (order_id, order_item_id, supplied_quantity, note, created_by,
                       business_date, shift, created_at)
                   VALUES ($1, $2, $3, $4, $5, $6, $7, COALESCE($8, NOW())) RETURNING *""",
                order["id"], target["id"], quantity, body.get("note"), user_id_from_token(user),
                business_date, shift, entry_ts)
            receipt = await post_ledger(
                c, doc_type="DISPATCH", doc_id=insert_row["id"], doc_no=f"DS-{insert_row['id']}",
                business_date=business_date, shift=shift,
                lines=[("PRODUCT", product["id"], PRODUCT_STORE[product["kind"]], -quantity)],
                created_by=user_id_from_token(user), note=f"Order {order_number}", occurred_at=entry_ts)
            await sync_order_status(c, order["id"])
    await broadcast("orders")
    await broadcast("stock")
    return {**dict(insert_row), "order_number": order_number, "item_name": target["item_name"],
            "stock_receipt": receipt}


@app.get("/fulfillment")
async def get_fulfillment(order_number: str = None, limit: str = "500", user=Depends(get_user)):
    async with pool.acquire() as c:
        conds, vals = [], []
        if order_number:
            vals.append(order_number.strip()); conds.append(f"o.order_number = ${len(vals)}")
        vals.append(min(max(int(limit) if limit.isdigit() else 500, 1), 1000))
        where = f"WHERE {' AND '.join(conds)}" if conds else ""
        return rows(await c.fetch(
            f"""SELECT fr.*, o.order_number, oi.item_name FROM fulfillment_records fr
                  JOIN orders o ON o.id = fr.order_id JOIN order_items oi ON oi.id = fr.order_item_id
                {where} ORDER BY fr.created_at DESC LIMIT ${len(vals)}""", *vals))


@app.delete("/fulfillment/{record_id}")
async def delete_fulfillment(record_id: int, user=Depends(get_user)):
    """Undo a dispatch: the goods go back into their store."""
    async with pool.acquire() as c:
        async with c.transaction():
            order_id = await c.fetchval("SELECT order_id FROM fulfillment_records WHERE id = $1", record_id)
            if not order_id:
                raise HTTPException(404, "Dispatch not found")
            receipt = await reverse_document(c, doc_type="DISPATCH", doc_id=record_id, user=user)
            await c.execute("DELETE FROM fulfillment_records WHERE id = $1", record_id)
            await sync_order_status(c, order_id)
    await broadcast("orders")
    await broadcast("stock")
    return {"success": True, "stock_receipt": receipt}


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



# ─────────────────────────── Schema ───────────────────────────

SCHEMA_PATH = Path(__file__).with_name("schema.sql")


async def initialize_tables():
    """Apply schema.sql (idempotent) so a fresh database comes up ready to use."""
    async with pool.acquire() as c:
        await c.execute(SCHEMA_PATH.read_text(encoding="utf-8"))
        logger.info("Database schema ready")


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


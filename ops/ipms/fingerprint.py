"""Prove that a migration/deploy left every pre-existing row untouched.

    python fingerprint.py capture <dbname> <out.json>
    python fingerprint.py verify  <dbname> <in.json>

`capture` records, for every public table, its column list, row count and an
MD5 over all rows (ordered by every column, cast to text). `verify` recomputes
the hash over the *captured* columns only — so additive columns are ignored —
and checks that each captured row still exists unchanged. Tables that the app
legitimately appends to (stock_activity_log, …) are verified as "every old row
still present" rather than "identical row count".

Connection settings come from the standard PGHOST / PGUSER / PGPASSWORD
environment variables; use the application's database owner so every table is
readable.
"""
import asyncio
import json
import sys

import asyncpg


async def table_columns(conn):
    result = await conn.fetch(
        """SELECT c.table_name, c.column_name
             FROM information_schema.columns c
             JOIN information_schema.tables t
               ON t.table_name = c.table_name AND t.table_schema = c.table_schema
            WHERE c.table_schema = 'public' AND t.table_type = 'BASE TABLE'
            ORDER BY c.table_name, c.ordinal_position""")
    tables: dict = {}
    for r in result:
        tables.setdefault(r["table_name"], []).append(r["column_name"])
    return tables


def row_expr(columns):
    parts = ", ".join(f'COALESCE("{c}"::text, \'∅\')' for c in columns)
    return f"md5(concat_ws('|', {parts}))"


async def fingerprint(conn, table, columns):
    expr = row_expr(columns)
    count, digest = await conn.fetchrow(
        f'SELECT COUNT(*), md5(COALESCE(string_agg(h, \',\' ORDER BY h), \'\')) '
        f'FROM (SELECT {expr} AS h FROM "{table}") s')
    return int(count), digest


async def capture(db, out):
    conn = await asyncpg.connect(database=db)
    try:
        tables = await table_columns(conn)
        data = {}
        for table, columns in tables.items():
            count, digest = await fingerprint(conn, table, columns)
            hashes = [r["h"] for r in await conn.fetch(f'SELECT {row_expr(columns)} AS h FROM "{table}"')]
            data[table] = {"columns": columns, "count": count, "md5": digest, "rows": hashes}
    finally:
        await conn.close()
    with open(out, "w") as fh:
        json.dump(data, fh)
    print(f"captured {len(data)} tables")


async def verify(db, src):
    with open(src) as fh:
        before = json.load(fh)
    conn = await asyncpg.connect(database=db)
    failures = []
    try:
        now_tables = await table_columns(conn)
        for table, info in sorted(before.items()):
            if table not in now_tables:
                failures.append(f"{table}: table missing")
                continue
            missing_cols = [c for c in info["columns"] if c not in now_tables[table]]
            if missing_cols:
                failures.append(f"{table}: columns dropped {missing_cols}")
                continue
            current = {r["h"] for r in await conn.fetch(
                f'SELECT {row_expr(info["columns"])} AS h FROM "{table}"')}
            lost = [h for h in info["rows"] if h not in current]
            count, digest = await fingerprint(conn, table, info["columns"])
            status = "identical" if digest == info["md5"] else f"+{count - info['count']} new rows"
            if lost:
                failures.append(f"{table}: {len(lost)} pre-existing row(s) changed or removed")
                status = "CHANGED"
            print(f"{table:32s} {info['count']:>6} → {count:<6} {status}")
    finally:
        await conn.close()
    if failures:
        print("\nFAILED:\n  " + "\n  ".join(failures))
        sys.exit(1)
    print("\nOK: every pre-existing row is unchanged")


if __name__ == "__main__":
    mode, db, path = sys.argv[1:4]
    asyncio.run(capture(db, path) if mode == "capture" else verify(db, path))

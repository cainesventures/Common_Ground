"""One-shot migration: split user tables out of the unified DB into users.db.

Run this before the first time you start the new split-aware code so the
existing user data ends up in users.db rather than getting orphaned in
content.db.  Safe to re-run — it skips when users.db is already populated.

Usage:
    python scripts/split_db.py             # migrate local dev DB
    python scripts/split_db.py --dry-run   # report what would happen
    python scripts/split_db.py --drop-source  # also drop user tables from
                                              # content.db after copying (more
                                              # aggressive — only when verified)

The default keeps user tables in content.db as a backup; queries no longer
route there (binds send them to users.db).
"""

import sys
import os
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import argparse
from sqlalchemy import inspect, text

from app.models.database import content_engine, users_engine
from app.models import UserBase

# Names of tables that belong on the user side.  Keep in sync with the model
# classes that subclass UserBase in app/models/__init__.py.
USER_TABLE_NAMES = [
    "users",
    "bill_tracking",
    "legislation_votes",
    "councilmember_votes",
    "bluesky_posts",
    "donations",
]


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--dry-run", action="store_true",
                        help="Print plan without writing anything")
    parser.add_argument("--drop-source", action="store_true",
                        help="After successful copy, DROP user tables from content.db")
    args = parser.parse_args()

    print(f"Content DB: {content_engine.url}")
    print(f"Users   DB: {users_engine.url}")

    # Ensure users.db has its schema.
    if not args.dry_run:
        UserBase.metadata.create_all(users_engine)
        print("users.db schema ensured (create_all).")

    content_insp = inspect(content_engine)
    users_insp = inspect(users_engine)

    content_tables = set(content_insp.get_table_names())
    users_tables = set(users_insp.get_table_names())

    print(f"\nContent.db tables: {len(content_tables)}")
    print(f"Users.db tables:   {len(users_tables)}")

    # Per-table migration plan.
    plan = []
    for tn in USER_TABLE_NAMES:
        in_content = tn in content_tables
        in_users = tn in users_tables
        plan.append((tn, in_content, in_users))

    print("\nMigration plan:")
    print(f"  {'table':<25} {'src exists':<12} {'dst exists':<12} {'src rows':<10} {'dst rows'}")
    with content_engine.connect() as cc, users_engine.connect() as uc:
        for tn, in_content, in_users in plan:
            src_n = cc.execute(text(f"SELECT COUNT(*) FROM {tn}")).scalar() if in_content else 0
            dst_n = uc.execute(text(f"SELECT COUNT(*) FROM {tn}")).scalar() if in_users else 0
            print(f"  {tn:<25} {str(in_content):<12} {str(in_users):<12} {src_n:<10} {dst_n}")

    if args.dry_run:
        print("\n(dry-run) — no writes performed.")
        return

    # Copy each table that has source data and an empty (or missing) destination.
    total_copied = 0
    for tn, in_content, in_users in plan:
        if not in_content:
            print(f"\n[{tn}] no source table — skipping.")
            continue

        with users_engine.connect() as uc:
            dst_n = uc.execute(text(f"SELECT COUNT(*) FROM {tn}")).scalar()
        if dst_n > 0:
            print(f"\n[{tn}] destination already has {dst_n} rows — skipping copy.")
            continue

        with content_engine.connect() as cc:
            rows = cc.execute(text(f"SELECT * FROM {tn}")).mappings().all()
        if not rows:
            print(f"\n[{tn}] no rows in source — skipping.")
            continue

        users_cols = {c["name"] for c in inspect(users_engine).get_columns(tn)}

        # Project source rows onto destination columns only (drops any legacy
        # columns).  Pass values through as-is — SQLite stores datetimes as
        # strings under the hood and the source rows already round-trip cleanly.
        projected = []
        for r in rows:
            projected.append({k: v for k, v in dict(r).items() if k in users_cols})

        if not projected:
            print(f"\n[{tn}] no projected rows after column filter — skipping.")
            continue

        columns = list(projected[0].keys())
        col_list = ", ".join(columns)
        placeholders = ", ".join(f":{c}" for c in columns)
        stmt = text(f"INSERT INTO {tn} ({col_list}) VALUES ({placeholders})")

        with users_engine.begin() as uc:
            uc.execute(stmt, projected)
        print(f"\n[{tn}] copied {len(projected)} rows.")
        total_copied += len(projected)

    print(f"\nDone.  Total rows copied across {len(USER_TABLE_NAMES)} tables: {total_copied}.")

    if args.drop_source:
        print("\n--drop-source: dropping user tables from content.db...")
        # Disable FK constraints (some indirect refs may exist).  SQLite is lenient.
        with content_engine.begin() as cc:
            cc.execute(text("PRAGMA foreign_keys=OFF"))
            for tn in USER_TABLE_NAMES:
                if tn in content_tables:
                    cc.execute(text(f"DROP TABLE IF EXISTS {tn}"))
                    print(f"  dropped {tn}")
            cc.execute(text("PRAGMA foreign_keys=ON"))
        print("Source tables dropped.  content.db now only holds content data.")
    else:
        print("\nLeft user tables in content.db as a safety backup.")
        print("Re-run with --drop-source after verifying users.db works end-to-end.")


if __name__ == "__main__":
    main()

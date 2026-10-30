"""Delete superseded content-DB snapshots from Backblaze B2.

publish.ps1 runs `litestream replicate -once -force-snapshot`, which uploads a
full ~100 MB snapshot every publish. Litestream only enforces retention while
`replicate` keeps running, and it never does here (see railway.toml for why),
so every snapshot ever taken stayed in the bucket. By Oct 2026 that was 7.6 GB
of the 10 GB free tier.

A restore needs only the newest snapshot in db/0009 (it covers TXID 1..N) plus
any L0 files at or after N. Everything else under db/ is deleted, including
hidden versions. users/ is never touched: it is prod's user-data backup.

Refuses to delete anything unless the newest snapshot was uploaded within the
last --max-age-hours, so a publish whose upload silently produced no snapshot
cannot prune down to a stale one.

    python scripts/prune_b2.py --dry-run
"""
import argparse
import os
import re
import sys
import time
from pathlib import Path

import requests

BUCKET = "opencommonground-db"
PREFIX = "db/"
LTX = re.compile(r"^db/(\d{4})/([0-9a-f]{16})-([0-9a-f]{16})\.ltx$")


def load_keys():
    keys = {k: os.environ.get(k) for k in ("B2_APPLICATION_KEY_ID", "B2_APPLICATION_KEY")}
    if all(keys.values()):
        return keys
    env = Path(__file__).resolve().parent.parent / ".env"
    for line in env.read_text().splitlines():
        m = re.match(r"\s*([A-Z0-9_]+)\s*=\s*(.*)", line)
        if m and m[1] in keys and not keys[m[1]]:
            keys[m[1]] = m[2].strip().strip("\"'")
    return keys


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--dry-run", action="store_true")
    ap.add_argument("--max-age-hours", type=float, default=6)
    args = ap.parse_args()

    keys = load_keys()
    auth = requests.get(
        "https://api.backblazeb2.com/b2api/v3/b2_authorize_account",
        auth=(keys["B2_APPLICATION_KEY_ID"], keys["B2_APPLICATION_KEY"]),
        timeout=30,
    )
    auth.raise_for_status()
    a = auth.json()
    url = a["apiInfo"]["storageApi"]["apiUrl"]
    headers = {"Authorization": a["authorizationToken"]}

    def call(name, body):
        r = requests.post(f"{url}/b2api/v3/{name}", headers=headers, json=body, timeout=60)
        r.raise_for_status()
        return r.json()

    bucket_id = call("b2_list_buckets", {"accountId": a["accountId"], "bucketName": BUCKET})["buckets"][0]["bucketId"]

    files, start = [], {}
    while True:
        r = call("b2_list_file_versions", {"bucketId": bucket_id, "prefix": PREFIX, "maxFileCount": 1000, **start})
        files += r["files"]
        if not r.get("nextFileName"):
            break
        start = {"startFileName": r["nextFileName"], "startFileId": r["nextFileId"]}

    snapshots = []
    for f in files:
        m = LTX.match(f["fileName"])
        if m and m[1] == "0009" and f["action"] == "upload":
            snapshots.append((int(m[3], 16), f["uploadTimestamp"], f))
    if not snapshots:
        print("No snapshot found in db/0009; nothing pruned.")
        return 1
    max_txid, _, newest = max(snapshots, key=lambda s: (s[0], s[1]))
    age_h = (time.time() * 1000 - newest["uploadTimestamp"]) / 3.6e6
    if age_h > args.max_age_hours:
        print(f"Newest snapshot {newest['fileName']} is {age_h:.1f}h old; refusing to prune.")
        return 1

    def keep(f):
        if f["fileId"] == newest["fileId"]:
            return True
        m = LTX.match(f["fileName"])
        return bool(m and m[1] == "0000" and f["action"] == "upload" and int(m[2], 16) >= max_txid)

    doomed = [f for f in files if not keep(f)]
    size = sum(f["contentLength"] for f in doomed) / 1e6
    verb = "Would delete" if args.dry_run else "Deleting"
    print(f"Keeping {newest['fileName']} (TXID 1..{max_txid:#x}). {verb} {len(doomed)} versions, {size:.0f} MB.")
    if args.dry_run:
        for f in doomed:
            print("  ", f["fileName"], f["action"])
        return 0

    failed = 0
    for f in doomed:
        try:
            call("b2_delete_file_version", {"fileName": f["fileName"], "fileId": f["fileId"]})
        except requests.HTTPError as e:
            failed += 1
            print(f"  failed: {f['fileName']}: {e}")
    print(f"Pruned {len(doomed) - failed} versions; {failed} failures.")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())

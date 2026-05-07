"""Bluesky bot for Open Common Ground.

Posts daily about notable Philadelphia City Council legislation.

Post types:
  - Weekdays: daily spotlight — a randomly selected high-impact bill
              (impact_score >= 6) from the full catalog
  - Weekdays: recently signed bills (last 30 days), if any
  - Sunday 9am: weekly roundup (counts + active bills)

Run via GitHub Actions daily at 9am ET.
"""

import os
import json
import random
import sys
from datetime import datetime, timedelta, timezone
import urllib.request
import urllib.error

API_BASE = os.environ.get("API_BASE", "https://opencommonground-api-production.up.railway.app")
BLUESKY_HANDLE = os.environ["BLUESKY_HANDLE"]
BLUESKY_APP_PASSWORD = os.environ["BLUESKY_APP_PASSWORD"]
SITE_BASE = "https://opencommonground.com"

BSKY_API = "https://bsky.social/xrpc"


def http_post(url: str, data: dict, headers: dict = {}) -> dict:
    body = json.dumps(data).encode()
    req = urllib.request.Request(url, data=body, headers={"Content-Type": "application/json", **headers}, method="POST")
    with urllib.request.urlopen(req, timeout=15) as resp:
        return json.loads(resp.read())


def http_get(url: str) -> dict:
    req = urllib.request.Request(url, headers={
        "User-Agent": "Mozilla/5.0 (compatible; OpenCommonGround/1.0)",
        "Accept": "application/json",
    })
    try:
        with urllib.request.urlopen(req, timeout=15) as resp:
            return json.loads(resp.read())
    except urllib.error.HTTPError as e:
        body = e.read().decode("utf-8", errors="replace")
        print(f"HTTP {e.code} from {url}: {body[:400]}")
        raise


def bsky_login() -> tuple[str, str]:
    resp = http_post(f"{BSKY_API}/com.atproto.server.createSession", {
        "identifier": BLUESKY_HANDLE,
        "password": BLUESKY_APP_PASSWORD,
    })
    return resp["accessJwt"], resp["did"]


def bsky_post(token: str, did: str, text: str) -> None:
    now = datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")
    http_post(
        f"{BSKY_API}/com.atproto.repo.createRecord",
        {
            "repo": did,
            "collection": "app.bsky.feed.post",
            "record": {
                "$type": "app.bsky.feed.post",
                "text": text,
                "createdAt": now,
            },
        },
        headers={"Authorization": f"Bearer {token}"},
    )
    print(f"Posted: {text[:80]}...")


def fetch_spotlight_bill() -> dict | None:
    """Pick a random high-impact analyzed bill from the full catalog."""
    try:
        # impact=high returns bills with impact_level='high', which maps to score >= 7
        # We fetch a larger pool and filter for score >= 6 to widen the net
        data = http_get(f"{API_BASE}/api/legislation/search?limit=100&level=local&analyzed=true&impact=high")
        bills = data.get("results", [])
        candidates = [b for b in bills if (b.get("impact_score") or 0) >= 6]
        if not candidates:
            # Fall back to medium-impact if no high-impact bills
            data = http_get(f"{API_BASE}/api/legislation/search?limit=100&level=local&analyzed=true&impact=medium")
            candidates = data.get("results", [])
        if not candidates:
            return None
        return random.choice(candidates)
    except Exception as e:
        print(f"Failed to fetch spotlight bill: {e}")
        return None


def post_daily_spotlight(token: str, did: str) -> bool:
    bill = fetch_spotlight_bill()
    if not bill:
        print("No spotlight bill found.")
        return False

    title = bill.get("plain_title") or bill.get("title") or "Untitled bill"
    bill_id = bill.get("id", "")
    sponsor = bill.get("sponsor") or ""
    impact = bill.get("impact_score", "")
    tags = bill.get("tags", "")

    # Format tags — stored as JSON array string
    tag_line = ""
    try:
        tag_list = json.loads(tags) if tags and tags.startswith("[") else []
        if tag_list:
            tag_line = f"\n{' · '.join(f'#{t.replace(\"-\", \"\")}' for t in tag_list[:3])}"
    except Exception:
        pass

    sponsor_line = f"\nSponsor: {sponsor}" if sponsor else ""
    url = f"{SITE_BASE}/philadelphia/legislation/{bill_id}"

    text = (
        f"📌 Philadelphia City Council Spotlight\n\n"
        f"{title}{sponsor_line}"
        f"{tag_line}\n\n"
        f"Impact: {impact}/10\n"
        f"{url}"
    )

    if len(text) > 300:
        # Trim title to fit
        budget = 300 - len(text) + len(title)
        title = title[:budget - 3] + "..."
        text = (
            f"📌 Philadelphia City Council Spotlight\n\n"
            f"{title}{sponsor_line}"
            f"{tag_line}\n\n"
            f"Impact: {impact}/10\n"
            f"{url}"
        )

    bsky_post(token, did, text)
    return True


def fetch_recently_signed(days: int = 30) -> list:
    """Bills signed into law within the last N days."""
    try:
        data = http_get(f"{API_BASE}/api/legislation/search?limit=100&level=local&status=signed_into_law")
        bills = data.get("results", [])
        cutoff = datetime.now(timezone.utc) - timedelta(days=days)
        recent = []
        for b in bills:
            date_str = b.get("introduced_date") or b.get("created_at")
            if not date_str:
                continue
            try:
                dt = datetime.fromisoformat(date_str.replace("Z", "+00:00"))
                if dt >= cutoff:
                    recent.append(b)
            except Exception:
                continue
        return recent
    except Exception as e:
        print(f"Failed to fetch signed bills: {e}")
        return []


def post_signed_bills(token: str, did: str) -> int:
    signed = fetch_recently_signed(days=30)
    if not signed:
        print("No bills signed into law in the last 30 days.")
        return 0

    posted = 0
    for bill in signed[:2]:
        title = bill.get("plain_title") or bill.get("title") or "Untitled bill"
        bill_id = bill.get("id", "")
        url = f"{SITE_BASE}/philadelphia/legislation/{bill_id}"

        text = (
            f"✅ Signed into law in Philadelphia\n\n"
            f"{title}\n\n"
            f"{url}"
        )

        if len(text) > 300:
            text = text[:297] + "..."

        bsky_post(token, did, text)
        posted += 1

    return posted


def post_weekly_roundup(token: str, did: str) -> None:
    try:
        data = http_get(f"{API_BASE}/api/insights/summary")
        total = data.get("total_bills") or "thousands of"
        active = data.get("active_bills") or ""
        active_line = f"\n📋 Active bills: {active}" if active else ""

        text = (
            f"📊 Philadelphia City Council — Weekly Update\n\n"
            f"Total bills tracked: {total}"
            f"{active_line}\n\n"
            f"Explore 26 years of legislation:\n"
            f"{SITE_BASE}/philadelphia/legislation"
        )

        if len(text) > 300:
            text = text[:297] + "..."

        bsky_post(token, did, text)
    except Exception as e:
        print(f"Weekly roundup failed: {e}")


def check_api_health() -> bool:
    print(f"Testing API at {API_BASE} ...")
    try:
        data = http_get(f"{API_BASE}/health")
        print(f"Health OK: {data}")
        return True
    except urllib.error.HTTPError as e:
        print(f"Health check failed: HTTP {e.code}")
        return False
    except Exception as e:
        print(f"Health check error: {e}")
        return False


def main():
    print(f"Bluesky bot starting — {datetime.now(timezone.utc).isoformat()}")

    if not check_api_health():
        print("API unreachable — aborting.")
        sys.exit(1)

    token, did = bsky_login()
    print("Logged in to Bluesky.")

    today = datetime.now(timezone.utc)
    is_sunday = today.weekday() == 6

    if is_sunday:
        print("Sunday — posting weekly roundup.")
        post_weekly_roundup(token, did)
    else:
        print("Posting daily spotlight...")
        posted = post_daily_spotlight(token, did)
        print(f"Spotlight posted: {posted}")

        print("Checking for recently signed bills...")
        n = post_signed_bills(token, did)
        print(f"Posted {n} signed bill(s).")

    print("Done.")


if __name__ == "__main__":
    main()

"""Bluesky bot for Open Common Ground.

Posts daily about notable Philadelphia City Council legislation.

Post types:
  - New high-impact bills introduced in the last 24h (impact_score >= 7)
  - Bills signed into law in the last 24h
  - Sunday 9am: weekly roundup (counts + spotlight bill)

Run via GitHub Actions daily at 9am ET.
"""

import os
import json
import sys
from datetime import datetime, timedelta, timezone
from typing import Optional
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
    req = urllib.request.Request(url, headers={"User-Agent": "OpenCommonGround-Bot/1.0"})
    with urllib.request.urlopen(req, timeout=15) as resp:
        return json.loads(resp.read())


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


def fetch_recent_bills(hours: int = 24) -> list:
    try:
        data = http_get(f"{API_BASE}/api/legislation/search?limit=100&level=local&sort=introduced_date")
        bills = data.get("results", [])
        cutoff = datetime.now(timezone.utc) - timedelta(hours=hours)
        recent = []
        for b in bills:
            introduced = b.get("introduced_date") or b.get("created_at")
            if not introduced:
                continue
            try:
                dt = datetime.fromisoformat(introduced.replace("Z", "+00:00"))
                if dt >= cutoff:
                    recent.append(b)
            except Exception:
                continue
        return recent
    except Exception as e:
        print(f"Failed to fetch bills: {e}")
        return []


def post_high_impact_bills(token: str, did: str) -> int:
    bills = fetch_recent_bills(hours=24)
    high_impact = [b for b in bills if (b.get("impact_score") or 0) >= 7]

    if not high_impact:
        print("No high-impact bills introduced in the last 24h.")
        return 0

    posted = 0
    for bill in high_impact[:3]:  # cap at 3 posts per run
        title = bill.get("plain_title") or bill.get("title") or "Untitled bill"
        bill_id = bill.get("id", "")
        sponsor = bill.get("primary_sponsor") or bill.get("sponsor") or ""
        impact = bill.get("impact_score", "")

        sponsor_line = f"\nSponsor: {sponsor}" if sponsor else ""
        url = f"{SITE_BASE}/philadelphia/legislation/{bill_id}"

        text = (
            f"🔔 New high-impact bill introduced in Philadelphia City Council\n\n"
            f"{title}{sponsor_line}\n\n"
            f"Impact score: {impact}/10\n"
            f"{url}"
        )

        if len(text) > 300:
            text = text[:297] + "..."

        bsky_post(token, did, text)
        posted += 1

    return posted


def post_signed_bills(token: str, did: str) -> int:
    bills = fetch_recent_bills(hours=24)
    signed = [b for b in bills if b.get("status") in ("signed_into_law", "enacted", "approved")]

    if not signed:
        print("No bills signed into law in the last 24h.")
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
        total = data.get("total_bills") or data.get("total") or "thousands of"
        active = data.get("active_bills") or ""
        active_line = f"\n📋 Active bills: {active}" if active else ""

        recent = fetch_recent_bills(hours=168)  # last 7 days
        new_this_week = len(recent)

        text = (
            f"📊 Philadelphia City Council — Weekly Update\n\n"
            f"New bills this week: {new_this_week}"
            f"{active_line}\n\n"
            f"Track all {total} bills at:\n"
            f"{SITE_BASE}/philadelphia/legislation"
        )

        if len(text) > 300:
            text = text[:297] + "..."

        bsky_post(token, did, text)
    except Exception as e:
        print(f"Weekly roundup failed: {e}")


def main():
    print(f"Bluesky bot starting — {datetime.now(timezone.utc).isoformat()}")

    token, did = bsky_login()
    print("Logged in to Bluesky.")

    today = datetime.now(timezone.utc)
    is_sunday = today.weekday() == 6

    if is_sunday:
        print("Sunday — posting weekly roundup.")
        post_weekly_roundup(token, did)
    else:
        print("Checking for high-impact bills...")
        n = post_high_impact_bills(token, did)
        print(f"Posted {n} high-impact bill(s).")

        print("Checking for bills signed into law...")
        n = post_signed_bills(token, did)
        print(f"Posted {n} signed bill(s).")

    print("Done.")


if __name__ == "__main__":
    main()

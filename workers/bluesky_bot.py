"""Bluesky bot for Open Common Ground.

Posts daily about notable Philadelphia City Council legislation.

Post types:
  - Weekdays: daily spotlight — a randomly selected high-impact bill
              (falls back to medium-impact if the pool is thin)
  - Weekdays: recently signed bills (last 30 days), if any
  - Sunday 9am: weekly roundup (counts + active bills)

Dedup: every post is recorded server-side in the `bluesky_posts` registry via
the X-Bot-Token-authenticated /api/legislation/bluesky/record-post endpoint.
Bill-fetch queries pass `not_posted_for=<type>` so the bot never picks a bill
it has already posted in that post_type.

Run via GitHub Actions daily at 9am ET.
"""

import os
import json
import random
import sys
import urllib.parse
from datetime import datetime, timedelta, timezone
import urllib.request
import urllib.error

API_BASE = os.environ.get("API_BASE", "https://opencommonground-api-production.up.railway.app")
BLUESKY_HANDLE = os.environ["BLUESKY_HANDLE"]
BLUESKY_APP_PASSWORD = os.environ["BLUESKY_APP_PASSWORD"]
BOT_API_TOKEN = os.environ.get("BOT_API_TOKEN", "")
SITE_BASE = "https://opencommonground.com"

BSKY_API = "https://bsky.social/xrpc"

# Tags we believe drive Bluesky engagement — bills carrying any of these get
# a weighting boost in candidate selection.  "Budget" validated by 2 likes
# on the May 28 budget post; "traffic" is hypothesis from user intuition.
# Tag forms below match how they're actually stored in the DB (hyphenated,
# not spaced — confirmed against ~23k tag-occurrences across 8.6k bills).
PRIORITY_TAGS = {
    # Budget / fiscal — validated
    "finance", "taxation", "budget",
    # Transportation / traffic enforcement — hypothesis
    "transportation", "traffic", "parking",
    # Public safety — adjacent (speed cams, school zones)
    "public-safety",
}


def _priority_weight(bill: dict) -> int:
    """Weight = 1 + 2 per matching PRIORITY_TAGS tag.  Bill with no matches = 1,
    one match = 3, two matches = 5.  Used for weighted random selection."""
    tags_raw = bill.get("tags") or ""
    try:
        tags = json.loads(tags_raw) if tags_raw.startswith("[") else []
    except Exception:
        tags = []
    matches = sum(1 for t in tags if t in PRIORITY_TAGS)
    return 1 + 2 * matches


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


def bsky_post(token: str, did: str, text: str, embed: dict = None) -> dict:
    now = datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")
    record = {
        "$type": "app.bsky.feed.post",
        "text": text,
        "createdAt": now,
    }
    if embed:
        record["embed"] = embed
    resp = http_post(
        f"{BSKY_API}/com.atproto.repo.createRecord",
        {
            "repo": did,
            "collection": "app.bsky.feed.post",
            "record": record,
        },
        headers={"Authorization": f"Bearer {token}"},
    )
    print(f"Posted: {text[:80]}...")
    return resp


def record_post(bill_id: str | None, post_type: str, bsky_resp: dict) -> None:
    """Tell the API we posted, so the bot never duplicates this bill."""
    if not BOT_API_TOKEN:
        print("BOT_API_TOKEN not set — skipping registry write (dedup falls back to feed lookback).")
        return
    try:
        http_post(
            f"{API_BASE}/api/legislation/bluesky/record-post",
            {
                "bill_id": bill_id,
                "post_type": post_type,
                "post_uri": bsky_resp.get("uri"),
                "post_cid": bsky_resp.get("cid"),
            },
            headers={"X-Bot-Token": BOT_API_TOKEN},
        )
        print(f"Recorded {post_type} post for bill_id={bill_id}.")
    except Exception as e:
        print(f"Failed to record post (will rely on feed-lookback dedup): {e}")


def fetch_recent_post_urls(handle: str, limit: int = 40) -> set[str]:
    """Return bill URLs posted by the bot recently, to avoid repeats."""
    try:
        actor = urllib.parse.quote(handle)
        data = http_get(f"{BSKY_API}/app.bsky.feed.getAuthorFeed?actor={actor}&limit={limit}")
        urls = set()
        for item in data.get("feed", []):
            embed = item.get("post", {}).get("record", {}).get("embed", {})
            if embed.get("$type") == "app.bsky.embed.external":
                uri = embed.get("external", {}).get("uri", "")
                if uri:
                    urls.add(uri)
        return urls
    except Exception as e:
        print(f"Failed to fetch recent post URLs (deduplication skipped): {e}")
        return set()


def fetch_spotlight_bill(excluded_urls: set[str] = None) -> dict | None:
    """Pick a random high-impact analyzed bill that's never been spotlighted.

    Primary dedup: server-side `not_posted_for=spotlight` filter (bluesky_posts
    registry).  Secondary dedup: client-side filter against recent author-feed
    URLs, in case the registry write previously failed.
    """
    if excluded_urls is None:
        excluded_urls = set()

    def not_posted(bill: dict) -> bool:
        url = f"{SITE_BASE}/philadelphia/legislation/{bill.get('id', '')}"
        return url not in excluded_urls

    try:
        data = http_get(
            f"{API_BASE}/api/legislation/search"
            f"?limit=100&level=local&analyzed=true&impact=high&not_posted_for=spotlight"
        )
        candidates = [b for b in data.get("results", []) if not_posted(b)]

        if len(candidates) < 5:
            data2 = http_get(
                f"{API_BASE}/api/legislation/search"
                f"?limit=100&level=local&analyzed=true&impact=medium&not_posted_for=spotlight"
            )
            candidates += [b for b in data2.get("results", []) if not_posted(b)]

        if not candidates:
            return None

        pool = [b for b in candidates if b.get("lede")] or candidates
        weights = [_priority_weight(b) for b in pool]
        return random.choices(pool, weights=weights, k=1)[0]
    except Exception as e:
        print(f"Failed to fetch spotlight bill: {e}")
        return None


def post_daily_spotlight(token: str, did: str) -> bool:
    recent_urls = fetch_recent_post_urls(BLUESKY_HANDLE)
    print(f"Found {len(recent_urls)} recently posted URLs to exclude.")
    bill = fetch_spotlight_bill(excluded_urls=recent_urls)
    if not bill:
        print("No spotlight bill found.")
        return False

    lede = (bill.get("lede") or "").strip()
    headline = (bill.get("headline") or "").strip()
    plain_title = (bill.get("plain_title") or bill.get("title") or "A Philadelphia City Council bill").strip()
    bill_id = bill.get("id", "")
    sponsor = (bill.get("sponsor") or "").strip()
    tags = bill.get("tags", "")
    introduced_raw = bill.get("introduced_date") or ""
    url = f"{SITE_BASE}/philadelphia/legislation/{bill_id}"

    # Use lede as the hook — it's AI-generated for exactly this purpose
    # headline is intentionally excluded: it's newspaper-style and too dense for a post
    hook = lede or plain_title

    # Format 1-2 hashtags from tags
    tag_str = ""
    try:
        tag_list = json.loads(tags) if tags and tags.startswith("[") else []
        if tag_list:
            tag_str = " ".join("#" + t.replace("-", "") for t in tag_list[:2])
    except Exception:
        pass

    # Format introduced date as "Introduced Mon YYYY"
    intro_str = ""
    try:
        if introduced_raw:
            dt = datetime.fromisoformat(introduced_raw.replace("Z", "+00:00"))
            intro_str = f"Introduced {dt.strftime('%b %Y')}"
    except Exception:
        pass

    footer_parts = [sponsor] if sponsor else ["Philadelphia City Council"]
    if intro_str:
        footer_parts.append(intro_str)
    footer = " · ".join(footer_parts)

    text = f"{hook}\n\n{footer}"
    if tag_str:
        text += f"\n{tag_str}"

    if len(text) > 300:
        budget = 300 - (len(text) - len(hook))
        hook = hook[:max(0, budget - 3)] + "..."
        text = f"{hook}\n\n{footer}"
        if tag_str and len(text) + len(tag_str) + 1 <= 300:
            text += f"\n{tag_str}"

    embed = {
        "$type": "app.bsky.embed.external",
        "external": {
            "uri": url,
            "title": plain_title,
            "description": headline or lede or "Philadelphia City Council legislation",
        },
    }

    resp = bsky_post(token, did, text, embed=embed)
    record_post(bill_id, "spotlight", resp)
    return True


def fetch_recently_signed(days: int = 30) -> list:
    """Bills signed into law within the last N days, never previously announced."""
    try:
        data = http_get(
            f"{API_BASE}/api/legislation/search"
            f"?limit=100&level=local&status=signed_into_law&not_posted_for=signed"
        )
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
        plain_title = (bill.get("plain_title") or bill.get("title") or "A bill").strip()
        lede = (bill.get("lede") or "").strip()
        bill_id = bill.get("id", "")
        url = f"{SITE_BASE}/philadelphia/legislation/{bill_id}"

        if lede:
            text = f"Just signed into law in Philadelphia: {plain_title}\n\n{lede}"
        else:
            text = f"Just signed into law in Philadelphia: {plain_title}"

        if len(text) > 300:
            text = text[:297] + "..."

        embed = {
            "$type": "app.bsky.embed.external",
            "external": {
                "uri": url,
                "title": plain_title,
                "description": lede or "Philadelphia City Council legislation",
            },
        }

        resp = bsky_post(token, did, text, embed=embed)
        record_post(bill_id, "signed", resp)
        posted += 1

    return posted


def post_weekly_roundup(token: str, did: str) -> None:
    try:
        data = http_get(f"{API_BASE}/api/insights/summary")
        total = data.get("total_bills")
        active = data.get("active_bills")
        this_year = data.get("bills_this_year")

        total_str = f"{total:,}" if total else "thousands of"
        active_str = f"{active:,}" if active else ""
        year_str = f"{this_year:,}" if this_year else ""

        lines = [f"Philadelphia City Council has {total_str} bills on record going back to 2000."]
        if active_str:
            lines.append(f"{active_str} are active right now.")
        if year_str:
            lines.append(f"{year_str} introduced so far this year.")

        text = "\n".join(lines)

        if len(text) > 300:
            text = text[:297] + "..."

        embed = {
            "$type": "app.bsky.embed.external",
            "external": {
                "uri": f"{SITE_BASE}/philadelphia/legislation",
                "title": "Philadelphia City Council — Open Common Ground",
                "description": "26 years of local legislation, tracked and analyzed.",
            },
        }

        resp = bsky_post(token, did, text, embed=embed)
        record_post(None, "roundup", resp)
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

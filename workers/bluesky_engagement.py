"""Bluesky engagement metrics tracker.

For each post in bluesky_posts within the last 14 days, fetch like / repost /
reply counts from Bluesky and write them back to the registry.  The bot uses
this data to learn which tags / topics / impact scores actually engage so the
selection logic can be improved with real feedback instead of guesses.

Run via GitHub Actions daily.
"""

import os
import json
import sys
import urllib.parse
import urllib.request
import urllib.error

API_BASE = os.environ.get("API_BASE", "https://opencommonground-api-production.up.railway.app")
BOT_API_TOKEN = os.environ["BOT_API_TOKEN"]

BSKY_API = "https://bsky.social/xrpc"
GETPOSTS_BATCH = 25  # Bluesky's app.bsky.feed.getPosts limit


def http_get(url: str, headers: dict | None = None) -> dict:
    req = urllib.request.Request(url, headers={
        "User-Agent": "Mozilla/5.0 (compatible; OpenCommonGround/1.0)",
        "Accept": "application/json",
        **(headers or {}),
    })
    try:
        with urllib.request.urlopen(req, timeout=20) as resp:
            return json.loads(resp.read())
    except urllib.error.HTTPError as e:
        body = e.read().decode("utf-8", errors="replace")
        print(f"HTTP {e.code} from {url}: {body[:400]}")
        raise


def http_post(url: str, data, headers: dict | None = None) -> dict:
    body = json.dumps(data).encode()
    req = urllib.request.Request(
        url,
        data=body,
        headers={"Content-Type": "application/json", **(headers or {})},
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=20) as resp:
        return json.loads(resp.read())


def chunked(lst, n):
    for i in range(0, len(lst), n):
        yield lst[i:i + n]


def main():
    print(f"Fetching posts-to-track from {API_BASE} ...")
    data = http_get(
        f"{API_BASE}/api/legislation/bluesky/posts-to-track",
        headers={"X-Bot-Token": BOT_API_TOKEN},
    )
    posts = data.get("posts", [])
    print(f"Tracking {len(posts)} posts within the engagement window.")

    if not posts:
        print("Nothing to update.")
        return

    updates = []
    for batch in chunked(posts, GETPOSTS_BATCH):
        # app.bsky.feed.getPosts accepts repeated uris= params, up to 25
        qs = "&".join(f"uris={urllib.parse.quote(p['post_uri'], safe='')}" for p in batch)
        try:
            resp = http_get(f"{BSKY_API}/app.bsky.feed.getPosts?{qs}")
        except Exception as e:
            print(f"Bluesky getPosts batch failed: {e}")
            continue

        metrics_by_uri = {p["uri"]: p for p in resp.get("posts", [])}
        for p in batch:
            m = metrics_by_uri.get(p["post_uri"])
            if not m:
                # Post may have been deleted from Bluesky — skip
                continue
            updates.append({
                "id": p["id"],
                "like_count": m.get("likeCount", 0),
                "repost_count": m.get("repostCount", 0),
                "reply_count": m.get("replyCount", 0),
            })

    if not updates:
        print("No engagement metrics retrieved.")
        return

    print(f"Posting {len(updates)} engagement updates back to API ...")
    result = http_post(
        f"{API_BASE}/api/legislation/bluesky/update-engagement",
        updates,
        headers={"X-Bot-Token": BOT_API_TOKEN},
    )
    print(f"Updated {result.get('updated', 0)} / {result.get('total', 0)} rows.")


if __name__ == "__main__":
    main()

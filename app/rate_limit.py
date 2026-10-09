"""Rate limiting.

The key function is the whole point of this module. slowapi's default,
`get_remote_address`, returns `request.client.host` -- the TCP peer -- and in
this deployment the TCP peer is never the visitor:

    browser -> Vercel (Next.js /api/* rewrite) -> Cloudflare -> Railway

`frontend/lib/api.ts` sets `API_URL = ''`, so every browser call is a relative
URL proxied by Next, and the backend sees Vercel's edge address. uvicorn 0.27
only honours `X-Forwarded-For` from `forwarded_allow_ips`, which defaults to
127.0.0.1, so the proxy's headers are not trusted and `client.host` stays the
proxy. The result was a single shared bucket: `/search` allows 30/minute, so
thirty searches *in total across every visitor* exhausted it and the next
person got a 429. One impatient user clicking filters could take search down
for everyone, and a traffic spike -- the thing the project is trying to cause
-- would have guaranteed it.

So the key is the leftmost `X-Forwarded-For` entry, which is the original
client as Vercel recorded it before Cloudflare appended its own hop.

The trade-off, stated plainly: a client can spoof `X-Forwarded-For` and get a
fresh bucket, so this does not stop a determined attacker. It is not meant to
-- Cloudflare sits in front for that. It is meant to stop one visitor's normal
browsing from rate-limiting everybody else, and for that a spoofable key is
strictly better than a key that is identical for all users.

`cf-connecting-ip` is deliberately not preferred: Cloudflare sets it to *its*
client, which on the proxied path is Vercel, not the visitor.
"""

from slowapi import Limiter
from slowapi.util import get_remote_address
from starlette.requests import Request


def client_identifier(request: Request) -> str:
    """Return the best available identity for the real caller.

    Falls back to the peer address when no forwarding header is present, which
    covers local development and any direct call to the Railway URL (the
    Bluesky bot does this, bypassing Cloudflare).
    """
    forwarded = request.headers.get("x-forwarded-for")
    if forwarded:
        # "client, proxy1, proxy2" -- leftmost is the original client. Guard
        # against a header that is present but empty or just commas.
        first = forwarded.split(",")[0].strip()
        if first:
            return first
    # Some proxies send only this one.
    real_ip = request.headers.get("x-real-ip")
    if real_ip and real_ip.strip():
        return real_ip.strip()
    return get_remote_address(request)


limiter = Limiter(key_func=client_identifier)

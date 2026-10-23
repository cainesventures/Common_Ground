"""Rate limiting.

The key function is the whole point of this module. The TCP peer is always a
Railway-internal address (100.64.x.x), so slowapi's default would put every
visitor in one bucket. Which header carries the real visitor depends on the
path the request took. Measured on 2026-10-22 from a known client IP:

    browser -> Vercel rewrite -> railway.app      x-vercel-forwarded-for
    caller  -> Cloudflare (api.*) -> railway.app  cf-connecting-ip
    caller  -> railway.app directly               x-forwarded-for (leftmost)

The Vercel rewrite targets the railway.app URL, so browser API calls never
pass through Cloudflare. Railway's edge rewrites X-Forwarded-For to
"<whoever connected to it>, <railway hop>", which is Vercel's AWS egress on
the first path and a Cloudflare edge on the second. Keying on the leftmost
X-Forwarded-For alone, as this used to, meant the key was a proxy address
that changed between requests, so in prod nobody ever reached a limit.

The trade-off, stated plainly: a direct caller can send any of these headers
and get a fresh bucket, so this does not stop a determined attacker. It is
meant to stop one visitor's ordinary browsing (or a naive script) from
hammering the one instance, and to never lump unrelated visitors together.
"""

from slowapi import Limiter
from slowapi.util import get_remote_address
from starlette.requests import Request

# Most specific first: each is set by the proxy that saw the visitor directly.
_CLIENT_HEADERS = ("x-vercel-forwarded-for", "cf-connecting-ip")


def client_identifier(request: Request) -> str:
    """Return the best available identity for the real caller.

    Falls back to the peer address when no forwarding header is present, which
    covers local development.
    """
    for name in _CLIENT_HEADERS:
        value = (request.headers.get(name) or "").split(",")[0].strip()
        if value:
            return value
    forwarded = request.headers.get("x-forwarded-for")
    if forwarded:
        # "client, proxy1, proxy2" -- leftmost is the original client. Guard
        # against a header that is present but empty or just commas.
        first = forwarded.split(",")[0].strip()
        if first:
            return first
    real_ip = request.headers.get("x-real-ip")
    if real_ip and real_ip.strip():
        return real_ip.strip()
    return get_remote_address(request)


limiter = Limiter(key_func=client_identifier)

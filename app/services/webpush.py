"""Minimal Web Push sender (RFC 8291 payload encryption + RFC 8292 VAPID).

This is what pywebpush does, built from the same two libraries it wraps
(http-ece for aes128gcm encryption, py-vapid for the signed header) without
its hard dependency on aiohttp.

Keys come from the environment:
  VAPID_PUBLIC_KEY   base64url uncompressed P-256 point (given to browsers)
  VAPID_PRIVATE_KEY  base64url raw 32-byte private scalar
Generate a pair with:  python -m app.services.webpush
"""
import base64
import json
import os
import time
from urllib.parse import urlparse

import http_ece
import requests
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric import ec
from py_vapid import Vapid02

# The JWT "sub" must be a mailto: or https: contact. The site URL, not an email:
# the owner's identity is deliberately kept off the site.
VAPID_SUBJECT = "https://opencommonground.com"


def _b64d(s: str) -> bytes:
    return base64.urlsafe_b64decode(s + "=" * (-len(s) % 4))


def _b64e(b: bytes) -> str:
    return base64.urlsafe_b64encode(b).rstrip(b"=").decode()


def public_key() -> str | None:
    return os.getenv("VAPID_PUBLIC_KEY") or None


def configured() -> bool:
    return bool(os.getenv("VAPID_PUBLIC_KEY") and os.getenv("VAPID_PRIVATE_KEY"))


class Gone(Exception):
    """The push service says this subscription no longer exists (404/410)."""


def send(endpoint: str, p256dh: str, auth: str, payload: dict, ttl: int = 24 * 3600) -> None:
    """Encrypt and deliver one notification. Raises Gone for a dead endpoint
    and RuntimeError for any other non-2xx answer."""
    body = http_ece.encrypt(
        json.dumps(payload).encode(),
        private_key=ec.generate_private_key(ec.SECP256R1()),  # fresh per message
        dh=_b64d(p256dh),
        auth_secret=_b64d(auth),
        version="aes128gcm",
    )
    u = urlparse(endpoint)
    vapid = Vapid02.from_raw(os.environ["VAPID_PRIVATE_KEY"].encode())
    headers = vapid.sign({
        "aud": f"{u.scheme}://{u.netloc}",
        "exp": int(time.time()) + 12 * 3600,
        "sub": VAPID_SUBJECT,
    })
    headers.update({
        "TTL": str(ttl),
        "Content-Encoding": "aes128gcm",
        "Content-Type": "application/octet-stream",
        "Urgency": "normal",
    })
    r = requests.post(endpoint, data=body, headers=headers, timeout=15)
    if r.status_code in (404, 410):
        raise Gone(endpoint)
    if r.status_code >= 300:
        raise RuntimeError(f"push service answered {r.status_code}: {r.text[:200]}")


def generate_keys() -> tuple[str, str]:
    """(public, private) in the env-var formats above."""
    key = ec.generate_private_key(ec.SECP256R1())
    private = key.private_numbers().private_value.to_bytes(32, "big")
    public = key.public_key().public_bytes(
        serialization.Encoding.X962, serialization.PublicFormat.UncompressedPoint)
    return _b64e(public), _b64e(private)


if __name__ == "__main__":
    pub, priv = generate_keys()
    print(f"VAPID_PUBLIC_KEY={pub}\nVAPID_PRIVATE_KEY={priv}")

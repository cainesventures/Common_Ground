"""Download Philadelphia's City Council district boundaries into app/data/.

The API serves this file from disk (/api/councilmembers/districts-geojson)
instead of fetching it live: the lines only change with redistricting, and the
live fetch made every map depend on one ArcGIS service staying up (Sentry
BACKEND-5, 2026-10-24). Rerun this after the next redistricting, pointing
SOURCE_URL at the new layer.

Usage: python scripts/fetch_council_districts.py
"""

import json
import urllib.request
from pathlib import Path

SOURCE_URL = (
    "https://services.arcgis.com/fLeGjb7u4uXqeF9q/arcgis/rest/services/"
    "Council_Districts_2024/FeatureServer/0/query"
    "?where=1%3D1&outFields=*&outSR=4326&f=geojson"
)
OUT_PATH = Path(__file__).resolve().parent.parent / "app" / "data" / "council_districts_2024.geojson"

# 6 decimal places is ~10cm; the source ships 13, which only adds bytes.
DECIMALS = 6


def _round(coords):
    if isinstance(coords[0], (int, float)):
        return [round(c, DECIMALS) for c in coords]
    return [_round(c) for c in coords]


def main():
    req = urllib.request.Request(SOURCE_URL, headers={"User-Agent": "Mozilla/5.0"})
    with urllib.request.urlopen(req, timeout=30) as resp:
        data = json.loads(resp.read())

    features = data.get("features") or []
    districts = sorted(int(f["properties"]["district"]) for f in features)
    if districts != list(range(1, 11)):
        raise SystemExit(f"Expected districts 1-10, got {districts}; not writing.")

    for f in features:
        f["geometry"]["coordinates"] = _round(f["geometry"]["coordinates"])
    features.sort(key=lambda f: int(f["properties"]["district"]))

    OUT_PATH.write_text(json.dumps(data, separators=(",", ":")), encoding="utf-8")
    print(f"Wrote {len(features)} districts to {OUT_PATH} ({OUT_PATH.stat().st_size // 1024} KB)")


if __name__ == "__main__":
    main()

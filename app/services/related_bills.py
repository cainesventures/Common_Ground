"""Related bills for a bill page: more on the same subject, more from the sponsor.

Bill pages are where Google sends nearly all of the site's visitors, and most
of those visitors read one page and leave (week of Nov 1 2026: 324 of 404 US
visitors viewed a single page). The related list they had was fetched in the
browser after load, matched on the bill's first tag alone, and was absent from
the HTML a crawler reads. This ranks on the server so the page can render the
list in its HTML, and ranks it better.

Subject match is tag overlap weighted by how rare each shared tag is (inverse
document frequency). Sharing "bike lanes", which is on a handful of bills, says
far more than sharing "zoning", which is on about 2,600. Ties go to the most
recent bill, so a reader who lands on a 2004 bill is shown what Council is doing
on that subject now.

The sponsor list is the primary sponsor's other bills, nearest in date first.
Sponsor strings carry a title and surname only ("Councilmember Squilla"), so the
nearest-in-date order is also what keeps two members with the same surname in
different decades from being mixed together.
"""
import json
import math
import threading
import time
from collections import Counter
from datetime import datetime
from typing import Optional

from sqlalchemy import func
from sqlalchemy.orm import Session

from app.models import Councilmember, Legislation
from app.services.name_matching import strip_title, surname

SUBJECT_LIMIT = 5
SPONSOR_LIMIT = 3
# A tag on fewer bills than this is not worth a "see all" link: the list it
# opens would hold this bill and almost nothing else.
MIN_TAG_BILLS = 3
# Resolutions honoring a person and procedural motions crowd out real bills on
# any shared tag. They are only offered alongside another bill of their type.
_SET_ASIDE_TYPES = {"ceremonial", "procedural"}


def parse_tags(raw) -> list[str]:
    """The bill's tags, lowercased and deduplicated, in stored order."""
    if not raw:
        return []
    items = raw
    if isinstance(raw, str):
        try:
            items = json.loads(raw)
        except (ValueError, TypeError):
            return []
    if not isinstance(items, list):
        return []
    out: list[str] = []
    for t in items:
        if isinstance(t, str) and t.strip():
            key = t.strip().lower()
            if key not in out:
                out.append(key)
    return out


def _norm(tag: str) -> str:
    # Same equivalence the tag -> category mapping uses: hyphen, underscore and
    # space are interchangeable, so "land-use" and "land use" are one subject.
    return " ".join(tag.replace("-", " ").replace("_", " ").split())


def primary_sponsor(raw: Optional[str]) -> str:
    """The first sponsor, as written on the bill ("Council President Johnson")."""
    if not raw:
        return ""
    return raw.split(",")[0].strip()


def _sponsor_key(raw: Optional[str]) -> str:
    """The first sponsor without the title, so a member's bills from before and
    after becoming Council President match each other."""
    return strip_title(primary_sponsor(raw)).strip().lower()


# The corpus scan is ~90 ms on SQLite (mostly datetime parsing of 8,700 rows),
# and every bill page render calls this. The parsed corpus is kept per database
# for a few minutes. The bill count is part of the key, so a publish that adds
# bills is seen on the next call; the bill pages themselves are cached for an
# hour by ISR, so a few minutes of staleness here is invisible.
_CORPUS_TTL_SECONDS = 600
_corpus_cache: dict = {}
_corpus_lock = threading.Lock()


def _scope(db: Session, level, city):
    q = db.query(Legislation.id).filter(Legislation.level == level)
    if city:
        q = q.filter(Legislation.city == city)
    return q


def _load_corpus(db: Session, level, city) -> dict:
    rows = (
        _scope(db, level, city)
        .with_entities(
            Legislation.id,
            Legislation.tags,
            Legislation.sponsor,
            Legislation.introduced_date,
            Legislation.bill_type,
        )
        .all()
    )
    # Document frequencies over the whole city corpus. `exact` counts the
    # spelling as stored, which is what the list page's ?tag= filter matches,
    # so the counts shown beside a tag agree with the list it opens.
    df: Counter = Counter()
    exact: Counter = Counter()
    keyed = []
    for r in rows:
        tags = parse_tags(r.tags)
        exact.update(tags)
        keys = frozenset(_norm(t) for t in tags)
        df.update(keys)
        keyed.append((r, keys, _sponsor_key(r.sponsor)))
    return {"n": len(rows) or 1, "df": df, "exact": exact, "keyed": keyed}


def _corpus(db: Session, level, city) -> dict:
    # A freshness check, not the corpus size: counted on `level` alone because
    # that is indexed (~2 ms). Adding the city filter made SQLite read the
    # table, full_text and all (~65 ms), which was most of the warm cost.
    count = db.query(func.count(Legislation.id)).filter(Legislation.level == level).scalar()
    # The engine object, not its URL: every test gets its own in-memory
    # database at the same URL. Holding the reference keeps id() from being
    # reused by a later engine.
    key = (db.get_bind(Legislation), level, city)
    now = time.monotonic()
    with _corpus_lock:
        hit = _corpus_cache.get(key)
        if hit and hit["count"] == count and now - hit["at"] < _CORPUS_TTL_SECONDS:
            return hit["corpus"]
    corpus = _load_corpus(db, level, city)
    with _corpus_lock:
        # One live entry per scope is all a server needs; dropping the rest
        # keeps test engines from piling up.
        _corpus_cache.clear()
        _corpus_cache[key] = {"count": count, "at": now, "corpus": corpus}
    return corpus


def _card(row) -> dict:
    return {
        "id": row.id,
        "bill_number": row.bill_number,
        # Same order of preference as the bill page heading and its <title>.
        "title": row.plain_title or row.headline or row.title,
        "status": row.status,
        "introduced_date": row.introduced_date.isoformat() if row.introduced_date else None,
        "impact_level": row.impact_level,
    }


def related_bills(db: Session, leg: Legislation) -> dict:
    corpus = _corpus(db, leg.level, leg.city)
    n, df, exact, keyed = corpus["n"], corpus["df"], corpus["exact"], corpus["keyed"]

    def idf(key: str) -> float:
        return math.log(n / df[key]) if df[key] else 0.0

    my_tags = parse_tags(leg.tags)
    my_keys = {_norm(t) for t in my_tags}
    my_type = leg.bill_type

    def eligible(r) -> bool:
        if r.id == leg.id:
            return False
        return r.bill_type not in _SET_ASIDE_TYPES or r.bill_type == my_type

    # ── More on this subject ────────────────────────────────────────────────
    scored = []
    for r, keys, _ in keyed:
        shared = keys & my_keys
        if not shared or not eligible(r):
            continue
        # Rounded so two bills with the same shared tags tie exactly, whatever
        # order the set happened to sum in, and the date decides between them.
        score = round(sum(idf(k) for k in shared), 6)
        if score <= 0:
            continue
        scored.append((score, r.introduced_date or datetime.min, r.id))
    scored.sort(reverse=True)
    subject_ids = [rid for _, _, rid in scored[:SUBJECT_LIMIT]]

    # The tag the "see all" link filters on: the most specific one that still
    # opens a list worth browsing.
    linkable = [t for t in my_tags if exact[t] >= MIN_TAG_BILLS]
    see_all_tag = max(linkable, key=lambda t: idf(_norm(t))) if linkable else None

    # ── More from the sponsor ───────────────────────────────────────────────
    sponsor_name = primary_sponsor(leg.sponsor)
    sponsor_key = _sponsor_key(leg.sponsor)
    sponsor_ids: list[str] = []
    if sponsor_key:
        taken = set(subject_ids)
        same = [r for r, _, key in keyed
                if key == sponsor_key and eligible(r) and r.id not in taken]
        ref = leg.introduced_date
        if ref:
            same.sort(key=lambda r: (r.introduced_date is None,
                                     abs((r.introduced_date - ref).days) if r.introduced_date else 0))
        else:
            same.sort(key=lambda r: r.introduced_date or datetime.min, reverse=True)
        sponsor_ids = [r.id for r in same[:SPONSOR_LIMIT]]

    # A current member's page is the better destination than a filtered list.
    # term_start guards against a former member who shared the surname.
    councilmember_id = None
    if sponsor_key:
        sn = surname(sponsor_name)
        year = leg.introduced_date.year if leg.introduced_date else None
        for m in db.query(Councilmember).all():
            if surname(m.name) == sn and (not m.term_start or year is None or year >= m.term_start):
                councilmember_id = m.id
                break

    wanted = subject_ids + sponsor_ids
    cards = {}
    if wanted:
        for row in db.query(
            Legislation.id, Legislation.bill_number, Legislation.plain_title,
            Legislation.headline, Legislation.title, Legislation.status,
            Legislation.introduced_date, Legislation.impact_level,
        ).filter(Legislation.id.in_(wanted)):
            cards[row.id] = _card(row)

    return {
        "subject": {
            "tag": see_all_tag,
            "bills": [cards[i] for i in subject_ids if i in cards],
        },
        "sponsor": {
            "name": sponsor_name or None,
            # What the list page's ?sponsor= filter should match: the surname
            # with the title stripped, so it finds bills from both titles.
            "filter": strip_title(sponsor_name) if sponsor_name else None,
            "councilmember_id": councilmember_id,
            "bills": [cards[i] for i in sponsor_ids if i in cards],
        },
        # Bills carrying each of this bill's tags, for the subject links at the
        # top of the page.
        "tag_counts": {t: exact[t] for t in my_tags},
    }

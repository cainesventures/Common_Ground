"""Councilmember scraper and service.

Scrapes Philadelphia City Council member profiles from phlcouncil.com
using Playwright (site has Cloudflare, so httpx doesn't work).

Data collected per member:
  - name, district, role (Council President / Councilmember / At-Large)
  - photo_url, bio, email, phone, profile_url
  - bills_sponsored — computed from the legislation table
"""

import logging
import re
import uuid
from datetime import datetime
from typing import Optional

from sqlalchemy import func, case, extract
from sqlalchemy.orm import Session

from app.models import Councilmember, Legislation, BillVoteRecord

logger = logging.getLogger(__name__)

# Known term start years keyed by profile slug — fallback when bio doesn't mention a year
KNOWN_TERM_START: dict[str, int] = {
    "kenyattajohnson":            2012,
    "marksquilla":                2012,
    "jamiegauthier":              2020,
    "curtisjonesjr":              2008,
    "jefferyyoungjr":             2022,
    "michaeldriscoll":            2016,
    "quetcylozada":               2022,
    "cindybass":                  2012,
    "anthonyphillips":            2024,
    "brianoneill":                1980,
    "katherinegilmorerichardson": 2020,
    "isaiahthomas":               2020,
    "jimharrity":                 2024,
    "ninaahmad":                  2024,
    "ruelandau":                  2024,
    "kendrabrooks":               2020,
    "nicolasorourke":             2024,
}

# Party affiliation keyed by profile slug. Council is majority-Democratic but
# not uniformly so — O'Neill is Republican, Brooks and O'Rourke are Working
# Families Party. Anyone not listed defaults to Democratic.
KNOWN_PARTY: dict[str, str] = {
    "brianoneill":    "Republican",
    "kendrabrooks":   "Working Families",
    "nicolasorourke": "Working Families",
}

# Current council members only (first 17 entries from the page, deduplicated)
CURRENT_MEMBER_SLUGS = [
    ("https://phlcouncil.com/kenyattajohnson/",       "Council President Kenyatta Johnson | District 2"),
    ("https://phlcouncil.com/marksquilla/",            "Councilmember Mark Squilla | District 1"),
    ("https://phlcouncil.com/jamiegauthier/",          "Councilmember Jamie Gauthier | District 3"),
    ("https://phlcouncil.com/curtisjonesjr/",          "Councilmember Curtis Jones, Jr. | District 4"),
    ("https://phlcouncil.com/jefferyyoungjr/",         "Councilmember Jeffery Young, Jr. | District 5"),
    ("https://phlcouncil.com/michaeldriscoll/",        "Councilmember Michael Driscoll | District 6"),
    ("https://phlcouncil.com/quetcylozada/",           "Councilmember Quetcy Lozada | District 7"),
    ("https://phlcouncil.com/cindybass/",              "Councilmember Cindy Bass | District 8"),
    ("https://phlcouncil.com/anthonyphillips/",        "Councilmember Anthony Phillips | District 9"),
    ("https://phlcouncil.com/brianoneill/",            "Councilmember Brian J. O'Neill | District 10"),
    ("https://phlcouncil.com/katherinegilmorerichardson/", "Councilmember At-Large Katherine Gilmore Richardson"),
    ("https://phlcouncil.com/isaiahthomas/",           "Councilmember At-Large Isaiah Thomas"),
    ("https://phlcouncil.com/jimharrity/",             "Councilmember At-Large Jim Harrity"),
    ("https://phlcouncil.com/ninaahmad/",              "Councilmember At-Large Nina Ahmad"),
    ("https://phlcouncil.com/ruelandau/",              "Councilmember At-Large Rue Landau"),
    ("https://phlcouncil.com/kendrabrooks/",           "Councilmember At-Large Kendra Brooks"),
    ("https://phlcouncil.com/nicolasorourke/",         "Councilmember At-Large Nicolas O'Rourke"),
]


def _parse_label(label: str) -> dict:
    """Parse 'Councilmember Mark Squilla | District 1' into name/district/role."""
    parts = label.split("|")
    full_title = parts[0].strip()
    district_raw = parts[1].strip() if len(parts) > 1 else ""

    # Extract district number
    district = ""
    if district_raw:
        m = re.search(r"District\s+(\d+)", district_raw)
        district = f"District {m.group(1)}" if m else "At-Large"
    else:
        district = "At-Large"

    # Extract name (remove title prefix including At-Large)
    name = re.sub(r"^(Council President|Councilmember)\s+(At-Large\s+)?", "", full_title).strip()

    return {"name": name, "district": district, "full_title": full_title}


async def _scrape_profile(page, url: str) -> dict:
    """Scrape a single phlcouncil.com profile page."""
    await page.goto(url, wait_until="networkidle", timeout=30000)

    result = {"profile_url": url, "photo_url": None, "bio": None, "email": None, "phone": None}

    # Bio — first substantive paragraph in main content
    try:
        main = await page.query_selector(".entry-content, main article, .post-content")
        if main:
            paras = await main.query_selector_all("p")
            bio_parts = []
            for p in paras[:3]:
                txt = (await p.inner_text()).strip()
                if len(txt) > 50:
                    bio_parts.append(txt)
                if len(" ".join(bio_parts)) > 400:
                    break
            if bio_parts:
                result["bio"] = " ".join(bio_parts)[:800]
    except Exception:
        pass

    # Photo — first wp-content image that isn't a logo/icon
    try:
        imgs = await page.query_selector_all("img[src*='wp-content']")
        for img in imgs:
            src = await img.get_attribute("src") or ""
            if any(x in src.lower() for x in ["logo", "icon", "banner", "header"]):
                continue
            width = await img.get_attribute("width") or "0"
            # Skip tiny images
            try:
                if int(width) < 80:
                    continue
            except ValueError:
                pass
            result["photo_url"] = src
            break
    except Exception:
        pass

    # Email
    try:
        email_link = await page.query_selector("a[href^='mailto:']")
        if email_link:
            href = await email_link.get_attribute("href") or ""
            result["email"] = href.replace("mailto:", "").strip()
    except Exception:
        pass

    # Phone
    try:
        phone_link = await page.query_selector("a[href^='tel:']")
        if phone_link:
            href = await phone_link.get_attribute("href") or ""
            result["phone"] = href.replace("tel:", "").strip()
        else:
            # Try text pattern
            body_text = await page.inner_text("body")
            m = re.search(r"\(?\d{3}\)?[\s\-\.]\d{3}[\s\-\.]\d{4}", body_text)
            if m:
                result["phone"] = m.group(0)
    except Exception:
        pass

    return result


def _extract_term_start(bio: str | None, slug: str) -> int | None:
    """Try to find the year a member first took office from their bio text, falling back to KNOWN_TERM_START."""
    if bio:
        # Patterns like "elected in 2012", "took office in 2020", "since 2008", "joined...council in 2016"
        patterns = [
            r"elected[^.]{0,40}?(\b20\d{2}\b|\b19\d{2}\b)",
            r"took office[^.]{0,30}?(\b20\d{2}\b|\b19\d{2}\b)",
            r"since (\b20\d{2}\b|\b19\d{2}\b)",
            r"joined[^.]{0,40}?council[^.]{0,20}?(\b20\d{2}\b|\b19\d{2}\b)",
            r"first elected[^.]{0,30}?(\b20\d{2}\b|\b19\d{2}\b)",
            r"serving since[^.]{0,20}?(\b20\d{2}\b|\b19\d{2}\b)",
        ]
        for pattern in patterns:
            m = re.search(pattern, bio, re.IGNORECASE)
            if m:
                year = int(m.group(1))
                if 1970 <= year <= 2030:
                    return year
    return KNOWN_TERM_START.get(slug)


def _sponsored_filter(query, member_name: str, term_start: int | None):
    """Apply the canonical sponsored-bill filter to a query.

    Sponsor strings are title + surname ("Councilmember Jones"), so matching is
    by surname (suffix-aware — see app.services.name_matching), scoped to the
    member's time in office so an earlier member with the same surname (or a
    substring match) isn't attributed to them.
    """
    from app.services.name_matching import surname
    query = query.filter(Legislation.sponsor.ilike(f"%{surname(member_name)}%"))
    if term_start:
        query = query.filter(extract("year", Legislation.introduced_date) >= term_start)
    return query


def _sponsored_counts(db: Session, member_name: str, term_start: int | None) -> tuple[int, int]:
    """(bills_sponsored, bills_passed) for this member."""
    q = _sponsored_filter(
        db.query(
            func.count(Legislation.id),
            func.sum(case((Legislation.status == "signed_into_law", 1), else_=0)),
        ),
        member_name,
        term_start,
    )
    total, passed = q.first()
    return int(total or 0), int(passed or 0)


_TERMINAL_STATUSES = ("signed_into_law", "failed", "vetoed", "withdrawn", "tabled")


def get_legislative_profile(db: Session, member_id: str, member_name: str,
                            term_start: int | None) -> dict:
    """Aggregate a member's sponsored-bill analysis + official voting behaviour.

    Sponsored bills are matched by surname/term (see _sponsored_filter); the
    small per-member set (<=~650 rows) is aggregated in Python.  Outcomes use
    the same died-in-committee rule as the insights endpoints: a non-terminal
    bill introduced before the current council term is dead, not active.
    """
    import json
    import statistics
    from collections import Counter
    from datetime import datetime

    rows = _sponsored_filter(
        db.query(
            Legislation.status,
            Legislation.tags,
            Legislation.bill_type,
            Legislation.impact_score,
            Legislation.impact_level,
            Legislation.committee,
            Legislation.introduced_date,
            Legislation.final_date,
        ),
        member_name,
        term_start,
    ).all()

    now_year = datetime.utcnow().year
    current_term = now_year - (now_year % 4)

    total = len(rows)
    signed = failed_vetoed = died = active = 0
    tag_counter: Counter = Counter()
    type_counter: Counter = Counter()
    committee_counter: Counter = Counter()
    impact_levels: Counter = Counter()
    impact_scores: list[int] = []
    passage_spans: list[float] = []

    for r in rows:
        st = r.status
        if st == "signed_into_law":
            signed += 1
            if r.final_date and r.introduced_date and r.final_date >= r.introduced_date:
                passage_spans.append((r.final_date - r.introduced_date).days)
        elif st in ("failed", "vetoed", "withdrawn", "tabled"):
            failed_vetoed += 1
        elif st in ("introduced", "in_committee"):
            yr = r.introduced_date.year if r.introduced_date else now_year
            if yr < current_term:
                died += 1
            else:
                active += 1

        if r.tags:
            try:
                tags = json.loads(r.tags) if r.tags.startswith("[") else [t.strip() for t in r.tags.split(",")]
                for t in tags:
                    if t and t.strip():
                        tag_counter[t.strip()] += 1
            except Exception:
                pass
        type_counter[r.bill_type or "unknown"] += 1
        if r.impact_level:
            impact_levels[r.impact_level] += 1
        if r.impact_score is not None:
            impact_scores.append(r.impact_score)
        if r.committee:
            committee_counter[r.committee] += 1

    closed = signed + failed_vetoed + died

    # Official roll-call voting behaviour (linked by councilmember_id).
    votes = (
        db.query(BillVoteRecord.vote, func.count(BillVoteRecord.id))
        .filter(BillVoteRecord.councilmember_id == member_id)
        .group_by(BillVoteRecord.vote)
        .all()
    )
    vcount = {v: int(n) for v, n in votes}
    total_votes = sum(vcount.values())
    absent = vcount.get("Absent", 0)
    nays = vcount.get("Nays", 0) + vcount.get("Nay", 0)
    present = total_votes - absent

    # The specific bills this member voted No on, with the chamber split for
    # context (e.g. "passed 14-3 over their objection"). Council is ~94%
    # unanimous, so these are the votes that actually distinguish a member.
    dissent_bills = _member_dissent_bills(db, member_id)

    return {
        "outcomes": {
            "total": total,
            "signed": signed,
            "failed_vetoed": failed_vetoed,
            "died_in_committee": died,
            "active": active,
            "pass_rate": round(signed / closed, 3) if closed else None,
        },
        "top_tags": [{"tag": t, "count": n} for t, n in tag_counter.most_common(8)],
        "bill_types": dict(type_counter),
        "impact": {
            "levels": dict(impact_levels),
            "avg_score": round(statistics.mean(impact_scores), 1) if impact_scores else None,
        },
        "committees": [{"committee": c, "count": n} for c, n in committee_counter.most_common(6)],
        "median_days_to_passage": round(statistics.median(passage_spans)) if passage_spans else None,
        "voting": {
            "total_votes": total_votes,
            "absent": absent,
            "dissents": nays,
            "attendance_rate": round(present / total_votes, 3) if total_votes else None,
            "dissent_bills": dissent_bills,
        },
    }


def _member_dissent_bills(db: Session, member_id: str) -> list[dict]:
    """Bills this member voted Nay on, newest first, with the chamber vote split."""
    nay_rows = (
        db.query(BillVoteRecord.legislation_id, BillVoteRecord.action_date)
        .filter(
            BillVoteRecord.councilmember_id == member_id,
            BillVoteRecord.vote.in_(["Nays", "Nay"]),
        )
        .all()
    )
    if not nay_rows:
        return []

    lids = [r[0] for r in nay_rows]
    date_by_lid = {lid: d for lid, d in nay_rows}

    tallies = (
        db.query(
            BillVoteRecord.legislation_id,
            func.sum(case((BillVoteRecord.vote == "Yea", 1), else_=0)),
            func.sum(case((BillVoteRecord.vote.in_(["Nays", "Nay"]), 1), else_=0)),
        )
        .filter(BillVoteRecord.legislation_id.in_(lids))
        .group_by(BillVoteRecord.legislation_id)
        .all()
    )
    tally_by_lid = {lid: (int(y or 0), int(n or 0)) for lid, y, n in tallies}

    bills = (
        db.query(
            Legislation.id,
            Legislation.bill_number,
            Legislation.plain_title,
            Legislation.headline,
            Legislation.title,
            Legislation.status,
        )
        .filter(Legislation.id.in_(lids))
        .all()
    )

    out = []
    for b in bills:
        yeas, bill_nays = tally_by_lid.get(b.id, (0, 0))
        d = date_by_lid.get(b.id)
        out.append({
            "id": b.id,
            "bill_number": b.bill_number,
            "title": b.plain_title or b.headline or b.title,
            "status": b.status,
            "action_date": d.isoformat() if d else None,
            "yeas": yeas,
            "nays": bill_nays,
        })
    out.sort(key=lambda x: x["action_date"] or "", reverse=True)
    return out


async def scrape_and_upsert_councilmembers(db: Session) -> list[Councilmember]:
    """Scrape all 17 current council member profiles and upsert into DB."""
    from playwright.async_api import async_playwright

    results = []
    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=True)
        page = await browser.new_page()

        for url, label in CURRENT_MEMBER_SLUGS:
            parsed = _parse_label(label)
            logger.info(f"Scraping {parsed['name']} ({url})")

            try:
                profile = await _scrape_profile(page, url)
            except Exception as e:
                logger.warning(f"Failed to scrape {url}: {e}")
                profile = {"profile_url": url, "photo_url": None, "bio": None, "email": None, "phone": None}

            # Upsert by profile_url slug
            slug = url.rstrip("/").split("/")[-1]
            member_id = f"cm_{slug}"

            bills_count, bills_passed = _sponsored_counts(db, parsed["name"], KNOWN_TERM_START.get(slug))

            existing = db.query(Councilmember).filter(Councilmember.id == member_id).first()
            if existing:
                cm = existing
            else:
                cm = Councilmember(id=member_id)
                db.add(cm)

            cm.name = parsed["name"]
            cm.district = parsed["district"]
            cm.party = KNOWN_PARTY.get(slug, "Democratic")
            cm.email = profile["email"]
            cm.phone = profile["phone"]
            cm.photo_url = profile.get("photo_url")
            cm.bio = profile.get("bio")
            cm.profile_url = profile["profile_url"]
            cm.bills_sponsored = bills_count
            cm.bills_passed = bills_passed
            cm.term_start = _extract_term_start(profile.get("bio"), slug)
            cm.updated_at = datetime.utcnow()

            db.commit()
            db.refresh(cm)
            results.append(cm)
            logger.info(f"  Upserted {cm.name} — district={cm.district}, bills_sponsored={cm.bills_sponsored}")

        await browser.close()

    return results


async def backfill_missing_emails(db: Session) -> dict:
    """Scrape email only for council members where email IS NULL."""
    from playwright.async_api import async_playwright

    missing = db.query(Councilmember).filter(Councilmember.email.is_(None)).all()
    if not missing:
        return {"checked": 0, "updated": 0, "still_missing": []}

    updated = []
    still_missing = []

    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=True)
        page = await browser.new_page()

        for member in missing:
            if not member.profile_url:
                still_missing.append(member.name)
                continue
            try:
                await page.goto(member.profile_url, wait_until="networkidle", timeout=30000)
                email_link = await page.query_selector("a[href^='mailto:']")
                if email_link:
                    href = await email_link.get_attribute("href") or ""
                    email = href.replace("mailto:", "").strip()
                    if email:
                        member.email = email
                        member.updated_at = datetime.utcnow()
                        db.commit()
                        updated.append(member.name)
                        logger.info(f"  Backfilled email for {member.name}: {email}")
                        continue
            except Exception as e:
                logger.warning(f"Failed email scrape for {member.name}: {e}")
            still_missing.append(member.name)

        await browser.close()

    return {"checked": len(missing), "updated": len(updated), "still_missing": still_missing}


def get_all_councilmembers(db: Session) -> list[Councilmember]:
    return db.query(Councilmember).order_by(Councilmember.district, Councilmember.name).all()


def get_councilmember(db: Session, member_id: str) -> Optional[Councilmember]:
    return db.query(Councilmember).filter(Councilmember.id == member_id).first()


def _apply_outcome_filter(query, outcome: str):
    """Narrow a sponsored-bill query to one outcome bucket (matches the
    legislative-profile counts, incl. the died-in-committee term rule)."""
    from datetime import datetime
    current_term = (lambda y: y - (y % 4))(datetime.utcnow().year)
    if outcome == "signed":
        return query.filter(Legislation.status == "signed_into_law")
    if outcome == "failed":
        return query.filter(Legislation.status.in_(["failed", "vetoed", "withdrawn", "tabled"]))
    if outcome == "active":
        return query.filter(
            Legislation.status.in_(["introduced", "in_committee"]),
            extract("year", Legislation.introduced_date) >= current_term,
        )
    if outcome == "died":
        return query.filter(
            Legislation.status.in_(["introduced", "in_committee"]),
            extract("year", Legislation.introduced_date) < current_term,
        )
    return query


def get_councilmember_bills(db: Session, member_name: str, term_start: int | None = None,
                            outcome: str | None = None, limit: int = 20, offset: int = 0):
    """Return (bills, total) sponsored by this council member, optionally
    narrowed to one outcome bucket (signed / active / died / failed).

    Uses the same surname + term-scoped filter as the cached bills_sponsored /
    bills_passed counts, so the live page and the stored counts always agree.
    """
    query = _sponsored_filter(db.query(Legislation), member_name, term_start)
    if outcome:
        query = _apply_outcome_filter(query, outcome)
    query = query.order_by(Legislation.introduced_date.desc())
    total = query.count()
    bills = query.offset(offset).limit(limit).all()
    return bills, total

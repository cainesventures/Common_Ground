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

from sqlalchemy import func, case
from sqlalchemy.orm import Session

from app.models import Councilmember, Legislation

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


_NAME_SUFFIXES = {"jr", "sr", "ii", "iii", "iv"}


def _member_last_name(member_name: str) -> str:
    """Surname for sponsor matching — drops generational suffixes so
    'Curtis Jones, Jr.' yields 'Jones', not 'Jr.'."""
    parts = [p for p in member_name.replace(",", " ").split() if p.rstrip(".").lower() not in _NAME_SUFFIXES]
    return parts[-1] if parts else member_name


def _sponsored_counts(db: Session, member_name: str, term_start: int | None) -> tuple[int, int]:
    """(bills_sponsored, bills_passed) for this member.

    Sponsor strings are titles + surname ("Councilmember Jones"), so matching
    is by surname, scoped to the member's time in office to avoid counting an
    earlier member with the same surname.
    """
    from sqlalchemy import extract
    last_name = _member_last_name(member_name)
    q = db.query(
        func.count(Legislation.id),
        func.sum(case((Legislation.status == "signed_into_law", 1), else_=0)),
    ).filter(Legislation.sponsor.ilike(f"%{last_name}%"))
    if term_start:
        q = q.filter(extract("year", Legislation.introduced_date) >= term_start)
    total, passed = q.first()
    return int(total or 0), int(passed or 0)


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


def get_councilmember_bills(db: Session, member_name: str, limit: int = 20, offset: int = 0):
    """Return bills sponsored by this council member."""
    last_name = member_name.split()[-1]
    query = (
        db.query(Legislation)
        .filter(Legislation.sponsor.ilike(f"%{last_name}%"))
        .order_by(Legislation.introduced_date.desc())
    )
    total = query.count()
    bills = query.offset(offset).limit(limit).all()
    return bills, total

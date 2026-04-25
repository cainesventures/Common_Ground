"""
Shared library for Common Ground background workers.

Imported by worker_fast.py and worker_perspectives.py.
Do not run directly.
"""

import sys
import os
import json
import logging
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))
os.chdir(ROOT)

MAX_RETRIES = 3
PERSPECTIVES_TARGET = 17
ACTIVE_STATUSES = {"introduced", "in_committee"}
LEGISTAR_PREFIX = "legistar_phila_"

ALL_STEPS = ["text", "analyze", "headline", "metadata", "perspectives", "news", "votes"]


def setup_logging(log_name: str) -> logging.Logger:
    LOG_DIR = ROOT / "logs"
    LOG_DIR.mkdir(exist_ok=True)
    log_file = LOG_DIR / f"{log_name}.log"

    stream_handler = logging.StreamHandler(sys.stdout)
    try:
        stream_handler.stream = open(
            sys.stdout.fileno(), mode="w", encoding="utf-8", buffering=1, closefd=False
        )
    except Exception:
        pass

    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s [%(levelname)s] %(message)s",
        handlers=[
            logging.FileHandler(log_file, encoding="utf-8"),
            stream_handler,
        ],
    )
    for noisy in ("sqlalchemy.engine", "sqlalchemy.pool", "sqlalchemy.dialects"):
        logging.getLogger(noisy).setLevel(logging.WARNING)
        logging.getLogger(noisy).propagate = False

    return logging.getLogger(log_name)


def run_worker(
    log: logging.Logger,
    allowed_steps: list[str],
    batch: int,
    parallel: int,
    dry_run: bool = False,
    year: int = 0,
    progress_key: str = "worker",
):
    from dotenv import load_dotenv
    load_dotenv(ROOT / ".env")

    import logging as _logging
    _logging.getLogger("sqlalchemy").setLevel(_logging.WARNING)

    from app.models.database import SessionLocal
    from app.models import Legislation
    from sqlalchemy import extract

    log.info("=" * 60)
    log.info(
        f"Worker starting — steps={allowed_steps} batch={batch} parallel={parallel} dry_run={dry_run}"
        + (f" year={year}" if year else "")
    )

    db = SessionLocal()
    try:
        q = db.query(Legislation.id).filter(Legislation.skip_reason.is_(None))
        if year:
            q = q.filter(extract("year", Legislation.introduced_date) == year)
        bill_ids = [
            row[0] for row in q.order_by(
                extract("year", Legislation.introduced_date).desc().nullslast(),
                Legislation.introduced_date.desc().nullslast(),
            ).limit(batch * 2).all()
        ]
    finally:
        db.close()

    log.info(f"Candidate pool: {len(bill_ids)} bill IDs")

    # Hearings refresh is a one-shot global operation — runs once per worker invocation
    if "hearings" in allowed_steps and not dry_run:
        try:
            from app.services.hearing_service import refresh_upcoming_hearings
            db_h = SessionLocal()
            try:
                result = refresh_upcoming_hearings(db_h)
                log.info(f"Hearings refreshed — meetings={result['meetings_scraped']} bills_matched={result['bills_matched']}")
            finally:
                db_h.close()
        except Exception as e:
            log.error(f"Hearings refresh failed: {e}", exc_info=True)

    processed = skipped = errors = 0

    def process_one(bill_id: str) -> str:
        thread_db = SessionLocal()
        try:
            bill = thread_db.query(Legislation).filter(Legislation.id == bill_id).first()
            if not bill or bill.skip_reason:
                return "complete"
            return process_bill(bill, thread_db, dry_run, allowed_steps, log)
        except Exception as e:
            log.error(f"Thread error for {bill_id}: {e}", exc_info=True)
            return "error"
        finally:
            thread_db.close()

    completed_count = 0
    with ThreadPoolExecutor(max_workers=parallel) as executor:
        futures = {}
        for bill_id in bill_ids:
            if completed_count >= batch:
                break
            futures[executor.submit(process_one, bill_id)] = bill_id

        for future in as_completed(futures):
            result = future.result()
            if result in ("processed", "skipped", "error"):
                completed_count += 1
            if result == "processed":
                processed += 1
            elif result == "skipped":
                skipped += 1
            elif result == "error":
                errors += 1

    log.info(f"Worker done — processed={processed} skipped={skipped} errors={errors}")
    _write_progress(log, processed, skipped, errors, progress_key)


def process_bill(
    bill, db, dry_run: bool, allowed_steps: list[str], log: logging.Logger
) -> str:
    label = f"[{bill.bill_number or bill.id}]"
    is_legistar = bill.id.startswith(LEGISTAR_PREFIX)

    def steps_needed():
        needs_text = not bill.full_text
        needs_analyze = bool(bill.full_text) and not bill.analyzed_at
        needs_headline = bool(bill.analyzed_at) and (not bill.headline or not bill.lede)
        needs_metadata = is_legistar and not bill.metadata_fetched_at
        needs_perspectives = (
            bool(bill.analyzed_at)
            and _perspective_count(bill, db) < _relevant_perspective_count(bill)
        )
        needs_news = (
            bool(bill.analyzed_at)
            and not bill.news_fetched_at
            and bill.status in ACTIVE_STATUSES
        )
        needs_votes = is_legistar and not bill.votes_fetched_at and bool(bill.external_url)

        step_flags = {
            "text": needs_text,
            "analyze": needs_analyze,
            "headline": needs_headline,
            "metadata": needs_metadata,
            "perspectives": needs_perspectives,
            "news": needs_news,
            "votes": needs_votes,
        }
        return [s for s in ALL_STEPS if s in allowed_steps and step_flags.get(s)]

    initial = steps_needed()
    if not initial:
        return "complete"

    if dry_run:
        log.info(f"DRY-RUN {label} would run steps={initial}")
        return "processed"

    any_done = False
    while True:
        remaining = steps_needed()
        if not remaining:
            break
        step = remaining[0]
        log.info(f"{label} step={step}")
        try:
            if step == "text":
                result = _step_text(bill, db, label, log)
            elif step == "analyze":
                result = _step_analyze(bill, db, label, log)
            elif step == "headline":
                result = _step_headline(bill, db, label, log)
            elif step == "metadata":
                result = _step_metadata(bill, db, label, log)
            elif step == "perspectives":
                result = _step_perspectives(bill, db, label, log)
            elif step == "news":
                result = _step_news(bill, db, label, log)
            elif step == "votes":
                result = _step_votes(bill, db, label, log)
            else:
                break

            if result in ("processed", "complete"):
                any_done = True
            elif result in ("skipped", "error"):
                break
        except Exception as e:
            log.error(f"{label} step={step} unhandled error: {e}", exc_info=True)
            _increment_retries(bill, db, step)
            return "error"

    return "processed" if any_done else "skipped"


# ── Steps ─────────────────────────────────────────────────────────────────────

def _step_text(bill, db, label: str, log) -> str:
    if not bill.id.startswith(LEGISTAR_PREFIX):
        _set_skip(bill, db, "no_scraper_for_source")
        log.warning(f"{label} skip — no scraper for source={bill.source}")
        return "skipped"

    matter_id = bill.id.split(LEGISTAR_PREFIX, 1)[-1]
    guid = _guid_from_url(bill.external_url)

    if not guid:
        retries = (bill.worker_retries or 0) + 1
        bill.worker_retries = retries
        if retries >= MAX_RETRIES:
            _set_skip(bill, db, f"no_guid_after_{retries}_attempts")
            log.warning(f"{label} skip — no GUID after {retries} attempts")
            return "skipped"
        log.warning(f"{label} no GUID (attempt {retries}/{MAX_RETRIES})")
        return "error"

    from app.integrations.legistar_scraper import PhilaLegistarScraper
    scraper = PhilaLegistarScraper(headless=True)
    detail = scraper.scrape_detail(matter_id, guid)
    if not detail:
        return _retry_or_skip(bill, db, label, "legistar_detail_scrape_failed", log)

    full_text = scraper.fetch_full_text(matter_id, guid)
    parsed = scraper._parse_detail(detail, matter_id, guid, full_text)

    if parsed.get("full_text"):
        bill.full_text = parsed["full_text"]
    if parsed.get("title") and not bill.title:
        bill.title = parsed["title"]
    if parsed.get("sponsor") and not bill.sponsor:
        bill.sponsor = parsed["sponsor"]
    if parsed.get("committee") and not bill.committee:
        bill.committee = parsed["committee"]
    if parsed.get("co_sponsors"):
        bill.co_sponsors = parsed["co_sponsors"]
    bill.metadata_fetched_at = datetime.utcnow()

    if not bill.full_text:
        return _retry_or_skip(bill, db, label, "no_full_text_on_legistar", log)

    log.info(f"{label} full_text fetched ({len(bill.full_text)} chars)")
    bill.worker_retries = 0
    db.commit()
    return "processed"


def _step_analyze(bill, db, label: str, log) -> str:
    from app.services.bill_research_service import analyze_bill
    result = analyze_bill(bill, db)
    if not result:
        return _retry_or_skip(bill, db, label, "analyze_returned_empty", log)

    bill.analyzed_at = datetime.utcnow()
    try:
        _run_headline(bill, db, label, log)
    except Exception as e:
        log.warning(f"{label} headline failed after analyze: {e}")

    db.commit()
    log.info(f"{label} analyzed — impact={bill.impact_level} type={bill.bill_type}")
    return "processed"


def _step_headline(bill, db, label: str, log) -> str:
    _run_headline(bill, db, label, log)
    db.commit()
    return "processed"


def _run_headline(bill, db, label: str, log):
    from app.services.legislation_service import _ai_headline, _ai_lede
    from app.services.ai_provider import get_ai_provider
    provider = get_ai_provider()
    bill.headline = _ai_headline(bill, provider)
    bill.lede = _ai_lede(bill, provider)
    log.info(f"{label} headline generated")


def _step_metadata(bill, db, label: str, log) -> str:
    if not bill.id.startswith(LEGISTAR_PREFIX):
        bill.metadata_fetched_at = datetime.utcnow()
        db.commit()
        return "skipped"

    matter_id = bill.id.split(LEGISTAR_PREFIX, 1)[-1]
    guid = _guid_from_url(bill.external_url)

    if not guid:
        bill.metadata_fetched_at = datetime.utcnow()
        db.commit()
        log.warning(f"{label} metadata — no GUID, stamped metadata_fetched_at")
        return "skipped"

    from app.integrations.legistar_scraper import PhilaLegistarScraper, _parse_date
    import json as _json
    scraper = PhilaLegistarScraper(headless=True)
    detail = scraper.scrape_detail(matter_id, guid)

    if detail:
        if detail.get("committee") and not bill.committee:
            bill.committee = detail["committee"]
        if detail.get("final_date") and not bill.final_date:
            bill.final_date = _parse_date(detail["final_date"])
        sponsors_raw = detail.get("sponsors", "") or ""
        slist = [s.strip() for s in sponsors_raw.split(",") if s.strip()]
        if slist and not bill.sponsor:
            bill.sponsor = slist[0]
        if len(slist) > 1 and not bill.co_sponsors:
            bill.co_sponsors = _json.dumps(slist[1:])
        # Sync status from Legistar — keeps signed/failed/vetoed bills current
        new_status = detail.get("status")
        if new_status and new_status != bill.status:
            log.info(f"{label} status updated {bill.status!r} -> {new_status!r}")
            bill.status = new_status

    bill.metadata_fetched_at = datetime.utcnow()
    db.commit()
    log.info(f"{label} metadata fetched — committee={bill.committee or 'none'} status={bill.status}")
    return "processed"


def _step_perspectives(bill, db, label: str, log) -> str:
    from app.services.perspectives_service import generate_perspective, get_relevant_perspectives
    relevant = get_relevant_perspectives(bill)
    existing = {p.perspective_type for p in bill.perspectives}
    missing_types = [p for p in relevant if p not in existing]

    if not missing_types:
        log.info(f"{label} perspectives complete ({len(existing)}/{len(relevant)})")
        return "complete"

    generated = 0
    for ptype in missing_types:
        try:
            result = generate_perspective(bill, ptype, db)
            if result:
                generated += 1
            else:
                log.warning(f"{label} perspective {ptype} returned None")
        except Exception as e:
            log.warning(f"{label} perspective {ptype} failed: {e}")

    db.commit()
    total = _perspective_count(bill, db)
    log.info(f"{label} perspectives +{generated} = {total}/{len(relevant)}")
    return "processed" if generated > 0 else "error"


def _step_news(bill, db, label: str, log) -> str:
    from app.services.news_service import fetch_and_store_news
    articles = fetch_and_store_news(bill, db)
    bill.news_fetched_at = datetime.utcnow()
    db.commit()
    log.info(f"{label} news fetched — {len(articles)} articles")
    return "processed"


def _step_votes(bill, db, label: str, log) -> str:
    from app.integrations.legistar_scraper import PhilaLegistarScraper
    from app.models import BillVoteRecord, Councilmember
    import uuid as _uuid

    scraper = PhilaLegistarScraper(headless=True)
    raw_votes = scraper.scrape_vote_history(bill.external_url)

    bill.votes_fetched_at = datetime.utcnow()

    if not raw_votes:
        db.commit()
        log.info(f"{label} votes — no vote records found")
        return "processed"

    councilmembers = db.query(Councilmember).all()
    name_map = {cm.name.split()[-1].lower(): cm for cm in councilmembers}

    VOTE_NORMALIZE = {
        "ayes": "Yea", "aye": "Yea", "yes": "Yea", "yea": "Yea",
        "noes": "Nay", "nay": "Nay", "no": "Nay",
        "abstain": "Abstain", "abstained": "Abstain",
        "absent": "Absent",
    }

    upserted = 0
    for v in raw_votes:
        voter_name = v["voter_name"]
        last_name = voter_name.split()[-1].strip().lower() if voter_name else ""
        cm = name_map.get(last_name)
        normalized_vote = VOTE_NORMALIZE.get((v.get("vote") or "").lower(), v.get("vote", ""))

        action_date = None
        if v.get("action_date"):
            try:
                action_date = datetime.fromisoformat(v["action_date"].rstrip("Z"))
            except (ValueError, AttributeError):
                pass

        existing = db.query(BillVoteRecord).filter(
            BillVoteRecord.legislation_id == bill.id,
            BillVoteRecord.voter_name == voter_name,
        ).first()

        if existing:
            existing.vote = normalized_vote
            existing.councilmember_id = cm.id if cm else None
            existing.action_date = action_date
            existing.result = v.get("result")
        else:
            db.add(BillVoteRecord(
                id=f"bvr_{_uuid.uuid4().hex[:12]}",
                legislation_id=bill.id,
                councilmember_id=cm.id if cm else None,
                voter_name=voter_name,
                vote=normalized_vote,
                action_date=action_date,
                result=v.get("result"),
            ))
        upserted += 1

    db.commit()
    log.info(f"{label} votes upserted={upserted}")
    return "processed"


# ── Helpers ───────────────────────────────────────────────────────────────────

def _guid_from_url(external_url) -> str:
    if not external_url:
        return ""
    import re
    m = re.search(r"GUID=([A-F0-9\-]{36})", external_url, re.IGNORECASE)
    return m.group(1) if m else ""


def _perspective_count(bill, db) -> int:
    from app.models import BillPerspective
    return db.query(BillPerspective).filter(BillPerspective.bill_id == bill.id).count()


def _relevant_perspective_count(bill) -> int:
    try:
        from app.services.perspectives_service import get_relevant_perspectives
        return len(get_relevant_perspectives(bill))
    except Exception:
        return PERSPECTIVES_TARGET


def _retry_or_skip(bill, db, label: str, reason: str, log) -> str:
    retries = (bill.worker_retries or 0) + 1
    bill.worker_retries = retries
    if retries >= MAX_RETRIES:
        _set_skip(bill, db, f"{reason}_after_{retries}_attempts")
        log.warning(f"{label} permanently skipped — {reason} after {retries} attempts")
        return "skipped"
    log.warning(f"{label} failed ({reason}), attempt {retries}/{MAX_RETRIES}")
    db.commit()
    return "error"


def _set_skip(bill, db, reason: str):
    bill.skip_reason = reason
    db.commit()


def _increment_retries(bill, db, step: str):
    retries = (bill.worker_retries or 0) + 1
    bill.worker_retries = retries
    if retries >= MAX_RETRIES:
        bill.skip_reason = f"{step}_failed_after_{retries}_attempts"
    db.commit()


def _write_progress(log, processed: int, skipped: int, errors: int, progress_key: str):
    LOG_DIR = ROOT / "logs"
    progress_file = LOG_DIR / f"{progress_key}_progress.json"
    existing = {}
    if progress_file.exists():
        try:
            existing = json.loads(progress_file.read_text(encoding="utf-8"))
        except Exception:
            pass

    progress_file.write_text(
        json.dumps({
            "last_run": datetime.utcnow().isoformat(),
            "runs": existing.get("runs", 0) + 1,
            "total_processed": existing.get("total_processed", 0) + processed,
            "total_skipped": existing.get("total_skipped", 0) + skipped,
            "total_errors": existing.get("total_errors", 0) + errors,
        }, indent=2),
        encoding="utf-8",
    )

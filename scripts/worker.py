"""
Background worker — processes bills through the full enrichment pipeline.

Run by Windows Task Scheduler every 30 minutes. Processes BATCH_SIZE bills
per run then exits. Gracefully handles sleep/wake cycles — missed runs are
harmless.

Priority order: 2026 → 2025 → 2024 → 2023 → 2022
Steps per bill: full_text → analyze → headline → metadata → perspectives → news

Bills that repeatedly fail get a skip_reason stamp and are skipped in future
runs. No bill is re-processed if already complete.

Usage:
    python scripts/worker.py              # normal run
    python scripts/worker.py --dry-run   # show what would be processed, no changes
    python scripts/worker.py --batch 10  # override batch size
"""

import sys
import os
import json
import logging
import argparse
from datetime import datetime
from pathlib import Path

# ── Path setup ────────────────────────────────────────────────────────────────
ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

os.chdir(ROOT)  # ensure relative paths (e.g. .env) resolve correctly

# ── Logging ───────────────────────────────────────────────────────────────────
LOG_DIR = ROOT / "logs"
LOG_DIR.mkdir(exist_ok=True)
LOG_FILE = LOG_DIR / "worker.log"

_stream_handler = logging.StreamHandler(sys.stdout)
_stream_handler.stream = open(sys.stdout.fileno(), mode="w", encoding="utf-8", buffering=1, closefd=False) if hasattr(sys.stdout, "fileno") else sys.stdout
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    handlers=[
        logging.FileHandler(LOG_FILE, encoding="utf-8"),
        _stream_handler,
    ],
)
log = logging.getLogger("worker")
# Suppress SQLAlchemy query noise
for _noisy in ("sqlalchemy.engine", "sqlalchemy.pool", "sqlalchemy.dialects"):
    logging.getLogger(_noisy).setLevel(logging.WARNING)
    logging.getLogger(_noisy).propagate = False

# ── Config ────────────────────────────────────────────────────────────────────
DEFAULT_BATCH_SIZE = 20
MAX_RETRIES = 3          # give up on full_text fetch after this many failures
PERSPECTIVES_TARGET = 17 # upper bound — actual target is get_relevant_perspectives(bill)

ACTIVE_STATUSES = {"introduced", "in_committee"}
ALL_STATUSES = {"introduced", "in_committee", "signed_into_law", "failed", "vetoed", "passed_chamber", "passed_both"}

# Steps that apply only to Legistar (local) bills
LEGISTAR_PREFIX = "legistar_phila_"


def main():
    parser = argparse.ArgumentParser(description="Common Ground background worker")
    parser.add_argument("--dry-run", action="store_true", help="Show what would run without making changes")
    parser.add_argument("--batch", type=int, default=DEFAULT_BATCH_SIZE, help="Bills to process per run")
    parser.add_argument("--year", type=int, default=0, help="Restrict to a specific year (0 = all)")
    parser.add_argument("--step", choices=["text", "analyze", "headline", "metadata", "perspectives", "news"], help="Run only one step")
    args = parser.parse_args()

    log.info("=" * 60)
    log.info(f"Worker starting — batch={args.batch} dry_run={args.dry_run}" + (f" year={args.year}" if args.year else "") + (f" step={args.step}" if args.step else ""))

    from dotenv import load_dotenv
    load_dotenv(ROOT / ".env")

    # Suppress SQLAlchemy query noise before importing ORM
    import logging as _logging
    _logging.getLogger("sqlalchemy").setLevel(_logging.WARNING)

    from app.models.database import SessionLocal
    from app.models import Legislation, BillPerspective
    from sqlalchemy import extract, or_, and_

    db = SessionLocal()
    processed = 0
    skipped = 0
    errors = 0

    try:
        # ── Build candidate query ──────────────────────────────────────────
        # All bills that have work remaining and no permanent skip
        q = db.query(Legislation).filter(Legislation.skip_reason.is_(None))

        if args.year:
            q = q.filter(extract("year", Legislation.introduced_date) == args.year)

        # Order: newest year first (2026→2022), then by introduced_date
        bills = (
            q.order_by(
                extract("year", Legislation.introduced_date).desc().nullslast(),
                Legislation.introduced_date.desc().nullslast(),
            )
            .all()
        )

        log.info(f"Candidate pool: {len(bills)} bills (skip_reason=None)")

        for bill in bills:
            if processed >= args.batch:
                break

            result = process_bill(bill, db, args.dry_run, args.step)
            if result == "processed":
                processed += 1
            elif result == "skipped":
                skipped += 1
            elif result == "error":
                errors += 1
            # "complete" means nothing to do — just move on without counting

        db.commit()

    except Exception as e:
        log.error(f"Worker crashed: {e}", exc_info=True)
        db.rollback()
    finally:
        db.close()

    log.info(f"Worker done — processed={processed} skipped={skipped} errors={errors}")
    _write_progress(processed, skipped, errors)


def process_bill(bill, db, dry_run: bool, only_step: str | None) -> str:
    """
    Run ALL needed steps for a bill until it is fully complete.
    Each call to process_bill completes one bill entirely.
    Returns: "processed" | "skipped" | "complete" | "error"
    """
    label = f"[{bill.bill_number or bill.id}]"
    is_legistar = bill.id.startswith(LEGISTAR_PREFIX)

    def steps_needed():
        needs_text         = not bill.full_text
        needs_analyze      = bool(bill.full_text) and not bill.analyzed_at
        needs_headline     = bool(bill.analyzed_at) and (not bill.headline or not bill.lede)
        needs_metadata     = is_legistar and not bill.metadata_fetched_at
        needs_perspectives = (
            bool(bill.analyzed_at) and
            _perspective_count(bill, db) < _relevant_perspective_count(bill)
        )
        needs_news = bool(bill.analyzed_at) and not bill.news_fetched_at and bill.status in ACTIVE_STATUSES

        steps = []
        if not only_step or only_step == "text":
            if needs_text:          steps.append("text")
        if not only_step or only_step == "analyze":
            if needs_analyze:       steps.append("analyze")
        if not only_step or only_step == "headline":
            if needs_headline:      steps.append("headline")
        if not only_step or only_step == "metadata":
            if needs_metadata:      steps.append("metadata")
        if not only_step or only_step == "perspectives":
            if needs_perspectives:  steps.append("perspectives")
        if not only_step or only_step == "news":
            if needs_news:          steps.append("news")
        return steps

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
                result = _step_text(bill, db, label)
            elif step == "analyze":
                result = _step_analyze(bill, db, label)
            elif step == "headline":
                result = _step_headline(bill, db, label)
            elif step == "metadata":
                result = _step_metadata(bill, db, label)
            elif step == "perspectives":
                result = _step_perspectives(bill, db, label)
            elif step == "news":
                result = _step_news(bill, db, label)
            else:
                break

            if result in ("processed", "complete"):
                any_done = True
            elif result in ("skipped", "error"):
                # Can't proceed further on this bill this run
                break
        except Exception as e:
            log.error(f"{label} step={step} unhandled error: {e}", exc_info=True)
            _increment_retries(bill, db, step, str(e))
            return "error"

    return "processed" if any_done else "skipped"


# ── Steps ─────────────────────────────────────────────────────────────────────

def _step_text(bill, db, label: str) -> str:
    if not bill.id.startswith(LEGISTAR_PREFIX):
        # Non-Legistar bills: no scraper available, mark skip
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
            log.warning(f"{label} skip — could not find GUID after {retries} attempts")
            return "skipped"
        log.warning(f"{label} no GUID found (attempt {retries}/{MAX_RETRIES})")
        return "error"

    from app.integrations.legistar_scraper import PhilaLegistarScraper
    scraper = PhilaLegistarScraper(headless=True)

    detail = scraper.scrape_detail(matter_id, guid)
    if not detail:
        return _retry_or_skip(bill, db, label, "legistar_detail_scrape_failed")

    full_text = scraper.fetch_full_text(matter_id, guid)

    if detail:
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
        return _retry_or_skip(bill, db, label, "no_full_text_on_legistar")

    log.info(f"{label} full_text fetched ({len(bill.full_text)} chars)")
    bill.worker_retries = 0
    db.commit()
    return "processed"


def _step_analyze(bill, db, label: str) -> str:
    from app.services.bill_research_service import analyze_bill
    result = analyze_bill(bill, db)
    if not result:
        return _retry_or_skip(bill, db, label, "analyze_returned_empty")

    bill.analyzed_at = datetime.utcnow()

    # Generate headline immediately after analyze
    try:
        _run_headline(bill, db, label)
    except Exception as e:
        log.warning(f"{label} headline failed after analyze: {e}")

    db.commit()
    log.info(f"{label} analyzed — impact={bill.impact_level} type={bill.bill_type}")
    return "processed"


def _step_headline(bill, db, label: str) -> str:
    _run_headline(bill, db, label)
    db.commit()
    return "processed"


def _run_headline(bill, db, label: str):
    from app.services.legislation_service import _ai_headline, _ai_lede
    provider = _get_provider()
    bill.headline = _ai_headline(bill, provider)
    bill.lede = _ai_lede(bill, provider)
    log.info(f"{label} headline generated")


def _step_metadata(bill, db, label: str) -> str:
    if not bill.id.startswith(LEGISTAR_PREFIX):
        bill.metadata_fetched_at = datetime.utcnow()
        db.commit()
        return "skipped"

    matter_id = bill.id.split(LEGISTAR_PREFIX, 1)[-1]
    guid = _guid_from_url(bill.external_url)

    if not guid:
        # Stamp anyway so we don't keep retrying
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

    bill.metadata_fetched_at = datetime.utcnow()
    db.commit()
    log.info(f"{label} metadata fetched — committee={bill.committee or 'none'}")
    return "processed"


def _step_perspectives(bill, db, label: str) -> str:
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


def _step_news(bill, db, label: str) -> str:
    from app.services.news_service import fetch_and_store_news
    articles = fetch_and_store_news(bill, db)
    bill.news_fetched_at = datetime.utcnow()
    db.commit()
    log.info(f"{label} news fetched — {len(articles)} articles")
    return "processed"


# ── Helpers ───────────────────────────────────────────────────────────────────

def _guid_from_url(external_url: str | None) -> str:
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


def _get_provider():
    """Return the AI provider name based on available API keys."""
    if os.getenv("ANTHROPIC_API_KEY"):
        return "anthropic"
    if os.getenv("GEMINI_API_KEY"):
        return "gemini"
    raise RuntimeError("No AI provider API key found in environment")


def _retry_or_skip(bill, db, label: str, reason: str) -> str:
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


def _increment_retries(bill, db, step: str, error: str):
    retries = (bill.worker_retries or 0) + 1
    bill.worker_retries = retries
    if retries >= MAX_RETRIES:
        bill.skip_reason = f"{step}_failed_after_{retries}_attempts"
        log.warning(f"Bill {bill.bill_number} permanently skipped after {retries} retries")
    db.commit()


def _write_progress(processed: int, skipped: int, errors: int):
    progress_file = LOG_DIR / "worker_progress.json"
    existing = {}
    if progress_file.exists():
        try:
            existing = json.loads(progress_file.read_text(encoding="utf-8"))
        except Exception:
            pass

    runs = existing.get("runs", 0) + 1
    total_processed = existing.get("total_processed", 0) + processed
    total_skipped = existing.get("total_skipped", 0) + skipped
    total_errors = existing.get("total_errors", 0) + errors

    progress_file.write_text(
        json.dumps({
            "last_run": datetime.utcnow().isoformat(),
            "runs": runs,
            "total_processed": total_processed,
            "total_skipped": total_skipped,
            "total_errors": total_errors,
        }, indent=2),
        encoding="utf-8",
    )


if __name__ == "__main__":
    main()

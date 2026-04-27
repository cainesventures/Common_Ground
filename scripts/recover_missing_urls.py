"""
Recovery script: fetches real Legistar matter_id/GUID for all bills
by scraping the year-filtered list one year at a time with full pagination.

Runs with headless=False so Legistar shows pagination controls.
A browser window will open on screen — do not close it.

Estimated runtime: ~10-15 min for all years.

Usage:
    python scripts/recover_missing_urls.py --dry-run
    python scripts/recover_missing_urls.py
    python scripts/recover_missing_urls.py --year 2025
"""

import sys
import re
import argparse
import logging
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path
from collections import defaultdict

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

for _n in ("sqlalchemy", "sqlalchemy.engine", "sqlalchemy.pool"):
    logging.getLogger(_n).setLevel(logging.WARNING)
    logging.getLogger(_n).propagate = False

LOG_DIR = ROOT / "logs"
LOG_DIR.mkdir(exist_ok=True)
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    handlers=[
        logging.FileHandler(LOG_DIR / "recover_missing_urls.log", encoding="utf-8"),
        logging.StreamHandler(sys.stdout),
    ]
)
log = logging.getLogger("recover")
BASE_URL = "https://phila.legistar.com"


def scrape_year(page, year: str) -> dict:
    """
    Using an already-open page, filter by Type=Bill + Year=year,
    paginate through all pages, return {file_number: (matter_id, guid)}.
    """
    result = {}

    page.goto(f"{BASE_URL}/Legislation.aspx", wait_until="networkidle", timeout=30000)

    # Type=Bill
    page.click("#ctl00_ContentPlaceHolder1_lstTypeBasic_Arrow")
    page.wait_for_selector(".rcbList li", timeout=5000)
    for item in page.query_selector_all(".rcbList li"):
        if item.inner_text().strip() == "Bill":
            item.click()
            break
    page.wait_for_timeout(300)

    # Year filter
    page.click("#ctl00_ContentPlaceHolder1_lstYears_Arrow")
    page.wait_for_selector(".rcbList li", timeout=5000)
    matched = False
    for item in page.query_selector_all(".rcbList li"):
        if item.inner_text().strip() == year:
            item.click()
            matched = True
            break
    if not matched:
        log.warning(f"Year {year} not in dropdown — skipping")
        return result
    page.wait_for_timeout(300)

    page.click("#visibleSearchButton")
    page.wait_for_selector("tr.rgRow, tr.rgAltRow", timeout=20000)
    page.wait_for_timeout(1000)

    # Click "Show 1000 records" to reduce number of pages
    try:
        for item in page.query_selector_all(".rmText"):
            if item.inner_text().strip() == "Show":
                item.hover()
                page.wait_for_timeout(600)
                break
        page.locator(".rmText", has_text="Show 1000 records").first.click(timeout=5000)
        # Wait for pagination controls to appear
        page.wait_for_selector(".rgNumPart", timeout=10000)
        log.info(f"  Show 1000 clicked — pagination visible")
    except Exception as e:
        log.debug(f"  Show 1000 failed: {e} — using default page size")

    page_num = 1
    while True:
        page.wait_for_selector("tr.rgRow, tr.rgAltRow", timeout=15000)
        rows = page.query_selector_all("tr.rgRow, tr.rgAltRow")
        log.info(f"  Year {year} page {page_num}: {len(rows)} rows")

        for row in rows:
            cells = row.query_selector_all("td")
            if not cells:
                continue
            file_number = cells[0].inner_text().strip()
            if not file_number:
                continue
            link = cells[0].query_selector("a")
            href = link.get_attribute("href") if link else ""
            mid = re.search(r"ID=(\d+)", href or "")
            gid = re.search(r"GUID=([A-F0-9\-]{36})", href or "", re.IGNORECASE)
            if mid:
                result[file_number] = (mid.group(1), gid.group(1) if gid else "")

        # Find next page link — stop if no more pages or we'd revisit one
        page_links = page.query_selector_all(".rgNumPart a")
        next_link = None
        found_current = False
        for pl in page_links:
            cls = pl.get_attribute("class") or ""
            if "rgCurrentPage" in cls:
                found_current = True
                continue
            if found_current:
                span_text = pl.inner_text().strip()
                if span_text.isdigit() and int(span_text) <= page_num:
                    break  # would go backwards — we're on the last page
                next_link = pl
                break

        if not next_link:
            break

        next_link.click()
        page.wait_for_timeout(800)
        page_num += 1

    return result


def scrape_year_worker(year: str) -> dict:
    """Standalone worker for parallel scraping — opens its own browser."""
    from playwright.sync_api import sync_playwright
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=False)
        page = browser.new_page()
        try:
            result = scrape_year(page, year)
        finally:
            browser.close()
    return year, result


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument("--year", type=str, default="")
    parser.add_argument("--parallel-sweep", action="store_true", help="Scrape all missing years in parallel")
    args = parser.parse_args()

    from dotenv import load_dotenv
    load_dotenv(ROOT / ".env")

    from app.models.database import SessionLocal
    from app.models import Legislation
    from playwright.sync_api import sync_playwright

    db = SessionLocal()
    try:
        bills = db.query(Legislation).filter(
            Legislation.source == "legistar",
            Legislation.external_url == None
        ).all()

        by_year = defaultdict(list)
        for bill in bills:
            year = str(bill.introduced_date.year) if bill.introduced_date else "2000"
            by_year[year].append(bill)

        # Only scrape years that have bills still missing
        years = sorted([y for y in by_year.keys() if by_year[y]], reverse=True)
        if args.year:
            years = [args.year] if args.year in by_year else []

        log.info(f"Bills needing recovery: {len(bills)}  Years: {years}")

        total_recovered = total_not_found = total_already_ok = 0
        spillover = {}

        if args.parallel_sweep:
            n_workers = min(25, len(bills))
            log.info(f"Targeted search for {len(bills)} missing bills — {n_workers} parallel browsers")

            bill_ids = [b.id for b in bills]
            batches = [bills[i::n_workers] for i in range(n_workers)]
            counter = [0]
            total = len(bills)
            results = {}  # bill_id -> (matter_id, guid)

            def search_batch(batch):
                from playwright.sync_api import sync_playwright as _spw
                batch_results = {}
                with _spw() as p:
                    browser = p.chromium.launch(headless=False)
                    page = browser.new_page()
                    try:
                        for bill in batch:
                            file_number = (bill.bill_number or "").strip()
                            if not file_number:
                                counter[0] += 1
                                continue
                            try:
                                page.goto(f"{BASE_URL}/Legislation.aspx", wait_until="networkidle", timeout=30000)
                                page.click("#ctl00_ContentPlaceHolder1_lstTypeBasic_Arrow")
                                page.wait_for_selector(".rcbList li", timeout=5000)
                                for item in page.query_selector_all(".rcbList li"):
                                    if item.inner_text().strip() == "Bill":
                                        item.click()
                                        break
                                page.wait_for_timeout(200)
                                page.click("#ctl00_ContentPlaceHolder1_lstYears_Arrow")
                                page.wait_for_selector(".rcbList li", timeout=5000)
                                for item in page.query_selector_all(".rcbList li"):
                                    if item.inner_text().strip() == "All Years":
                                        item.click()
                                        break
                                page.wait_for_timeout(200)
                                if not page.is_checked("#ctl00_ContentPlaceHolder1_chkID"):
                                    page.check("#ctl00_ContentPlaceHolder1_chkID")
                                page.fill("#ctl00_ContentPlaceHolder1_txtSearch", file_number)
                                page.click("#visibleSearchButton")

                                matter_id = guid = None
                                try:
                                    page.wait_for_selector("tr.rgRow, tr.rgAltRow", timeout=10000)
                                    for row in page.query_selector_all("tr.rgRow, tr.rgAltRow"):
                                        cells = row.query_selector_all("td")
                                        if not cells: continue
                                        row_file = cells[0].inner_text().strip()
                                        if row_file != file_number and not row_file.startswith(file_number): continue
                                        link = cells[0].query_selector("a")
                                        href = link.get_attribute("href") if link else ""
                                        mid = re.search(r"ID=(\d+)", href or "")
                                        gid = re.search(r"GUID=([A-F0-9\-]{36})", href or "", re.IGNORECASE)
                                        if mid:
                                            matter_id = mid.group(1)
                                            guid = gid.group(1) if gid else ""
                                        break
                                except Exception:
                                    pass

                                counter[0] += 1
                                if matter_id:
                                    batch_results[bill.id] = (matter_id, guid)
                                    log.info(f"[{counter[0]}/{total}] FOUND {file_number} -> legistar_phila_{matter_id}")
                                else:
                                    log.info(f"[{counter[0]}/{total}] NOT FOUND {file_number}")

                            except Exception as e:
                                counter[0] += 1
                                log.warning(f"Error on {file_number}: {e}")
                    finally:
                        browser.close()
                return batch_results

            with ThreadPoolExecutor(max_workers=n_workers) as executor:
                futures = [executor.submit(search_batch, batch) for batch in batches]
                for future in as_completed(futures):
                    results.update(future.result())

            bill_map = {b.id: b for b in bills}
            for bill_id, (matter_id, guid) in results.items():
                bill = bill_map[bill_id]
                correct_url = (
                    f"{BASE_URL}/LegislationDetail.aspx?ID={matter_id}&GUID={guid}"
                    if guid else f"{BASE_URL}/LegislationDetail.aspx?ID={matter_id}"
                )
                correct_id = f"legistar_phila_{matter_id}"
                if not args.dry_run:
                    bill.external_url = correct_url
                    bill.id = correct_id
                    bill.skip_reason = None
                    bill.worker_retries = 0
                total_recovered += 1

            total_not_found = total - total_recovered
            if not args.dry_run and total_recovered:
                db.commit()

        else:
            spillover = {}
            with sync_playwright() as p:
                browser = p.chromium.launch(headless=False)
                page = browser.new_page()

                try:
                    for year in years:
                        bills_this_year = by_year[year]
                        log.info(f"--- Year {year}: {len(bills_this_year)} bills to recover ---")

                        legistar_map = scrape_year(page, year)
                        log.info(f"  Scraped {len(legistar_map)} bills from Legistar for {year}")

                        prev_year = str(int(year) - 1)
                        if prev_year in spillover:
                            by_year[year] = by_year[year] + spillover.pop(prev_year)

                        recovered = not_found = already_ok = 0
                        spillover[year] = []
                        for bill in bills_this_year:
                            file_number = (bill.bill_number or "").strip()
                            if not file_number or file_number not in legistar_map:
                                not_found += 1
                                spillover[year].append(bill)
                                continue

                            matter_id, guid = legistar_map[file_number]
                            correct_url = (
                                f"{BASE_URL}/LegislationDetail.aspx?ID={matter_id}&GUID={guid}"
                                if guid else f"{BASE_URL}/LegislationDetail.aspx?ID={matter_id}"
                            )
                            correct_id = f"legistar_phila_{matter_id}"

                            if bill.external_url == correct_url and bill.id == correct_id:
                                already_ok += 1
                                continue

                            log.info(f"  {'[DRY] ' if args.dry_run else ''}UPDATE {file_number} -> {correct_id}")
                            if not args.dry_run:
                                bill.external_url = correct_url
                                bill.id = correct_id
                                bill.skip_reason = None
                                bill.worker_retries = 0
                            recovered += 1

                        if not args.dry_run and recovered:
                            db.commit()

                        log.info(f"  Year {year} done — recovered={recovered} not_found={not_found} already_ok={already_ok}")
                        total_recovered += recovered
                        total_not_found += not_found
                        total_already_ok += already_ok

                finally:
                    browser.close()

        log.info(f"=== COMPLETE — recovered={total_recovered} not_found={total_not_found} already_ok={total_already_ok} ===")

    finally:
        db.close()


if __name__ == "__main__":
    main()

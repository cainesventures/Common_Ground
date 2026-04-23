"""Playwright-based scraper for Philadelphia Legistar (phila.legistar.com).

Used when the Legistar REST API is IP-restricted. Navigates the public web
interface using a headless browser to extract legislation data.

Full text is fetched from the "Legislation Details (With Text)" PDF report,
which is publicly accessible at:
  https://phila.legistar.com/ViewReport.ashx?M=R&N=Master&GID=30&ID={matter_id}&GUID={guid}&Extra=WithText
"""

import asyncio
import logging
import re
from datetime import datetime
from typing import Any, Dict, List, Optional

import httpx

logger = logging.getLogger(__name__)

BASE_URL = "https://phila.legistar.com"

STATUS_MAP: Dict[str, str] = {
    "new": "introduced",
    "referred": "in_committee",
    "in committee": "in_committee",
    "adopted": "signed_into_law",
    "approved": "signed_into_law",
    "passed": "signed_into_law",
    "enacted": "signed_into_law",
    "failed": "failed",
    "defeated": "failed",
    "vetoed": "vetoed",
    "tabled": "failed",
    "withdrawn": "failed",
}


def _parse_date(raw: str) -> Optional[datetime]:
    if not raw or raw.strip() in ("", "N/A", "-"):
        return None
    for fmt in ("%m/%d/%Y", "%Y-%m-%dT%H:%M:%S", "%Y-%m-%d"):
        try:
            return datetime.strptime(raw.strip(), fmt)
        except ValueError:
            continue
    return None


def _normalize_status(raw: str) -> str:
    lower = raw.lower().strip()
    for key, val in STATUS_MAP.items():
        if key in lower:
            return val
    return "introduced"


class PhilaLegistarScraper:
    """Scrapes Philadelphia City Council legislation from phila.legistar.com."""

    def __init__(self, headless: bool = True):
        self.headless = headless

    def _apply_filters_and_search(self, page: Any) -> None:
        """Set Type=Bill, Year=All Years, then click Search. Shared by list and export methods."""
        page.click("#ctl00_ContentPlaceHolder1_lstTypeBasic_Arrow")
        page.wait_for_selector(".rcbList li", timeout=5000)
        for item in page.query_selector_all(".rcbList li"):
            if item.inner_text().strip() == "Bill":
                item.click()
                break
        page.wait_for_timeout(300)

        page.click("#ctl00_ContentPlaceHolder1_lstYears_Arrow")
        page.wait_for_selector(".rcbList li", timeout=5000)
        for item in page.query_selector_all(".rcbList li"):
            if item.inner_text().strip() == "All Years":
                item.click()
                break
        page.wait_for_timeout(300)

        page.click("#visibleSearchButton")
        page.wait_for_selector("tr.rgRow, tr.rgAltRow", timeout=20000)

    def export_to_excel(self, save_path: str) -> int:
        """
        Set Bill/All-Years filters, expand to 10000 records, export to Excel,
        save to save_path. Returns number of data rows in the file.

        The exported file is HTML disguised as .xls — parse with _parse_excel_export().
        """
        from playwright.sync_api import sync_playwright

        with sync_playwright() as p:
            browser = p.chromium.launch(headless=self.headless)
            page = browser.new_page()
            try:
                logger.info("Loading Legistar for bulk Excel export ...")
                page.goto(f"{BASE_URL}/Legislation.aspx", wait_until="networkidle", timeout=30000)
                self._apply_filters_and_search(page)
                logger.info("Grid loaded — expanding to Show 10000 records ...")

                # Expand "Show" submenu and click "Show 10000 records"
                try:
                    for item in page.query_selector_all(".rmText"):
                        if item.inner_text().strip() == "Show":
                            item.hover()
                            page.wait_for_timeout(600)
                            break
                    page.locator(".rmText", has_text="Show 10000 records").first.click(timeout=5000)
                    page.wait_for_timeout(8000)
                    page.wait_for_selector("tr.rgRow", timeout=30000)
                    rows_visible = len(page.query_selector_all("tr.rgRow, tr.rgAltRow"))
                    logger.info(f"After Show 10000: {rows_visible} rows visible")
                except Exception as e:
                    logger.warning(f"Could not expand to 10000 rows: {e} — exporting current page")

                # Export to Excel — hover "Export" parent, then click child
                for item in page.query_selector_all(".rmText"):
                    if item.inner_text().strip() == "Export":
                        item.hover()
                        page.wait_for_timeout(600)
                        break

                with page.expect_download(timeout=30000) as dl:
                    page.locator(".rmText", has_text="Export to Excel").first.click(
                        timeout=5000, no_wait_after=True
                    )

                dl.value.save_as(save_path)
                import os
                size = os.path.getsize(save_path)
                logger.info(f"Excel saved: {save_path} ({size} bytes)")
                return self._count_excel_rows(save_path)

            finally:
                browser.close()

    @staticmethod
    def _count_excel_rows(path: str) -> int:
        """Count data rows in an HTML-disguised .xls export."""
        try:
            rows = PhilaLegistarScraper.parse_excel_export(path)
            return len(rows)
        except Exception:
            return 0

    @staticmethod
    def parse_excel_export(path: str) -> List[Dict[str, Any]]:
        """
        Parse an HTML-disguised .xls export from Legistar.
        Returns list of row dicts with keys matching scrape_list() output,
        except matter_id and guid are None (not included in export).
        """
        from html.parser import HTMLParser

        class _TableParser(HTMLParser):
            def __init__(self):
                super().__init__()
                self.rows: List[List[str]] = []
                self._row: List[str] = []
                self._cell = ""
                self._in_cell = False
            def handle_starttag(self, tag, attrs):
                if tag == "tr": self._row = []
                elif tag in ("td", "th"): self._in_cell = True; self._cell = ""
            def handle_endtag(self, tag):
                if tag in ("td", "th"):
                    self._row.append(self._cell.strip())
                    self._in_cell = False
                elif tag == "tr" and self._row:
                    self.rows.append(self._row)
            def handle_data(self, data):
                if self._in_cell: self._cell += data

        with open(path, encoding="utf-8", errors="ignore") as f:
            html = f.read()

        parser = _TableParser()
        parser.feed(html)
        all_rows = [r for r in parser.rows if any(c.strip() for c in r)]
        if not all_rows:
            return []

        # First row is headers
        results = []
        for row in all_rows[1:]:
            if len(row) < 6:
                continue
            results.append({
                "matter_id": None,  # not in export; fetch via detail page link
                "guid": None,
                "file_number": row[0].replace("\xa0", " ").strip(),
                "bill_type": row[1].strip(),
                "status": row[2].strip(),
                "intro_date": row[3].strip(),
                "final_date": row[4].strip(),
                "title_short": row[5].strip(),
            })
        return results

    def scrape_list(
        self,
        limit: int = 100,
        allowed_types: Optional[List[str]] = None,
    ) -> List[Dict[str, Any]]:
        """
        Scrape the legislation list page and return raw row data including matter IDs.

        For bulk ingestion (limit > 100) use export_to_excel() + parse_excel_export() instead,
        then enrich with matter IDs from individual detail page links.

        Args:
            limit: Max number of matching rows to return.
            allowed_types: Bill types to include. Defaults to ["Bill"].

        Returns list of dicts with keys: matter_id, guid, file_number,
        bill_type, status, intro_date, final_date, title_short.
        """
        if allowed_types is None:
            allowed_types = ["Bill"]
        allowed_lower = {t.lower() for t in allowed_types}

        from playwright.sync_api import sync_playwright

        rows: List[Dict[str, Any]] = []

        with sync_playwright() as p:
            browser = p.chromium.launch(headless=self.headless)
            page = browser.new_page()

            try:
                logger.info("Loading phila.legistar.com/Legislation.aspx ...")
                page.goto(f"{BASE_URL}/Legislation.aspx", wait_until="networkidle", timeout=30000)
                self._apply_filters_and_search(page)
                logger.info("Grid loaded")

                bill_rows = page.query_selector_all("tr.rgRow, tr.rgAltRow")
                logger.info(f"Found {len(bill_rows)} total rows on page (filtering to: {allowed_types})")

                for row in bill_rows:
                    if len(rows) >= limit:
                        break
                    try:
                        cells = row.query_selector_all("td")
                        if len(cells) < 6:
                            continue

                        bill_type = cells[1].inner_text().strip()
                        if bill_type.lower() not in allowed_lower:
                            continue

                        # Extract matter ID and GUID from the link in col 0
                        link = cells[0].query_selector("a")
                        href = link.get_attribute("href") if link else ""
                        matter_id_match = re.search(r"ID=(\d+)", href or "")
                        guid_match = re.search(r"GUID=([A-F0-9\-]{36})", href or "", re.IGNORECASE)

                        matter_id = matter_id_match.group(1) if matter_id_match else None
                        guid = guid_match.group(1) if guid_match else None
                        file_number = cells[0].inner_text().strip()

                        rows.append({
                            "matter_id": matter_id,
                            "guid": guid,
                            "file_number": file_number,
                            "bill_type": bill_type,
                            "status": cells[2].inner_text().strip(),
                            "intro_date": cells[3].inner_text().strip(),
                            "final_date": cells[4].inner_text().strip(),
                            "title_short": cells[5].inner_text().strip(),
                        })
                    except Exception as e:
                        logger.warning(f"Error parsing row: {e}")
                        continue

                logger.info(f"Kept {len(rows)} rows after type filter")

            except Exception as e:
                logger.error(f"Error scraping legislation list: {e}")
            finally:
                browser.close()

        return rows

    def fetch_full_text(self, matter_id: str, guid: str) -> Optional[str]:
        """
        Download the "Legislation Details (With Text)" PDF and extract plain text.

        The PDF is publicly accessible without authentication.
        Returns extracted text, or None on failure.
        """
        url = (
            f"{BASE_URL}/ViewReport.ashx?M=R&N=Master&GID=30"
            f"&ID={matter_id}&GUID={guid}&Extra=WithText"
            f"&Title=Legislation+Details+(With+Text)"
        )
        try:
            import fitz  # PyMuPDF
            r = httpx.get(url, follow_redirects=True, timeout=20)
            r.raise_for_status()
            doc = fitz.open(stream=r.content, filetype="pdf")
            text = "\n".join(page.get_text() for page in doc)
            return text.strip() or None
        except ImportError:
            logger.warning("PyMuPDF (fitz) not installed — skipping full text extraction. Run: pip install pymupdf")
            return None
        except Exception as e:
            logger.warning(f"Could not fetch PDF text for matter {matter_id}: {e}")
            return None

    def scrape_detail(self, matter_id: str, guid: str) -> Optional[Dict[str, Any]]:
        """
        Scrape a single bill detail page for full title, sponsors, and description.
        """
        from playwright.sync_api import sync_playwright

        url = f"{BASE_URL}/LegislationDetail.aspx?ID={matter_id}&GUID={guid}"

        with sync_playwright() as p:
            browser = p.chromium.launch(headless=self.headless)
            page = browser.new_page()
            try:
                # Use "load" instead of "networkidle" — detail pages have slow analytics scripts
                page.goto(url, wait_until="load", timeout=30000)
                page.wait_for_selector("#ctl00_ContentPlaceHolder1_lblFile2", timeout=10000)

                def _get(field: str) -> str:
                    el = page.query_selector(f"#ctl00_ContentPlaceHolder1_lbl{field}2")
                    return el.inner_text().strip() if el else ""

                return {
                    "matter_id": matter_id,
                    "file_number": _get("File"),
                    "bill_type": _get("Type"),
                    "status": _get("Status"),
                    "intro_date": _get("Introduced"),
                    "final_date": _get("Passed"),
                    "title": _get("Title"),
                    "sponsors": _get("Sponsors"),
                    "description": _get("Name"),  # "Name" field = short description
                    "committee": _get("ReferredTo"),  # referred-to committee body
                }
            except Exception as e:
                logger.error(f"Error scraping detail for matter {matter_id}: {e}")
                return None
            finally:
                browser.close()

    def scrape_bills(
        self,
        limit: int = 100,
        fetch_details: bool = True,
        allowed_types: Optional[List[str]] = None,
    ) -> List[Dict[str, Any]]:
        """
        Scrape bills from the list page, then enrich with detail page data.

        Args:
            limit: Max number of bills to return (after type filtering).
            fetch_details: If True, visit each detail page for full title + sponsors.
                           If False, use list page data only (faster, less complete).
            allowed_types: Bill types to include. Defaults to ["Bill"].

        Returns:
            List of parsed bill dicts ready for Legislation model.
        """
        list_rows = self.scrape_list(limit=limit, allowed_types=allowed_types)
        logger.info(f"Scraped {len(list_rows)} rows from list page")

        results: List[Dict[str, Any]] = []

        for row in list_rows:
            matter_id = row.get("matter_id")
            guid = row.get("guid")

            if fetch_details and matter_id and guid:
                detail = self.scrape_detail(matter_id, guid)
                if detail:
                    full_text = self.fetch_full_text(matter_id, guid)
                    parsed = self._parse_detail(detail, matter_id, guid, full_text)
                    results.append(parsed)
                    continue

            # Fallback: use list row data only
            parsed = self._parse_row(row)
            results.append(parsed)

        return results

    def fetch_details_for_bill(self, file_number: str) -> Optional[Dict[str, Any]]:
        """
        Look up a bill by file number on the Legistar list page, extract matter_id/guid,
        then fetch detail page + full text PDF.

        Returns a parsed dict (same shape as _parse_detail) or None on failure.
        """
        from playwright.sync_api import sync_playwright

        matter_id = guid = None

        with sync_playwright() as p:
            browser = p.chromium.launch(headless=self.headless)
            page = browser.new_page()
            try:
                page.goto(f"{BASE_URL}/Legislation.aspx", wait_until="networkidle", timeout=30000)
                self._apply_filters_and_search(page)

                for row in page.query_selector_all("tr.rgRow, tr.rgAltRow"):
                    cells = row.query_selector_all("td")
                    if not cells:
                        continue
                    cell_text = cells[0].inner_text().strip()
                    if cell_text.strip().lower() == file_number.strip().lower():
                        link = cells[0].query_selector("a")
                        href = link.get_attribute("href") if link else ""
                        mid = re.search(r"ID=(\d+)", href or "")
                        gid = re.search(r"GUID=([A-F0-9\-]{36})", href or "", re.IGNORECASE)
                        if mid:
                            matter_id = mid.group(1)
                        if gid:
                            guid = gid.group(1)
                        break
            except Exception as e:
                logger.error(f"Error searching list for {file_number}: {e}")
            finally:
                browser.close()

        if not matter_id:
            logger.warning(f"Could not find matter_id for bill {file_number}")
            return None

        detail = self.scrape_detail(matter_id, guid or "")
        if not detail:
            return None
        full_text = self.fetch_full_text(matter_id, guid or "")
        return self._parse_detail(detail, matter_id, guid or "", full_text)

    def _parse_detail(
        self,
        detail: Dict[str, Any],
        matter_id: str,
        guid: str = "",
        full_text: Optional[str] = None,
    ) -> Dict[str, Any]:
        import json as _json
        intro_date = _parse_date(detail.get("intro_date", ""))
        final_date = _parse_date(detail.get("final_date", ""))
        # Sponsors field is comma-separated; first is primary, rest are co-sponsors
        sponsors_raw = detail.get("sponsors", "") or ""
        sponsor_list = [s.strip() for s in sponsors_raw.split(",") if s.strip()]
        primary_sponsor = sponsor_list[0] if sponsor_list else None
        co_sponsors = _json.dumps(sponsor_list[1:]) if len(sponsor_list) > 1 else None
        return {
            "id": f"legistar_phila_{matter_id}",
            "source": "legistar",
            "level": "local",
            "bill_number": detail.get("file_number") or f"#{matter_id}",
            "title": detail.get("title") or detail.get("title_short") or "(no title)",
            "description": detail.get("description") or detail.get("bill_type"),
            "full_text": full_text,
            "sponsor": primary_sponsor,
            "co_sponsors": co_sponsors,
            "committee": detail.get("committee") or None,
            "final_date": final_date,
            "status": _normalize_status(detail.get("status", "")),
            "introduced_date": intro_date,
            "external_url": (
                f"{BASE_URL}/LegislationDetail.aspx?ID={matter_id}&GUID={guid}"
                if guid else f"{BASE_URL}/LegislationDetail.aspx?ID={matter_id}"
            ),
        }

    def scrape_matter_guid_map(self) -> Dict[str, str]:
        """
        Scrape the full legislation list (expanded to 10,000 records) and return
        a mapping of {matter_id: guid} for all bills.  One Playwright session.
        """
        from playwright.sync_api import sync_playwright

        result: Dict[str, str] = {}

        with sync_playwright() as p:
            browser = p.chromium.launch(headless=self.headless)
            page = browser.new_page()
            try:
                logger.info("Loading Legistar for matter→guid map …")
                page.goto(f"{BASE_URL}/Legislation.aspx", wait_until="networkidle", timeout=30000)
                self._apply_filters_and_search(page)

                # Expand to 10,000 records
                try:
                    for item in page.query_selector_all(".rmText"):
                        if item.inner_text().strip() == "Show":
                            item.hover()
                            page.wait_for_timeout(600)
                            break
                    page.locator(".rmText", has_text="Show 10000 records").first.click(timeout=5000)
                    page.wait_for_timeout(8000)
                    page.wait_for_selector("tr.rgRow", timeout=30000)
                except Exception as e:
                    logger.warning(f"Could not expand to 10000 rows: {e} — using current page")

                for row in page.query_selector_all("tr.rgRow, tr.rgAltRow"):
                    try:
                        cells = row.query_selector_all("td")
                        if not cells:
                            continue
                        link = cells[0].query_selector("a")
                        href = link.get_attribute("href") if link else ""
                        mid = re.search(r"ID=(\d+)", href or "")
                        gid = re.search(r"GUID=([A-F0-9\-]{36})", href or "", re.IGNORECASE)
                        if mid and gid:
                            result[mid.group(1)] = gid.group(1)
                    except Exception:
                        continue

                logger.info(f"Collected {len(result)} matter→guid mappings")
            except Exception as e:
                logger.error(f"Error building matter→guid map: {e}")
            finally:
                browser.close()

        return result

    @staticmethod
    def fetch_sponsor_from_detail(matter_id: str, guid: str) -> Optional[str]:
        """
        Fetch a bill detail page via httpx (no browser) and parse the sponsor field.
        Returns sponsor string or None.
        """
        import httpx
        from html.parser import HTMLParser

        class _SponsorParser(HTMLParser):
            def __init__(self):
                super().__init__()
                self._capture = False
                self.sponsor: Optional[str] = None
            def handle_starttag(self, tag, attrs):
                attr_dict = dict(attrs)
                if attr_dict.get("id") == "ctl00_ContentPlaceHolder1_lblSponsors2":
                    self._capture = True
            def handle_data(self, data):
                if self._capture and data.strip():
                    self.sponsor = data.strip()
                    self._capture = False

        url = f"{BASE_URL}/LegislationDetail.aspx?ID={matter_id}&GUID={guid}"
        try:
            resp = httpx.get(url, timeout=15, follow_redirects=True)
            if resp.status_code != 200:
                return None
            parser = _SponsorParser()
            parser.feed(resp.text)
            return parser.sponsor or None
        except Exception as e:
            logger.warning(f"fetch_sponsor_from_detail failed for matter {matter_id}: {e}")
            return None

    def scrape_upcoming_hearings(self) -> List[Dict[str, Any]]:
        """
        Scrape phila.legistar.com/Calendar.aspx for upcoming City Council meetings.
        For each meeting that has an Accessible Agenda link, fetch that page and
        extract the bill file numbers listed on the agenda.

        Returns a list of dicts:
          {
            "date": datetime,
            "time": str,                     # e.g. "10:00 AM"
            "body": str,                     # e.g. "Committee on Public Safety"
            "location": str,
            "bill_file_numbers": List[str],  # e.g. ["240001", "25-0123"]
          }
        """
        from playwright.sync_api import sync_playwright
        from html.parser import HTMLParser
        import re as _re

        results: List[Dict[str, Any]] = []
        now = datetime.utcnow()

        class AgendaParser(HTMLParser):
            """Extract bill file-number-like tokens from agenda HTML."""
            def __init__(self):
                super().__init__()
                self.text_chunks: List[str] = []
            def handle_data(self, data: str):
                self.text_chunks.append(data)
            def bill_numbers(self) -> List[str]:
                text = " ".join(self.text_chunks)
                # Philly bill numbers: "240001", "24-0001", "2024-0001"
                return list(dict.fromkeys(_re.findall(r'\b\d{2,4}-?\d{4,5}\b', text)))

        with sync_playwright() as p:
            browser = p.chromium.launch(headless=self.headless)
            page = browser.new_page()
            try:
                logger.info("Loading Legistar Calendar ...")
                page.goto(f"{BASE_URL}/Calendar.aspx", wait_until="networkidle", timeout=30000)
                page.wait_for_selector("tr.rgRow, tr.rgAltRow", timeout=15000)

                rows = page.query_selector_all("tr.rgRow, tr.rgAltRow")
                logger.info(f"Calendar: found {len(rows)} meeting rows")

                for row in rows:
                    cells = row.query_selector_all("td")
                    if len(cells) < 4:
                        continue

                    date_text     = cells[0].inner_text().strip()
                    time_text     = cells[1].inner_text().strip() if len(cells) > 1 else ""
                    body_text     = cells[2].inner_text().strip() if len(cells) > 2 else ""
                    location_text = cells[3].inner_text().strip() if len(cells) > 3 else ""

                    meeting_date = _parse_date(date_text)
                    if not meeting_date or meeting_date < now:
                        continue  # skip past meetings

                    # Find "Meeting details" and "Accessible Agenda" links in the row
                    agenda_url: Optional[str] = None
                    meeting_url: Optional[str] = None
                    for link in row.query_selector_all("a"):
                        text = link.inner_text().strip().lower()
                        href = link.get_attribute("href") or ""
                        full_href = href if href.startswith("http") else f"{BASE_URL}/{href.lstrip('/')}"
                        if "accessible" in text and "agenda" in text:
                            agenda_url = full_href
                        elif "meeting" in text and "detail" in text:
                            meeting_url = full_href

                    bill_file_numbers: List[str] = []
                    if agenda_url:
                        try:
                            resp = httpx.get(agenda_url, timeout=15, follow_redirects=True)
                            content_type = resp.headers.get("content-type", "")
                            if "html" in content_type:
                                parser = AgendaParser()
                                parser.feed(resp.text)
                                bill_file_numbers = parser.bill_numbers()
                            elif "pdf" in content_type:
                                try:
                                    import fitz
                                    doc = fitz.open(stream=resp.content, filetype="pdf")
                                    text = " ".join(page.get_text() for page in doc)
                                    import re as _re2
                                    bill_file_numbers = list(dict.fromkeys(_re2.findall(r'\b\d{2,4}-?\d{4,5}\b', text)))
                                except Exception:
                                    pass
                        except Exception as e:
                            logger.warning(f"Could not fetch agenda at {agenda_url}: {e}")

                    results.append({
                        "date":              meeting_date,
                        "time":              time_text,
                        "body":              body_text,
                        "location":          location_text,
                        "meeting_url":       meeting_url,
                        "bill_file_numbers": bill_file_numbers,
                    })

            except Exception as e:
                logger.error(f"scrape_upcoming_hearings failed: {e}")
            finally:
                browser.close()

        logger.info(f"scrape_upcoming_hearings: {len(results)} future meetings found")
        return results

    def scrape_vote_history(self, detail_url: str) -> List[Dict[str, Any]]:
        """
        Scrape roll call votes from a bill's detail page on phila.legistar.com.

        Visits the LegislationDetail page, finds Action Details links in the
        history table, then visits each to extract individual member votes.

        Returns a list of dicts:
          { voter_name: str, vote: str, action_date: str|None, result: str }
        """
        from playwright.sync_api import sync_playwright

        votes: List[Dict[str, Any]] = []

        with sync_playwright() as p:
            browser = p.chromium.launch(headless=self.headless)
            page = browser.new_page()
            try:
                page.goto(detail_url, wait_until="domcontentloaded", timeout=30000)
                page.wait_for_timeout(2000)
                page.wait_for_selector("#ctl00_ContentPlaceHolder1_lblFile2", timeout=10000)

                # Find all "Action Details" links — Legistar uses onclick="radopen('HistoryDetail.aspx?...')"
                # rather than href, so we extract the URL from the onclick attribute.
                action_links = []
                for a in page.query_selector_all("a[onclick*='HistoryDetail']"):
                    onclick = a.get_attribute("onclick") or ""
                    match = re.search(r"radopen\('([^']+)'", onclick)
                    if not match:
                        continue
                    rel = match.group(1)
                    full = rel if rel.startswith("http") else f"{BASE_URL}/{rel.lstrip('/')}"
                    # Grab date/result from the parent table row
                    row_el = a.evaluate_handle("el => el.closest('tr')")
                    row_text = row_el.as_element().inner_text() if row_el.as_element() else ""
                    cells = [c.strip() for c in row_text.split("\t") if c.strip()]
                    action_date = cells[0] if cells else None
                    result = ""
                    for cell in cells:
                        if cell.lower() in ("pass", "fail", "failed", "passed"):
                            result = cell
                            break
                    action_links.append({"url": full, "action_date": action_date, "result": result})

                logger.info(f"scrape_vote_history: found {len(action_links)} action detail link(s) at {detail_url}")

                for link in action_links:
                    try:
                        detail_page = browser.new_page()
                        detail_page.goto(link["url"], wait_until="domcontentloaded", timeout=20000)
                        detail_page.wait_for_timeout(2000)
                        # Vote table rows: each has voter name and vote value
                        for row_el in detail_page.query_selector_all("tr.rgRow, tr.rgAltRow"):
                            cells = row_el.query_selector_all("td")
                            if len(cells) < 2:
                                continue
                            voter_name = cells[0].inner_text().strip()
                            vote_value = cells[1].inner_text().strip()
                            if voter_name and vote_value:
                                votes.append({
                                    "voter_name": voter_name,
                                    "vote": vote_value,
                                    "action_date": link["action_date"],
                                    "result": link["result"],
                                })
                        detail_page.close()
                    except Exception as e:
                        logger.warning(f"scrape_vote_history: failed to scrape {link['url']}: {e}")
                        continue

            except Exception as e:
                logger.error(f"scrape_vote_history failed for {detail_url}: {e}")
            finally:
                browser.close()

        # Deduplicate — keep last vote per voter name
        seen: Dict[str, Dict[str, Any]] = {}
        for v in votes:
            seen[v["voter_name"]] = v
        return list(seen.values())

    def _parse_row(self, row: Dict[str, Any]) -> Dict[str, Any]:
        matter_id = row.get("matter_id") or row.get("file_number", "unknown")
        intro_date = _parse_date(row.get("intro_date", ""))
        return {
            "id": f"legistar_phila_{matter_id}",
            "source": "legistar",
            "level": "local",
            "bill_number": row.get("file_number") or f"#{matter_id}",
            "title": row.get("title_short") or "(no title)",
            "description": row.get("bill_type"),
            "full_text": None,
            "sponsor": None,
            "status": _normalize_status(row.get("status", "")),
            "introduced_date": intro_date,
            "external_url": (
                f"{BASE_URL}/LegislationDetail.aspx?ID={row['matter_id']}&GUID={row['guid']}"
                if row.get("matter_id") and row.get("guid") else None
            ),
        }

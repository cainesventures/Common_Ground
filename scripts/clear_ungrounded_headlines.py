"""One-off cleanup: clear AI headlines/ledes that were generated from unusable source text.

Eight bills were enriched despite having no usable source: four whose Legistar
record is an empty form ("(no title)"), one whose full_text is a saved HTTP error
page, and three whose headline or lede asserted facts absent from the bill title.
The model invented specific, plausible-sounding legislation for all of them.

Clearing headline/lede makes the UI fall back to the real legal title
(BillCard: `headline || plain_title || title`). skip_reason is set so
worker_core's queue skips these bills instead of regenerating the same text --
see worker_core.steps_needed(), which treats a null headline as work to do.
"""
import sqlite3

# Legistar record is an empty form -- no title, sponsor, or body to ground on.
NO_SOURCE = ["030869", "170552", "170847", "260664"]
# Real title present, but the generated headline/lede asserted facts it does not support.
UNGROUNDED = ["000019", "000711", "080473", "260238"]

DB = "common_ground_test.db"


def main():
    db = sqlite3.connect(DB)
    cur = db.cursor()

    for bills, reason in ((NO_SOURCE, "no_usable_source_text"),
                          (UNGROUNDED, "ai_headline_ungrounded")):
        cur.executemany(
            "update legislation set headline = null, lede = null, skip_reason = ? "
            "where bill_number = ?",
            [(reason, bn) for bn in bills],
        )

    # 170552's summary described the scrape artifact ("printed on 2026-04-27 but
    # introduced 2017-05-18"), which means nothing to a reader.
    cur.execute(
        "update legislation set summary = ? where bill_number = '170552'",
        ("This bill's Legistar record contains no title, sponsor, or text. "
         "No description of its contents is available.",),
    )

    # 000711's full_text is a saved "Server Error" page; the Full Text tab renders it.
    cur.execute("update legislation set full_text = null where bill_number = '000711'")

    db.commit()
    print(f"cleared {len(NO_SOURCE) + len(UNGROUNDED)} bills")
    db.close()


if __name__ == "__main__":
    main()

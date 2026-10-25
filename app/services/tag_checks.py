"""Checks that an AI-assigned subject tag is about what the bill is about.

The tagger reads procedure as subject. Every Home Rule Charter amendment goes
to the voters, so its title carries "fixing the date of a special election ...
prescribing the form of ballot question", and the tagger marked charter
amendments on gender-neutral wording, stop and frisk or the Fair Housing
Commission as "elections". Business improvement district renewals ("extend the
term of that Authority") got "elections" too, and the "ethics" tag picked up
utility billing notices, municipal ID cards and zoning permit posting. An audit
on 2026-10-25 found 47 of 111 "elections" bills and 38 of 118 "ethics" bills
introduced 2000-2023 were not about either.

That mattered beyond the tag pills: /philadelphia/insights derives its key
finding ("Council legislates the city, not itself") from these two tags, and
the strays inflated how much Council has passed on the rules that bind it
(ethics laws 45 -> 23, elections laws 48 -> 18 once removed).

The rules only remove a tag the tagger already gave, never add one, so each
pattern only has to separate the right bills from the wrong ones inside an
already-tagged set. Shared by scripts/fix_subject_tags.py (existing rows) and
scripts/worker_core.py (new bills, after tag normalization).
"""
import re

# Procedural ballot language, removed before matching so it cannot count as
# the subject. Includes the charter chapter "Referenda Approved by the Voters",
# which holds non-binding questions on wages, schools and the like.
_BALLOT_BOILERPLATE = re.compile(
    r"submission (?:of such amendment )?(?:to|for the approval or disapproval of) "
    r"the (?:qualified )?electors"
    r"|approved for submission to the electors"
    r"|fix(?:ing)? the date (?:of|for) (?:a |the )?(?:special )?election(?: for such purposes?)?"
    r"|prescribing the form of (?:the )?ballot questions?(?: to be voted on)?"
    r"|(?:make|making) arrangements(?: for the (?:special )?election)?"
    r"|Referenda Approved by the Voters",
    re.I,
)

SUBJECT_RULES: dict[str, re.Pattern] = {
    # Rules on how officials conduct themselves and how money reaches them.
    "ethics": re.compile(
        r"\bethic|\b20-6\d\d\b|\b20-1000\b|campaign|political contributions"
        r"|contributions? (?:to|by|on behalf of) (?:city )?(?:elected|candidates)"
        r"|made certain contributions|public (?:matching )?financ|lobby"
        r"|financial interests?|financial disclosure|conflicts? of interest|\bgifts?\b"
        r"|nepotism|outside (?:employment|income|earned income)"
        r"|\b17-1400\b|non-competitively bid|competitive(?:ly)? bid"
        r"|disclosures? by persons seeking|inspector general|political activit"
        r"|\bresign|corrupt",
        re.I,
    ),
    # How elections, campaigns, candidacies and elective offices work.
    "elections": re.compile(
        r"\belect(?:ion|ions|ed|ive|ors?)?\b|\bcandida|\bballot|\bvot(?:e|er|ers|ing)\b"
        r"|campaign|political (?:contributions|committee|activit)"
        r"|contributions and expenditures|public (?:matching )?financ"
        r"|councilmanic districts?|redistrict|reapportion|city commissioners"
        r"|terms? of office|consecutive terms|term limits?|\bresign",
        re.I,
    ),
}

# Titles that name no subject at all, where only the record says what the bill
# did. 020824 (2002) is "a new Article XIII of the Philadelphia Home Rule
# Charter" and nothing more; it would have created a Campaign Finance Board.
_KEEP = {("020824", "ethics"), ("020824", "elections")}


def unsupported_subject_tags(tags: list, title: str | None,
                             bill_number: str | None = None) -> list[str]:
    """The tags in SUBJECT_RULES that this bill's title does not support."""
    text = _BALLOT_BOILERPLATE.sub(" ", title or "")
    out = []
    for t in tags:
        key = str(t).lower().strip() if isinstance(t, str) else None
        rule = SUBJECT_RULES.get(key)
        if rule and (bill_number, key) not in _KEEP and not rule.search(text):
            out.append(t)
    return out


def drop_unsupported_subject_tags(tags: list, title: str | None,
                                  bill_number: str | None = None) -> list:
    """tags without the unsupported ones. A bill whose only tags are all
    unsupported keeps them: an empty list sends it back to the AI tagger,
    which would assign the same tags again."""
    bad = unsupported_subject_tags(tags, title, bill_number)
    kept = [t for t in tags if t not in bad]
    return kept if kept else list(tags)

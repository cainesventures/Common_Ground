"""Subject-tag checks that keep "ethics" and "elections" to bills about them."""
from app.services.tag_checks import drop_unsupported_subject_tags, unsupported_subject_tags

BALLOT = (
    "Providing for the submission to the qualified electors of the City of Philadelphia of an "
    "amendment to The Philadelphia Home Rule Charter {}; fixing the date of a special election "
    "for such purpose; prescribing the form of ballot question to be voted on; and authorizing "
    "the appropriate officers to publish notice and to make arrangements for the special election."
)


def test_ballot_procedure_is_not_an_elections_subject():
    gender = BALLOT.format("to change certain gender specific references to gender neutral references")
    assert unsupported_subject_tags(["elections", "government"], gender) == ["elections"]
    terms = BALLOT.format("to provide that Councilmembers shall not be eligible for election for more than four terms")
    assert unsupported_subject_tags(["elections"], terms) == []


def test_business_district_renewal_loses_elections():
    title = ("Adopting an amendment to the Articles of Incorporation of the Old City Special Services "
             "District of Philadelphia to extend the term of that Authority")
    assert drop_unsupported_subject_tags(["elections", "economic-development"], title) == ["economic-development"]


def test_ethics_kept_for_conduct_rules_and_dropped_for_billing_notices():
    gifts = ('Amending Chapter 20-600 of The Philadelphia Code, entitled "Standards of Conduct and '
             'Ethics," by amending provisions prohibiting City officers from accepting gifts')
    assert unsupported_subject_tags(["ethics"], gifts) == []
    pgw = ("Requiring the Philadelphia Gas Works to include with all monthly billing statements "
           "information regarding the portion of the customer's bill attributable to uncollected service")
    assert unsupported_subject_tags(["ethics", "utilities"], pgw) == ["ethics"]


def test_subjectless_title_override_and_never_emptied():
    bare = BALLOT.format("a new Article XIII")
    assert unsupported_subject_tags(["elections", "ethics"], bare, "020824") == []
    # Emptying the list would send the bill back to the AI tagger.
    assert drop_unsupported_subject_tags(["elections"], bare, "999999") == ["elections"]

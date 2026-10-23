// Plain-language definitions of the words Philadelphia City Council uses.
// Shown as tap/hover definitions (components/Term.tsx) and listed on
// /glossary. Neutral by design: each entry says what a thing IS and does,
// never whether it is good. Keep entries to two or three sentences.

export interface GlossaryEntry {
  term: string
  short: string          // one or two sentences, used in the popover
  more?: string          // extra context, shown only on /glossary
}

export const GLOSSARY: Record<string, GlossaryEntry> = {
  bill: {
    term: 'Bill',
    short: 'A proposed law. It becomes an ordinance if a majority of Council (9 of 17) passes it and the Mayor signs it, or does not act on it within ten days.',
  },
  ordinance: {
    term: 'Ordinance',
    short: 'A city law. Bills that pass Council and are signed by the Mayor become ordinances and are added to The Philadelphia Code.',
  },
  resolution: {
    term: 'Resolution',
    short: 'A formal statement or action by Council that is not a law. Resolutions schedule hearings, approve some appointments and agreements, honor people, or state a position, and do not need the Mayor\'s signature.',
  },
  introduced: {
    term: 'Introduced',
    short: 'Formally filed by a councilmember at a Council session. Most bills are then sent to a committee.',
  },
  in_committee: {
    term: 'In committee',
    short: 'Sent to one of Council\'s committees, which must hold a public hearing before it can recommend the bill to the full Council. Many bills stay here and never get a hearing.',
  },
  public_hearing: {
    term: 'Public hearing',
    short: 'A committee meeting where residents can testify for or against a bill before the committee votes on it.',
  },
  first_reading: {
    term: 'First reading',
    short: 'After a committee reports a bill out, it is read at one Council session and can be voted on for final passage at a later one, so there is time to see it before the vote.',
  },
  final_passage: {
    term: 'Final passage',
    short: 'The vote of the full Council on a bill. It needs a majority of all members, 9 of 17, not just of those present.',
  },
  awaiting_mayor: {
    term: 'Awaiting Mayor',
    short: 'Passed by Council and sent to the Mayor, who can sign it, veto it, or let it become law without a signature after ten days.',
  },
  veto: {
    term: 'Veto',
    short: 'The Mayor\'s rejection of a bill Council passed. Council can override a veto with two-thirds of its members, 12 of 17.',
  },
  signed_into_law: {
    term: 'Signed into law',
    short: 'Passed by Council and signed by the Mayor (or enacted without a signature, or over a veto). It is now an ordinance.',
  },
  lapsed: {
    term: 'Lapsed',
    short: 'Died at the end of a four-year Council term without being enacted. Pending bills do not carry over; they must be reintroduced in the new term.',
  },
  died_without_a_vote: {
    term: 'Died without a vote',
    short: 'Lapsed with no recorded roll-call vote at any stage, so no councilmember is on record for or against it.',
  },
  roll_call: {
    term: 'Roll call vote',
    short: 'A recorded vote where each councilmember\'s yes or no is listed by name.',
  },
  sponsor: {
    term: 'Sponsor',
    short: 'The councilmember who introduces a bill. Co-sponsors sign on to support it.',
  },
  at_large: {
    term: 'At-large member',
    short: 'One of seven councilmembers elected citywide rather than by district. The Charter limits each party to five at-large nominees, which reserves at least two seats for the minority party.',
  },
  district_member: {
    term: 'District member',
    short: 'One of ten councilmembers elected by and representing a single geographic district.',
  },
  councilmanic_prerogative: {
    term: 'Councilmanic prerogative',
    short: 'An unwritten custom, not a law, in which Council defers to the district member on land-use bills for their own district.',
    more: 'It shapes zoning and property bills in particular, which is why a remapping bill is usually sponsored by the member whose district it affects.',
  },
  zoning_remapping: {
    term: 'Zoning remapping',
    short: 'A bill that changes the zoning category of specific blocks, which controls what can be built there and how densely.',
  },
  zoning_overlay: {
    term: 'Zoning overlay',
    short: 'Extra rules layered on top of an area\'s base zoning, such as height limits, design rules, or use restrictions for a corridor or neighborhood.',
  },
  variance: {
    term: 'Variance',
    short: 'Permission from the Zoning Board of Adjustment to build or use a property in a way its zoning does not normally allow. It is granted case by case, not by Council.',
  },
  encroachment: {
    term: 'Encroachment',
    short: 'Something built into the public right-of-way, such as steps, a ramp, an awning, or a sign over the sidewalk. Many routine bills authorize a specific one.',
  },
  right_of_way: {
    term: 'Right-of-way',
    short: 'Public land for streets and sidewalks, including the space above and below them.',
  },
  tax_abatement: {
    term: 'Tax abatement',
    short: 'A temporary reduction in property tax, usually on the value added by new construction or improvements, for a set number of years.',
  },
  tif: {
    term: 'Tax increment financing (TIF)',
    short: 'Paying for a development project with the extra tax revenue the project is expected to generate in the future.',
  },
  charter_amendment: {
    term: 'Charter amendment',
    short: 'A change to the Home Rule Charter, the city\'s constitution. Council can propose one, but voters must approve it on the ballot.',
  },
  home_rule_charter: {
    term: 'Home Rule Charter',
    short: 'Philadelphia\'s founding document since 1951. It sets up the Mayor, Council, and city departments and how they work.',
  },
}

/** Map a bill status to its glossary key, when there is one. */
export const STATUS_TERM: Record<string, string> = {
  introduced: 'introduced',
  in_committee: 'in_committee',
  awaiting_mayor: 'awaiting_mayor',
  signed_into_law: 'signed_into_law',
  vetoed: 'veto',
  lapsed: 'lapsed',
}

/** Map a bill_type ("Bill", "Resolution", ...) to its glossary key. */
export function billTypeTerm(billType?: string | null): string | null {
  const t = (billType ?? '').toLowerCase()
  if (t.includes('resolution')) return 'resolution'
  if (t.includes('charter')) return 'charter_amendment'
  if (t.includes('bill') || t.includes('ordinance')) return 'bill'
  return null
}

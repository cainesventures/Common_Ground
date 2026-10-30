/**
 * Ballot questions that a bill put before voters, keyed by bill id.
 *
 * Hand-maintained because the facts that matter here come from the ballot
 * itself, not the bill: Legistar often only holds the bill as introduced, and
 * the wording can be amended before passage (it was for 8006948). Quote the
 * final wording from vote.phila.gov and cite every explanatory line.
 */
export interface BallotQuestion {
  /** e.g. "Question 1" */
  label: string
  /** ISO date of the election, local time. */
  electionDate: string
  /** Search title used in place of the bill headline. Keep under ~60 chars. */
  seoTitle: string
  seoDescription: string
  /** Official ballot wording, verbatim. */
  wording: string
  yesMeans: string
  noMeans: string
  /** Extra context, each with its source. */
  notes: { text: string; source: string; href: string }[]
  /** Set when our stored bill text predates amendments to the wording. */
  textIsIntroducedVersion: boolean
}

export const BALLOT_QUESTIONS: Record<string, BallotQuestion> = {
  legistar_phila_8006948: {
    label: 'Question 1',
    electionDate: '2026-11-03',
    seoTitle: 'Philadelphia Ballot Question 1 (Nov 3, 2026): City Contracts',
    seoDescription:
      'Question 1 on the November 3, 2026 Philadelphia ballot asks whether to amend the Home Rule Charter to allow bid preferences and set-asides for small and local businesses. Official wording and what a yes or no vote means.',
    wording:
      "Should the Philadelphia Home Rule Charter be amended to revise the City's contracting procedures to allow for bid preferences and set-asides for small businesses; modify the threshold and standards for contracts that can be set aside for small and local businesses; and grant the Procurement Department and the City Solicitor discretion on bond requirements for certain construction projects?",
    yesMeans:
      'The Charter is amended so the City can give contracting preferences to small businesses and expand them for local businesses on City-funded projects.',
    noMeans: 'The Charter is not amended, and the current contracting rules stay in place.',
    notes: [
      {
        text: 'The Committee of Seventy says the change would let the City award contracts between $75,000 and $500,000 to local and small businesses even when they are not the lowest bidder.',
        source: 'Committee of Seventy',
        href: 'https://seventy.org/get-informed/voter-guide/2026-general-ballot-questions/',
      },
    ],
    textIsIntroducedVersion: true,
  },
}

export function getBallotQuestion(billId?: string | null): BallotQuestion | null {
  return (billId && BALLOT_QUESTIONS[billId]) || null
}

/** True through the end of election day, Philadelphia time. */
export function isUpcoming(q: BallotQuestion, now: Date = new Date()): boolean {
  // Polls close 8pm Eastern; treat the whole day as upcoming. EST is UTC-5 in
  // early November, so midnight local is 05:00 UTC the next day.
  const end = new Date(`${q.electionDate}T00:00:00-05:00`)
  end.setUTCDate(end.getUTCDate() + 1)
  return now < end
}

import { getBallotQuestion, isUpcoming } from '@/lib/ballot-questions'

function formatElectionDate(iso: string): string {
  return new Date(`${iso}T12:00:00-05:00`).toLocaleDateString('en-US', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    year: 'numeric',
    timeZone: 'America/New_York',
  })
}

/**
 * For a bill that put a question on the ballot: the official wording and what
 * each vote means, at the top of the page. A server component so it is in the
 * HTML crawlers read; people search for the ballot question, not the bill.
 */
export function BallotQuestionCallout({ billId }: { billId?: string | null }) {
  const q = getBallotQuestion(billId)
  if (!q) return null
  const upcoming = isUpcoming(q)
  const date = formatElectionDate(q.electionDate)

  return (
    <aside className="mb-6 rounded-xl border border-sky-300 bg-sky-50 px-4 py-4 dark:border-sky-700 dark:bg-sky-900/20">
      <div className="text-xs font-semibold uppercase tracking-wide text-sky-800 dark:text-sky-200">
        On the ballot {date}
      </div>
      <h2 className="mt-1 text-lg font-semibold">
        {q.label}: {upcoming ? 'what you are voting on' : 'what voters were asked'}
      </h2>

      <blockquote className="mt-3 border-l-4 border-sky-400 pl-3 text-sm italic">
        {q.wording}
      </blockquote>

      <dl className="mt-4 grid gap-3 text-sm sm:grid-cols-2">
        <div>
          <dt className="font-semibold">A yes vote</dt>
          <dd className="text-muted-foreground">{q.yesMeans}</dd>
        </div>
        <div>
          <dt className="font-semibold">A no vote</dt>
          <dd className="text-muted-foreground">{q.noMeans}</dd>
        </div>
      </dl>

      {q.notes.map((n) => (
        <p key={n.href} className="mt-3 text-sm text-muted-foreground">
          {n.text}{' '}
          <a href={n.href} className="underline underline-offset-2" rel="noopener" target="_blank">
            {n.source}
          </a>
        </p>
      ))}

      {q.textIsIntroducedVersion && (
        <p className="mt-3 text-xs text-muted-foreground">
          The bill text and summary below are from the version as introduced. Council amended the
          wording before it passed, so the ballot wording above is the one that counts.
        </p>
      )}

      <p className="mt-3 text-xs text-muted-foreground">
        Wording from the{' '}
        <a
          href="https://vote.phila.gov/media/2026G_Ballot_Questions.pdf"
          className="underline underline-offset-2"
          rel="noopener"
          target="_blank"
        >
          Philadelphia City Commissioners
        </a>
        {upcoming && (
          <>
            . Polls are open 7am to 8pm.{' '}
            <a href="https://vote.phila.gov/" className="underline underline-offset-2" rel="noopener" target="_blank">
              Find your polling place
            </a>
          </>
        )}
        .
      </p>
    </aside>
  )
}

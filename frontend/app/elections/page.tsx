'use client'

import { useEffect, useState, useRef } from 'react'
import Link from 'next/link'
import { api } from '@/lib/api'

const DISCLAIMER =
  'AI-generated speculation for civic engagement only. Predictions are not factual representations ' +
  "of any candidate's positions. They are generated from publicly available party and background " +
  'information and should not be taken as statements by or about any candidate.'

interface Candidate {
  id: string
  name: string
  district: string
  party?: string
  bio?: string
  photo_url?: string
  website_url?: string
  office_sought?: string
  election_year: number
  is_incumbent?: boolean
}

interface Prediction {
  candidate_id: string
  candidate_name: string
  district: string
  party?: string
  is_incumbent?: boolean
  predicted_vote: 'support' | 'oppose' | 'uncertain'
  reasoning: string
}

// ── Disclaimer banner ────────────────────────────────────────────────────────

function DisclaimerBanner() {
  return (
    <div className="border border-amber-300 bg-amber-50 rounded-lg px-4 py-3 text-sm text-amber-800">
      <span className="font-semibold">AI-generated speculation for civic engagement only.</span>{' '}
      {DISCLAIMER.slice(DISCLAIMER.indexOf('Predictions'))}
    </div>
  )
}

// ── Prediction badge ─────────────────────────────────────────────────────────

const VOTE_STYLES: Record<string, string> = {
  support:   'bg-green-100 text-green-800',
  oppose:    'bg-red-100 text-red-800',
  uncertain: 'bg-gray-100 text-gray-600',
}

// ── Bill search + predict ────────────────────────────────────────────────────

function BillPredictSelector({ onPredictions }: {
  onPredictions: (data: { predictions: Prediction[]; bill_title: string; disclaimer: string }) => void
}) {
  const [query, setQuery]           = useState('')
  const [results, setResults]       = useState<any[]>([])
  const [selectedBill, setSelected] = useState<any>(null)
  const [searching, setSearching]   = useState(false)
  const [predicting, setPredicting] = useState(false)
  const [error, setError]           = useState<string | null>(null)
  const debounce                    = useRef<ReturnType<typeof setTimeout> | null>(null)

  const handleQueryChange = (q: string) => {
    setQuery(q)
    setSelected(null)
    if (!q.trim()) { setResults([]); return }
    if (debounce.current) clearTimeout(debounce.current)
    debounce.current = setTimeout(async () => {
      setSearching(true)
      try {
        const data = await api.searchLegislation(q, 8)
        setResults(data?.results ?? [])
      } catch { setResults([]) }
      finally { setSearching(false) }
    }, 300)
  }

  const handlePredict = async () => {
    if (!selectedBill) return
    setPredicting(true); setError(null)
    try {
      const data = await api.getCandidatePredictions(selectedBill.id)
      onPredictions({ predictions: data.predictions ?? [], bill_title: data.bill_title ?? selectedBill.plain_title ?? selectedBill.title, disclaimer: data.disclaimer })
    } catch (e: any) {
      setError(e.message || 'Prediction failed.')
    } finally {
      setPredicting(false)
    }
  }

  return (
    <div className="space-y-3">
      <div className="relative">
        <input
          type="text"
          placeholder="Search for a bill…"
          value={selectedBill ? (selectedBill.plain_title || selectedBill.title) : query}
          onChange={(e) => handleQueryChange(e.target.value)}
          onFocus={() => { if (selectedBill) { setSelected(null); setQuery('') } }}
          className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/40"
        />
        {results.length > 0 && !selectedBill && (
          <div className="absolute z-10 mt-1 w-full rounded-md border bg-background shadow-lg max-h-64 overflow-y-auto">
            {results.map((bill) => (
              <button
                key={bill.id}
                onClick={() => { setSelected(bill); setResults([]); setQuery('') }}
                className="w-full text-left px-3 py-2 text-sm hover:bg-muted transition-colors border-b last:border-0"
              >
                <span className="font-mono text-xs text-muted-foreground mr-2">{bill.bill_number}</span>
                {bill.plain_title || bill.title}
              </button>
            ))}
          </div>
        )}
        {searching && (
          <p className="absolute right-3 top-2.5 text-xs text-muted-foreground">Searching…</p>
        )}
      </div>
      {error && <p className="text-sm text-red-600">{error}</p>}
      <button
        onClick={handlePredict}
        disabled={!selectedBill || predicting}
        className="px-4 py-2 rounded-md bg-primary text-primary-foreground text-sm font-medium disabled:opacity-50 hover:opacity-90 transition-opacity"
      >
        {predicting ? 'Generating predictions… (this may take a moment)' : 'Predict votes'}
      </button>
    </div>
  )
}

// ── Prediction results ───────────────────────────────────────────────────────

function PredictionResults({ predictions, billTitle }: { predictions: Prediction[]; billTitle: string }) {
  const supportCount  = predictions.filter((p) => p.predicted_vote === 'support').length
  const opposeCount   = predictions.filter((p) => p.predicted_vote === 'oppose').length
  const uncertainCount = predictions.filter((p) => p.predicted_vote === 'uncertain').length

  return (
    <div className="space-y-4">
      <DisclaimerBanner />
      <div>
        <p className="text-sm font-semibold mb-1">Predictions for: {billTitle}</p>
        <p className="text-xs text-muted-foreground">
          {supportCount} likely support · {opposeCount} likely oppose · {uncertainCount} uncertain
        </p>
      </div>
      <div className="space-y-3">
        {predictions.map((p) => (
          <div key={p.candidate_id} className="border rounded-lg p-4 flex items-start gap-3">
            <span className={`shrink-0 text-xs font-semibold px-2 py-1 rounded-full capitalize ${VOTE_STYLES[p.predicted_vote] ?? VOTE_STYLES.uncertain}`}>
              {p.predicted_vote}
            </span>
            <div>
              <p className="text-sm font-medium">
                {p.candidate_name}
                {p.is_incumbent && <span className="ml-1.5 text-xs text-muted-foreground">(incumbent)</span>}
              </p>
              <p className="text-xs text-muted-foreground">{p.district}{p.party ? ` · ${p.party}` : ''}</p>
              <p className="text-sm text-muted-foreground italic mt-1">"{p.reasoning}"</p>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

// ── Office description ───────────────────────────────────────────────────────

function OfficeDescription({ office }: { office: string }) {
  const [open, setOpen] = useState(false)
  const [data, setData] = useState<any>(null)
  const [loading, setLoading] = useState(false)

  const load = () => {
    if (data) return
    setLoading(true)
    api.getOfficeDescription(office)
      .then((d) => setData(d))
      .catch(() => {})
      .finally(() => setLoading(false))
  }

  const handleToggle = () => {
    const next = !open
    setOpen(next)
    if (next) load()
  }

  return (
    <div className="mt-1 mb-3">
      <button
        onClick={handleToggle}
        className="text-xs text-muted-foreground hover:text-foreground transition-colors flex items-center gap-1"
      >
        <span>{open ? '▾' : '▸'}</span>
        About this office
      </button>
      {open && (
        <div className="mt-2 border rounded-lg p-4 space-y-3 text-sm bg-muted/20">
          {loading && <p className="text-xs text-muted-foreground">Generating…</p>}
          {data && (
            <>
              <p className="text-muted-foreground leading-relaxed">{data.what_it_does}</p>
              <div className="grid sm:grid-cols-2 gap-3">
                {data.key_responsibilities?.length > 0 && (
                  <div>
                    <p className="text-xs font-semibold mb-1">Key responsibilities</p>
                    <ul className="space-y-0.5">
                      {data.key_responsibilities.map((r: string, i: number) => (
                        <li key={i} className="text-xs text-muted-foreground">· {r}</li>
                      ))}
                    </ul>
                  </div>
                )}
                {data.good_candidate_traits?.length > 0 && (
                  <div>
                    <p className="text-xs font-semibold mb-1">What makes a good candidate</p>
                    <ul className="space-y-0.5">
                      {data.good_candidate_traits.map((t: string, i: number) => (
                        <li key={i} className="text-xs text-muted-foreground">· {t}</li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
              <div className="flex gap-4 text-xs text-muted-foreground">
                {data.term_length && <span>Term: {data.term_length}</span>}
                {data.salary_approx && <span>Salary: {data.salary_approx}</span>}
              </div>
            </>
          )}
        </div>
      )}
    </div>
  )
}

// ── Candidate card ───────────────────────────────────────────────────────────

function CandidateCard({ candidate }: { candidate: Candidate }) {
  return (
    <div className="border rounded-lg p-4 flex items-start gap-4">
      <div className="shrink-0 w-12 h-12 rounded-full overflow-hidden bg-muted flex items-center justify-center">
        {candidate.photo_url ? (
          <img src={candidate.photo_url} alt={candidate.name} className="w-full h-full object-cover object-top" />
        ) : (
          <span className="text-lg font-bold text-muted-foreground">{candidate.name[0]}</span>
        )}
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <p className="font-medium text-sm">{candidate.name}</p>
          {candidate.is_incumbent && (
            <span className="text-xs px-1.5 py-0.5 rounded-full bg-blue-100 text-blue-700 font-medium">Incumbent</span>
          )}
        </div>
        <p className="text-xs text-muted-foreground mt-0.5">
          {candidate.party ?? 'Independent'}{candidate.office_sought ? ` · ${candidate.office_sought}` : ''}
        </p>
        {candidate.bio && (
          <p className="text-xs text-muted-foreground mt-1 line-clamp-2">{candidate.bio}</p>
        )}
        {candidate.website_url && (
          <a href={candidate.website_url} target="_blank" rel="noopener noreferrer"
             className="text-xs text-primary hover:underline mt-1 inline-block">
            Campaign website →
          </a>
        )}
      </div>
    </div>
  )
}

// ── Main page ────────────────────────────────────────────────────────────────

export default function ElectionsPage() {
  const [candidates, setCandidates]       = useState<Candidate[]>([])
  const [loading, setLoading]             = useState(true)
  const [predictions, setPredictions]     = useState<Prediction[] | null>(null)
  const [predictedBillTitle, setBillTitle] = useState('')

  useEffect(() => {
    api.getCandidates()
      .then((d) => setCandidates(d?.candidates ?? []))
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [])

  // Group candidates by district
  const byDistrict = candidates.reduce<Record<string, Candidate[]>>((acc, c) => {
    const key = c.district
    if (!acc[key]) acc[key] = []
    acc[key].push(c)
    return acc
  }, {})

  const districtGroups = Object.entries(byDistrict).sort(([a], [b]) => {
    if (a === 'At-Large') return 1
    if (b === 'At-Large') return -1
    return a.localeCompare(b)
  })

  return (
    <div className="max-w-3xl space-y-8">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold">Philadelphia City Council Elections</h1>
        <p className="text-muted-foreground mt-1">
          Candidates for the upcoming election cycle and AI-powered vote predictions on current legislation.
        </p>
      </div>

      <DisclaimerBanner />

      {/* Predict votes section */}
      <div className="border rounded-lg p-5 space-y-4">
        <div>
          <h2 className="text-sm font-semibold">How might candidates vote?</h2>
          <p className="text-xs text-muted-foreground mt-1">
            Select a bill and AI will speculate how each candidate might vote based on their background and party affiliation.
            First call per bill may take a moment.
          </p>
        </div>
        <BillPredictSelector
          onPredictions={(data) => {
            setPredictions(data.predictions)
            setBillTitle(data.bill_title)
          }}
        />
        {predictions && (
          <PredictionResults predictions={predictions} billTitle={predictedBillTitle} />
        )}
      </div>

      {/* Candidate roster */}
      <div className="space-y-6">
        <h2 className="text-lg font-semibold">Candidates</h2>

        {loading && (
          <div className="space-y-2">
            {[...Array(3)].map((_, i) => <div key={i} className="h-20 rounded-lg bg-muted animate-pulse" />)}
          </div>
        )}

        {!loading && candidates.length === 0 && (
          <div className="text-center py-12 text-muted-foreground">
            <p className="text-sm">No candidates have been added yet.</p>
            <p className="text-xs mt-1">
              An admin can add candidates from the <Link href="/admin" className="underline hover:no-underline">admin panel</Link>.
            </p>
          </div>
        )}

        {districtGroups.map(([district, cands]) => {
          const office = cands[0]?.office_sought || district
          return (
            <div key={district}>
              <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-1">{district}</h3>
              {office && <OfficeDescription office={office} />}
              <div className="space-y-3">
                {cands.map((c) => <CandidateCard key={c.id} candidate={c} />)}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

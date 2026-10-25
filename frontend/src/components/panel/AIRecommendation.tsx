import { useEffect, useState } from 'react'
import { getRecommendation, SECTORS, type AIRecommendation as Rec, type Split } from '../../api'

// One request per country and split (rounded to 5 points): dragging sliders never calls the AI
const cache = new Map<string, Promise<Rec>>()
const keyOf = (iso3: string, split: Split | null, assumptions: Record<string, number>) =>
  `${iso3}|${split ? SECTORS.map((k) => 5 * Math.round(split[k] / 5)).join(',') : 'recommended'}|${JSON.stringify(assumptions)}`

function Part({ label, tone, children }: { label: string; tone: string; children: React.ReactNode }) {
  return (
    <div>
      <div className={`label mb-1 ${tone}`}>{label}</div>
      <div className="text-[0.84rem] leading-snug">{children}</div>
    </div>
  )
}

/** AI recommendation under the reasoning bullets, in three labelled parts so people know where each claim comes from */
export default function AIRecommendation({ iso3, split, assumptions }: { iso3: string; split: Split | null; assumptions: Record<string, number> }) {
  const [asked, setAsked] = useState<{ split: Split | null; assumptions: Record<string, number> }>({ split, assumptions })
  const [rec, setRec] = useState<Rec | null>(null)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    let live = true
    setRec(null)
    setFailed(false)
    const key = keyOf(iso3, asked.split, asked.assumptions)
    const job = cache.get(key) ?? cache.set(key, getRecommendation(iso3, asked.split, asked.assumptions)).get(key)!
    job.then((r) => live && setRec(r)).catch(() => {
      cache.delete(key)
      if (live) setFailed(true)
    })
    return () => {
      live = false
    }
  }, [iso3, asked])

  // Offer a refresh only when the split moved by 10 points or more in some bucket since the recommendation was made
  const moved = rec && split ? SECTORS.some((k) => Math.abs(split[k] - rec.split_used[k]) >= 10) : false

  return (
    <div className="border-edge mt-3 rounded-md border p-3">
      <div className="mb-2 flex items-center justify-between">
        <span className="text-[0.9rem] font-medium">AI recommendation</span>
        {moved && <button onClick={() => setAsked({ split, assumptions })} className="text-gold hover:text-ink text-[0.78rem] underline underline-offset-2">Refresh for this split</button>}
      </div>
      {failed && <p className="text-mute text-[0.82rem]">The recommendation service didn't answer. The reasoning above still comes straight from the data.</p>}
      {!rec && !failed && <p className="text-mute text-[0.82rem]">Writing a recommendation for this plan…</p>}
      {rec && (
        <div className="space-y-3">
          <Part label="From the data · World Bank and NASA" tone="text-ink">
            <ul className="space-y-0.5">{rec.data.map((d) => <li key={d}>{d}</li>)}</ul>
          </Part>
          <Part label={rec.analysis.text ? 'Analysis · AI reasoning on the data' : 'Analysis · Offline'} tone="text-gold">
            {rec.analysis.text
              ? <p>{rec.analysis.text}</p>
              : (
                <>
                  <ul className="space-y-0.5">{rec.offline.map((x) => <li key={x}>{x}</li>)}</ul>
                  <p className="text-faint mt-1 text-[0.72rem]">AI unavailable ({rec.analysis.unavailable}); showing the data-based reasoning.</p>
                </>
              )}
          </Part>
          <Part label="From the web · Google Search" tone="text-cyan">
            {rec.web.text ? (
              <>
                <p>{rec.web.text}</p>
                <ol className="mt-1 space-y-0.5 text-[0.74rem]">
                  {rec.web.sources?.map((s, i) => <li key={i}><a href={s.url} target="_blank" rel="noreferrer" className="text-cyan hover:underline">{i + 1}. {s.title}</a></li>)}
                </ol>
              </>
            ) : <p className="text-mute">No web context: {rec.web.unavailable}. Nothing here is guessed.</p>}
          </Part>
        </div>
      )}
    </div>
  )
}

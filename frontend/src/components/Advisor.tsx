import { useEffect, useRef, useState } from 'react'
import { askAdvisor, type AdvisorAnswer, type AdvisorKind, type ReformInput, type Simulation, type Split, type Supply, type Twins } from '../api'
import { formatDelta, formatMoney, formatPct } from '../lib/format'

type Entry = { question: string; answer: AdvisorAnswer | null }

/** Last resort if the backend itself cannot be reached: a template from what this page already has */
function localAnswer(kind: AdvisorKind | null, name: string, sim: Simulation | null, twins: Twins | null): AdvisorAnswer {
  let text = `Nahda data for ${name} is still loading.`
  if (kind === 'peers' && twins) {
    text = twins.twins.map((t) => `${t.country} (${t.year}, ${t.turnaround ? 'turnaround' : 'stagnated'}): ${t.changed} Access ${formatDelta(t.access_change, ' pts')}, income ${formatDelta(t.income_change)}.`).join(' ')
  } else if (kind === 'reform' && sim?.reform) {
    const r = sim.reform
    const i = Math.min(r.phase_years, 10) - 1
    text = `${formatMoney(r.freed[i])}/yr freed, +${(r.peak_cpi * 100).toFixed(1)}% inflation a year during phase-in, ${formatMoney(r.net_per_home_month[i])}/month net per household after ${formatPct(r.rebate_share * 100, 0)} rebates.`
  } else if (sim) {
    const y = sim.years[sim.years.length - 1]
    text = `By year 10: access ${formatPct(y.access_pct)}, ${Math.round(sim.rail.funded_km)} km of corridor, savings ${formatMoney(y.fund)}.`
  }
  return { answer: text, sources: [], mode: 'offline', label: 'Offline answer from Nahda data', meta: { detail: 'local', server_ms: 0 } }
}

export default function Advisor({ iso3, name, share, split, supply, reform, sim, twins }: {
  iso3: string | null
  name: string | null
  share: number
  split: Split
  supply: Supply
  reform: ReformInput | null
  sim: Simulation | null
  twins: Twins | null
}) {
  const [open, setOpen] = useState(false)
  const [entries, setEntries] = useState<Entry[]>([])
  const [text, setText] = useState('')
  const end = useRef<HTMLDivElement>(null)
  useEffect(() => setEntries([]), [iso3])
  useEffect(() => {
    end.current?.scrollIntoView({ block: 'end' })
  }, [entries])

  const busy = entries.some((e) => !e.answer)
  async function ask(question: string, kind: AdvisorKind | null) {
    if (!iso3 || !name || busy) return
    setEntries((e) => [...e, { question, answer: null }])
    let answer: AdvisorAnswer
    try {
      answer = await askAdvisor({ iso3, question, kind, share, split, supply, reform })
    } catch {
      answer = localAnswer(kind, name, sim, twins)
    }
    setEntries((e) => e.map((x, i) => (i === e.length - 1 ? { ...x, answer } : x)))
  }

  const chips: [string, AdvisorKind][] = name
    ? [[`What worked for ${name}'s closest peers?`, 'peers'], ['How should we split Power, Transport and Tourism?', 'split'], ['How can fuel subsidy reform avoid hurting families?', 'reform']]
    : []

  return (
    <div className="pointer-events-none fixed right-5 bottom-5 z-40 flex flex-col items-end gap-2">
      {open && (
        <div className="bg-panel border-edge pointer-events-auto flex max-h-[70vh] w-[400px] flex-col rounded-md border shadow-2xl" role="dialog" aria-label="Ask Nahda">
          <div className="border-edge flex items-center justify-between border-b px-4 py-2.5">
            <span className="text-[0.9rem] font-medium">Ask Nahda{name ? ` · ${name}` : ''}</span>
            <button onClick={() => setOpen(false)} className="text-mute hover:text-ink text-[0.8rem]" aria-label="Close advisor">Close</button>
          </div>
          <div className="scroll-thin flex-1 space-y-4 overflow-y-auto px-4 py-3 text-[0.84rem] leading-snug">
            {!iso3 && <p className="text-mute">Pick a country on the globe first.</p>}
            {iso3 && entries.length === 0 && <p className="text-mute">Answers use Nahda's numbers for {name}; web search adds real-world context.</p>}
            {entries.map((e, i) => (
              <div key={i}>
                <div className="text-gold mb-1">{e.question}</div>
                {!e.answer ? <div className="text-mute">Thinking…</div> : (
                  <>
                    <div className="space-y-1 whitespace-pre-line">{e.answer.answer.replace(/^\s*[*-]\s+/gm, '• ')}</div>
                    {e.answer.sources.length > 0 && (
                      <ol className="mt-2 space-y-0.5 text-[0.74rem]">
                        {e.answer.sources.map((s, j) => (
                          <li key={j}><a href={s.url} target="_blank" rel="noreferrer" className="text-cyan hover:underline">{j + 1}. {s.title}</a></li>
                        ))}
                      </ol>
                    )}
                    <div className={`mt-1.5 text-[0.7rem] ${e.answer.mode === 'offline' ? 'text-gold/80' : 'text-faint'}`}>{e.answer.label}</div>
                  </>
                )}
              </div>
            ))}
            <div ref={end} />
          </div>
          {iso3 && (
            <div className="border-edge space-y-2 border-t px-4 py-3">
              <div className="flex flex-wrap gap-1.5">
                {chips.map(([q, k]) => (
                  <button key={k} onClick={() => ask(q, k)} disabled={busy}
                    className="border-edge text-mute hover:text-ink hover:border-mute rounded-full border px-2.5 py-1 text-left text-[0.74rem] disabled:opacity-50">{q}</button>
                ))}
              </div>
              <form onSubmit={(ev) => { ev.preventDefault(); if (text.trim().length > 1) { ask(text.trim(), null); setText('') } }}>
                <input type="text" value={text} onChange={(ev) => setText(ev.target.value)} placeholder={`Ask about ${name}…`} disabled={busy}
                  className="w-full px-3 py-1.5 text-[0.84rem]" aria-label="Question" />
              </form>
            </div>
          )}
        </div>
      )}
      <button onClick={() => setOpen(!open)}
        className="bg-gold text-space pointer-events-auto rounded-full px-4 py-2 text-[0.88rem] font-medium shadow-lg transition-transform hover:scale-105">
        Ask Nahda
      </button>
    </div>
  )
}

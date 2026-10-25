import { useEffect, useRef, useState } from 'react'
import { askAdvisor, getAdvisorStatus, type AdvisorAnswer, type AdvisorKind, type Peers, type Simulation, type Split } from '../api'
import { formatNumber, formatPct } from '../lib/format'

type Entry = { question: string; answer: AdvisorAnswer | null }

/** Last resort if the backend itself cannot be reached: a template from what this page already has */
function localAnswer(kind: AdvisorKind | null, name: string, sim: Simulation | null, peers: Peers | null): AdvisorAnswer {
  let text = `Nahda data for ${name} is still loading.`
  if (kind === 'first' && sim) {
    text = sim.recommendation.banner.join(' ')
  } else if (kind === 'risk' && sim) {
    const worst = Object.values(sim.shocks).sort((a, b) => a.after.access_pct - b.after.access_pct)[0]
    text = `The biggest single risk is "${worst.label}": access in year 10 would reach ${formatPct(worst.after.access_pct, 0)} instead of ${formatPct(worst.before.access_pct, 0)}.`
  } else if (kind === 'peer' && peers) {
    const p = peers.peers[0]
    text = p ? `${p.country} from ${p.year}: ${p.changed} ${p.result}.` : `No peer meets the selection rule for ${name}.`
  } else if (kind === 'siting' && sim) {
    text = `Strongest sunlight: ${sim.sites.solar.site} (${formatNumber(sim.sites.solar.value, 1)} kWh/m²/day). Strongest 50 m wind: ${sim.sites.wind.site} (${formatNumber(sim.sites.wind.value, 1)} m/s). Actual sites need local studies.`
  } else if (sim) {
    text = `${sim.recommendation.banner.join(' ')} By year 10: access ${formatPct(sim.cards.access.value)}, clean share ${formatPct(sim.cards.access.clean)}.`
  }
  return { answer: text, sources: [], mode: 'offline', label: 'Offline answer from Nahda data', meta: { detail: 'local', server_ms: 0 } }
}

export default function Advisor({ iso3, name, split, overrides, sim, peers }: {
  iso3: string | null
  name: string | null
  split: Split | null
  overrides: Record<string, number>
  sim: Simulation | null
  peers: Peers | null
}) {
  const [open, setOpen] = useState(false)
  // What the advisor can really do right now: set from the server, then from each answer's source
  const [mode, setMode] = useState<AdvisorAnswer['mode'] | 'nokey' | null>(null)
  useEffect(() => {
    if (!open) return
    getAdvisorStatus().then((s) => setMode((m) => m ?? (s.key ? s.last_mode : 'nokey'))).catch(() => setMode('offline'))
  }, [open])
  const [entries, setEntries] = useState<Entry[]>([])
  const [text, setText] = useState('')
  const end = useRef<HTMLDivElement>(null)
  useEffect(() => setEntries([]), [iso3])
  useEffect(() => {
    end.current?.scrollIntoView({ block: 'end' })
  }, [entries])

  const busy = entries.some((e) => !e.answer)
  async function ask(question: string, kind: AdvisorKind | null) {
    if (busy) return
    setEntries((e) => [...e, { question, answer: null }])
    let answer: AdvisorAnswer
    try {
      answer = await askAdvisor({ iso3, question, kind, split, assumptions: overrides })
    } catch {
      answer = localAnswer(kind, name ?? 'this country', sim, peers)
    }
    if (answer.mode !== 'greeting') setMode(answer.mode)
    setEntries((e) => e.map((x, i) => (i === e.length - 1 ? { ...x, answer } : x)))
  }

  const chips: [string, AdvisorKind][] = name
    ? [[`What should ${name} do first?`, 'first'], [`Why did ${peers?.peers[0]?.country ?? 'its best peer'} succeed?`, 'peer'], ['Is solar or wind smarter here?', 'mix'], ['What could go wrong with this plan?', 'risk']]
    : []

  return (
    <div className="pointer-events-none fixed right-5 bottom-5 z-40 flex flex-col items-end gap-2">
      {open && (
        <div className="bg-panel border-edge pointer-events-auto flex max-h-[70vh] w-[400px] flex-col rounded-md border shadow-2xl" role="dialog" aria-label="Ask Nahda">
          <div className="border-edge flex items-center justify-between border-b px-4 py-2.5">
            <div>
              <div className="text-[0.9rem] font-medium">Ask Nahda{name ? ` · ${name}` : ''}</div>
              <div className="text-mute flex items-center gap-1.5 text-[0.7rem]" aria-label="Advisor status">
                <span className="inline-block h-2 w-2 rounded-full" style={{ background: mode === 'web' ? '#22c55e' : mode === 'model' || mode === null ? '#f59e0b' : '#9ca3af' }} />
                {mode === 'web' ? 'Live AI + Web Search' : mode === 'model' ? 'Live AI · web search unavailable' : mode === null ? 'Live AI' : 'Offline Data Mode'}
              </div>
            </div>
            <button onClick={() => setOpen(false)} className="text-mute hover:text-ink text-[0.8rem]" aria-label="Close advisor">Close</button>
          </div>
          <div className="scroll-thin flex-1 space-y-4 overflow-y-auto px-4 py-3 text-[0.84rem] leading-snug">
            {entries.length === 0 && (
              <p className="text-mute">{iso3 ? `Answers use Nahda's numbers for ${name}; web search adds real-world context when available.` : 'Ask anything about electricity access, or pick a country on the globe for its own plan.'}</p>
            )}
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
                    {e.answer.label && <div className={`mt-1.5 text-[0.7rem] ${e.answer.mode === 'offline' ? 'text-gold/80' : 'text-faint'}`}>{e.answer.label}</div>}
                    {e.answer.note && <div className="text-faint mt-0.5 text-[0.68rem]">Why: {e.answer.note}</div>}
                  </>
                )}
              </div>
            ))}
            <div ref={end} />
          </div>
          <div className="border-edge space-y-2 border-t px-4 py-3">
              {iso3 && <div className="flex flex-wrap gap-1.5">
                {chips.map(([q, k]) => (
                  <button key={k} onClick={() => ask(q, k)} disabled={busy}
                    className="border-edge text-mute hover:text-ink hover:border-mute rounded-full border px-2.5 py-1 text-left text-[0.74rem] disabled:opacity-50">{q}</button>
                ))}
              </div>}
              <form onSubmit={(ev) => { ev.preventDefault(); if (text.trim()) { ask(text.trim(), null); setText('') } }}>
                <input type="text" value={text} onChange={(ev) => setText(ev.target.value)} placeholder={name ? `Ask about ${name}…` : 'Ask a question…'} disabled={busy}
                  className="w-full px-3 py-1.5 text-[0.84rem]" aria-label="Question" />
              </form>
          </div>
        </div>
      )}
      <button onClick={() => setOpen(!open)}
        className="bg-gold text-space pointer-events-auto rounded-full px-4 py-2 text-[0.88rem] font-medium shadow-lg transition-transform hover:scale-105">
        Ask Nahda
      </button>
    </div>
  )
}

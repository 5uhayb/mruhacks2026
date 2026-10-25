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

  const chips: [string, AdvisorKind | null][] = name
    ? [[`What should ${name} do first?`, 'first'], [`Why did ${peers?.peers[0]?.country ?? 'its best peer'} succeed?`, 'peer'], ['Is solar or wind smarter here?', 'mix'], ['What could go wrong with this plan?', 'risk']]
    : [['Which countries lack power the most?', null], ['Is solar or wind better for Africa?', null], ['How do countries reach rural villages?', null], ['What does a reserve fund protect against?', null]]

  const input = useRef<HTMLTextAreaElement>(null)
  // Grow the box with the text, up to about five lines
  useEffect(() => {
    const el = input.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${Math.min(el.scrollHeight, 120)}px`
  }, [text])
  const send = () => {
    const q = text.trim()
    if (!q || busy) return
    ask(q, null)
    setText('')
  }

  return (
    <div className="pointer-events-none fixed right-5 bottom-5 z-40 flex flex-col items-end gap-2">
      {open && (
        <div className="bg-panel border-edge pointer-events-auto flex h-[min(450px,70vh)] w-[min(310px,calc(100vw-2.5rem))] flex-col overflow-hidden rounded-2xl border shadow-2xl" role="dialog" aria-label="Ask Nahda">
          <div className="border-edge flex items-center gap-3 border-b px-4 py-3">
            <Avatar />
            <div className="min-w-0 flex-1">
              <div className="text-[0.95rem] font-medium">Ask Nahda{name ? ` · ${name}` : ''}</div>
              <div className="text-mute flex items-center gap-1.5 text-[0.7rem]" aria-label="Advisor status">
                <span className="inline-block h-2 w-2 rounded-full" style={{ background: mode === 'web' ? '#22c55e' : mode === 'model' || mode === null ? '#f59e0b' : '#9ca3af' }} />
                {mode === 'web' ? 'Live AI + Web Search' : mode === 'model' ? 'Live AI · web search unavailable' : mode === null ? 'Live AI' : 'Offline Data Mode'}
              </div>
            </div>
            {entries.length > 0 && (
              <button onClick={() => setEntries([])} disabled={busy} className="text-mute hover:text-ink rounded-md px-2 py-1 text-[0.78rem] disabled:opacity-40" title="Start a new chat">New chat</button>
            )}
            <button onClick={() => setOpen(false)} className="text-mute hover:text-ink rounded-md px-2 py-1 text-[1.1rem] leading-none" aria-label="Close advisor">×</button>
          </div>

          <div className="scroll-thin flex-1 overflow-y-auto px-4 py-4 text-[0.88rem] leading-relaxed">
            {entries.length === 0 ? (
              <div className="flex h-full flex-col items-center justify-center text-center">
                <Avatar big />
                <div className="mt-3 text-[1.15rem] font-medium">How can I help{name ? ` with ${name}` : ''}?</div>
                <p className="text-mute mt-1 max-w-[300px] text-[0.8rem]">
                  {iso3 ? `I answer with Nahda's World Bank and NASA numbers for ${name}.` : 'Ask anything about electricity access, or pick a country on the globe.'}
                </p>
                <div className="mt-5 grid w-full grid-cols-2 gap-2">
                  {chips.map(([q, k]) => (
                    <button key={q} onClick={() => ask(q, k)} disabled={busy}
                      className="border-edge hover:bg-edge/60 hover:border-mute rounded-xl border px-3 py-2.5 text-left text-[0.8rem] leading-snug transition-colors disabled:opacity-50">{q}</button>
                  ))}
                </div>
              </div>
            ) : (
              <div className="space-y-5">
                {entries.map((e, i) => (
                  <div key={i} className="space-y-3">
                    <div className="flex justify-end">
                      <div className="bg-edge max-w-[85%] rounded-2xl rounded-br-md px-3.5 py-2 whitespace-pre-wrap">{e.question}</div>
                    </div>
                    <div className="flex gap-2.5">
                      <Avatar />
                      <div className="min-w-0 flex-1 pt-0.5">
                        {!e.answer ? <Typing /> : (
                          <>
                            <Formatted text={e.answer.answer} />
                            {e.answer.sources.length > 0 && (
                              <div className="mt-2 flex flex-wrap gap-1.5">
                                {e.answer.sources.map((src, j) => (
                                  <a key={j} href={src.url} target="_blank" rel="noreferrer" title={src.url}
                                    className="border-edge text-cyan hover:border-cyan/60 max-w-[200px] truncate rounded-full border px-2 py-0.5 text-[0.72rem]">{j + 1}. {src.title}</a>
                                ))}
                              </div>
                            )}
                            {(e.answer.label || e.answer.note) && (
                              <div className={`mt-1.5 text-[0.68rem] ${e.answer.mode === 'offline' ? 'text-gold/80' : 'text-faint'}`}>
                                {e.answer.label}{e.answer.note ? `${e.answer.label ? ' · ' : ''}${e.answer.note}` : ''}
                              </div>
                            )}
                          </>
                        )}
                      </div>
                    </div>
                  </div>
                ))}
                <div ref={end} />
              </div>
            )}
          </div>

          <div className="px-3 pt-1 pb-3">
            <div className="border-edge bg-space focus-within:border-mute flex items-end gap-2 rounded-2xl border px-3 py-2 transition-colors">
              <textarea ref={input} rows={1} value={text} onChange={(ev) => setText(ev.target.value)} disabled={busy}
                onKeyDown={(ev) => { if (ev.key === 'Enter' && !ev.shiftKey) { ev.preventDefault(); send() } }}
                placeholder={name ? `Message Nahda about ${name}…` : 'Message Nahda…'} aria-label="Question"
                className="placeholder:text-faint max-h-[120px] flex-1 resize-none bg-transparent py-1 text-[0.88rem] leading-snug outline-none" />
              <button onClick={send} disabled={!text.trim() || busy} aria-label="Send"
                className="bg-ink text-space grid h-8 w-8 shrink-0 place-items-center rounded-full transition-opacity disabled:opacity-30">
                <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden><path d="M7 12V2M7 2L2.5 6.5M7 2l4.5 4.5" stroke="currentColor" strokeWidth="1.8" fill="none" strokeLinecap="round" strokeLinejoin="round" /></svg>
              </button>
            </div>
            <div className="text-faint mt-1.5 text-center text-[0.66rem]">Enter to send · Shift+Enter for a new line · numbers come from Nahda's data</div>
          </div>
        </div>
      )}
      <button onClick={() => setOpen(!open)}
        className="bg-gold text-space pointer-events-auto flex items-center gap-2 rounded-full px-4 py-2 text-[0.88rem] font-medium shadow-lg transition-transform hover:scale-105">
        <span className="bg-space/15 grid h-5 w-5 place-items-center rounded-full text-[0.7rem] font-semibold">N</span>Ask Nahda
      </button>
    </div>
  )
}

function Avatar({ big }: { big?: boolean }) {
  return (
    <div className={`bg-gold text-space grid shrink-0 place-items-center rounded-full font-semibold ${big ? 'h-12 w-12 text-[1.2rem]' : 'h-7 w-7 text-[0.8rem]'}`} aria-hidden>N</div>
  )
}

function Typing() {
  return (
    <div className="flex items-center gap-1 py-2" aria-label="Nahda is typing">
      {[0, 1, 2].map((i) => <span key={i} className="typing-dot bg-mute inline-block h-1.5 w-1.5 rounded-full" style={{ animationDelay: `${i * 160}ms` }} />)}
    </div>
  )
}

/** Light formatting for answers: paragraphs, bullet lists and **bold**, like a chat app */
function Formatted({ text }: { text: string }) {
  const bold = (t: string) => t.split(/\*\*(.+?)\*\*/g).map((part, j) => (j % 2 ? <strong key={j} className="text-ink font-semibold">{part}</strong> : part))
  const blocks = text.trim().split(/\n\s*\n/)
  return (
    <div className="space-y-2.5">
      {blocks.map((block, i) => {
        const lines = block.split('\n').filter((l) => l.trim())
        if (lines.length && lines.every((l) => /^\s*([*•-]|\d+\.)\s+/.test(l))) {
          return (
            <ul key={i} className="ml-4 list-disc space-y-1">
              {lines.map((l, j) => <li key={j}>{bold(l.replace(/^\s*([*•-]|\d+\.)\s+/, ''))}</li>)}
            </ul>
          )
        }
        return <p key={i}>{bold(lines.join(' '))}</p>
      })}
    </div>
  )
}

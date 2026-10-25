import { useEffect, useRef, useState } from 'react'
import { askAdvisor, type AdvisorAnswer, type AdvisorKind, type AnswerCard, type CardIcon, type Peers, type Simulation, type Split } from '../api'
import { formatNumber, formatPct } from '../lib/format'

type Entry = { question: string; answer: AdvisorAnswer | null }

/** Last resort if the backend itself cannot be reached: a plain answer from what this page already has */
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
    text = `Strongest sunlight: ${sim.sites.solar.site} (${formatNumber(sim.sites.solar.value, 1)} kWh/m²/day). Strongest 50 m wind: ${sim.sites.wind.site} (${formatNumber(sim.sites.wind.value, 1)} m/s).`
  } else if (sim) {
    text = `${sim.recommendation.banner.join(' ')} By year 10: access ${formatPct(sim.cards.access.value)}.`
  }
  return { answer: text, sources: [], mode: 'offline', label: '', card: null, meta: { detail: 'local', server_ms: 0 } }
}

/** Small outline icons for card rows (16px, current colour) */
function Icon({ name }: { name: CardIcon }) {
  const paths: Record<CardIcon, React.ReactNode> = {
    sun: <><circle cx="12" cy="12" r="4" /><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" /></>,
    wind: <path d="M3 8h11a3 3 0 1 0-3-3M3 12h16a3 3 0 1 1-3 3M3 16h8" />,
    bolt: <path d="M13 2 4 14h7l-1 8 9-12h-7l1-8Z" />,
    home: <><path d="M3 11 12 4l9 7" /><path d="M5 10v10h14V10" /><path d="M10 20v-5h4v5" /></>,
    shield: <path d="M12 3 4 6v6c0 4.5 3.4 8.3 8 9 4.6-.7 8-4.5 8-9V6l-8-3Z" />,
    people: <><circle cx="9" cy="8" r="3" /><path d="M3 20a6 6 0 0 1 12 0" /><path d="M16 5a3 3 0 0 1 0 6M21 20a6 6 0 0 0-4-5.6" /></>,
    pin: <><path d="M12 21s-7-6.2-7-11a7 7 0 0 1 14 0c0 4.8-7 11-7 11Z" /><circle cx="12" cy="10" r="2.5" /></>,
  }
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden className="shrink-0">
      {paths[name]}
    </svg>
  )
}

/** Nahda's answer: bold verdict, label/value rows with thin dividers, a muted "why", a faint source line */
function Card({ card, about, sources }: { card: AnswerCard; about?: AdvisorAnswer['about']; sources: AdvisorAnswer['sources'] }) {
  return (
    <div className="bg-panel border-edge max-w-[92%] rounded-xl border px-3.5 py-3">
      {about && <div className="text-cyan mb-1 text-[0.68rem] tracking-wide uppercase">About {about.name}</div>}
      <div className="text-ink text-[0.92rem] leading-snug font-semibold">{card.verdict}</div>
      <div className="mt-2">
        {card.facts.map((f, i) => (
          <div key={i} className={`grid grid-cols-[auto_1fr] items-start gap-x-3 py-1.5 ${i ? 'border-edge border-t' : ''}`}>
            <span className="text-mute flex items-center gap-1.5 pt-px text-[0.78rem]"><Icon name={f.icon} />{f.label}</span>
            <span className="text-right text-[0.8rem] leading-snug">
              <span className="text-ink">{f.value}</span>
              {f.detail && <span className="text-faint num block text-[0.68rem]">{f.detail}</span>}
            </span>
          </div>
        ))}
      </div>
      {card.why && <p className="text-mute mt-2 text-[0.8rem] leading-snug">{card.why}</p>}
      <div className="text-faint mt-2 text-[0.68rem]">{card.source}</div>
      {sources.length > 0 && (
        <div className="mt-1 flex flex-wrap gap-x-2 text-[0.68rem]">
          {sources.map((s, j) => <a key={j} href={s.url} target="_blank" rel="noreferrer" className="text-cyan/80 hover:text-cyan truncate hover:underline">{j + 1}. {s.title}</a>)}
        </div>
      )}
    </div>
  )
}

/** The user's question: right-aligned bubble with a tail at the bottom right */
function Question({ text }: { text: string }) {
  return (
    <div className="fade flex justify-end">
      <div className="relative max-w-[82%]">
        <div className="text-cyan rounded-2xl rounded-br-[4px] bg-[#123150] px-3.5 py-2 text-[0.84rem] leading-snug">{text}</div>
        <svg className="absolute -right-[6px] bottom-0" width="8" height="10" viewBox="0 0 8 10" aria-hidden><path d="M0 0v10h8C4 9 1 6 0 0Z" fill="#123150" /></svg>
      </div>
    </div>
  )
}

/** Three dots while the answer is on its way */
function Typing() {
  return (
    <div className="bg-panel border-edge flex w-fit gap-1 rounded-xl border px-3.5 py-3" aria-label="Nahda is answering">
      {[0, 1, 2].map((i) => <span key={i} className="typing-dot bg-mute h-1.5 w-1.5 rounded-full" style={{ animationDelay: `${i * 160}ms` }} />)}
    </div>
  )
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
  const [entries, setEntries] = useState<Entry[]>([])
  const [text, setText] = useState('')
  const end = useRef<HTMLDivElement>(null)
  const input = useRef<HTMLInputElement>(null)
  useEffect(() => setEntries([]), [iso3])
  useEffect(() => {
    end.current?.scrollIntoView({ block: 'end', behavior: 'smooth' })
  }, [entries])
  useEffect(() => {
    if (open) input.current?.focus()
  }, [open])

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
    setEntries((e) => e.map((x, i) => (i === e.length - 1 ? { ...x, answer } : x)))
  }

  const twin = peers?.peers[0]?.country
  const endYear = (sim?.start.access_year ?? new Date().getFullYear()) + 10
  // [full question, short label once the conversation has started, kind]
  const chips: [string, string, AdvisorKind][] = name
    ? [
        [`What should ${name} do first?`, 'What first?', 'first'],
        [twin ? `What did ${twin} do differently?` : 'Which country closed a gap like this?', twin ? `Why ${twin}?` : 'Peers?', 'peer'],
        [`How many people would get power by ${endYear}?`, `By ${endYear}?`, 'people'],
        ['How reliable is this plan?', 'Risks?', 'risk'],
      ]
    : []
  const started = entries.length > 0

  return (
    <>
      {open && (
        // Above the timeline and below the country panel's header, whatever the screen height
        <div className="bg-space/95 border-edge fade fixed right-5 bottom-[84px] z-40 flex max-h-[calc(100vh-290px)] min-h-[300px] w-[380px] flex-col rounded-2xl border shadow-2xl shadow-black/60 backdrop-blur"
          role="dialog" aria-label="Ask Nahda">
          <div className="flex shrink-0 items-start justify-between px-4 pt-3.5 pb-2.5">
            <div>
              <div className="text-[0.95rem] font-semibold">Ask Nahda{name ? ` · ${name}` : ''}</div>
              <div className="text-mute mt-0.5 flex items-center gap-1.5 text-[0.7rem]">
                <span className="bg-gold inline-block h-1.5 w-1.5 rounded-full" />Answers from World Bank & NASA data
              </div>
            </div>
            <button onClick={() => setOpen(false)} className="text-mute hover:text-ink hover:bg-edge -mr-1 grid h-7 w-7 place-items-center rounded-full transition-colors" aria-label="Close chat">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden><path d="M6 6l12 12M18 6 6 18" /></svg>
            </button>
          </div>

          <div className="scroll-thin flex-1 space-y-3 overflow-y-auto px-4 pb-2" aria-live="polite">
            {!started && (
              <div className="fade space-y-2 pt-1">
                <p className="text-mute text-[0.8rem]">{name ? `Ask anything about ${name}, or start with one of these:` : 'Say hello, or pick a country on the globe to ask about its plan.'}</p>
                {chips.map(([q, , k]) => (
                  <button key={k} onClick={() => ask(q, k)}
                    className="border-edge hover:border-cyan/60 hover:text-ink text-mute block w-full rounded-xl border px-3 py-2 text-left text-[0.8rem] transition-colors">
                    {q}
                  </button>
                ))}
              </div>
            )}
            {entries.map((e, i) => (
              <div key={i} className="space-y-2">
                <Question text={e.question} />
                <div className="fade">
                  {!e.answer ? <Typing />
                    : e.answer.card ? <Card card={e.answer.card} about={e.answer.about} sources={e.answer.sources} />
                    : <div className="bg-panel border-edge w-fit max-w-[92%] rounded-xl border px-3.5 py-2.5 text-[0.84rem] leading-snug">{e.answer.answer}</div>}
                </div>
              </div>
            ))}
            <div ref={end} />
          </div>

          {started && chips.length > 0 && (
            <div className="scroll-thin flex shrink-0 gap-1.5 overflow-x-auto px-4 pt-1 pb-2" aria-label="Suggested questions">
              {chips.map(([q, short, k]) => (
                <button key={k} onClick={() => ask(q, k)} disabled={busy} title={q}
                  className="border-edge text-mute hover:text-ink hover:border-mute shrink-0 rounded-full border px-3 py-1 text-[0.76rem] whitespace-nowrap transition-colors disabled:opacity-40">
                  {short}
                </button>
              ))}
            </div>
          )}

          <form className="shrink-0 px-4 pb-4" onSubmit={(ev) => { ev.preventDefault(); if (text.trim()) { ask(text.trim(), null); setText('') } }}>
            <div className="border-edge focus-within:border-mute bg-panel flex items-center rounded-full border pr-1.5 pl-4 transition-colors">
              <input ref={input} type="text" value={text} onChange={(ev) => setText(ev.target.value)} disabled={busy}
                placeholder={name ? `Ask about ${name}…` : 'Say hello…'} aria-label="Question"
                className="min-w-0 flex-1 !border-0 !bg-transparent py-2 text-[0.84rem] outline-none" />
              <button type="submit" disabled={busy || !text.trim()} aria-label="Send"
                className="bg-gold text-space grid h-7 w-7 shrink-0 place-items-center rounded-full transition-opacity disabled:opacity-30">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="M5 12h14M13 6l6 6-6 6" /></svg>
              </button>
            </div>
          </form>
        </div>
      )}
      {!open && (
        <button onClick={() => setOpen(true)}
          className="bg-gold text-space fixed right-5 bottom-5 z-40 rounded-full px-4 py-2 text-[0.88rem] font-medium shadow-lg transition-transform hover:scale-105">
          Ask Nahda
        </button>
      )}
    </>
  )
}

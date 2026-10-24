import { useEffect, useMemo, useRef, useState } from 'react'
import type { WorldCountry } from '../api'
import { formatPct } from '../lib/format'
import { useLog } from '../log'

/** Top bar: wordmark and country search. Cmd/Ctrl+K focuses it, Enter flies to the first match. */
export function CommandBar({ countries, onSelect, systemOpen, onToggleSystem }: {
  countries: WorldCountry[]
  onSelect: (iso3: string) => void
  systemOpen: boolean
  onToggleSystem: () => void
}) {
  const [query, setQuery] = useState('')
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(0)
  const input = useRef<HTMLInputElement>(null)

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        input.current?.focus()
        setOpen(true)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const matches = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return []
    return countries
      .filter((c) => c.name.toLowerCase().includes(q) || c.iso3.toLowerCase() === q)
      .sort((a, b) => Number(!a.name.toLowerCase().startsWith(q)) - Number(!b.name.toLowerCase().startsWith(q)))
      .slice(0, 7)
  }, [query, countries])

  function choose(iso3: string) {
    onSelect(iso3)
    setQuery('')
    setOpen(false)
    input.current?.blur()
  }

  return (
    <div className="pointer-events-none absolute top-0 right-0 left-0 z-20 flex items-center gap-4 px-5 py-4">
      <div className="pointer-events-auto flex items-baseline gap-2">
        <span className="text-[1.15rem] font-semibold tracking-tight">Nahda</span>
        <span className="text-mute text-[1rem]" lang="ar">نهضة</span>
      </div>
      <div className="pointer-events-auto relative w-[340px]">
        <input
          ref={input}
          type="text"
          value={query}
          placeholder="Search a country"
          onChange={(e) => {
            setQuery(e.target.value)
            setOpen(true)
            setActive(0)
          }}
          onFocus={() => setOpen(true)}
          onBlur={() => setTimeout(() => setOpen(false), 150)}
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown') setActive((a) => Math.min(matches.length - 1, a + 1))
            if (e.key === 'ArrowUp') setActive((a) => Math.max(0, a - 1))
            if (e.key === 'Enter' && matches[active]) choose(matches[active].iso3)
            if (e.key === 'Escape') input.current?.blur()
          }}
          className="bg-panel/90 w-full px-3 py-2 text-[0.9rem] backdrop-blur-0"
          aria-label="Search a country"
        />
        <kbd className="num text-faint border-edge pointer-events-none absolute top-1/2 right-2 -translate-y-1/2 rounded border px-1.5 text-[0.7rem]">Ctrl K</kbd>
        {open && matches.length > 0 && (
          <ul className="bg-panel border-edge absolute top-full right-0 left-0 mt-1 overflow-hidden rounded-md border">
            {matches.map((c, i) => (
              <li key={c.iso3}>
                <button
                  onMouseDown={() => choose(c.iso3)}
                  onMouseEnter={() => setActive(i)}
                  className={`flex w-full items-baseline justify-between gap-3 px-3 py-2 text-left text-[0.88rem] ${i === active ? 'bg-edge' : ''}`}
                >
                  <span>{c.name}</span>
                  <span className="num text-faint text-[0.72rem]">{c.iso3}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
      <button onClick={onToggleSystem} className={`pointer-events-auto ml-auto text-[0.8rem] ${systemOpen ? 'text-ink' : 'text-mute hover:text-ink'}`}>
        <kbd className="num border-edge mr-1.5 rounded border px-1.5 text-[0.7rem]">`</kbd>System
      </button>
    </div>
  )
}

/** Bottom scrubber: 1990 → today (measured) → +10 years (projected) */
export function TimeScrubber({ years, year, lastMeasured, setYear, rightInset, plan }: {
  years: number[]
  year: number
  lastMeasured: number
  setYear: (y: number) => void
  rightInset: number
  /** The selected country's plan, if any: its projected access for this year and the with/without toggle */
  plan: { country: string; value: number | null; usePlan: boolean; setUsePlan: (v: boolean) => void } | null
}) {
  const [playing, setPlaying] = useState(false)
  const first = years[0]
  const last = years[years.length - 1]
  useEffect(() => {
    if (!playing) return
    const t = setInterval(() => {
      setYear(year >= last ? first : year + 1)
    }, 260)
    return () => clearInterval(t)
  }, [playing, year, first, last, setYear])
  const projected = year > lastMeasured
  const todayPct = ((lastMeasured - first) / (last - first)) * 100
  return (
    <div className="absolute bottom-5 left-5 z-10 flex items-center gap-4" style={{ right: rightInset + 20 }}>
      <button onClick={() => setPlaying(!playing)} className="border-edge bg-panel hover:border-mute grid h-9 w-9 shrink-0 place-items-center rounded-md border" aria-label={playing ? 'Pause' : 'Play'}>
        {playing ? (
          <svg width="12" height="12" viewBox="0 0 12 12"><rect x="2" y="1" width="3" height="10" fill="#e8ecf3" /><rect x="7" y="1" width="3" height="10" fill="#e8ecf3" /></svg>
        ) : (
          <svg width="12" height="12" viewBox="0 0 12 12"><path d="M2 1 L11 6 L2 11 Z" fill="#e8ecf3" /></svg>
        )}
      </button>
      <div className="relative flex-1">
        {/* projected stretch drawn in gold behind the track */}
        <div className="pointer-events-none absolute top-[9.5px] h-[3px] rounded-r" style={{ left: `${todayPct}%`, right: 0, background: 'repeating-linear-gradient(90deg, rgba(242,169,59,0.55) 0 4px, transparent 4px 7px)' }} />
        <input className="scrub relative" type="range" min={first} max={last} step={1} value={year} onChange={(e) => setYear(Number(e.target.value))} aria-label="Year" />
        <div className="num text-faint relative h-4 text-[0.7rem]">
          <span className="absolute left-0">{first}</span>
          <span className="absolute -translate-x-1/2" style={{ left: `${todayPct}%` }}>{lastMeasured} · latest data</span>
          <span className="text-gold/70 absolute right-0">{last} projected</span>
        </div>
      </div>
      {plan && (
        <div className="border-edge bg-panel flex shrink-0 overflow-hidden rounded-md border text-[0.72rem]" role="group" aria-label="Projection">
          {[true, false].map((v) => (
            <button key={String(v)} onClick={() => plan.setUsePlan(v)}
              className={`px-2.5 py-1.5 ${plan.usePlan === v ? 'bg-edge text-ink' : 'text-mute hover:text-ink'}`}>
              {v ? 'With plan' : 'Without plan'}
            </button>
          ))}
        </div>
      )}
      <div className="w-52 shrink-0 text-right">
        <div className={`num text-[1.6rem] leading-none ${projected ? 'text-gold' : ''}`}>{year}</div>
        <div className="text-mute mt-1 text-[0.72rem] leading-snug">
          {!projected
            ? 'Electricity access, measured'
            : plan?.usePlan && plan.value != null
              ? `Projected with your plan: ${plan.country} ${formatPct(plan.value)}`
              : 'Projected, no new plan (impact model)'}
        </div>
      </div>
    </div>
  )
}

/** Live log of real API calls (toggle with the ` key) */
export function SystemDrawer({ open }: { open: boolean }) {
  const lines = useLog()
  const end = useRef<HTMLDivElement>(null)
  useEffect(() => {
    // Block body on purpose: some browsers return a Promise from scrollIntoView, which React would treat as a cleanup
    end.current?.scrollIntoView({ block: 'end' })
  }, [lines.length, open])
  if (!open) return null
  return (
    <div className="bg-panel border-edge fade absolute bottom-24 left-5 z-30 w-[560px] rounded-md border">
      <div className="border-edge flex items-center justify-between border-b px-3 py-2">
        <span className="label">System</span>
        <span className="num text-faint text-[0.7rem]">React → FastAPI · models loaded at startup · data cached locally</span>
      </div>
      <div className="scroll-thin num max-h-[220px] overflow-y-auto px-3 py-2 text-[0.72rem] leading-relaxed">
        {lines.length === 0 && <div className="text-faint">No calls yet.</div>}
        {lines.map((l) => (
          <div key={l.id} className={l.error ? 'text-down' : 'text-mute'}>
            <span className="text-faint">{l.time}</span> <span className="text-ink">{l.method} {l.path}</span> → {l.detail}
            {l.ms > 0 && <span className="text-ink"> · {l.ms}ms</span>}
          </div>
        ))}
        <div ref={end} />
      </div>
    </div>
  )
}

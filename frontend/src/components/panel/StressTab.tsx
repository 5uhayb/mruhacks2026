import { useMemo, useState } from 'react'
import type { ShockSide, Simulation } from '../../api'
import { formatCompact, formatDelta, formatPct } from '../../lib/format'
import { Info, Section, fitDomain, useSize } from '../ui'

const ROWS: { key: keyof ShockSide; label: string; fmt: (v: number) => string; ceiling?: number }[] = [
  { key: 'solar_mw', label: 'Solar built', fmt: (v) => formatCompact(v, 'MW') },
  { key: 'wind_mw', label: 'Wind built', fmt: (v) => formatCompact(v, 'MW') },
  { key: 'line_km', label: 'Lines built', fmt: (v) => formatCompact(v, 'km') },
  { key: 'clean_pct', label: 'Clean electricity', fmt: formatPct, ceiling: 100 },
  { key: 'access_pct', label: 'Has electricity', fmt: formatPct, ceiling: 100 },
]

/** 500 faint futures plus the median; the selected shock drawn as a bold red dashed line */
function Futures({ paths, start, startYear, shock }: { paths: number[][]; start: number; startYear: number; shock: number[] | null }) {
  const [ref, { width: w }] = useSize<HTMLDivElement>()
  const h = 190
  const pad = { l: 40, r: 10, t: 8, b: 22 }
  const [lo, hi] = useMemo(() => fitDomain([start, ...paths.flat(), ...(shock ?? [])]), [paths, start, shock])
  const x = (i: number) => pad.l + (i / 10) * (w - pad.l - pad.r)
  const y = (v: number) => pad.t + (1 - (v - lo) / (hi - lo || 1)) * (h - pad.t - pad.b)
  const median = useMemo(() => Array.from({ length: 10 }, (_, t) => {
    const col = paths.map((p) => p[t]).sort((a, b) => a - b)
    return col[Math.floor(col.length / 2)]
  }), [paths])
  const d = (vals: number[]) => [start, ...vals].map((v, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join('')
  const ticks = [lo, Math.round((lo + hi) / 2), hi]
  return (
    <div ref={ref} style={{ height: h }}>
      {w > 0 && (
        <svg width={w} height={h} role="img" aria-label="Paths of the plan across 500 futures">
          {ticks.map((v) => (
            <g key={v}>
              <line x1={pad.l} x2={w - pad.r} y1={y(v)} y2={y(v)} stroke="#1e2638" />
              <text x={pad.l - 6} y={y(v) + 3} textAnchor="end" fill="#4b5468" fontSize={10} fontFamily="Geist Mono Variable">{v}%</text>
            </g>
          ))}
          {[0, 2, 4, 6, 8, 10].map((i) => (
            <text key={i} x={x(i)} y={h - 5} textAnchor="middle" fill="#4b5468" fontSize={10} fontFamily="Geist Mono Variable">{startYear + i}</text>
          ))}
          {paths.map((p, i) => (
            <path key={i} d={d(p)} pathLength={1} className="draw" fill="none" stroke="#f2a93b" strokeOpacity={0.07} strokeWidth={1.2} style={{ animationDelay: `${(i % 100) * 8}ms` }} />
          ))}
          <path d={d(median)} pathLength={1} className="draw" fill="none" stroke="#e8ecf3" strokeWidth={2} style={{ animationDelay: '900ms' }} />
          {shock && <path key={shock.join()} d={d(shock)} fill="none" stroke="#ef5350" strokeWidth={2.5} strokeDasharray="6 4" className="fade" />}
        </svg>
      )}
    </div>
  )
}

function How({ children }: { children: React.ReactNode }) {
  return (
    <div className="border-edge bg-space/40 mt-3 rounded-md border px-3 py-2 text-[0.8rem] leading-snug">
      <div className="label mb-0.5">How we calculated this</div>
      <p className="text-mute">{children}</p>
    </div>
  )
}

export default function StressTab({ sim, name }: { sim: Simulation; name: string }) {
  const [shock, setShock] = useState('budget_cut')
  const [compare, setCompare] = useState(false)
  const s = sim.shocks[shock]
  const f = sim.futures
  const startYear = sim.start.access_year ?? new Date().getFullYear()
  // Plot whichever outcome actually varies across futures
  const spread = (paths: number[][]) => Math.max(...paths.map((p) => p[9])) - Math.min(...paths.map((p) => p[9]))
  const useAccess = spread(f.access_paths) > 1
  const metric = useAccess ? 'Electricity access' : 'Clean electricity share'
  const shockPath = s.path.map((p) => (useAccess ? p.access_pct : p.clean_pct))

  // Biggest drawdowns first; rows that did not move (or sit at a ceiling) last, with a reason
  const rows = ROWS.map((r) => {
    const [b, a] = [Number(s.before[r.key]), Number(s.after[r.key])]
    const change = b ? (a - b) / Math.abs(b) : 0
    return { ...r, b, a, change, still: Math.abs(a - b) < 1e-6 }
  }).sort((p, q) => Number(p.still) - Number(q.still) || Math.abs(q.change) - Math.abs(p.change))
  const solarCut = s.after.solar_mw + s.after.wind_mw < s.before.solar_mw + s.before.wind_mw - 1e-6

  return (
    <>
      <Section title={`${f.runs} budget futures`} right={`From ${f.history_years} GDP history`}>
        <p className="text-[0.85rem] leading-snug">{metric} (%) in each future.</p>
        <div className="text-mute mt-1 mb-2 flex flex-wrap gap-x-4 text-[0.72rem]">
          <span><span className="bg-gold/60 mr-1.5 inline-block h-[2px] w-3 align-middle" />One future each</span>
          <span><span className="bg-ink mr-1.5 inline-block h-[2px] w-3 align-middle" />Median</span>
          {compare && <span><span className="border-down mr-1.5 inline-block w-3 border-t-2 border-dashed align-middle" />{s.label} (single shock)</span>}
        </div>
        <Futures key={`${sim.budget.total}-${sim.split.solar}-${sim.split.wind}`} paths={useAccess ? f.access_paths : f.clean_paths} start={useAccess ? sim.start.access : sim.start.clean}
          startYear={startYear} shock={compare ? shockPath : null} />
        <p className="mt-3 text-[0.9rem] leading-snug">
          In 9 of 10 futures, {useAccess ? 'electricity access' : 'clean electricity'} still reaches{' '}
          <span className="num text-gold">{formatPct(useAccess ? f.access_p10 : f.clean_p10)}</span> by {startYear + 10},
          and the plan stays on track in <span className="num">{formatPct(f.on_track * 100, 0)}</span> of them.
        </p>
        <How>
          We ran the plan through {f.runs} possible futures. In each one, {name}'s budget rises and falls the way its own economy really did:
          year-to-year changes in GDP from {f.history_years}{f.resource_years ? ` and in ${f.resource_word} income from ${f.resource_years}` : ''},
          picked at random in {f.block_years}-year chunks, with the budget drifting {formatPct(f.drift_back * 100, 0)} a year back toward normal.
          When money runs short or costs run over, the reserve fund tops up spending. A plan "stays on track" if at least {formatPct(f.on_track_threshold * 100, 0)} of
          its planned spending happens. By year 10 the budget ranges from {formatPct(f.budget_p10 * 100, 0)} to {formatPct(f.budget_p90 * 100, 0)} of today's in 8 of 10 futures.
        </How>
      </Section>

      <div className="border-edge border-b px-5 py-3">
        <button onClick={() => setCompare(!compare)} className="text-mute hover:text-ink text-[0.85rem]" aria-expanded={compare}>
          Compare single shocks {compare ? '▴' : '▾'}
        </button>
      </div>
      {compare && (
      <Section title="Single shocks" right={`Each shock alone, ${startYear + 10}, as planned vs after`}>
        <div className="flex flex-wrap gap-2">
          {Object.entries(sim.shocks).map(([key, v]) => (
            <button key={key} onClick={() => setShock(key)}
              className={`rounded-md border px-3 py-1.5 text-[0.85rem] transition-colors ${key === shock ? 'border-down text-ink bg-down/10' : 'border-edge text-mute hover:text-ink'}`}>
              {v.label}
            </button>
          ))}
        </div>
        <p className="text-mute mt-3 text-[0.8rem]">{s.detail}</p>
        <table className="mt-2 w-full text-[0.88rem]">
          <thead>
            <tr className="text-faint text-[0.7rem] uppercase">
              <th className="pb-1 text-left font-normal">In {startYear + 10}</th>
              <th className="pb-1 text-right font-normal">As planned</th>
              <th className="pb-1 text-right font-normal">After shock</th>
              <th className="pb-1 text-right font-normal">Change</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.key} className="border-edge border-t">
                <td className="text-mute py-2">
                  {r.label}
                  {r.still && (
                    <div className="text-faint text-[0.72rem] leading-snug">
                      {r.ceiling && r.a >= r.ceiling - 0.05 && solarCut
                        ? 'Still at the ceiling with what was built.'
                        : r.ceiling && r.a >= r.ceiling - 0.05 ? 'Already at the ceiling.' : 'Not affected by this shock.'}
                    </div>
                  )}
                </td>
                <td className="num py-2 text-right">{r.fmt(r.b)}</td>
                <td className={`num py-2 text-right ${r.a < r.b - 1e-6 ? 'text-down' : ''}`}>{r.fmt(r.a)}</td>
                <td className={`num py-2 text-right text-[0.8rem] ${r.change < 0 ? 'text-down' : 'text-mute'}`}>{formatDelta(r.change * 100)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="mt-3 text-[0.9rem] leading-snug">
          {s.note.split('. ')[0].replace(/\.$/, '')}.{' '}
          <Info text={`${s.note} The red dashed line on the futures chart is this shock, ending at ${formatPct(shockPath[shockPath.length - 1])} in ${startYear + 10}.`} />
        </p>
        <How>
          We ran the same plan again with just one thing changed: {s.detail.charAt(0).toLowerCase() + s.detail.slice(1)} Everything else stays the same,
          and the reserve fund covers what it can of any shortfall or overrun. The table compares {startYear + 10} with and without the shock.
        </How>
      </Section>
      )}
    </>
  )
}

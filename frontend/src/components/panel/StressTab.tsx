import { useMemo, useState } from 'react'
import type { ShockSide, Simulation } from '../../api'
import { formatCompact, formatDelta, formatMoney, formatPct } from '../../lib/format'
import { Section, useSize } from '../ui'
import { fitDomain } from './TwinsTab'

const ROWS: { key: keyof ShockSide; label: string; fmt: (v: number) => string; ceiling?: number }[] = [
  { key: 'fund', label: 'Savings fund', fmt: (v) => formatMoney(v, 2) },
  { key: 'solar_mw', label: 'Solar built', fmt: (v) => formatCompact(v, 'MW') },
  { key: 'renewable_pct', label: 'Clean electricity', fmt: formatPct, ceiling: 100 },
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

export default function StressTab({ sim }: { sim: Simulation }) {
  const [shock, setShock] = useState('oil_price')
  const [compare, setCompare] = useState(false)
  const s = sim.shocks[shock]
  const f = sim.futures
  const startYear = sim.start.access_year ?? new Date().getFullYear()
  // Plot whichever outcome actually varies across futures
  const spread = (paths: number[][]) => Math.max(...paths.map((p) => p[9])) - Math.min(...paths.map((p) => p[9]))
  const useAccess = spread(f.access_paths) > 1
  const metric = useAccess ? 'Electricity access' : 'Clean electricity share'
  const shockPath = s.path.map((p) => (useAccess ? p.access_pct : p.renewable_pct))

  // Biggest drawdowns first; rows that did not move (or sit at a ceiling) last, with a reason
  const rows = ROWS.map((r) => {
    const [b, a] = [Number(s.before[r.key]), Number(s.after[r.key])]
    const change = b ? (a - b) / Math.abs(b) : 0
    return { ...r, b, a, change, still: Math.abs(a - b) < 1e-6 }
  }).sort((p, q) => Number(p.still) - Number(q.still) || Math.abs(q.change) - Math.abs(p.change))
  const solarCut = s.after.solar_mw < s.before.solar_mw - 1e-6

  return (
    <>
      <Section title={`${f.runs} historical bootstrap futures`} right={`From ${f.history_years} ${f.resource} income`}>
        <p className="text-[0.85rem] leading-snug">
          {metric} (%) across {f.runs} futures built from {f.history_years} {f.resource} income history
        </p>
        <div className="text-mute mt-1 mb-2 flex flex-wrap gap-x-4 text-[0.72rem]">
          <span><span className="bg-gold/60 mr-1.5 inline-block h-[2px] w-3 align-middle" />One future each</span>
          <span><span className="bg-ink mr-1.5 inline-block h-[2px] w-3 align-middle" />Median</span>
          {compare && <span><span className="border-down mr-1.5 inline-block w-3 border-t-2 border-dashed align-middle" />{s.label} (single shock)</span>}
        </div>
        <Futures key={`${sim.share}-${sim.pool}`} paths={useAccess ? f.access_paths : f.clean_paths} start={useAccess ? sim.start.access : sim.start.clean}
          startYear={startYear} shock={compare ? shockPath : null} />
        <p className="mt-3 text-[0.9rem] leading-snug">
          Each future replays random 3-year stretches of this country's real {f.resource} income swings.
          In 9 out of 10, {useAccess ? 'electricity access' : 'clean electricity'} still reaches{' '}
          <span className="num text-gold">{formatPct(useAccess ? f.access_p10 : f.clean_p10)}</span> by {startYear + 10}.
          The plan keeps at least 90% of its spending on track in <span className="num">{formatPct(f.p_funded * 100, 0)}</span> of futures.
        </p>
      </Section>

      <div className="border-edge border-b px-5 py-3">
        <button onClick={() => setCompare(!compare)} className="text-mute hover:text-ink text-[0.85rem]" aria-expanded={compare}>
          Compare single macro shocks {compare ? '▴' : '▾'}
        </button>
      </div>
      {compare && (
      <Section title="Single macro shocks" right={`Each shock alone, ${startYear + 10}, as planned vs after`}>
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
                        ? 'Target still met: the solar left after the shock is more than needed.'
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
        <p className="mt-3 text-[0.9rem] leading-snug">{s.note}</p>
        <p className="text-mute mt-2 text-[0.8rem] leading-snug">
          The red dashed line on the futures chart is this shock, ending at <span className="num text-down">{formatPct(shockPath[shockPath.length - 1])}</span>.
        </p>
      </Section>
      )}
    </>
  )
}

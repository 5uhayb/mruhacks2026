import { useMemo, useState } from 'react'
import type { Simulation, ShockSide } from '../../api'
import { formatMoney, formatNumber, formatPct } from '../../lib/format'
import { Section, useSize } from '../ui'

const ROWS: { key: keyof ShockSide; label: string; fmt: (v: number) => string }[] = [
  { key: 'access_pct', label: 'Has electricity', fmt: formatPct },
  { key: 'renewable_pct', label: 'Clean electricity', fmt: formatPct },
  { key: 'solar_mw', label: 'Solar built', fmt: (v) => `${formatNumber(v)} MW` },
  { key: 'fund', label: 'Savings fund', fmt: (v) => formatMoney(v) },
]

/** 500 faint lines, one per future, drawn in when the panel opens */
function Futures({ paths, start, color }: { paths: number[][]; start: number; color: string }) {
  const [ref, { width: w }] = useSize<HTMLDivElement>()
  const h = 170
  const pad = { l: 34, r: 8, t: 8, b: 20 }
  const x = (i: number) => pad.l + (i / 10) * (w - pad.l - pad.r)
  const y = (v: number) => pad.t + (1 - v / 100) * (h - pad.t - pad.b)
  const median = useMemo(() => Array.from({ length: 10 }, (_, t) => {
    const col = paths.map((p) => p[t]).sort((a, b) => a - b)
    return col[Math.floor(col.length / 2)]
  }), [paths])
  const d = (vals: number[]) => [start, ...vals].map((v, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join('')
  return (
    <div ref={ref} style={{ height: h }}>
      {w > 0 && (
        <svg width={w} height={h}>
          {[0, 50, 100].map((v) => (
            <g key={v}>
              <line x1={pad.l} x2={w - pad.r} y1={y(v)} y2={y(v)} stroke="#1e2638" />
              <text x={pad.l - 6} y={y(v) + 3} textAnchor="end" fill="#4b5468" fontSize={10} fontFamily="Geist Mono Variable">{v}%</text>
            </g>
          ))}
          {[0, 5, 10].map((i) => <text key={i} x={x(i)} y={h - 4} textAnchor="middle" fill="#4b5468" fontSize={10} fontFamily="Geist Mono Variable">{i === 0 ? 'now' : `+${i}`}</text>)}
          {paths.map((p, i) => (
            <path key={i} d={d(p)} pathLength={1} className="draw" fill="none" stroke={color} strokeOpacity={0.07} strokeWidth={1.2} style={{ animationDelay: `${(i % 100) * 8}ms` }} />
          ))}
          <path d={d(median)} pathLength={1} className="draw" fill="none" stroke="#e8ecf3" strokeWidth={2} style={{ animationDelay: '900ms' }} />
        </svg>
      )}
    </div>
  )
}

export default function StressTab({ sim }: { sim: Simulation }) {
  const [shock, setShock] = useState('oil_price')
  const s = sim.shocks[shock]
  const f = sim.futures
  // Show whichever outcome actually varies across futures
  const spread = (paths: number[][]) => Math.max(...paths.map((p) => p[9])) - Math.min(...paths.map((p) => p[9]))
  const useAccess = spread(f.access_paths) > 1
  return (
    <>
      <Section title="Shocks" right="Year 10, as planned vs after the shock">
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
          <tbody>
            {ROWS.map((r) => {
              const [b, a] = [Number(s.before[r.key]), Number(s.after[r.key])]
              return (
                <tr key={r.key} className="border-edge border-b last:border-b-0">
                  <td className="text-mute py-2">{r.label}</td>
                  <td className="num py-2 text-right">{r.fmt(b)}</td>
                  <td className={`num w-28 py-2 text-right ${a < b - 1e-6 ? 'text-down' : ''}`}>{r.fmt(a)}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
        <p className="mt-3 text-[0.9rem] leading-snug">{s.note}</p>
      </Section>

      <Section title={`${f.runs} futures built from real history`} right={`${f.resource} income ${f.history_years}`}>
        <Futures key={`${sim.share}-${sim.pool}`} paths={useAccess ? f.access_paths : f.clean_paths} start={useAccess ? sim.start.access : sim.start.clean} color="#f2a93b" />
        <p className="mt-3 text-[0.9rem] leading-snug">
          Each line replays random 3-year stretches of this country's real {f.resource} income swings.
          In 9 out of 10 futures, {useAccess ? 'electricity access' : 'clean electricity'} still reaches{' '}
          <span className="num text-gold">{formatPct(useAccess ? f.access_p10 : f.clean_p10)}</span>
          {useAccess ? '' : `, and electricity access stays at ${formatPct(f.access_p10)}`}.
          The plan keeps at least 90% of its spending on track in <span className="num">{Math.round(f.p_funded * 100)}%</span> of futures.
        </p>
      </Section>
    </>
  )
}

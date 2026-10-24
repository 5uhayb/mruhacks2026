import { useState } from 'react'
import {
  Area,
  AreaChart,
  CartesianGrid,
  ComposedChart,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import type { Band, Stress, YearRow } from '../api'
import { num, pct, usd } from '../format'
import { Card } from './Card'

const AXIS = { stroke: '#64748b', fontSize: 12 }
const TOOLTIP = { contentStyle: { background: '#0f172a', border: '1px solid #334155', borderRadius: 8 } }

const METRICS: { key: keyof YearRow; label: string; color: string; format: (v: number) => string }[] = [
  { key: 'electricity_access', label: 'Electricity access', color: '#fbbf24', format: (v) => pct(v, 1) },
  { key: 'solar_share', label: 'Solar vs. demand', color: '#f59e0b', format: (v) => pct(v) },
  { key: 'youth_unemployment', label: 'Youth unemployment', color: '#a78bfa', format: (v) => pct(v, 1) },
  { key: 'rail_km', label: 'Rail built (km)', color: '#38bdf8', format: (v) => `${num(v)} km` },
  { key: 'fund', label: 'Savings fund', color: '#34d399', format: usd },
]

export function ProjectionChart({ years, today }: { years: YearRow[]; today: Partial<Record<keyof YearRow, number>> }) {
  const [metric, setMetric] = useState(METRICS[0])
  const data = [
    { year: 'Today', value: today[metric.key] ?? 0 },
    ...years.map((y) => ({ year: `Y${y.year}`, value: y[metric.key] })),
  ]
  return (
    <div>
      <div className="mb-3 flex flex-wrap gap-2">
        {METRICS.map((m) => (
          <button
            key={m.key}
            onClick={() => setMetric(m)}
            className={`rounded-full px-3 py-1 text-xs transition ${
              m.key === metric.key ? 'text-slate-950 font-semibold' : 'bg-slate-800 text-slate-300 hover:bg-slate-700'
            }`}
            style={m.key === metric.key ? { background: m.color } : undefined}
          >
            {m.label}
          </button>
        ))}
      </div>
      <ResponsiveContainer width="100%" height={240}>
        <AreaChart data={data} margin={{ left: 10, right: 10 }}>
          <defs>
            <linearGradient id="fill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={metric.color} stopOpacity={0.45} />
              <stop offset="100%" stopColor={metric.color} stopOpacity={0} />
            </linearGradient>
          </defs>
          <CartesianGrid stroke="#1e293b" vertical={false} />
          <XAxis dataKey="year" {...AXIS} />
          <YAxis {...AXIS} width={60} tickFormatter={(v) => metric.format(v)} domain={['auto', 'auto']} />
          <Tooltip {...TOOLTIP} formatter={(v) => [metric.format(Number(v)), metric.label]} />
          <Area type="monotone" dataKey="value" stroke={metric.color} strokeWidth={2.5} fill="url(#fill)" />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  )
}

function FanChart({ bands, color, format, title }: {
  bands: Band[]
  color: string
  format: (v: number) => string
  title: string
}) {
  const data = bands.map((b) => ({ year: `Y${b.year}`, range: [b.p10, b.p90], p50: b.p50 }))
  return (
    <div>
      <div className="mb-1 text-sm text-slate-300">{title}</div>
      <ResponsiveContainer width="100%" height={180}>
        <ComposedChart data={data} margin={{ left: 0, right: 10 }}>
          <CartesianGrid stroke="#1e293b" vertical={false} />
          <XAxis dataKey="year" {...AXIS} />
          <YAxis {...AXIS} width={50} tickFormatter={format} domain={['auto', 'auto']} />
          <Tooltip
            {...TOOLTIP}
            formatter={(v, name) =>
              Array.isArray(v)
                ? [`${format(Number(v[0]))} – ${format(Number(v[1]))}`, '80% of scenarios']
                : [format(Number(v)), name === 'p50' ? 'Median' : String(name)]
            }
          />
          <Area dataKey="range" stroke="none" fill={color} fillOpacity={0.25} />
          <Line dataKey="p50" stroke={color} strokeWidth={2.5} dot={false} />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  )
}

export function StressTest({ result, loading, onRun }: { result: Stress | null; loading: boolean; onRun: () => void }) {
  return (
    <Card
      title="Oil-price stress test"
      subtitle="1,000 possible futures, built by replaying real oil booms and crashes from 1988–2025"
      action={
        <button
          onClick={onRun}
          disabled={loading}
          className="shrink-0 rounded-lg bg-orange-500 px-4 py-2 text-sm font-semibold text-slate-950 hover:bg-orange-400 disabled:opacity-60"
        >
          {loading ? 'Simulating...' : result ? 'Re-run' : '🛢️ Run 1,000 scenarios'}
        </button>
      }
    >
      {result ? (
        <div className="space-y-4">
          <p className="text-sm text-slate-300">
            Oil drops below <strong>$40</strong> at some point in{' '}
            <strong className="text-orange-400">{pct(result.crash_share * 100)}</strong> of futures. Even so, this
            plan's score stays above <strong className="text-emerald-400">{num(result.score_p10)}</strong> in 90% of
            them (median <strong>{num(result.score_p50)}</strong>).
          </p>
          <div className="grid gap-4 md:grid-cols-2">
            <FanChart bands={result.oil_price} color="#f97316" format={(v) => `$${num(v)}`} title="Oil price ($/barrel)" />
            <FanChart bands={result.bands.budget} color="#818cf8" format={usd} title="Money invested per year" />
            <FanChart
              bands={result.bands.electricity_access}
              color="#fbbf24"
              format={(v) => pct(v)}
              title="Electricity access"
            />
            <FanChart bands={result.bands.fund} color="#34d399" format={usd} title="Savings fund" />
          </div>
          <p className="text-xs text-slate-500">Shaded band: middle 80% of scenarios. Line: median.</p>
        </div>
      ) : (
        <p className="text-sm text-slate-400">
          What happens if oil crashes like it did in 2015 or 2020? Run the stress test to see how the plan holds up.
        </p>
      )}
    </Card>
  )
}

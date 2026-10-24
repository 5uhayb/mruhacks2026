import { useState } from 'react'
import { Area, CartesianGrid, ComposedChart, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import type { Band, Plan, ShockSide } from '../api'
import { AXIS, Delta, GRID, Note, Panel, Read, TOOLTIP, Why } from '../components/ui'
import { compact, money, num, pct } from '../format'

const ROWS: { key: keyof ShockSide; label: string; fmt: (v: number) => string; higherIsBetter: boolean }[] = [
  { key: 'solar_mw', label: 'Solar built (MW, yr 10)', fmt: (v) => num(v), higherIsBetter: true },
  { key: 'homes', label: 'Home-equivalents of power', fmt: (v) => num(v), higherIsBetter: true },
  { key: 'rail_km', label: 'Rail built (km)', fmt: (v) => num(v), higherIsBetter: true },
  { key: 'fund', label: 'Fund balance', fmt: (v) => money(v), higherIsBetter: true },
  { key: 'shortfall_total', label: 'Planned spending missed', fmt: (v) => money(v), higherIsBetter: false },
  { key: 'deal_npv', label: 'Flagship solar NPV', fmt: (v) => money(v), higherIsBetter: true },
  { key: 'resilience', label: 'Fiscal Resilience Score', fmt: (v) => num(v), higherIsBetter: true },
]

function Fan({ bands, fmt }: { bands: Band[]; fmt: (v: number) => string }) {
  const data = bands.map((b) => ({ year: `Y${b.year}`, range: [b.p10, b.p90], p50: b.p50, p10: b.p10 }))
  return (
    <ResponsiveContainer width="100%" height={130}>
      <ComposedChart data={data} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
        <CartesianGrid {...GRID} vertical={false} />
        <XAxis dataKey="year" {...AXIS} />
        <YAxis {...AXIS} tickFormatter={fmt} width={48} />
        <Tooltip {...TOOLTIP} formatter={(v, name) => Array.isArray(v) ? [`${fmt(Number(v[0]))} – ${fmt(Number(v[1]))}`, 'P10–P90'] : [fmt(Number(v)), String(name).toUpperCase()]} />
        <Area dataKey="range" stroke="none" fill="#e6e6e6" fillOpacity={0.1} isAnimationActive={false} />
        <Line dataKey="p50" stroke="#e6e6e6" strokeWidth={1.5} dot={false} isAnimationActive={false} />
        <Line dataKey="p10" stroke="#808080" strokeWidth={1} strokeDasharray="3 3" dot={false} isAnimationActive={false} />
      </ComposedChart>
    </ResponsiveContainer>
  )
}

const TERM_LABELS: Record<string, string> = {
  term_buffer: 'Savings buffer',
  term_new_income: 'New non-oil income',
  term_clean_power: 'Clean power',
  term_access: 'Grid access',
}

export default function Stress({ plan }: { plan: Plan }) {
  const [shock, setShock] = useState('oil_price')
  const s = plan.shocks[shock]
  const mc = plan.monte_carlo
  const res = plan.resilience
  return (
    <div className="grid grid-cols-12">
      <Panel title="Shocks" right="BEFORE / AFTER · YEAR 10" className="col-span-7">
        <div className="mb-2 flex flex-wrap gap-1">
          {Object.entries(plan.shocks).map(([key, v]) => (
            <button
              key={key}
              onClick={() => setShock(key)}
              className={`num border px-2 py-1 text-[11px] ${key === shock ? 'bg-amb border-amb text-black' : 'border-line text-ink hover:border-amb'}`}
            >
              {v.label}
            </button>
          ))}
        </div>
        <p className="text-dim mb-2 text-[12px]">{s.detail}</p>
        <table className="num w-full text-[12px]">
          <thead>
            <tr className="text-dim border-line border-b text-[10px] uppercase">
              <th className="text-left font-normal">Metric</th>
              <th className="text-right font-normal">Before</th>
              <th className="text-right font-normal">After</th>
              <th className="text-right font-normal">Change</th>
            </tr>
          </thead>
          <tbody>
            {ROWS.map((r, i) => {
              const [b, a] = [Number(s.before[r.key]), Number(s.after[r.key])]
              const diff = a - b
              const pctChange = b ? (diff / Math.abs(b)) * 100 : 0
              return (
                <tr key={r.key} className={i % 2 ? 'bg-white/[0.03]' : ''}>
                  <td className="font-sans">{r.label}</td>
                  <td className="text-right">{r.fmt(b)}</td>
                  <td className="text-right">{r.fmt(a)}</td>
                  <td className="text-right">
                    {Math.abs(diff) < 1e-6 ? <span className="text-dim">—</span> : b ? (
                      <Delta diff={pctChange} unit="%" good={(diff > 0) === r.higherIsBetter} digits={0} />
                    ) : (
                      <span className={`text-[12px] ${(diff > 0) === r.higherIsBetter ? 'text-up' : 'text-dn'}`}>
                        {diff > 0 ? '▲' : '▼'} {r.fmt(Math.abs(diff))}
                      </span>
                    )}
                  </td>
                </tr>
              )
            })}
            <tr>
              <td className="font-sans">Fully funded every year</td>
              <td className="text-right">{s.before.fully_funded ? 'YES' : 'NO'}</td>
              <td className={`text-right ${s.after.fully_funded ? 'text-up' : 'text-dn'}`}>{s.after.fully_funded ? 'YES' : 'NO'}</td>
              <td />
            </tr>
          </tbody>
        </table>
        <div className="mt-2"><Note>{s.note}</Note></div>
      </Panel>

      <Panel title="Fiscal Resilience Score" right="0–100 · FOUR TERMS, EACH 0–1" className="col-span-5">
        <div className="flex items-baseline gap-3">
          <span className="num text-dim text-[16px]">{num(res.today.resilience)}</span>
          <span className="text-dim">→</span>
          <span className="num text-[24px] font-medium">{num(res.year10.resilience)}</span>
          <span className="text-dim num text-[11px]">TODAY → YEAR 10</span>
        </div>
        <table className="num mt-2 w-full text-[12px]">
          <thead>
            <tr className="text-dim border-line border-b text-[10px] uppercase">
              <th className="text-left font-normal">Term</th>
              <th className="text-right font-normal">Today</th>
              <th className="text-right font-normal">Yr 10</th>
              <th className="w-24" />
            </tr>
          </thead>
          <tbody>
            {Object.keys(TERM_LABELS).map((k) => {
              const key = k as keyof typeof res.today
              return (
                <tr key={k}>
                  <td className="font-sans">{TERM_LABELS[k]}</td>
                  <td className="text-dim text-right">{res.today[key].toFixed(2)}</td>
                  <td className="text-right">{res.year10[key].toFixed(2)}</td>
                  <td className="pl-2">
                    <div className="relative h-[6px] bg-[#1a1a1a]">
                      <div className="absolute h-full bg-[#4a4a4a]" style={{ width: `${res.today[key] * 100}%` }} />
                      <div className="absolute h-[2px] top-[2px] bg-[#e6e6e6]" style={{ width: `${res.year10[key] * 100}%` }} />
                    </div>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
        <div className="mt-2"><Note>{res.note}</Note></div>
        <Why why={res.why} />
      </Panel>

      <Panel title={`Monte Carlo · ${mc.runs} Oil Futures`} right="P10 / P50 / P90" className="col-span-12">
        <div className="grid grid-cols-12 gap-4">
          <div className="col-span-3">
            <div className="lbl">Probability fully funded</div>
            <div className="num text-[28px] font-medium">{pct(mc.p_funded * 100, 0)}</div>
            <div className="num text-dim text-[11px]">P10 HOME-EQUIV. {compact(mc.homes_p10)} · P10 FUND {money(mc.fund_p10)}</div>
            <div className="mt-2"><Note>{mc.note}</Note></div>
            <Why why={mc.why} />
          </div>
          <div className="col-span-3">
            <div className="lbl">Annual pool</div>
            <Fan bands={mc.bands.pool} fmt={(v) => money(v, 1)} />
          </div>
          <div className="col-span-3">
            <div className="lbl">Fund balance</div>
            <Fan bands={mc.bands.fund} fmt={(v) => money(v, 1)} />
          </div>
          <div className="col-span-3">
            <div className="lbl">Resilience score</div>
            <Fan bands={mc.bands.resilience} fmt={(v) => num(v)} />
          </div>
        </div>
        <Read>
          READ: Band = P10 to P90, solid line = median, dashed line = P10. The fund is the shock absorber: it only helps
          once it has had time to grow.
        </Read>
      </Panel>
    </div>
  )
}

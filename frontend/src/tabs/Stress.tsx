import { useState } from 'react'
import { Area, CartesianGrid, ComposedChart, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import type { Plan } from '../api'
import { AXIS, Big, GRID, Panel, TOOLTIP, Why, goalValue } from '../components/ui'
import { money } from '../format'

export default function Stress({ plan }: { plan: Plan }) {
  const [shock, setShock] = useState('oil_price')
  const s = plan.shocks[shock]
  const mc = plan.monte_carlo
  const fan = mc.fund_bands.map((b) => ({ year: `Y${b.year}`, range: [b.p10, b.p90], p50: b.p50 }))
  return (
    <div className="grid grid-cols-12">
      <Panel title="1 · Hit the plan with a shock" className="col-span-7">
        <div className="mb-3 flex flex-wrap gap-1">
          {Object.entries(plan.shocks).map(([key, v]) => (
            <button
              key={key}
              onClick={() => setShock(key)}
              className={`num border px-3 py-1.5 text-[12px] ${key === shock ? 'bg-amb border-amb text-black' : 'border-line hover:border-amb'}`}
            >
              {v.label}
            </button>
          ))}
        </div>
        <p className="text-dim mb-3 text-[12px]">{s.detail}</p>
        <table className="num w-full text-[14px]">
          <thead>
            <tr className="text-dim border-line border-b text-[10px] uppercase">
              <th className="py-1 text-left font-normal">Goal (year 10)</th>
              <th className="text-right font-normal">Normal</th>
              <th className="text-right font-normal">With shock</th>
            </tr>
          </thead>
          <tbody>
            {plan.goals.map((g) => {
              const [b, a] = [s.before[g.key], s.after[g.key]]
              return (
                <tr key={g.key} className="border-line border-b">
                  <td className="py-1.5 font-sans text-[13px]">{g.label}</td>
                  <td className="text-right">{goalValue(g.key, b, plan)} {b >= 0.999 && <span className="text-up">✓</span>}</td>
                  <td className={`text-right ${a < b - 1e-6 ? 'text-dn' : ''}`}>
                    {goalValue(g.key, a, plan)} {a >= 0.999 && <span className="text-up">✓</span>}
                  </td>
                </tr>
              )
            })}
            <tr>
              <td className="py-1.5 font-sans text-[13px]">Every year paid for</td>
              <td className="text-right">{s.before.fully_funded ? <span className="text-up">YES</span> : <span className="text-dn">NO</span>}</td>
              <td className="text-right">{s.after.fully_funded ? <span className="text-up">YES</span> : <span className="text-dn">NO</span>}</td>
            </tr>
          </tbody>
        </table>
        <p className="mt-3 text-[14px]">{s.note}</p>
      </Panel>

      <Panel title={`2 · ${mc.runs} possible oil futures`} className="col-span-5">
        <Big label="Plan fully paid for" value={`${Math.round(mc.p_funded * 100)}%`} line="of futures" size="text-[40px]" />
        <div className="lbl mt-4 mb-1">Chance each goal is met</div>
        <table className="num w-full text-[13px]">
          <tbody>
            {plan.goals.map((g) => (
              <tr key={g.key}>
                <td className="py-0.5 font-sans">{g.label}</td>
                <td className="w-28 px-2">
                  <div className="h-[5px] bg-[#1a1a1a]"><div className="bg-ink h-full" style={{ width: `${mc.p_goal[g.key] * 100}%` }} /></div>
                </td>
                <td className="w-12 text-right">{Math.round(mc.p_goal[g.key] * 100)}%</td>
              </tr>
            ))}
          </tbody>
        </table>
        <Why why={mc.why} />
      </Panel>

      <Panel title="Savings across all futures" right="BAND = MIDDLE 80% · LINE = TYPICAL" className="col-span-12">
        <ResponsiveContainer width="100%" height={170}>
          <ComposedChart data={fan} margin={{ top: 4, right: 16, left: 0, bottom: 0 }}>
            <CartesianGrid {...GRID} vertical={false} />
            <XAxis dataKey="year" {...AXIS} />
            <YAxis {...AXIS} tickFormatter={(v) => money(v, 0)} width={52} />
            <Tooltip {...TOOLTIP} formatter={(v) => (Array.isArray(v) ? `${money(Number(v[0]))} – ${money(Number(v[1]))}` : money(Number(v)))} />
            <Area dataKey="range" stroke="none" fill="#e6e6e6" fillOpacity={0.1} isAnimationActive={false} />
            <Line dataKey="p50" stroke="#e6e6e6" strokeWidth={1.5} dot={false} isAnimationActive={false} />
          </ComposedChart>
        </ResponsiveContainer>
        <p className="text-dim text-[12px]">Savings protect the plan only after they have had time to grow.</p>
      </Panel>
    </div>
  )
}

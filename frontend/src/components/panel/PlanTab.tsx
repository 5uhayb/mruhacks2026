import { useState } from 'react'
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { SECTORS, type AssumptionSpec, type Country, type Optimized, type Sector, type Simulation, type Split } from '../../api'
import { money, num, pct } from '../../format'
import { CountUp, Section, Stat } from '../ui'

const LABEL: Record<Sector, string> = { solar: 'Solar farms', rail: 'Rail', fund: 'Savings fund' }
const AXIS = { stroke: '#4b5468', fontSize: 11, tickLine: false, axisLine: false, fontFamily: 'Geist Mono Variable' }

function Assumptions({ specs, overrides, setOverrides }: {
  specs: Record<string, AssumptionSpec>
  overrides: Record<string, number>
  setOverrides: (o: Record<string, number>) => void
}) {
  const [open, setOpen] = useState(false)
  const edited = Object.keys(overrides).length
  return (
    <Section title="Assumptions" right={<button onClick={() => setOpen(!open)} className="hover:text-ink">{open ? 'Hide' : `Show all ${Object.keys(specs).length}`}{edited > 0 && ` · ${edited} edited`}</button>}>
      {open ? (
        <div className="space-y-3">
          {Object.entries(specs).map(([key, s]) => {
            const isRate = s.unit === 'rate' || s.unit === 'rate/pt' || s.unit === '/yr'
            const v = overrides[key] ?? s.value
            return (
              <div key={key}>
                <div className="flex items-center justify-between gap-3">
                  <span className={`text-[0.85rem] ${key in overrides ? 'text-gold' : ''}`}>{s.label}</span>
                  <span className="flex items-center gap-1.5">
                    <input type="number" className="num w-24 px-2 py-1 text-right text-[0.8rem]" value={isRate ? +(v * 100).toFixed(2) : v}
                      step={isRate ? 0.1 : s.unit.startsWith('$') ? 1000 : 0.05}
                      onChange={(e) => setOverrides({ ...overrides, [key]: isRate ? Number(e.target.value) / 100 : Number(e.target.value) })} />
                    <span className="text-faint w-14 text-[0.7rem]">{isRate ? '%' : s.unit}</span>
                  </span>
                </div>
                <p className="text-faint mt-0.5 text-[0.75rem] leading-snug">{s.note}</p>
              </div>
            )
          })}
          {edited > 0 && <button onClick={() => setOverrides({})} className="text-gold text-[0.8rem]">Reset to defaults</button>}
        </div>
      ) : (
        <p className="text-mute text-[0.82rem]">Costs, solar efficiency, fund returns and build times. Every number above depends on them.</p>
      )}
    </Section>
  )
}

export default function PlanTab({ country, sim, share, setShare, split, setSplit, onOptimize, optimizing, optimized, specs, overrides, setOverrides }: {
  country: Country
  sim: Simulation | null
  share: number
  setShare: (v: number) => void
  split: Split
  setSplit: (s: Split) => void
  onOptimize: () => void
  optimizing: boolean
  optimized: Optimized | null
  specs: Record<string, AssumptionSpec>
  overrides: Record<string, number>
  setOverrides: (o: Record<string, number>) => void
}) {
  const total = SECTORS.reduce((s, k) => s + split[k], 0) || 1
  const y = sim?.years[sim.years.length - 1]
  const outlook = country.outlook
  const chart = sim
    ? [{ year: 0, plan: sim.start.access, none: sim.start.access }, ...sim.years.map((r) => ({
        year: r.year,
        plan: r.access_pct,
        none: outlook ? sim.start.access + ((outlook.access_in_10 - outlook.access_now) * r.year) / 10 : sim.start.access,
      }))]
    : []
  return (
    <>
      <Section title="Investment" right={sim ? `${money(sim.base_revenue)} a year of ${country.resource} income` : undefined}>
        <div className="flex items-baseline justify-between">
          <span className="text-[1rem]">Invest <span className="num text-gold">{Math.round(share * 100)}%</span> of {country.resource} income</span>
          {sim && <span className="num text-gold text-[1.1rem]"><CountUp value={sim.pool} format={(v) => money(v)} /> / yr</span>}
        </div>
        <input className="big mt-2" type="range" min={0} max={0.3} step={0.01} value={share} onChange={(e) => setShare(Number(e.target.value))} aria-label="Share of resource income invested" />
        <div className="mt-3 grid grid-cols-3 gap-4">
          {SECTORS.map((k) => (
            <label key={k}>
              <div className="flex justify-between text-[0.8rem]"><span className="text-mute">{LABEL[k]}</span><span className="num">{Math.round((split[k] / total) * 100)}%</span></div>
              <input type="range" min={0} max={100} step={1} value={split[k]} onChange={(e) => setSplit({ ...split, [k]: Number(e.target.value) })} />
            </label>
          ))}
        </div>
        <div className="mt-3 flex items-center gap-3">
          <button onClick={onOptimize} disabled={optimizing} className="border-gold text-gold hover:bg-gold hover:text-space shrink-0 rounded-md border px-3 py-1.5 text-[0.85rem] whitespace-nowrap transition-colors disabled:opacity-50">
            {optimizing ? 'Searching…' : 'Find best plan'}
          </button>
          {optimized && (
            <span className="text-mute text-[0.78rem] leading-snug">
              Fastest electricity access that still keeps 90% of spending on track in {Math.round(optimized.p_funded * 100)}% of futures.
              {optimized.split.rail === 0 && ' Rail is not part of this goal.'}
            </span>
          )}
        </div>
      </Section>

      {sim && y && (
        <Section title="In 10 years" right="Estimates">
          <div className="grid grid-cols-2 gap-x-6 gap-y-5">
            <Stat accent="gold" label="Solar built" value={<CountUp value={y.solar_mw} format={(v) => `${num(v)} MW`} />} sub={`As much power as ${num(y.homes)} homes use`} />
            <Stat accent="gold" label="Has electricity" value={<CountUp value={y.access_pct} format={(v) => pct(v)} />}
              sub={sim.access_full_year && sim.start.access < 99.95 ? `Everyone by year ${sim.access_full_year}, from ${pct(sim.start.access)}` : `From ${pct(sim.start.access)} today`} />
            <Stat accent="gold" label="Savings fund" value={<CountUp value={y.fund} format={(v) => money(v)} />} sub={`Covers about ${num(sim.months_covered)} months of ${country.resource} income`} />
            <Stat accent="gold" label="Clean electricity" value={<CountUp value={y.renewable_pct} format={(v) => pct(v)} />} sub={`From ${pct(sim.start.clean)} today · ${num(y.rail_km)} km rail funded`} />
          </div>
          <div className="mt-5 h-[150px]">
            <div className="text-mute mb-1 flex gap-4 text-[0.75rem]">
              <span><span className="bg-gold mr-1.5 inline-block h-[2px] w-3 align-middle" />With this plan</span>
              <span><span className="bg-mute mr-1.5 inline-block h-[2px] w-3 align-middle" />No plan (model projection)</span>
            </div>
            <ResponsiveContainer width="100%" height="85%">
              <LineChart data={chart} margin={{ top: 6, right: 8, left: -18, bottom: 0 }}>
                <CartesianGrid stroke="#1e2638" vertical={false} />
                <XAxis dataKey="year" {...AXIS} tickFormatter={(v) => (v === 0 ? 'now' : `+${v}`)} />
                <YAxis {...AXIS} domain={[0, 100]} ticks={[0, 50, 100]} tickFormatter={(v) => `${v}%`} />
                <Tooltip contentStyle={{ background: '#0d1320', border: '1px solid #1e2638', borderRadius: 6, fontSize: 12 }} formatter={(v, n) => [pct(Number(v)), n === 'plan' ? 'With plan' : 'No plan']} labelFormatter={(v) => (v === 0 ? 'Now' : `Year ${v}`)} />
                <Line dataKey="none" stroke="#8a94a8" strokeDasharray="4 4" strokeWidth={1.5} dot={false} animationDuration={500} />
                <Line dataKey="plan" stroke="#f2a93b" strokeWidth={2.5} dot={false} animationDuration={500} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </Section>
      )}
      <Assumptions specs={specs} overrides={overrides} setOverrides={setOverrides} />
    </>
  )
}

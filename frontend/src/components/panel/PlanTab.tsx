import { useState, type ReactNode } from 'react'
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import type { AssumptionSpec, Country, Optimized, Simulation, Split } from '../../api'
import { formatCompact, formatInt, formatMoney, formatNumber, formatPct } from '../../lib/format'
import { CountUp, Section } from '../ui'
import SplitBar from './SplitBar'
import { fitDomain } from './TwinsTab'

const AXIS = { stroke: '#4b5468', fontSize: 11, tickLine: false, axisLine: false, fontFamily: 'Geist Mono Variable' }
export const GRID_NOTE = 'Assumes new power can reach homes through the grid; transmission and connection upgrades are not modelled.'

function Assumptions({ specs, overrides, setOverrides, householdSize }: {
  specs: Record<string, AssumptionSpec>
  overrides: Record<string, number>
  setOverrides: (o: Record<string, number>) => void
  householdSize: number | null
}) {
  const [open, setOpen] = useState(false)
  const edited = Object.keys(overrides).length
  return (
    <Section title="Assumptions" right={<button onClick={() => setOpen(!open)} className="hover:text-ink">{open ? 'Hide' : `Show all ${Object.keys(specs).length}`}{edited > 0 && ` · ${edited} edited`}</button>}>
      {open ? (
        <div className="space-y-3">
          {Object.entries(specs).map(([key, s]) => {
            const isRate = s.unit === 'rate' || s.unit === 'rate/pt' || s.unit === '/yr'
            // Household size defaults per country, so show the value actually used
            const v = overrides[key] ?? (key === 'household_size' && householdSize != null ? householdSize : s.value)
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
        <p className="text-mute text-[0.82rem]">Costs, solar efficiency, household size, fund returns and build times. Every number above depends on them.</p>
      )}
      <p className="text-faint mt-3 text-[0.75rem] leading-snug">Limitation: {GRID_NOTE} Storage is not costed either.</p>
    </Section>
  )
}

function Card({ label, value, sub, note }: { label: string; value: ReactNode; sub?: ReactNode; note?: string }) {
  return (
    <div className="border-edge rounded-md border p-3">
      <div className="label">{label} <span className="text-faint normal-case tracking-normal">· estimate</span></div>
      <div className="num text-gold mt-1 text-[1.45rem] leading-none">{value}</div>
      {sub && <div className="text-mute mt-1.5 text-[0.78rem] leading-snug">{sub}</div>}
      {note && <div className="text-faint mt-1 text-[0.72rem] leading-snug">{note}</div>}
    </div>
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
  const y = sim?.years[sim.years.length - 1]
  const outlook = country.outlook
  // Countries already at ≥99% access: the meaningful headline is clean electricity, not access
  const accessDone = (sim?.start.access ?? 0) >= 99
  const startYear = sim?.start.access_year ?? new Date().getFullYear()
  const key = accessDone ? 'renewable_pct' : 'access_pct'
  const startValue = sim ? (accessDone ? sim.start.clean : sim.start.access) : 0
  const noPlan = (t: number) => (!accessDone && outlook && !outlook.no_gap ? startValue + (outlook.change * t) / 10 : startValue)
  const chart = sim ? [{ year: startYear, plan: startValue, none: startValue }, ...sim.years.map((r) => ({ year: startYear + r.year, plan: r[key], none: noPlan(r.year) }))] : []
  const domain = fitDomain(chart.flatMap((c) => [c.plan, c.none]))
  const h = sim?.homes
  const rail = sim?.rail

  return (
    <>
      <Section title="Investment" right={sim ? `${formatMoney(sim.base_revenue, 2)} a year of ${country.resource} income` : undefined}>
        <div className="flex items-baseline justify-between">
          <span className="text-[1rem]">Invest <span className="num text-gold">{Math.round(share * 100)}%</span> of {country.resource} income</span>
          {sim && <span className="num text-gold text-[1.1rem]"><CountUp value={sim.pool} format={(v) => formatMoney(v, 2)} /> / yr</span>}
        </div>
        <input className="big mt-2" type="range" min={0} max={0.3} step={0.01} value={share} onChange={(e) => setShare(Number(e.target.value))} aria-label="Share of resource income invested" />
        {sim?.low_resource.is_low && (
          <p className="text-mute mt-1 text-[0.8rem]">
            Resource income is a small share of this economy ({formatPct(sim.low_resource.rents_pct_gdp)} of GDP), so this plan has limited impact here.
          </p>
        )}
        <SplitBar split={split} setSplit={setSplit} amounts={sim?.split_amounts ?? null} />
        <div className="mt-3 flex items-center gap-3">
          <button onClick={onOptimize} disabled={optimizing}
            className="border-gold text-gold hover:bg-gold hover:text-space shrink-0 rounded-md border px-3 py-1.5 text-left text-[0.82rem] leading-tight transition-colors disabled:opacity-50">
            {optimizing ? 'Searching…' : <>Optimize split<span className="block text-[0.7rem] opacity-80">fastest access · funded in ≥80% of futures</span></>}
          </button>
          {optimized && (
            <span className="text-mute text-[0.78rem] leading-snug">
              Best split found after {formatInt(optimized.plans_tested)} combinations: <span className="num text-ink">{optimized.split.solar} / {optimized.split.rail} / {optimized.split.fund}</span>.
              {' '}Keeps ≥90% of spending on track in {formatPct(optimized.p_funded * 100, 0)} of futures.{optimized.split.rail === 0 && ' Rail does not raise access, so it gets nothing.'}
            </span>
          )}
        </div>
      </Section>

      {sim && y && h && rail && (
        <Section title={`By ${startYear + 10}`}>
          <div className="grid grid-cols-2 gap-3">
            <Card label="Solar built" value={<CountUp value={y.solar_mw} format={(v) => formatCompact(v, 'MW')} />}
              sub={`${formatMoney(sim.split_amounts.solar)} a year at ${sim.sites[0]?.site ?? 'the sunniest site'}`} />
            <Card label="Homes" value={h.every_home ? 'Every home' : <CountUp value={h.homes_powered} format={(v) => formatCompact(v)} />}
              sub={h.every_home
                ? `Enough to cover the electricity use of every home in the country (about ${formatCompact(h.households)} households), with ${formatPct(h.left_over_share * 100, 0)} left over for business and industry.`
                : `${formatPct(h.coverage * 100, 0)} of the country's ${formatCompact(h.households)} households (${formatNumber(sim.household_size, 1)} people each)`} />
            {accessDone ? (
              <Card label="Clean electricity" value={<CountUp value={y.renewable_pct} format={(v) => formatPct(v)} />}
                sub={`From ${formatPct(sim.start.clean)} (latest available, ${sim.start.clean_year})`}
                note={`Access is already ${formatPct(sim.start.access)} (latest available, ${sim.start.access_year}), so the plan's main effect is cleaner power.`} />
            ) : (
              <Card label="Has electricity" value={<CountUp value={y.access_pct} format={(v) => formatPct(v)} />}
                sub={sim.access_full_year
                  ? `Everyone by ${startYear + sim.access_full_year}, from ${formatPct(sim.start.access)} (latest available, ${sim.start.access_year})`
                  : `From ${formatPct(sim.start.access)} (latest available, ${sim.start.access_year})`}
                note={GRID_NOTE} />
            )}
            {accessDone ? (
              <Card label="Has electricity" value={formatPct(y.access_pct)} sub={`Already near-universal (latest available, ${sim.start.access_year})`} />
            ) : (
              <Card label="Clean electricity" value={<CountUp value={y.renewable_pct} format={(v) => formatPct(v)} />}
                sub={`From ${formatPct(sim.start.clean)} (latest available, ${sim.start.clean_year})`} />
            )}
            <Card label="Savings fund" value={<CountUp value={y.fund} format={(v) => formatMoney(v)} />}
              sub={`About ${formatNumber(sim.months_covered, 1)} months of ${country.resource} income, to cover bad years`} />
            <Card label="Rail" value={<CountUp value={rail.funded_km} format={(v) => formatCompact(v, 'km')} />}
              sub={rail.from
                ? `${rail.from} → ${rail.to}: ${formatInt(rail.funded_km)} of ${formatInt(rail.route_km)} km`
                : `Of new intercity rail (no corridor defined for this country)`}
              note={rail.years_to_complete != null
                ? `${rail.from ? 'Full corridor' : '1,000 km'} done in about ${formatNumber(rail.years_to_complete, 0)} years at ${formatMoney(rail.annual_pool)} a year`
                : 'No rail budget in this split'} />
          </div>

          <div className="mt-5 h-[160px]">
            <div className="text-mute mb-1 flex flex-wrap gap-x-4 text-[0.75rem]">
              <span>{accessDone ? 'Clean electricity share' : 'Electricity access'}, %</span>
              <span><span className="bg-gold mr-1.5 inline-block h-[2px] w-3 align-middle" />With this plan</span>
              <span><span className="bg-mute mr-1.5 inline-block h-[2px] w-3 align-middle" />{accessDone ? 'No plan (held at latest value)' : 'No plan (impact model)'}</span>
            </div>
            <ResponsiveContainer width="100%" height="85%">
              <LineChart data={chart} margin={{ top: 6, right: 8, left: -12, bottom: 0 }}>
                <CartesianGrid stroke="#1e2638" vertical={false} />
                <XAxis dataKey="year" {...AXIS} interval={1} />
                <YAxis {...AXIS} domain={domain} tickFormatter={(v) => `${v}%`} allowDecimals={false} />
                <Tooltip contentStyle={{ background: '#0d1320', border: '1px solid #1e2638', borderRadius: 6, fontSize: 12 }}
                  formatter={(v, n) => [formatPct(Number(v)), n === 'plan' ? 'With plan' : 'No plan']} />
                <Line dataKey="none" stroke="#8a94a8" strokeDasharray="4 4" strokeWidth={1.5} dot={false} animationDuration={500} />
                <Line dataKey="plan" stroke="#f2a93b" strokeWidth={2.5} dot={false} animationDuration={500} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </Section>
      )}
      <Assumptions specs={specs} overrides={overrides} setOverrides={setOverrides} householdSize={sim?.household_size ?? null} />
    </>
  )
}

import { useState, type ReactNode } from 'react'
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { SECTORS, type AssumptionSpec, type Country, type Simulation, type Split } from '../../api'
import { formatCompact, formatInt, formatMoney, formatNumber, formatPct } from '../../lib/format'
import { CountUp, Info, Section, fitDomain } from '../ui'
import SplitBar from './SplitBar'

const AXIS = { stroke: '#4b5468', fontSize: 11, tickLine: false, axisLine: false, fontFamily: 'Geist Mono Variable' }
export const GRID_NOTE = 'Assumes new lines connect homes; local grid studies needed.'

function Assumptions({ specs, overrides, setOverrides, householdSize }: {
  specs: Record<string, AssumptionSpec>
  overrides: Record<string, number>
  setOverrides: (o: Record<string, number>) => void
  householdSize: number | null
}) {
  const [open, setOpen] = useState(false)
  const edited = Object.keys(overrides).length
  const groups = [...new Set(Object.values(specs).map((s) => s.group))]
  return (
    <Section title="Assumptions" right={<button onClick={() => setOpen(!open)} className="hover:text-ink">{open ? 'Hide' : `Show all ${Object.keys(specs).length}`}{edited > 0 && ` · ${edited} edited`}</button>}>
      {open ? (
        <div className="space-y-5">
          {groups.map((g) => (
            <div key={g} className="space-y-3">
              <div className="label text-ink">{g}</div>
              {Object.entries(specs).filter(([, s]) => s.group === g).map(([key, s]) => {
                const isRate = s.unit === 'rate' || s.unit === 'ratio'
                const v = overrides[key] ?? (key === 'household_size' && householdSize != null ? householdSize : s.value)
                return (
                  <div key={key} className="flex items-center justify-between gap-3">
                    <span className={`cursor-help text-[0.85rem] underline decoration-dotted decoration-1 underline-offset-4 ${key in overrides ? 'text-gold' : ''}`} title={s.note}>{s.label}</span>
                    <span className="flex items-center gap-1.5">
                      <input type="number" className="num w-24 px-2 py-1 text-right text-[0.8rem]" value={isRate ? +(v * 100).toFixed(2) : v}
                        step={isRate ? 0.1 : s.max > 1000 ? 1000 : s.max > 10 ? 1 : 0.01}
                        onChange={(e) => setOverrides({ ...overrides, [key]: isRate ? Number(e.target.value) / 100 : Number(e.target.value) })} />
                      <span className="text-faint w-20 text-[0.7rem]">{isRate ? '%' : s.unit}</span>
                    </span>
                  </div>
                )
              })}
            </div>
          ))}
          {edited > 0 && <button onClick={() => setOverrides({})} className="text-gold text-[0.8rem]">Reset to defaults</button>}
        </div>
      ) : (
        <p className="text-mute text-[0.82rem]">Every number above depends on these editable estimates.</p>
      )}
      <div className="mt-2"><Info label="Limitations" text={`${GRID_NOTE} Hover an assumption's name to see what it means. Wind speeds are 50 m NASA point averages; turbine sites need detailed local studies.`} /></div>
    </Section>
  )
}

function Card({ label, value, children, note }: { label: string; value: ReactNode; children?: ReactNode; note?: string }) {
  return (
    <div className="border-edge rounded-md border p-3">
      <div className="label">{label} <span className="text-faint normal-case tracking-normal">· estimate</span></div>
      <div className="num text-gold mt-1 text-[1.3rem] leading-none">{value}</div>
      {children && <div className="text-mute mt-1.5 space-y-0.5 text-[0.78rem] leading-snug">{children}</div>}
      {note && <div className="text-faint mt-1.5 text-[0.72rem] leading-snug">{note}</div>}
    </div>
  )
}

function ShareInput({ value, onChange, label }: { value: number; onChange: (v: number) => void; label: string }) {
  return (
    <input type="number" aria-label={label} className="num w-14 px-1.5 py-0.5 text-right text-[0.8rem]" value={+(value * 100).toFixed(1)} step={0.5} min={0}
      onChange={(e) => onChange(Math.max(0, Number(e.target.value)) / 100)} />
  )
}

export default function PlanTab({ country, sim, split, setSplit, onRecommended, playbookLine, rule, specs, overrides, setOverrides }: {
  country: Country
  sim: Simulation | null
  split: Split | null
  setSplit: (s: Split) => void
  onRecommended: () => void
  /** Explanation when the split came from a peer's playbook */
  playbookLine: string | null
  rule: string | null
  specs: Record<string, AssumptionSpec>
  overrides: Record<string, number>
  setOverrides: (o: Record<string, number>) => void
}) {
  const shown = split ?? sim?.split ?? null
  const startYear = sim?.start.access_year ?? new Date().getFullYear()
  const outlook = country.outlook
  const noPlan = (t: number) => (sim && outlook && !outlook.no_gap ? sim.start.access + (outlook.change * t) / 10 : sim?.start.access ?? 0)
  const chart = sim ? [{ year: startYear, plan: sim.start.access, none: sim.start.access }, ...sim.years.map((r) => ({ year: startYear + r.year, plan: r.access_pct, none: noPlan(r.year) }))] : []
  const domain = fitDomain(chart.flatMap((c) => [c.plan, c.none]))
  const isRecommended = !!sim && !!shown && SECTORS.every((k) => Math.abs(sim.recommendation.split[k] - shown[k]) < 0.5)
  const b = sim?.budget ?? country.budget
  const set = (key: string) => (v: number) => setOverrides({ ...overrides, [key]: v })

  return (
    <>
      <Section title="Budget" right={<span className="num text-gold text-[0.95rem]">{formatMoney(b.total, 2)} / yr</span>}>
        <div className="space-y-1.5 text-[0.84rem]">
          <div className="flex items-center justify-between gap-3">
            <span className="flex items-center gap-1.5"><ShareInput label="Share of GDP" value={b.gdp.share} onChange={set('budget_gdp_share')} />% of GDP ({formatMoney(b.gdp.base)})</span>
            <span className="num">{formatMoney(b.gdp.amount, 2)}</span>
          </div>
          {b.resource.base > 0 && (
            <div className="flex items-center justify-between gap-3">
              <span className="flex items-center gap-1.5"><ShareInput label="Share of resource income" value={b.resource.share} onChange={set('budget_resource_share')} />% of {b.resource.word} income ({formatMoney(b.resource.base)}/yr{b.resource.years ? `, ${b.resource.years[0]}–${b.resource.years[1]}` : ''})</span>
              <span className="num">{formatMoney(b.resource.amount, 2)}</span>
            </div>
          )}
        </div>
      </Section>

      <Section title="Mix">
        {sim && (
          <div className="border-gold/40 bg-gold/5 flex items-start justify-between gap-3 rounded-md border px-3 py-2">
            <div className="text-[0.88rem] leading-snug">
              <p>
                {sim.recommendation.banner}{' '}
                {rule && <Info text={`Solar and wind are variable, not baseload; storage and the grid cover gaps. ${rule}`} />}
              </p>
              {playbookLine && <p className="text-gold mt-1 text-[0.8rem]">{playbookLine}</p>}
            </div>
            {!isRecommended && (
              <button onClick={onRecommended} className="text-gold hover:text-ink shrink-0 text-[0.78rem] underline underline-offset-2">Use recommended</button>
            )}
          </div>
        )}
        {shown && <SplitBar split={shown} setSplit={setSplit} amounts={sim?.split_amounts ?? null} />}
      </Section>

      {sim && (
        <Section title={`By ${startYear + 10}`}>
          <div className="grid grid-cols-2 gap-3">
            <Card label="Solar added" value={<CountUp value={sim.cards.solar.mw} format={(v) => formatCompact(v, 'MW')} />}>
              <div>{formatMoney(sim.cards.solar.capex)} invested · payback {sim.cards.solar.payback != null ? `${formatNumber(sim.cards.solar.payback, 1)} yrs` : 'n/a'}</div>
              <div>Best site: {sim.cards.solar.site.site}, {formatNumber(sim.cards.solar.site.value, 1)} kWh/m²/day</div>
            </Card>
            <Card label="Wind added" value={<CountUp value={sim.cards.wind.mw} format={(v) => formatCompact(v, 'MW')} />}>
              <div>~{formatInt(sim.cards.wind.turbines)} turbines of {formatNumber(sim.cards.wind.mw_per_turbine, 1)} MW · {formatMoney(sim.cards.wind.capex)}</div>
              <div>Best site: {sim.cards.wind.site.site}, {formatNumber(sim.cards.wind.site.value, 1)} m/s · capacity factor {formatPct(sim.cards.wind.capacity_factor * 100, 0)}</div>
            </Card>
            <Card label="Grid & storage" value={<CountUp value={sim.cards.grid.km} format={(v) => formatCompact(v, 'km')} />}>
              <div>{formatCompact(sim.cards.grid.storage_mwh, 'MWh')} of storage · {formatMoney(sim.cards.grid.capex)}</div>
              <div>Lines reach ~{formatCompact(sim.cards.grid.households)} homes</div>
            </Card>
            <Card label="Electricity access" value={<CountUp value={sim.cards.access.value} format={(v) => formatPct(v)} />} note={GRID_NOTE}>
              <div>From {formatPct(sim.start.access)} · clean share {formatPct(sim.cards.access.clean)}</div>
              <div>Limited by {sim.limit === 'lines' ? 'lines (more grid & storage helps)' : 'generation (more solar or wind helps)'}</div>
            </Card>
          </div>

          <div className="mt-5 h-[160px]">
            <div className="text-mute mb-1 flex flex-wrap gap-x-4 text-[0.75rem]">
              <span>Electricity access, %</span>
              <span><span className="bg-gold mr-1.5 inline-block h-[2px] w-3 align-middle" />With this plan</span>
              <span><span className="bg-mute mr-1.5 inline-block h-[2px] w-3 align-middle" />No plan (impact model)</span>
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

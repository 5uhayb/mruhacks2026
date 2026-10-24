import { useState, type ReactNode } from 'react'
import { Bar, BarChart, CartesianGrid, Cell, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { PRESETS, SECTORS, type AssumptionSpec, type Country, type Optimized, type Preset, type ReformInput, type Sector, type Simulation, type Split, type Supply } from '../../api'
import { formatCompact, formatInt, formatMoney, formatNumber, formatPct } from '../../lib/format'
import { CountUp, Section } from '../ui'
import SplitBar, { SECTOR_STYLE } from './SplitBar'
import { fitDomain } from './TwinsTab'

const AXIS = { stroke: '#4b5468', fontSize: 11, tickLine: false, axisLine: false, fontFamily: 'Geist Mono Variable' }
export const GRID_NOTE = 'Assumes new power can reach homes through the grid; transmission and connection upgrades are not modelled.'
export const DEFAULT_REFORM: ReformInput = { target_price: 0.6, phase_years: 5, rebate_share: 0.5, add_to_plan: true }
const PRESET_LABEL: Record<Preset, string> = { balanced: 'Balanced', power: 'Power', mobility: 'Mobility', growth: 'Growth', resilience: 'Resilience' }

function Assumptions({ specs, overrides, setOverrides, countryDefaults }: {
  specs: Record<string, AssumptionSpec>
  overrides: Record<string, number>
  setOverrides: (o: Record<string, number>) => void
  countryDefaults: Record<string, number>
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
                const isRate = s.unit === 'rate' || s.unit === 'rate/pt' || s.unit === '/yr' || s.unit === 'ratio'
                // Some defaults depend on the country (household size, fuel use), so show the value actually used
                const v = overrides[key] ?? countryDefaults[key] ?? s.value
                return (
                  <div key={key}>
                    <div className="flex items-center justify-between gap-3">
                      <span className={`text-[0.85rem] ${key in overrides ? 'text-gold' : ''}`}>{s.label}</span>
                      <span className="flex items-center gap-1.5">
                        <input type="number" className="num w-24 px-2 py-1 text-right text-[0.8rem]" value={isRate ? +(v * 100).toFixed(2) : v}
                          step={isRate ? 0.1 : s.unit.startsWith('$') && s.max > 100 ? 1000 : 0.05}
                          onChange={(e) => setOverrides({ ...overrides, [key]: isRate ? Number(e.target.value) / 100 : Number(e.target.value) })} />
                        <span className="text-faint w-16 text-[0.7rem]">{isRate ? '%' : s.unit}</span>
                      </span>
                    </div>
                    <p className="text-faint mt-0.5 text-[0.75rem] leading-snug">{s.note}</p>
                  </div>
                )
              })}
            </div>
          ))}
          {edited > 0 && <button onClick={() => setOverrides({})} className="text-gold text-[0.8rem]">Reset to defaults</button>}
        </div>
      ) : (
        <p className="text-mute text-[0.82rem]">Costs, returns per sector, solar sourcing, fuel reform, household size and build times. Every number above depends on them.</p>
      )}
      <p className="text-faint mt-3 text-[0.75rem] leading-snug">Limitation: {GRID_NOTE} Storage is not costed either.</p>
    </Section>
  )
}

function Card({ label, value, sub, note }: { label: string; value: ReactNode; sub?: ReactNode; note?: string }) {
  return (
    <div className="border-edge rounded-md border p-3">
      <div className="label">{label} <span className="text-faint normal-case tracking-normal">· estimate</span></div>
      <div className="num text-gold mt-1 text-[1.3rem] leading-none">{value}</div>
      {sub && <div className="text-mute mt-1.5 text-[0.78rem] leading-snug">{sub}</div>}
      {note && <div className="text-faint mt-1 text-[0.72rem] leading-snug">{note}</div>}
    </div>
  )
}

/** One sector: what it builds, what it cost, what it returns each year, and how long it takes to pay back */
function SectorCard({ sector, sim, headline, sub }: { sector: Sector; sim: Simulation; headline: ReactNode; sub: string }) {
  const e = sim.sectors[sector]
  const fund = sector === 'fund'
  return (
    <div className="border-edge rounded-md border p-3" style={{ borderTopColor: SECTOR_STYLE[sector].color, borderTopWidth: 2 }}>
      <div className="label">{SECTOR_STYLE[sector].label} <span className="text-faint normal-case tracking-normal">· estimate</span></div>
      <div className="num text-gold mt-1 text-[1.3rem] leading-none">{headline}</div>
      <div className="text-mute mt-1.5 text-[0.76rem] leading-snug">{sub}</div>
      <dl className="border-edge num mt-2 grid grid-cols-3 gap-1 border-t pt-2 text-[0.76rem]">
        <div><dt className="text-faint text-[0.66rem]">{fund ? 'Saved' : 'Invested'}</dt><dd>{formatMoney(e.capex)}</dd></div>
        <div><dt className="text-faint text-[0.66rem]">Return</dt><dd>{formatMoney(e.annual_return)}/yr</dd></div>
        <div><dt className="text-faint text-[0.66rem]">Payback</dt><dd>{e.payback != null ? `${formatNumber(e.payback, 1)} yrs` : 'None needed'}</dd></div>
      </dl>
      <p className="text-faint mt-1.5 text-[0.7rem] leading-snug">{e.basis}{sector === 'rail' ? ' · payback per km once open' : fund ? ' · capital stays liquid' : ''}.</p>
    </div>
  )
}

function NumberField({ label, value, onChange, step, unit, min, max }: { label: string; value: number; onChange: (v: number) => void; step: number; unit: string; min: number; max: number }) {
  return (
    <label className="flex items-center justify-between gap-3 text-[0.82rem]">
      <span>{label}</span>
      <span className="flex items-center gap-1.5">
        <input type="number" className="num w-20 px-2 py-1 text-right text-[0.8rem]" value={value} step={step} min={min} max={max}
          onChange={(e) => onChange(Math.min(max, Math.max(min, Number(e.target.value))))} />
        <span className="text-faint w-10 text-[0.7rem]">{unit}</span>
      </span>
    </label>
  )
}

function ReformAndSupply({ sim, startYear, supply, setSupply, reform, setReform, specs, overrides, setOverrides }: {
  sim: Simulation
  startYear: number
  supply: Supply
  setSupply: (s: Supply) => void
  reform: ReformInput | null
  setReform: (r: ReformInput | null) => void
  specs: Record<string, AssumptionSpec>
  overrides: Record<string, number>
  setOverrides: (o: Record<string, number>) => void
}) {
  const [open, setOpen] = useState(false)
  const r = sim.reform
  const threshold = (overrides.cpi_warning ?? specs.cpi_warning?.value ?? 0.03) * 100
  const full = r ? Math.min(r.phase_years, 10) - 1 : 0
  const relief = r ? r.rail_relief.indexOf(true) : -1
  const chart = r ? r.cpi.map((v, i) => ({ year: startYear + i + 1, cpi: v * 100, relief: r.rail_relief[i] })) : []
  return (
    <Section title="Fuel price reform & supply chain" right={<button onClick={() => setOpen(!open)} className="hover:text-ink">{open ? 'Hide ▴' : 'Show ▾'}</button>}>
      {!open ? (
        <p className="text-mute text-[0.82rem]">
          Solar: {sim.supply.label}. Fuel price reform: {reform ? `on, ${formatMoney(r?.freed[full])}/yr freed` : 'off'}.
        </p>
      ) : (
        <div className="space-y-5">
          <div>
            <div className="label text-ink mb-2">Solar supply chain</div>
            <div className="border-edge flex overflow-hidden rounded-md border text-[0.8rem]" role="group" aria-label="Solar supply chain">
              {(['import', 'local'] as Supply[]).map((k) => (
                <button key={k} onClick={() => setSupply(k)} className={`flex-1 px-3 py-1.5 ${supply === k ? 'bg-edge text-ink' : 'text-mute hover:text-ink'}`}>
                  {k === 'import' ? 'Import from Tier-1 licensed OEMs' : 'Local assembly joint venture'}
                </button>
              ))}
            </div>
            <p className="text-mute mt-2 text-[0.78rem] leading-snug">
              Build cost ×{formatNumber(sim.supply.capex_mult, 2)} · farms running {sim.supply.build_years} {sim.supply.build_years === 1 ? 'year' : 'years'} after funding
              {supply === 'local'
                ? ` · about ${formatInt(sim.supply.jobs)} local assembly jobs and ${formatMoney(sim.supply.local_value)} kept in the country by ${startYear + 10}`
                : ' · faster to deploy, no local manufacturing'} (estimates).
            </p>
            <p className="text-faint mt-1 text-[0.72rem]">{sim.supply.note}</p>
          </div>

          <div>
            <label className="flex items-center gap-2 text-[0.85rem]">
              <input type="checkbox" checked={!!reform} onChange={(e) => setReform(e.target.checked ? DEFAULT_REFORM : null)} />
              <span className="label text-ink">Gradual fuel price reform</span>
              <span className="text-faint text-[0.72rem]">optional funding source</span>
            </label>
            {reform && (
              <div className="mt-3 space-y-2">
                <NumberField label="Current pump price (estimate)" unit="$/L" step={0.01} min={0.01} max={2}
                  value={overrides.fuel_price_now ?? specs.fuel_price_now?.value ?? 0.15}
                  onChange={(v) => setOverrides({ ...overrides, fuel_price_now: v })} />
                <NumberField label="Target domestic fuel price" unit="$/L" step={0.05} min={0.01} max={3} value={reform.target_price}
                  onChange={(v) => setReform({ ...reform, target_price: v })} />
                <NumberField label="Phase-in period" unit="years" step={1} min={1} max={10} value={reform.phase_years}
                  onChange={(v) => setReform({ ...reform, phase_years: Math.round(v) })} />
                <NumberField label="Savings returned as cash rebates" unit="%" step={5} min={0} max={100} value={Math.round(reform.rebate_share * 100)}
                  onChange={(v) => setReform({ ...reform, rebate_share: v / 100 })} />
                <label className="flex items-center gap-2 text-[0.82rem]">
                  <input type="checkbox" checked={reform.add_to_plan} onChange={(e) => setReform({ ...reform, add_to_plan: e.target.checked })} />
                  Add the savings kept by the state to the investment plan
                </label>
                <p className="text-faint text-[0.72rem] leading-snug">
                  The current price is a generic placeholder: set it to the country's actual pump price.
                  {r && (r.litres_source
                    ? ` Fuel use: ${formatInt(r.litres_per_person)} L per person a year, from World Bank energy use (${formatInt(r.litres_source.energy_kgoe)} kg of oil equivalent per person, ${r.litres_source.year}) × road fuel share (estimate).`
                    : ` Fuel use: ${formatInt(r.litres_per_person)} L per person a year (edited).`)}
                  {' '}Pass-through and freight relief are editable under Assumptions.
                </p>
              </div>
            )}
            {reform && r && (
              <>
                <div className="mt-3 grid grid-cols-3 gap-2">
                  <Card label="Subsidy freed" value={`${formatMoney(r.freed[full])}/yr`}
                    sub={`At full price (year ${r.phase_years}). ${formatMoney(r.kept[full])}/yr kept after rebates${r.add_to_plan ? ', added to the plan' : ''}.`} />
                  <div className="border-edge rounded-md border p-3">
                    <div className="label">Consumer inflation <span className="text-faint normal-case tracking-normal">· estimate</span></div>
                    <div className={`num mt-1 text-[1.3rem] leading-none ${r.warning ? 'text-down' : 'text-gold'}`}>+{formatNumber(r.peak_cpi * 100, 1)}% CPI</div>
                    <div className="text-mute mt-1.5 text-[0.78rem] leading-snug">Per year during the {r.phase_years}-year phase-in, from higher transport and manufacturing costs.</div>
                    {r.warning && <span className="bg-down/15 text-down mt-1.5 inline-block rounded px-1.5 py-0.5 text-[0.7rem]">Above the {formatNumber(threshold, 0)}%/yr warning level</span>}
                  </div>
                  <Card label="Net cost per household" value={`${formatMoney(r.net_per_home_month[full])}/mo`}
                    sub={`${formatMoney(r.cost_per_home_month[full])}/mo higher costs − ${formatMoney(r.rebate_per_home_month[full])}/mo rebate (${formatPct(r.rebate_share * 100, 0)} of savings).`} />
                </div>
                <div className="mt-3 h-[120px]">
                  <div className="text-mute mb-1 text-[0.72rem]">Inflation added by the reform, % per year</div>
                  <ResponsiveContainer width="100%" height="85%">
                    <BarChart data={chart} margin={{ top: 4, right: 8, left: -18, bottom: 0 }}>
                      <CartesianGrid stroke="#1e2638" vertical={false} />
                      <XAxis dataKey="year" {...AXIS} interval={1} />
                      <YAxis {...AXIS} tickFormatter={(v) => `${v}%`} />
                      <ReferenceLine y={threshold} stroke="#ef5350" strokeDasharray="4 4" />
                      <Tooltip contentStyle={{ background: '#0d1320', border: '1px solid #1e2638', borderRadius: 6, fontSize: 12 }}
                        formatter={(v) => [`${formatNumber(Number(v), 2)}%`, 'Inflation added']} />
                      <Bar dataKey="cpi" isAnimationActive={false}>
                        {chart.map((c) => <Cell key={c.year} fill={c.relief ? '#5ec8e5' : '#f2a93b'} />)}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                </div>
                <p className="text-mute mt-1 text-[0.78rem] leading-snug">
                  Rebates lower what families pay, not the inflation rate.{' '}
                  {relief >= 0
                    ? `The rail corridor is complete in ${startYear + relief + 1}; from then on, cheaper freight removes part of the passed-on transport cost (blue).`
                    : 'The rail corridor is not complete within 10 years at this split, so there is no freight relief yet.'}
                  {' '}Household spending: {formatMoney(r.spending.value)} ({r.spending.year}, {r.spending.source}). Before any change in how much fuel people buy.
                </p>
              </>
            )}
          </div>
        </div>
      )}
    </Section>
  )
}

export default function PlanTab({ country, sim, share, setShare, split, setSplit, onPreset, optimizing, optimized, specs, overrides, setOverrides, supply, setSupply, reform, setReform }: {
  country: Country
  sim: Simulation | null
  share: number
  setShare: (v: number) => void
  split: Split
  setSplit: (s: Split) => void
  onPreset: (p: Preset) => void
  optimizing: Preset | null
  optimized: Optimized | null
  specs: Record<string, AssumptionSpec>
  overrides: Record<string, number>
  setOverrides: (o: Record<string, number>) => void
  supply: Supply
  setSupply: (s: Supply) => void
  reform: ReformInput | null
  setReform: (r: ReformInput | null) => void
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
  const matches = optimized && SECTORS.every((k) => Math.abs(optimized.split[k] - split[k]) < 0.5)

  return (
    <>
      <Section title="Capital allocation" right={sim ? `${formatMoney(sim.base_revenue, 2)} a year of ${country.resource} income` : undefined}>
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
        <div className="mt-4 flex flex-wrap items-center gap-1.5" role="group" aria-label="Priority presets">
          <span className="label mr-1">Priority</span>
          {PRESETS.map((p) => (
            <button key={p} onClick={() => onPreset(p)} disabled={optimizing != null}
              className={`rounded-full border px-3 py-1 text-[0.8rem] transition-colors disabled:opacity-60 ${optimized?.preset === p && matches ? 'border-gold text-gold bg-gold/10' : 'border-edge text-mute hover:text-ink hover:border-mute'}`}>
              {optimizing === p ? 'Searching…' : PRESET_LABEL[p]}
            </button>
          ))}
        </div>
        {optimized && (
          <p className="text-mute mt-2 text-[0.8rem] leading-snug">
            <span className="text-ink">{optimized.preset_label}:</span> {optimized.rationale}{' '}
            <span className="text-faint">({formatInt(optimized.plans_tested)} splits tested; ≥90% of spending on track in {formatPct(optimized.p_funded * 100, 0)} of 500 futures{matches ? '' : '; split edited since'}.)</span>
          </p>
        )}
        <SplitBar split={split} setSplit={setSplit} amounts={sim?.split_amounts ?? null} />
      </Section>

      {sim && y && h && rail && (
        <Section title={`By ${startYear + 10}: four sectors`}>
          <div className="grid grid-cols-2 gap-3">
            <SectorCard sector="solar" sim={sim} headline={<CountUp value={y.solar_mw} format={(v) => formatCompact(v, 'MW')} />}
              sub={`Solar at ${sim.sites[0]?.site ?? 'the sunniest site'} and beyond`} />
            <SectorCard sector="rail" sim={sim} headline={<CountUp value={rail.funded_km} format={(v) => formatCompact(v, 'km')} />}
              sub={rail.from
                ? `${rail.from} → ${rail.to}: ${formatInt(rail.funded_km)} of ${formatInt(rail.route_km)} km${rail.complete_year ? `, complete in ${startYear + rail.complete_year}` : ''}`
                : 'Of new intercity rail (no corridor defined for this country)'} />
            <SectorCard sector="industry" sim={sim} headline={<CountUp value={sim.sectors.industry.capex} format={(v) => formatMoney(v)} />}
              sub="Capital in tourism and non-oil industry (hotels, logistics, processing)" />
            <SectorCard sector="fund" sim={sim} headline={<CountUp value={y.fund} format={(v) => formatMoney(v)} />}
              sub={`About ${formatNumber(sim.months_covered, 1)} months of ${country.resource} income, to cover bad years`} />
          </div>

          <div className="mt-3 grid grid-cols-3 gap-3">
            {accessDone ? (
              <Card label="Clean electricity" value={<CountUp value={y.renewable_pct} format={(v) => formatPct(v)} />}
                sub={`From ${formatPct(sim.start.clean)} (${sim.start.clean_year}). Access already ${formatPct(sim.start.access)} (${sim.start.access_year}).`} />
            ) : (
              <Card label="Has electricity" value={<CountUp value={y.access_pct} format={(v) => formatPct(v)} />}
                sub={sim.access_full_year
                  ? `Everyone by ${startYear + sim.access_full_year}, from ${formatPct(sim.start.access)} (${sim.start.access_year})`
                  : `From ${formatPct(sim.start.access)} (${sim.start.access_year})`}
                note={GRID_NOTE} />
            )}
            {accessDone ? (
              <Card label="Has electricity" value={formatPct(y.access_pct)} sub={`Already near-universal (${sim.start.access_year})`} />
            ) : (
              <Card label="Clean electricity" value={<CountUp value={y.renewable_pct} format={(v) => formatPct(v)} />}
                sub={`From ${formatPct(sim.start.clean)} (${sim.start.clean_year})`} />
            )}
            <Card label="Homes" value={h.every_home ? 'Every home' : <CountUp value={h.homes_powered} format={(v) => formatCompact(v)} />}
              sub={h.every_home
                ? `All ~${formatCompact(h.households)} households, ${formatPct(h.left_over_share * 100, 0)} left for business`
                : `${formatPct(h.coverage * 100, 0)} of ${formatCompact(h.households)} households (${formatNumber(sim.household_size, 1)} people each)`} />
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
      {sim && (
        <ReformAndSupply sim={sim} startYear={startYear} supply={supply} setSupply={setSupply} reform={reform} setReform={setReform}
          specs={specs} overrides={overrides} setOverrides={setOverrides} />
      )}
      <Assumptions specs={specs} overrides={overrides} setOverrides={setOverrides} countryDefaults={sim?.country_defaults ?? {}} />
    </>
  )
}

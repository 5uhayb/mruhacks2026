import {
  Area,
  CartesianGrid,
  ComposedChart,
  Line,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { SECTORS, type AssumptionSpec, type OptimizeResult, type Plan, type Sector, type Split } from '../api'
import { AXIS, GRID, Note, Panel, Read, TOOLTIP } from '../components/ui'
import { formatAssumption, money, num, pct } from '../format'

const SECTOR_LABEL: Record<Sector, string> = { solar: 'Solar', rail: 'Rail', fund: 'Sovereign wealth fund' }

function Slider({ label, value, display, min, max, step, onChange }: {
  label: string
  value: number
  display: string
  min: number
  max: number
  step: number
  onChange: (v: number) => void
}) {
  return (
    <div className="py-1">
      <div className="flex justify-between">
        <span className="lbl">{label}</span>
        <span className="num text-ink text-[13px]">{display}</span>
      </div>
      <input type="range" min={min} max={max} step={step} value={value} onChange={(e) => onChange(Number(e.target.value))} />
    </div>
  )
}

export function Assumptions({ specs, overrides, setOverrides }: {
  specs: Record<string, AssumptionSpec>
  overrides: Record<string, number>
  setOverrides: (o: Record<string, number>) => void
}) {
  return (
    <div>
      <div className="mb-1 flex justify-end">
        {Object.keys(overrides).length > 0 && (
          <button onClick={() => setOverrides({})} className="num text-amb text-[11px]">[RESET ALL]</button>
        )}
      </div>
      <table className="w-full text-[12px]">
        <thead>
          <tr className="text-dim border-line border-b text-[10px] uppercase">
            <th className="text-left font-normal">Assumption</th>
            <th className="text-right font-normal">Value</th>
            <th className="pl-2 text-right font-normal">Range</th>
          </tr>
        </thead>
        <tbody>
          {Object.entries(specs).map(([key, s]) => {
            const value = overrides[key] ?? s.value
            const isRate = s.unit === 'rate' || s.unit === 'rate/pt' || s.unit === '/yr'
            return (
              <tr key={key} className="border-line border-b align-top" title={s.note}>
                <td className="py-1 pr-2">
                  <div className={key in overrides ? 'text-amb' : 'text-ink'}>{s.label}</div>
                  <div className="text-dim text-[11px] leading-tight">{s.note}</div>
                </td>
                <td className="py-1 text-right">
                  <input
                    type="number"
                    className="w-24 text-right text-[12px]"
                    value={isRate ? +(value * 100).toFixed(2) : value}
                    step={isRate ? 0.1 : s.unit.startsWith('$') ? 1000 : 0.05}
                    onChange={(e) => {
                      const raw = Number(e.target.value)
                      setOverrides({ ...overrides, [key]: isRate ? raw / 100 : raw })
                    }}
                  />
                  <div className="text-dim num text-[10px]">{isRate ? '%' : s.unit}</div>
                </td>
                <td className="num text-dim py-1 pl-2 text-right text-[11px] whitespace-nowrap">
                  {formatAssumption(s.min, s.unit)}–{formatAssumption(s.max, s.unit)}
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

function ValueChart({ plan }: { plan: Plan }) {
  const data = plan.years.map((y) => ({
    year: `Y${y.year}`,
    capital: y.capital_deployed,
    value: y.value_created,
    band: [y.value_created * 0.85, y.value_created * 1.15],
  }))
  const breakeven = plan.years.find((y) => y.capital_deployed > 0 && y.value_created >= y.capital_deployed)
  return (
    <ResponsiveContainer width="100%" height={230}>
      <ComposedChart data={data} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
        <CartesianGrid {...GRID} vertical={false} />
        <XAxis dataKey="year" {...AXIS} />
        <YAxis {...AXIS} tickFormatter={(v) => money(v, 0)} width={52} />
        <Tooltip
          {...TOOLTIP}
          formatter={(v, name) =>
            Array.isArray(v) ? [`${money(Number(v[0]))} – ${money(Number(v[1]))}`, '±15% band'] : [money(Number(v)), String(name)]
          }
        />
        <Area dataKey="band" stroke="none" fill="#e6e6e6" fillOpacity={0.08} isAnimationActive={false} />
        <Line dataKey="capital" name="Capital deployed" stroke="#808080" strokeWidth={1.5} dot={false} isAnimationActive={false} />
        <Line dataKey="value" name="Value created" stroke="#e6e6e6" strokeWidth={1.5} dot={false} isAnimationActive={false} />
        {breakeven && (
          <ReferenceLine x={`Y${breakeven.year}`} stroke="#ffb000" strokeDasharray="2 2"
            label={{ value: 'BREAKEVEN', fill: '#ffb000', fontSize: 10, fontFamily: 'IBM Plex Mono', position: 'insideTopLeft' }} />
        )}
      </ComposedChart>
    </ResponsiveContainer>
  )
}

export default function Allocate({ plan, share, setShare, split, setSplit, specs, overrides, setOverrides, onOptimize, optimizing, optimizeResult }: {
  plan: Plan
  share: number
  setShare: (v: number) => void
  split: Split
  setSplit: (s: Split) => void
  specs: Record<string, AssumptionSpec>
  overrides: Record<string, number>
  setOverrides: (o: Record<string, number>) => void
  onOptimize: () => void
  optimizing: boolean
  optimizeResult: OptimizeResult | null
}) {
  const total = SECTORS.reduce((s, k) => s + split[k], 0) || 1
  const r = plan.readout
  const last = plan.years[plan.years.length - 1]
  return (
    <div className="grid grid-cols-12">
      <div className="col-span-4 flex flex-col">
        <Panel title="Allocation" right="SHARE OF RESOURCE REVENUE">
          <Slider label="Revenue diverted" value={share} display={`${Math.round(share * 100)}%`} min={0} max={0.3} step={0.01} onChange={setShare} />
          {SECTORS.map((k) => (
            <Slider key={k} label={SECTOR_LABEL[k]} value={split[k]} display={`${Math.round((split[k] / total) * 100)}%`}
              min={0} max={100} step={1} onChange={(v) => setSplit({ ...split, [k]: v })} />
          ))}
          <button
            onClick={onOptimize}
            disabled={optimizing}
            className="border-amb text-amb hover:bg-amb mt-2 border px-2 py-1 text-left text-[11px] tracking-wider uppercase hover:text-black disabled:opacity-50"
          >
            {optimizing ? 'Testing 1,700 splits across 200 oil futures…' : 'Find most resilient split'}
          </button>
          {optimizeResult && (
            <p className="mt-1 text-[12px]">
              <span className="text-dim">P10 resilience, year 10: </span>
              <span className="num">{num(optimizeResult.current_robust_score)} → {num(optimizeResult.robust_score)}</span>
              <span className="text-dim"> · Rail is not in the score because its benefits are not modelled.</span>
            </p>
          )}
        </Panel>
        <Panel title="Live Readout" right={`${pct(r.share * 100, 0)} OF ${money(r.base_revenue)}/YR`}>
          <div className="grid grid-cols-3">
            <div>
              <div className="lbl">Annual pool</div>
              <div className="num text-[20px]">{money(r.pool)}</div>
            </div>
            <div>
              <div className="lbl">Per person</div>
              <div className="num text-[16px]">${num(r.per_person)}</div>
            </div>
            <div>
              <div className="lbl">Of revenue</div>
              <div className="num text-[16px]">{pct(r.share * 100, 0)}</div>
            </div>
          </div>
          <table className="num mt-2 w-full text-[12px]">
            <tbody>
              {SECTORS.map((k) => (
                <tr key={k} className="border-line border-t">
                  <td className="text-dim font-sans">{SECTOR_LABEL[k]}</td>
                  <td className="text-right">{money(r.split_amounts[k])}/yr</td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="mt-2"><Note>{r.note}</Note></div>
        </Panel>
        <Panel title="Assumptions" right="EDITABLE · HOVER FOR MEANING" className="flex-1">
          <Assumptions specs={specs} overrides={overrides} setOverrides={setOverrides} />
        </Panel>
      </div>

      <div className="col-span-8 flex flex-col">
        <Panel title="Capital Deployed vs Value Created" right="CUMULATIVE · 10 YEARS · ±15% BAND">
          <div className="text-dim mb-1 flex gap-4 text-[11px]">
            <span><span className="inline-block h-[2px] w-3 align-middle" style={{ background: '#808080' }} /> CAPITAL DEPLOYED (SOLAR + RAIL)</span>
            <span><span className="inline-block h-[2px] w-3 align-middle" style={{ background: '#e6e6e6' }} /> VALUE CREATED (FUEL FREED FOR EXPORT + FUND RETURNS)</span>
          </div>
          <ValueChart plan={plan} />
          <Note>{plan.value_note}</Note>
          <Read>
            READ: Solar's value is the oil and gas it frees for export. Rail adds kilometres, not modelled value, so the gap
            between the lines is partly rail.
          </Read>
        </Panel>
        <Panel title="10-Year Output" right="MODEL OUTPUT · BASE CASE" className="flex-1">
          <table className="num w-full text-[12px]">
            <thead>
              <tr className="text-dim border-line border-b text-[10px] uppercase">
                {['Year', 'Pool', 'Solar MW', 'Home-equiv.', 'Renew elec', 'Access', 'Rail km', 'Fund', 'Resilience'].map((h, i) => (
                  <th key={h} className={`font-normal ${i ? 'text-right' : 'text-left'}`}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {plan.years.map((y, i) => (
                <tr key={y.year} className={i % 2 ? 'bg-white/[0.03]' : ''}>
                  <td className="text-dim">Y{y.year}</td>
                  <td className="text-right">{money(y.pool)}</td>
                  <td className="text-right">{num(y.solar_mw)}</td>
                  <td className="text-right">{num(y.homes)}</td>
                  <td className="text-right">{pct(y.renewable_pct)}</td>
                  <td className="text-right">{pct(y.access_pct)}</td>
                  <td className="text-right">{num(y.rail_km)}</td>
                  <td className="text-right">{money(y.fund)}</td>
                  <td className="text-right">{num(y.resilience)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <Read>
            READ: By year 10 the plan has built {num(last.solar_mw)} MW of solar and {num(last.rail_km)} km of rail, and saved{' '}
            {money(last.fund)}. Solar produces {num(overrides.solar_build_years ?? specs.solar_build_years.value)} year(s)
            after funding; rail opens after {num(overrides.rail_build_years ?? specs.rail_build_years.value)}.
          </Read>
        </Panel>
      </div>
    </div>
  )
}

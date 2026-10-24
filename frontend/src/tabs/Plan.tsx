import { CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { SECTORS, type AssumptionSpec, type OptimizeResult, type Plan as PlanData, type Sector, type Split } from '../api'
import { AXIS, Big, GRID, Panel, TOOLTIP } from '../components/ui'
import { formatAssumption, money, num } from '../format'

const SECTOR_LABEL: Record<Sector, string> = { solar: 'Solar', rail: 'Rail', fund: 'Savings fund' }
const GOAL_STYLE: Record<string, { color: string; dash?: string }> = {
  goal_power: { color: '#e6e6e6' },
  goal_clean: { color: '#ffb000' },
  goal_savings: { color: '#808080' },
  goal_rail: { color: '#808080', dash: '4 3' },
}

function Slider({ label, value, display, sub, min, max, step, onChange }: {
  label: string
  value: number
  display: string
  sub?: string
  min: number
  max: number
  step: number
  onChange: (v: number) => void
}) {
  return (
    <div className="py-1.5">
      <div className="flex items-baseline justify-between">
        <span className="lbl">{label}</span>
        <span className="num text-[15px]">{display}{sub && <span className="text-dim text-[11px]"> {sub}</span>}</span>
      </div>
      <input type="range" min={min} max={max} step={step} value={value} onChange={(e) => onChange(Number(e.target.value))} />
    </div>
  )
}

function Assumptions({ specs, overrides, setOverrides }: {
  specs: Record<string, AssumptionSpec>
  overrides: Record<string, number>
  setOverrides: (o: Record<string, number>) => void
}) {
  return (
    <details className="mt-3 text-[12px]">
      <summary className="text-dim hover:text-amb num cursor-pointer text-[11px]">
        [+] ASSUMPTIONS ({Object.keys(specs).length}){Object.keys(overrides).length > 0 && ` · ${Object.keys(overrides).length} EDITED`}
      </summary>
      <table className="mt-2 w-full">
        <tbody>
          {Object.entries(specs).map(([key, s]) => {
            const value = overrides[key] ?? s.value
            const isRate = s.unit === 'rate' || s.unit === 'rate/pt' || s.unit === '/yr'
            return (
              <tr key={key} title={s.note} className="border-line border-b">
                <td className={`py-1 ${key in overrides ? 'text-amb' : ''}`}>{s.label}</td>
                <td className="text-right">
                  <input
                    type="number"
                    className="w-24 text-right text-[12px]"
                    value={isRate ? +(value * 100).toFixed(2) : value}
                    step={isRate ? 0.1 : s.unit.startsWith('$') ? 1000 : 0.05}
                    onChange={(e) => setOverrides({ ...overrides, [key]: isRate ? Number(e.target.value) / 100 : Number(e.target.value) })}
                  />
                </td>
                <td className="text-dim num pl-2 text-right text-[10px] whitespace-nowrap">
                  {formatAssumption(s.min, s.unit)}–{formatAssumption(s.max, s.unit)}
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
      {Object.keys(overrides).length > 0 && (
        <button onClick={() => setOverrides({})} className="num text-amb mt-1 text-[11px]">[RESET]</button>
      )}
    </details>
  )
}

export default function Plan({ plan, share, setShare, split, setSplit, specs, overrides, setOverrides, onOptimize, optimizing, optimizeResult }: {
  plan: PlanData
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
  const y = plan.years[plan.years.length - 1]
  const chart = [
    { year: 'Now', ...Object.fromEntries(plan.goals.map((g) => [g.key, plan.today[g.key] * 100])) },
    ...plan.years.map((r) => ({ year: `Y${r.year}`, ...Object.fromEntries(plan.goals.map((g) => [g.key, r[g.key] * 100])) })),
  ]
  return (
    <div className="grid grid-cols-12">
      <Panel title="1 · How much to invest" className="col-span-4">
        <Slider label="Share of oil money" value={share} display={`${Math.round(share * 100)}%`} min={0} max={0.3} step={0.01} onChange={setShare} />
        <Big label="Budget per year" value={money(plan.pool)} line={`$${num(plan.per_person)} per person`} />

        <div className="lbl mt-5 mb-1">2 · Where it goes</div>
        {SECTORS.map((k) => (
          <Slider key={k} label={SECTOR_LABEL[k]} value={split[k]} display={`${Math.round((split[k] / total) * 100)}%`}
            sub={money(plan.split_amounts[k])} min={0} max={100} step={1} onChange={(v) => setSplit({ ...split, [k]: v })} />
        ))}

        <button
          onClick={onOptimize}
          disabled={optimizing}
          className="border-amb text-amb hover:bg-amb mt-3 w-full border px-3 py-2 text-[12px] font-semibold tracking-wider hover:text-black disabled:opacity-50"
        >
          {optimizing ? 'TESTING SPLITS…' : 'AUTO-PLAN: HIT THE MOST GOALS'}
        </button>
        {optimizeResult && (
          <p className="text-dim num mt-1 text-[11px]">
            BAD-OIL-YEARS SCORE {num(optimizeResult.current_robust_score)} → <span className="text-up">{num(optimizeResult.robust_score)}</span>
          </p>
        )}
        <Assumptions specs={specs} overrides={overrides} setOverrides={setOverrides} />
      </Panel>

      <div className="col-span-8 flex flex-col">
        <Panel title="3 · What you get by year 10">
          <div className="grid grid-cols-4 gap-4">
            <Big label="Solar built" value={`${num(y.solar_mw / 1000, 1)} GW`} line={`${num(y.homes / 1e6, 1)}M homes' worth`} size="text-[26px]" />
            <Big label="Clean power" value={`${num(y.renewable_pct)}%`} line="of all electricity" size="text-[26px]" />
            <Big label="Rail built" value={`${num(y.rail_km)} km`} line={`of ${num(plan.route_km)} km goal`} size="text-[26px]" />
            <Big label="Savings" value={money(y.fund)} line="for bad oil years" size="text-[26px]" />
          </div>
        </Panel>
        <Panel title="Progress to each goal" right="% OF GOAL · 100 = MET" className="flex-1">
          <ResponsiveContainer width="100%" height={260}>
            <LineChart data={chart} margin={{ top: 6, right: 16, left: -10, bottom: 0 }}>
              <CartesianGrid {...GRID} vertical={false} />
              <XAxis dataKey="year" {...AXIS} />
              <YAxis {...AXIS} domain={[0, 100]} ticks={[0, 25, 50, 75, 100]} />
              <Tooltip {...TOOLTIP} formatter={(v, name) => [`${num(Number(v))}%`, plan.goals.find((g) => g.key === name)?.label ?? String(name)]} />
              <Legend formatter={(key) => <span className="text-[11px]">{plan.goals.find((g) => g.key === key)?.label}</span>} />
              {plan.goals.map((g) => (
                <Line key={g.key} dataKey={g.key} stroke={GOAL_STYLE[g.key].color} strokeDasharray={GOAL_STYLE[g.key].dash}
                  strokeWidth={1.5} dot={false} isAnimationActive={false} />
              ))}
            </LineChart>
          </ResponsiveContainer>
        </Panel>
      </div>
    </div>
  )
}

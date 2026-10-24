import { SECTORS, type OptimizeResult, type Sector, type Split } from '../api'
import { SECTOR_INFO, num, usd } from '../format'
import { Card } from './Card'

type Props = {
  oilPrice: number
  setOilPrice: (v: number) => void
  investShare: number
  setInvestShare: (v: number) => void
  split: Split
  setSplit: (s: Split) => void
  annualBudget: number | undefined
  currentBrent: number
  onOptimize: () => void
  optimizing: boolean
  optimizeResult: OptimizeResult | null
  assumptions: Record<string, number>
}

function Slider({ value, min, max, step, onChange, color }: {
  value: number
  min: number
  max: number
  step: number
  onChange: (v: number) => void
  color?: string
}) {
  return (
    <input
      type="range"
      min={min}
      max={max}
      step={step}
      value={value}
      onChange={(e) => onChange(Number(e.target.value))}
      className="w-full"
      style={{ accentColor: color ?? '#818cf8' }}
    />
  )
}

export default function Controls(props: Props) {
  const { split, setSplit } = props
  const total = SECTORS.reduce((sum, s) => sum + split[s], 0) || 1

  return (
    <Card title="Investment plan" subtitle="Redirect oil revenue into the future">
      <div className="space-y-5">
        <div>
          <div className="flex justify-between text-sm">
            <span className="text-slate-300">Oil price assumption</span>
            <span className="font-mono text-slate-100">${props.oilPrice}/barrel</span>
          </div>
          <Slider value={props.oilPrice} min={30} max={150} step={1} onChange={props.setOilPrice} color="#f97316" />
          <div className="text-xs text-slate-500">Last 12 months average: ${num(props.currentBrent)}</div>
        </div>

        <div>
          <div className="flex justify-between text-sm">
            <span className="text-slate-300">Share of oil revenue invested</span>
            <span className="font-mono text-slate-100">{Math.round(props.investShare * 100)}%</span>
          </div>
          <Slider value={props.investShare} min={0.05} max={0.5} step={0.01} onChange={props.setInvestShare} />
          <div className="text-xs text-slate-500">= {usd(props.annualBudget)} per year to invest</div>
        </div>

        <div className="space-y-3 border-t border-slate-800 pt-4">
          <div className="flex h-3 overflow-hidden rounded-full">
            {SECTORS.map((s) => (
              <div
                key={s}
                style={{ width: `${(split[s] / total) * 100}%`, background: SECTOR_INFO[s].color }}
                className="transition-all duration-500"
              />
            ))}
          </div>
          {SECTORS.map((s: Sector) => (
            <div key={s}>
              <div className="flex justify-between text-sm">
                <span className="text-slate-300">
                  {SECTOR_INFO[s].icon} {SECTOR_INFO[s].label}
                </span>
                <span className="font-mono" style={{ color: SECTOR_INFO[s].color }}>
                  {Math.round((split[s] / total) * 100)}%
                </span>
              </div>
              <Slider
                value={split[s]}
                min={0}
                max={100}
                step={1}
                color={SECTOR_INFO[s].color}
                onChange={(v) => setSplit({ ...split, [s]: v })}
              />
            </div>
          ))}
        </div>

        <button
          onClick={props.onOptimize}
          disabled={props.optimizing}
          className="w-full rounded-lg bg-gradient-to-r from-amber-500 to-emerald-500 px-4 py-2.5 font-semibold text-slate-950 transition hover:brightness-110 disabled:opacity-60"
        >
          {props.optimizing ? 'Testing 2,000 budget splits...' : '✨ Find the most resilient split'}
        </button>
        {props.optimizeResult && (
          <p className="text-sm text-slate-300">
            Score in a bad oil decade (worst 10% of scenarios):{' '}
            <span className="font-mono text-slate-400">{num(props.optimizeResult.current_robust_score)}</span> →{' '}
            <span className="font-mono font-bold text-emerald-400">{num(props.optimizeResult.robust_score)}</span>
          </p>
        )}

        <details className="text-xs text-slate-400">
          <summary className="cursor-pointer text-slate-300">Model assumptions</summary>
          <ul className="mt-2 space-y-1">
            {Object.entries(props.assumptions).map(([k, v]) => (
              <li key={k} className="flex justify-between gap-2">
                <span>{k.replaceAll('_', ' ')}</span>
                <span className="font-mono">{v.toLocaleString()}</span>
              </li>
            ))}
          </ul>
        </details>
      </div>
    </Card>
  )
}

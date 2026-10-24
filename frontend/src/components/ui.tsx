import { useState, type ReactNode } from 'react'
import type { GoalKey, Plan, Point, Why as WhyData } from '../api'
import { money, num } from '../format'

export function Panel({ title, right, children, className = '' }: {
  title: string
  right?: ReactNode
  children: ReactNode
  className?: string
}) {
  return (
    <section className={`border-line flex flex-col border-r border-b p-4 ${className}`}>
      <header className="mb-3 flex items-baseline justify-between">
        <h2 className="lbl font-medium">{title}</h2>
        {right && <div className="text-dim num text-[11px]">{right}</div>}
      </header>
      {children}
    </section>
  )
}

/** One big number with a label and one short line */
export function Big({ label, value, line, title, size = 'text-[32px]' }: {
  label: string
  value: ReactNode
  line?: ReactNode
  title?: string
  size?: string
}) {
  return (
    <div title={title} className={title ? 'cursor-help' : ''}>
      <div className="lbl">{label}</div>
      <div className={`num text-ink leading-tight font-medium ${size}`}>{value}</div>
      {line && <div className="text-dim mt-1 text-[13px]">{line}</div>}
    </div>
  )
}

export function Sparkline({ points, width = 120, height = 28 }: { points: Point[]; width?: number; height?: number }) {
  if (points.length < 2) return null
  const xs = points.map((p) => p.year)
  const ys = points.map((p) => p.value)
  const [x0, x1, y0, y1] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)]
  const sx = (x: number) => ((x - x0) / (x1 - x0 || 1)) * (width - 2) + 1
  const sy = (y: number) => height - 1 - ((y - y0) / (y1 - y0 || 1)) * (height - 2)
  return (
    <svg width={width} height={height}>
      <polyline points={points.map((p) => `${sx(p.year)},${sy(p.value)}`).join(' ')} fill="none" stroke="#e6e6e6" strokeWidth={1} />
    </svg>
  )
}

/** "?" toggle with the method behind a number; hidden by default */
export function Why({ why }: { why: WhyData }) {
  const [open, setOpen] = useState(false)
  return (
    <div className="mt-2">
      <button onClick={() => setOpen(!open)} className="num text-dim hover:text-amb text-[11px]">
        [{open ? '−' : '?'}] HOW IS THIS CALCULATED
      </button>
      {open && (
        <div className="border-amb mt-1 space-y-1.5 border-l pl-2 text-[12px]">
          <p>{why.words}</p>
          <p className="num text-amb">{why.symbols}</p>
          <table className="w-full">
            <tbody>
              {why.inputs.map((i) => (
                <tr key={i.label} className="align-top">
                  <td className="text-dim pr-2 whitespace-nowrap">{i.label}</td>
                  <td className="num pr-2 text-right whitespace-nowrap">{i.value}</td>
                  <td className="text-dim text-[11px]">{i.source}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p><span className="lbl mr-1">Moves it most:</span>{why.sensitivity}</p>
        </div>
      )}
    </div>
  )
}

/** Display value for a goal, from its 0-1 progress */
export function goalValue(key: GoalKey, progress: number, plan: Plan): string {
  if (key === 'goal_power') return `${num(progress * 100)}%`
  if (key === 'goal_clean') return `${num(progress * 50)}%`
  if (key === 'goal_savings') return money(progress * plan.base_revenue)
  return `${num(progress * plan.route_km)} km`
}

/** The goals strip: today → year 10, with progress bars */
export function GoalBar({ plan }: { plan: Plan }) {
  const y10 = plan.years[plan.years.length - 1]
  const met = plan.goals.filter((g) => y10[g.key] >= 0.999).length
  return (
    <div className="border-line grid grid-cols-[repeat(4,1fr)_150px] border-b">
      {plan.goals.map((g) => {
        const [now, then] = [plan.today[g.key], y10[g.key]]
        const done = then >= 0.999
        return (
          <div key={g.key} className="border-line border-r px-4 py-2.5">
            <div className="flex items-baseline justify-between">
              <span className="lbl">{g.label}</span>
              <span className={`num text-[11px] font-semibold ${done ? 'text-up' : 'text-dim'}`}>{done ? '✓ MET' : `${num(then * 100)}%`}</span>
            </div>
            <div className="num mt-0.5 text-[15px]">
              <span className="text-dim">{goalValue(g.key, now, plan)}</span>
              <span className="text-dim"> → </span>
              <span className={done ? 'text-up' : 'text-ink'}>{goalValue(g.key, then, plan)}</span>
            </div>
            <div className="relative mt-1.5 h-[5px] bg-[#1a1a1a]">
              <div className={`absolute h-full transition-all duration-300 ${done ? 'bg-up' : 'bg-ink'}`} style={{ width: `${then * 100}%` }} />
              <div className="absolute h-full bg-[#4a4a4a]" style={{ width: `${now * 100}%` }} />
            </div>
            <div className="text-dim mt-1 text-[11px]">Goal: {g.target}</div>
          </div>
        )
      })}
      <div className="flex flex-col justify-center px-4">
        <span className="lbl">Goals met</span>
        <span className="num text-[26px] leading-none font-medium">{met}<span className="text-dim text-[16px]">/4</span></span>
        <span className="text-dim num text-[11px]">BY YEAR 10</span>
      </div>
    </div>
  )
}

export function Footer() {
  return (
    <footer className="text-dim border-line border-t px-4 py-1.5 text-[11px]">
      Illustrative model built on public World Bank and NASA data. Not investment advice.
    </footer>
  )
}

export const AXIS = { stroke: '#808080', fontSize: 10, fontFamily: 'IBM Plex Mono', tickLine: false }
export const GRID = { stroke: '#1a1a1a' }
export const TOOLTIP = {
  contentStyle: { background: '#000', border: '1px solid #2a2a2a', fontFamily: 'IBM Plex Mono', fontSize: 11 },
  labelStyle: { color: '#ffb000' },
  itemStyle: { color: '#e6e6e6' },
}

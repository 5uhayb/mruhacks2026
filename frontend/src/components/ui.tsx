import { useState, type ReactNode } from 'react'
import type { MetricBlock, Point, Why as WhyData } from '../api'
import { money, num, smallPct } from '../format'

export function Panel({ title, right, children, className = '' }: {
  title: string
  right?: ReactNode
  children: ReactNode
  className?: string
}) {
  return (
    <section className={`border-line flex flex-col border-r border-b p-3 ${className}`}>
      <header className="border-line mb-2 flex items-baseline justify-between border-b pb-1">
        <h2 className="lbl font-medium">{title}</h2>
        {right && <div className="text-dim num text-[11px]">{right}</div>}
      </header>
      {children}
    </section>
  )
}

export function Read({ children }: { children: ReactNode }) {
  return <p className="text-dim mt-2 text-[12px] italic leading-snug">{children}</p>
}

export function Note({ children }: { children: ReactNode }) {
  return <p className="text-ink text-[13px] leading-snug">{children}</p>
}

/** Signed comparison, green when good and red when bad */
export function Delta({ diff, unit, good, vs, digits = 1 }: {
  diff: number
  unit: string
  good: boolean
  vs?: string
  digits?: number
}) {
  const arrow = diff >= 0 ? '▲' : '▼'
  return (
    <span className={`num text-[12px] ${good ? 'text-up' : 'text-dn'}`}>
      {arrow} {num(Math.abs(diff), digits)}
      {unit}
      {vs && <span className="text-dim"> vs {vs}</span>}
    </span>
  )
}

export function Sparkline({ points, width = 90, height = 22 }: { points: Point[]; width?: number; height?: number }) {
  if (points.length < 2) return null
  const xs = points.map((p) => p.year)
  const ys = points.map((p) => p.value)
  const [x0, x1, y0, y1] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)]
  const sx = (x: number) => ((x - x0) / (x1 - x0 || 1)) * (width - 2) + 1
  const sy = (y: number) => height - 1 - ((y - y0) / (y1 - y0 || 1)) * (height - 2)
  return (
    <svg width={width} height={height} className="shrink-0">
      <polyline
        points={points.map((p) => `${sx(p.year)},${sy(p.value)}`).join(' ')}
        fill="none"
        stroke="#e6e6e6"
        strokeWidth={1}
      />
    </svg>
  )
}

/** Yearly bars; highlighted years drawn in off-white, others grey */
export function BarSpark({ values, highlight, height = 48 }: {
  values: { year: number; value: number }[]
  highlight: number[]
  height?: number
}) {
  const max = Math.max(...values.map((v) => v.value), 1)
  return (
    <div className="flex items-end gap-[3px]" style={{ height }}>
      {values.map((v) => (
        <div key={v.year} className="flex flex-1 flex-col items-center" title={`${v.year}: ${money(v.value)}`}>
          <div
            style={{ height: Math.max(1, (v.value / max) * (height - 12)), background: highlight.includes(v.year) ? '#e6e6e6' : '#4a4a4a' }}
            className="w-full"
          />
          <span className="num text-dim mt-[2px] text-[8px] leading-none">{String(v.year).slice(2)}</span>
        </div>
      ))}
    </div>
  )
}

function formatValue(m: MetricBlock): string {
  if (m.value == null) return '—'
  if (m.unit === '$') return `$${num(m.value)}`
  if (m.unit.startsWith('%')) return m.key === 'renewable_electricity_pct' ? smallPct(m.value) : `${num(m.value, 1)}%`
  return num(m.value, 2)
}

/** The four-line metric block: label, value + year + sparkline, comparison, analyst note */
export function Metric({ m, compact = false }: { m: MetricBlock; compact?: boolean }) {
  return (
    <div className="border-line border-b py-2 last:border-b-0">
      <div className="lbl">{m.label}</div>
      <div className="flex items-center justify-between gap-2">
        <div title={m.source} className="cursor-help">
          <span className="num text-ink text-[18px] font-medium">{formatValue(m)}</span>
          {m.unit === '% GDP' && <span className="text-dim num text-[11px]"> of GDP</span>}
          <span className="text-dim num ml-2 text-[11px]">{m.year}</span>
        </div>
        <Sparkline points={m.sparkline} />
      </div>
      {m.compare && (
        <Delta diff={m.compare.diff} unit={m.compare.unit} good={m.compare.good} vs={m.compare.vs} digits={m.unit === '' ? 2 : 1} />
      )}
      {!compact && <Note>{m.note}</Note>}
    </div>
  )
}

/** "?" toggle that explains how a computed number was produced */
export function Why({ why, label = 'WHY THIS NUMBER' }: { why: WhyData; label?: string }) {
  const [open, setOpen] = useState(false)
  return (
    <div className="mt-1">
      <button onClick={() => setOpen(!open)} className="num text-dim hover:text-amb text-[11px]">
        [{open ? '−' : '?'}] {label}
      </button>
      {open && (
        <div className="border-amb mt-1 space-y-1.5 border-l pl-2 text-[12px]">
          <p className="text-ink">{why.words}</p>
          <p className="num text-amb">{why.symbols}</p>
          <table className="w-full">
            <tbody>
              {why.inputs.map((i) => (
                <tr key={i.label} className="align-top">
                  <td className="text-dim pr-2 whitespace-nowrap">{i.label}</td>
                  <td className="num text-ink pr-2 text-right whitespace-nowrap">{i.value}</td>
                  <td className="text-dim text-[11px]">{i.source}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="text-ink">
            <span className="lbl mr-1">Most sensitive:</span>
            {why.sensitivity}
          </p>
        </div>
      )}
    </div>
  )
}

/** Compact stat cell for deal cards and readouts */
export function Cell({ label, value, sub }: { label: string; value: ReactNode; sub?: ReactNode }) {
  return (
    <div className="border-line border-r border-b p-2">
      <div className="lbl">{label}</div>
      <div className="num text-ink text-[16px]">{value}</div>
      {sub && <div className="num text-dim text-[11px]">{sub}</div>}
    </div>
  )
}

export function Footer() {
  return (
    <footer className="text-dim border-line border-t px-3 py-1.5 text-[11px]">
      Illustrative planning model built on public World Bank and NASA data and the assumptions shown. Not investment
      advice.
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

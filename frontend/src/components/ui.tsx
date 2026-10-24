import { geoCentroid } from 'd3-geo'
import { Component, useEffect, useRef, useState, type ReactNode } from 'react'
import type { Point } from '../api'

/** Keeps one broken section from taking down the whole workspace */
export class Boundary extends Component<{ children: ReactNode; label: string }, { error: string | null }> {
  state = { error: null as string | null }
  static getDerivedStateFromError(e: Error) {
    return { error: e.message }
  }
  render() {
    if (this.state.error) {
      return (
        <div className="text-mute p-5 text-[0.85rem]">
          {this.props.label} failed to render: {this.state.error}{' '}
          <button className="text-ink underline" onClick={() => this.setState({ error: null })}>Retry</button>
        </div>
      )
    }
    return this.props.children
  }
}

/** Number that eases to each new value (500ms); always lands on the final value even if frames stall */
export function CountUp({ value, format }: { value: number; format: (v: number) => string }) {
  const [shown, setShown] = useState(value)
  const from = useRef(value)
  useEffect(() => {
    const start = performance.now()
    const a = from.current
    let raf = 0
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / 500)
      const v = a + (value - a) * (1 - Math.pow(1 - t, 3))
      setShown(v)
      from.current = v
      if (t < 1) raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    const done = setTimeout(() => {
      cancelAnimationFrame(raf)
      setShown(value)
      from.current = value
    }, 650)
    return () => {
      cancelAnimationFrame(raf)
      clearTimeout(done)
    }
  }, [value])
  return <span className="num">{format(shown)}</span>
}

export function Sparkline({ points, width = 96, height = 26, color = '#e8ecf3', unit = '' }: {
  points: Point[]
  width?: number
  height?: number
  color?: string
  unit?: string
}) {
  if (points.length < 2) return <svg width={width} height={height} />
  const xs = points.map((p) => p.year)
  const ys = points.map((p) => p.value)
  const [x0, x1, y0, y1] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)]
  const sx = (x: number) => ((x - x0) / (x1 - x0 || 1)) * (width - 6) + 3
  const sy = (y: number) => height - 3 - ((y - y0) / (y1 - y0 || 1)) * (height - 6)
  const [first, last] = [points[0], points[points.length - 1]]
  const n = (v: number) => v.toLocaleString('en-US', { maximumFractionDigits: v < 10 ? 2 : 0 })
  const fmt = (v: number) => (unit === '$' ? `$${n(v)}` : unit === 'kWh' ? `${n(v)} kWh` : `${n(v)}${unit}`)
  return (
    <svg width={width} height={height} className="shrink-0 cursor-help">
      {/* Native tooltip: years and range */}
      <title>{`${first.year}: ${fmt(first.value)} → ${last.year}: ${fmt(last.value)} · min ${fmt(y0)}, max ${fmt(y1)}`}</title>
      <polyline points={points.map((p) => `${sx(p.year)},${sy(p.value)}`).join(' ')} fill="none" stroke={color} strokeWidth={1.25} strokeOpacity={0.85} />
      <circle cx={sx(first.year)} cy={sy(first.value)} r={1.8} fill="none" stroke={color} strokeWidth={1} />
      <circle cx={sx(last.year)} cy={sy(last.value)} r={2.2} fill={color} />
    </svg>
  )
}

export function Section({ title, right, children }: { title: string; right?: ReactNode; children: ReactNode }) {
  return (
    <section className="border-edge border-b px-5 py-4 last:border-b-0">
      <div className="mb-3 flex items-baseline justify-between gap-3">
        <h3 className="label">{title}</h3>
        {right && <div className="text-mute text-[0.75rem]">{right}</div>}
      </div>
      {children}
    </section>
  )
}

export function Stat({ label, value, sub, accent }: { label: string; value: ReactNode; sub?: ReactNode; accent?: 'gold' | 'cyan' }) {
  return (
    <div>
      <div className="label">{label}</div>
      <div className={`num mt-1 text-[1.6rem] leading-none ${accent === 'gold' ? 'text-gold' : accent === 'cyan' ? 'text-cyan' : ''}`}>{value}</div>
      {sub && <div className="text-mute mt-1.5 text-[0.8rem] leading-snug">{sub}</div>}
    </div>
  )
}

/** Width and height of an element, kept up to date */
export function useSize<T extends HTMLElement>() {
  const ref = useRef<T>(null)
  const [size, setSize] = useState({ width: 0, height: 0 })
  useEffect(() => {
    if (!ref.current) return
    const ro = new ResizeObserver(([e]) => setSize({ width: e.contentRect.width, height: e.contentRect.height }))
    ro.observe(ref.current)
    return () => ro.disconnect()
  }, [])
  return [ref, size] as const
}

// ---------- Geography (outlines cached locally in /public) ----------

export type CountryFeature = {
  type: 'Feature'
  properties: { ISO_A3: string; ADM0_A3: string; NAME: string }
  geometry: GeoJSON.Geometry
}

let featuresPromise: Promise<CountryFeature[]> | null = null
export function loadFeatures(): Promise<CountryFeature[]> {
  featuresPromise ??= fetch('/countries.geojson').then((r) => r.json()).then((d) => d.features as CountryFeature[])
  return featuresPromise
}

/** Natural Earth marks some ISO codes as -99 (e.g. Norway); fall back to ADM0_A3 */
export const isoOf = (f: CountryFeature) => (f.properties.ISO_A3 !== '-99' ? f.properties.ISO_A3 : f.properties.ADM0_A3)

export function centroidOf(f: CountryFeature): { lat: number; lng: number } {
  // Use the largest polygon so countries with far-off islands center on the mainland
  const g = f.geometry
  let target: GeoJSON.Geometry = g
  if (g.type === 'MultiPolygon') {
    const areas = g.coordinates.map((poly) => Math.abs(ringArea(poly[0])))
    target = { type: 'Polygon', coordinates: g.coordinates[areas.indexOf(Math.max(...areas))] }
  }
  const [lng, lat] = geoCentroid({ type: 'Feature', properties: {}, geometry: target } as never)
  return { lat, lng }
}

function ringArea(ring: number[][]): number {
  let a = 0
  for (let i = 0; i < ring.length - 1; i++) a += ring[i][0] * ring[i + 1][1] - ring[i + 1][0] * ring[i][1]
  return a / 2
}

export function hasWebGL(): boolean {
  try {
    const c = document.createElement('canvas')
    return !!(c.getContext('webgl2') || c.getContext('webgl'))
  } catch {
    return false
  }
}

// ---------- Colors ----------

const mix = (a: number[], b: number[], t: number) => a.map((v, i) => Math.round(v + (b[i] - v) * Math.max(0, Math.min(1, t))))
const rgb = (c: number[], alpha = 1) => `rgba(${c[0]},${c[1]},${c[2]},${alpha})`
const GOLD = [242, 169, 59]

/** Electricity access tiers: the globe's only color scale */
export const TIERS = [
  { min: 90, label: 'Connected', range: '90%+', color: [91, 107, 133], hex: '#5B6B85' },
  { min: 60, label: 'Struggling', range: '60–90%', color: [245, 158, 11], hex: '#F59E0B' },
  { min: 0, label: 'Critical', range: 'Below 60%', color: [239, 68, 68], hex: '#EF4444' },
] as const
const tier = (access: number) => TIERS.find((t) => access >= t.min)!.color as unknown as number[]

/** Measured electricity access, by tier */
export const accessColor = (access: number) => rgb(tier(access))
/** Projected years: same tiers with a faint gold tint, so the future reads differently */
export const projectedColor = (access: number) => rgb(mix(tier(access), GOLD, 0.12))
/** The selected country as the plan reshapes it */
export const planColor = (access: number, strength: number) => rgb(mix(tier(access), GOLD, 0.35 + 0.4 * strength))
export const NO_DATA = '#2A303C'

/** "How is this calculated?": the longer explanation lives in a hover tooltip (click toggles it for touch) */
export function Info({ text, label = 'How is this calculated?' }: { text: string; label?: string }) {
  const [open, setOpen] = useState(false)
  return (
    <span className="relative inline-block">
      <button type="button" title={text} onClick={() => setOpen(!open)} onBlur={() => setOpen(false)}
        className="text-faint hover:text-ink cursor-help text-[0.72rem] underline decoration-dotted underline-offset-2">
        {label}
      </button>
      {open && (
        <span role="tooltip" className="bg-panel border-edge text-mute absolute top-full left-0 z-40 mt-1 block w-72 rounded-md border p-2.5 text-[0.75rem] leading-snug shadow-lg">
          {text}
        </span>
      )}
    </span>
  )
}

// ---------- Flags (bundled SVGs from flag-icons, so they render offline and on Windows) ----------

const iso2ByIso3 = new Map<string, string>()
export function setFlagCodes(pairs: [string, string | null][]) {
  for (const [iso3, iso2] of pairs) if (iso2) iso2ByIso3.set(iso3, iso2.toLowerCase())
}
export function flagClass(iso3: string): string | null {
  const c = iso2ByIso3.get(iso3)
  return c ? `fi fi-${c}` : null
}
export function Flag({ iso3, className = '' }: { iso3: string; className?: string }) {
  const c = flagClass(iso3)
  return c ? <span className={`${c} flag ${className}`} aria-hidden /> : null
}

/** y-axis that fits the data: from 10 below the lowest value to 5 above the highest, within 0–100 */
export function fitDomain(values: number[]): [number, number] {
  const lo = Math.max(0, Math.floor(Math.min(...values) - 10))
  const hi = Math.min(100, Math.ceil(Math.max(...values) + 5))
  return [lo, Math.max(hi, lo + 5)]
}

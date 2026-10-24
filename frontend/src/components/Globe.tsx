import { geoInterpolate } from 'd3-geo'
import { useEffect, useMemo, useRef, useState } from 'react'
import GlobeGL, { type GlobeMethods } from 'react-globe.gl'
import { MeshPhongMaterial } from 'three'
import type { Twins, WorldCountry } from '../api'
import { NO_DATA, accessColor, centroidOf, flagClass, isoOf, planColor, projectedColor, useSize, type CountryFeature } from './ui'

export type PlanOverlay = {
  sites: { site: string; lat: number; lon: number; mw: number }[]
  rail: { coords: [number, number][] | null; fraction: number }
}

export type GlobeState = {
  year: number
  lastMeasured: number
  selected: string | null
  /** Selected country's projected access by calendar year, with the user's plan (null = no plan / baseline) */
  planPath: Record<number, number> | null
  /** Solar sites and rail corridor, shown on the Plan tab only */
  overlay: PlanOverlay | null
  /** Historical twins, shown on the Twins tab only */
  twins: Twins | null
}

/** Access in a given year: measured value (carried forward), or the model's projection after the last measured year */
export function accessIn(c: WorldCountry | undefined, year: number, lastMeasured: number): { value: number; projected: boolean } | null {
  if (!c) return null
  if (year > lastMeasured && c.projected[year] != null) return { value: c.projected[year], projected: true }
  let best: number | null = null
  for (const [y, v] of Object.entries(c.access)) if (Number(y) <= year) best = v
  return best == null ? null : { value: best, projected: false }
}

type Arc = { startLat: number; startLng: number; endLat: number; endLng: number }
type Marker = { kind: 'twin' | 'solar'; lat: number; lng: number; text: string; stack: number }
type RailPath = { points: [number, number][]; color: string; dash: number; gap: number }

/** Labels closer than ~7° stack upward so neighbours (e.g. Iraq and Kuwait) never overlap */
function stack<T extends { lat: number; lng: number }>(items: T[]): (T & { stack: number })[] {
  const out: (T & { stack: number })[] = []
  for (const it of items) {
    const near = out.filter((o) => Math.hypot(o.lat - it.lat, o.lng - it.lng) < 7)
    out.push({ ...it, stack: near.length })
  }
  return out
}

function routePoints(coords: [number, number][], fraction: number): [number, number][] {
  const [[lat1, lng1], [lat2, lng2]] = coords
  const interp = geoInterpolate([lng1, lat1], [lng2, lat2])
  return Array.from({ length: 41 }, (_, i) => {
    const [lng, lat] = interp((i / 40) * fraction)
    return [lat, lng] as [number, number]
  })
}

export default function Globe({ features, countries, state, onSelect, panelFraction }: {
  features: CountryFeature[]
  countries: Map<string, WorldCountry>
  state: GlobeState
  onSelect: (iso3: string | null) => void
  /** Share of the screen width covered by the side panel (0 when closed) */
  panelFraction: number
}) {
  const [ref, size] = useSize<HTMLDivElement>()
  const globe = useRef<GlobeMethods | undefined>(undefined)
  const [hover, setHover] = useState<string | null>(null)
  const material = useMemo(() => new MeshPhongMaterial({ color: '#0b1222', shininess: 6 }), [])
  const byIso = useMemo(() => new Map(features.map((f) => [isoOf(f), f])), [features])

  // Idle: slow rotation. Selected: fly to the country and center it in the part of the screen the panel leaves visible
  useEffect(() => {
    const g = globe.current
    if (!g || !size.width) return
    const controls = g.controls()
    controls.enableDamping = true
    controls.autoRotateSpeed = 0.3
    const f = state.selected ? byIso.get(state.selected) : null
    if (f) {
      controls.autoRotate = false
      const c = centroidOf(f)
      g.pointOfView({ lat: c.lat - 4, lng: c.lng + 55 * panelFraction, altitude: 1.65 }, 1100)
    } else {
      controls.autoRotate = true
      g.pointOfView({ altitude: 2.4 }, 900)
    }
  }, [state.selected, byIso, size.width, panelFraction])

  const selectedLastYear = useMemo(() => {
    const c = state.selected ? countries.get(state.selected) : null
    return c ? Math.max(...Object.keys(c.access).map(Number)) : state.lastMeasured
  }, [state.selected, countries, state.lastMeasured])

  const color = (f: CountryFeature) => {
    const iso = isoOf(f)
    // The selected country follows the user's plan in projected years
    if (iso === state.selected && state.planPath && state.year > selectedLastYear && state.planPath[state.year] != null) {
      return planColor(state.planPath[state.year], 0.6)
    }
    const a = accessIn(countries.get(iso), state.year, state.lastMeasured)
    if (!a) return NO_DATA
    return a.projected ? projectedColor(a.value) : accessColor(a.value)
  }

  const { arcs, markers, paths } = useMemo(() => {
    const arcs: Arc[] = []
    let markers: Marker[] = []
    const paths: RailPath[] = []
    const from = state.selected ? byIso.get(state.selected) : null
    if (state.twins && from) {
      const s = centroidOf(from)
      const twinMarkers: Omit<Marker, 'stack'>[] = []
      for (const tw of state.twins.twins) {
        const f = byIso.get(tw.iso3)
        if (!f) continue
        const e = centroidOf(f)
        arcs.push({ startLat: s.lat, startLng: s.lng, endLat: e.lat, endLng: e.lng })
        twinMarkers.push({ kind: 'twin', lat: e.lat, lng: e.lng, text: `${tw.country} ${tw.year} · ${Math.round(tw.similarity)}%` })
      }
      markers = stack(twinMarkers)
    }
    if (state.overlay) {
      const built = state.overlay.sites.filter((x) => x.mw > 0).slice(0, 3)
      markers = stack(built.map((x) => ({ kind: 'solar' as const, lat: x.lat, lng: x.lon, text: `${x.site} · ${Math.round(x.mw).toLocaleString('en-US')} MW` })))
      const r = state.overlay.rail
      if (r.coords) {
        paths.push({ points: routePoints(r.coords, 1), color: 'rgba(138,148,168,0.8)', dash: 0.02, gap: 0.015 })
        if (r.fraction > 0.005) paths.push({ points: routePoints(r.coords, Math.min(1, r.fraction)), color: '#f2a93b', dash: 1, gap: 0 })
      }
    }
    return { arcs, markers, paths }
  }, [state.twins, state.overlay, state.selected, byIso])

  return (
    <div ref={ref} className="absolute inset-0">
      {size.width > 0 && (
        <GlobeGL
          ref={globe}
          width={size.width}
          height={size.height}
          backgroundColor="rgba(0,0,0,0)"
          globeMaterial={material}
          atmosphereColor="#5d7ab5"
          atmosphereAltitude={0.14}
          polygonsData={features}
          polygonCapColor={(f) => color(f as CountryFeature)}
          polygonSideColor={() => 'rgba(7, 11, 20, 0.7)'}
          polygonStrokeColor={(f) => {
            const iso = isoOf(f as CountryFeature)
            return iso === state.selected ? '#f2a93b' : iso === hover ? '#e8ecf3' : 'rgba(7, 11, 20, 0.9)'
          }}
          polygonAltitude={(f) => {
            const iso = isoOf(f as CountryFeature)
            return iso === state.selected ? 0.035 : iso === hover ? 0.014 : 0.006
          }}
          polygonsTransitionDuration={350}
          polygonLabel={(f) => {
            const iso = isoOf(f as CountryFeature)
            const c = countries.get(iso)
            const name = c?.name ?? (f as CountryFeature).properties.NAME
            const flag = flagClass(iso)
            return `<div class="globe-tip"><div style="font-weight:600">${flag ? `<span class="${flag} flag"></span> ` : ''}${name}</div>${c?.hover ? `<div style="color:#8a94a8;margin-top:3px">${c.hover}</div>` : ''}</div>`
          }}
          onPolygonHover={(f) => setHover(f ? isoOf(f as CountryFeature) : null)}
          onPolygonClick={(f) => {
            const iso = isoOf(f as CountryFeature)
            if (countries.has(iso)) onSelect(iso)
          }}
          onGlobeClick={() => onSelect(null)}
          arcsData={arcs}
          arcColor={() => ['rgba(94,200,229,0.9)', 'rgba(94,200,229,0.35)']}
          arcStroke={0.6}
          arcAltitudeAutoScale={0.45}
          arcDashLength={0.35}
          arcDashGap={0.15}
          arcDashInitialGap={1}
          arcDashAnimateTime={2200}
          arcsTransitionDuration={600}
          pathsData={paths}
          pathPoints="points"
          pathPointLat={(p) => (p as [number, number])[0]}
          pathPointLng={(p) => (p as [number, number])[1]}
          pathPointAlt={0.04}
          pathColor={(p: object) => (p as RailPath).color}
          pathStroke={2}
          pathDashLength={(p: object) => (p as RailPath).dash}
          pathDashGap={(p: object) => (p as RailPath).gap}
          pathTransitionDuration={500}
          htmlElementsData={markers}
          htmlLat="lat"
          htmlLng="lng"
          htmlAltitude={0.04}
          htmlElement={(d) => {
            // Plain DOM labels: far lighter than 3D text, and crisp at any zoom
            const m = d as Marker
            const el = document.createElement('div')
            el.className = m.kind === 'twin' ? 'twin-label' : 'solar-marker'
            el.style.setProperty('--stack', String(m.stack))
            if (m.kind === 'solar') {
              const dot = document.createElement('span')
              dot.className = 'pulse'
              el.appendChild(dot)
            }
            el.appendChild(document.createTextNode(m.text))
            return el
          }}
        />
      )}
    </div>
  )
}

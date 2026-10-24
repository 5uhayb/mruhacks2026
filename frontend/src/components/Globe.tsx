import { useEffect, useMemo, useRef, useState } from 'react'
import GlobeGL, { type GlobeMethods } from 'react-globe.gl'
import { MeshPhongMaterial } from 'three'
import type { Twins, WorldCountry } from '../api'
import { NO_DATA, accessColor, centroidOf, isoOf, planColor, projectedColor, useSize, type CountryFeature } from './ui'

export type GlobeState = {
  year: number
  lastMeasured: number
  selected: string | null
  plan: { access10: number; strength: number } | null
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
type Label = { lat: number; lng: number; text: string }

export default function Globe({ features, countries, state, onSelect, panelOpen }: {
  features: CountryFeature[]
  countries: Map<string, WorldCountry>
  state: GlobeState
  onSelect: (iso3: string | null) => void
  panelOpen: boolean
}) {
  const [ref, size] = useSize<HTMLDivElement>()
  const globe = useRef<GlobeMethods | undefined>(undefined)
  const [hover, setHover] = useState<string | null>(null)
  const material = useMemo(() => new MeshPhongMaterial({ color: '#0b1222', shininess: 6 }), [])
  const byIso = useMemo(() => new Map(features.map((f) => [isoOf(f), f])), [features])

  // Idle: slow rotation. Selected: fly to the country, offset left so the side panel doesn't cover it
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
      g.pointOfView({ lat: c.lat - 4, lng: c.lng + (panelOpen ? 22 : 0), altitude: 1.65 }, 1100)
    } else {
      controls.autoRotate = true
      g.pointOfView({ altitude: 2.4 }, 900)
    }
  }, [state.selected, byIso, size.width, panelOpen])

  const color = (f: CountryFeature) => {
    const iso = isoOf(f)
    const c = countries.get(iso)
    const a = accessIn(c, state.year, state.lastMeasured)
    if (iso === state.selected && state.plan) return planColor(state.plan.access10, state.plan.strength)
    if (!a) return NO_DATA
    return a.projected ? projectedColor(a.value) : accessColor(a.value)
  }

  const { arcs, labels } = useMemo(() => {
    const t = state.twins
    const from = state.selected ? byIso.get(state.selected) : null
    if (!t || !from) return { arcs: [] as Arc[], labels: [] as Label[] }
    const s = centroidOf(from)
    const arcs: Arc[] = []
    const labels: Label[] = []
    for (const tw of t.twins) {
      const f = byIso.get(tw.iso3)
      if (!f) continue
      const e = centroidOf(f)
      arcs.push({ startLat: s.lat, startLng: s.lng, endLat: e.lat, endLng: e.lng })
      labels.push({ lat: e.lat, lng: e.lng, text: `${tw.country} ${tw.year} · ${Math.round(tw.similarity)}%` })
    }
    return { arcs, labels }
  }, [state.twins, state.selected, byIso])

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
            const c = countries.get(isoOf(f as CountryFeature))
            const name = c?.name ?? (f as CountryFeature).properties.NAME
            return `<div class="globe-tip"><div style="font-weight:600">${name}</div>${c?.hover ? `<div style="color:#8a94a8;margin-top:3px">${c.hover}</div>` : ''}</div>`
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
          htmlElementsData={labels}
          htmlLat="lat"
          htmlLng="lng"
          htmlAltitude={0.02}
          htmlElement={(d) => {
            // Plain DOM labels: far lighter than 3D text, and crisp at any zoom
            const el = document.createElement('div')
            el.className = 'twin-label'
            el.textContent = (d as Label).text
            return el
          }}
        />
      )}
    </div>
  )
}

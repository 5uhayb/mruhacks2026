import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  getAssumptions,
  getCountry,
  getTwins,
  getWorld,
  optimize,
  simulate,
  SECTORS,
  type AssumptionSpec,
  type Country,
  type Optimized,
  type Simulation,
  type Split,
  type Twins,
  type World,
} from './api'
import { CommandBar, SystemDrawer, TimeScrubber } from './components/Chrome'
import Globe from './components/Globe'
import CountryPanel, { TABS, type Tab } from './components/panel/CountryPanel'
import ModelTab from './components/panel/ModelTab'
import PlanTab from './components/panel/PlanTab'
import Profile from './components/panel/Profile'
import StressTab from './components/panel/StressTab'
import TwinsTab from './components/panel/TwinsTab'
import { Boundary, hasWebGL, loadFeatures, type CountryFeature } from './components/ui'

const DEFAULT_SPLIT: Split = { solar: 40, rail: 30, fund: 30 }

// Cache per country so revisiting (and the preloaded Libya) is instant
const countryCache = new Map<string, Promise<Country>>()
const twinsCache = new Map<string, Promise<Twins>>()
const cachedCountry = (iso: string) => countryCache.get(iso) ?? countryCache.set(iso, getCountry(iso)).get(iso)!
const cachedTwins = (iso: string) => twinsCache.get(iso) ?? twinsCache.set(iso, getTwins(iso)).get(iso)!

/** Initial state from the URL, e.g. /?c=LBY&invest=10&solar=40&rail=30&fund=30&tab=Plan */
function fromUrl() {
  const q = new URLSearchParams(window.location.search)
  const n = (k: string, d: number) => (q.get(k) != null && !Number.isNaN(Number(q.get(k))) ? Number(q.get(k)) : d)
  const tab = q.get('tab') as Tab | null
  return {
    selected: q.get('c'),
    share: Math.min(30, Math.max(0, n('invest', 10))) / 100,
    split: { solar: n('solar', DEFAULT_SPLIT.solar), rail: n('rail', DEFAULT_SPLIT.rail), fund: n('fund', DEFAULT_SPLIT.fund) },
    tab: tab && TABS.includes(tab) ? tab : 'Profile',
  }
}

function App() {
  const initial = useMemo(fromUrl, [])
  const [world, setWorld] = useState<World | null>(null)
  const [features, setFeatures] = useState<CountryFeature[]>([])
  const [specs, setSpecs] = useState<Record<string, AssumptionSpec>>({})
  const [selected, setSelected] = useState<string | null>(initial.selected)
  const [tab, setTab] = useState<Tab>(initial.tab)
  const [share, setShare] = useState(initial.share)
  const [split, setSplit] = useState<Split>(initial.split)
  const [overrides, setOverrides] = useState<Record<string, number>>({})
  const [year, setYear] = useState<number | null>(null)
  const [systemOpen, setSystemOpen] = useState(false)
  const [country, setCountry] = useState<Country | null>(null)
  const [twins, setTwins] = useState<Twins | null>(null)
  const [sim, setSim] = useState<Simulation | null>(null)
  const [optimized, setOptimized] = useState<Optimized | null>(null)
  const [optimizing, setOptimizing] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Load the world, outlines and assumptions; preload Libya so the first click is instant
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>
    const load = () =>
      Promise.all([getWorld(), loadFeatures(), getAssumptions()])
        .then(([w, f, a]) => {
          setWorld(w)
          setFeatures(f)
          setSpecs(a)
          setError(null)
          cachedCountry('LBY')
          cachedTwins('LBY')
        })
        .catch(() => {
          setError('Waiting for the backend (cd backend; python -m uvicorn main:app --port 8000)…')
          timer = setTimeout(load, 2500)
        })
    load()
    return () => clearTimeout(timer)
  }, [])

  const countries = useMemo(() => new Map((world?.countries ?? []).map((c) => [c.iso3, c])), [world])
  const lastMeasured = useMemo(
    () => Math.max(...(world?.countries ?? []).flatMap((c) => Object.keys(c.access).map(Number)), 2000),
    [world],
  )
  const shownYear = year ?? lastMeasured

  // Selected country: profile and twins (cached)
  useEffect(() => {
    setCountry(null)
    setTwins(null)
    setSim(null)
    setOptimized(null)
    if (!selected || !world) return
    let live = true
    cachedCountry(selected).then((c) => live && setCountry(c)).catch(() => {})
    cachedTwins(selected).then((t) => live && setTwins(t)).catch(() => live && setTwins(null))
    return () => {
      live = false
    }
  }, [selected, world])

  // Re-simulate as sliders move (debounced)
  useEffect(() => {
    if (!selected || !world) return
    const t = setTimeout(() => simulate({ iso3: selected, share, split, assumptions: overrides }).then(setSim).catch(() => {}), 120)
    return () => clearTimeout(t)
  }, [selected, share, split, overrides, world])

  // Keep the URL shareable
  useEffect(() => {
    const q = new URLSearchParams()
    if (selected) {
      q.set('c', selected)
      q.set('invest', String(Math.round(share * 100)))
      SECTORS.forEach((k) => q.set(k, String(Math.round(split[k]))))
      q.set('tab', tab)
    }
    window.history.replaceState(null, '', q.toString() ? `?${q}` : window.location.pathname)
  }, [selected, share, split, tab])

  // ` toggles the System drawer; Esc closes the panel (both ignored while typing)
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (['INPUT', 'TEXTAREA', 'SELECT'].includes((e.target as HTMLElement).tagName)) return
      if (e.key === '`') setSystemOpen((o) => !o)
      if (e.key === 'Escape') setSelected(null)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  // "Find best plan": animate the sliders to the optimizer's answer
  const animating = useRef(0)
  const runOptimize = useCallback(async () => {
    if (!selected) return
    setOptimizing(true)
    try {
      const best = await optimize({ iso3: selected, share, split, assumptions: overrides })
      setOptimized(best)
      const from = { ...split }
      const total = SECTORS.reduce((s, k) => s + from[k], 0) || 1
      const start = performance.now()
      const id = ++animating.current
      const step = (now: number) => {
        if (id !== animating.current) return
        const t = Math.min(1, (now - start) / 700)
        const e = 1 - Math.pow(1 - t, 3)
        setSplit({
          solar: (from.solar / total) * 100 + (best.split.solar - (from.solar / total) * 100) * e,
          rail: (from.rail / total) * 100 + (best.split.rail - (from.rail / total) * 100) * e,
          fund: (from.fund / total) * 100 + (best.split.fund - (from.fund / total) * 100) * e,
        })
        if (t < 1) requestAnimationFrame(step)
      }
      requestAnimationFrame(step)
    } finally {
      setOptimizing(false)
    }
  }, [selected, share, split, overrides])

  const select = useCallback((iso: string | null) => setSelected(iso), [])

  if (!hasWebGL()) {
    return <main className="text-mute grid h-full place-items-center p-8">This app needs WebGL for the 3D globe. Try a recent Chrome, Edge or Firefox.</main>
  }

  const y = sim?.years[sim.years.length - 1]
  const plan = sim && y
    ? { access10: y.access_pct, strength: Math.min(1, 0.5 * ((y.access_pct - sim.start.access) / Math.max(1, 100 - sim.start.access)) + 0.5 * (y.renewable_pct / 100)) }
    : null
  const panelOpen = !!selected

  return (
    <main className="relative h-full overflow-hidden">
      {world && features.length > 0 && (
        <Globe
          features={features}
          countries={countries}
          state={{ year: shownYear, lastMeasured, selected, plan: tab === 'Plan' ? plan : null, twins: tab === 'Twins' || tab === 'Profile' ? twins : null }}
          onSelect={select}
          panelOpen={panelOpen}
        />
      )}
      {!world && <div className="text-mute absolute inset-0 grid place-items-center text-[0.9rem]">{error ?? 'Loading the world…'}</div>}

      {world && <CommandBar countries={world.countries} onSelect={select} systemOpen={systemOpen} onToggleSystem={() => setSystemOpen((o) => !o)} />}

      {world && !selected && (
        <div className="fade pointer-events-none absolute top-20 left-5 z-10 max-w-[420px]">
          <p className="text-[1.05rem] leading-snug">Electricity access in {shownYear}, every country. Lighter means more people connected.</p>
          <p className="text-mute mt-1 text-[0.85rem]">Click a country, or press Ctrl K to search.</p>
        </div>
      )}

      {world && (
        <TimeScrubber years={world.years} year={shownYear} lastMeasured={lastMeasured} setYear={setYear} rightInset={panelOpen ? Math.min(Math.max(window.innerWidth * 0.4, 440), 640) + 16 : 0} />
      )}

      <Boundary label="System log">
        <SystemDrawer open={systemOpen} />
      </Boundary>

      {selected && (
        <CountryPanel country={country} tab={tab} setTab={setTab} onClose={() => setSelected(null)}>
          <Boundary key={`${selected}-${tab}`} label={tab}>
          {!country && <div className="text-mute p-5 text-[0.85rem]">Loading…</div>}
          {country && tab === 'Profile' && <Profile country={country} />}
          {country && tab === 'Plan' && (
            <PlanTab country={country} sim={sim} share={share} setShare={setShare} split={split} setSplit={setSplit}
              onOptimize={runOptimize} optimizing={optimizing} optimized={optimized} specs={specs} overrides={overrides} setOverrides={setOverrides} />
          )}
          {country && tab === 'Twins' && <TwinsTab country={country} twins={twins} />}
          {country && tab === 'Stress' && (sim ? <StressTab sim={sim} /> : <div className="text-mute p-5 text-[0.85rem]">Simulating…</div>)}
          {country && tab === 'Model' && <ModelTab country={country} twins={twins} />}
          </Boundary>
        </CountryPanel>
      )}
    </main>
  )
}

export default App

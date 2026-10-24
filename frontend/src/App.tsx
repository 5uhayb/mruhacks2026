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
  type Preset,
  type ReformInput,
  type Simulation,
  type Split,
  type Supply,
  type Twins,
  type World,
} from './api'
import { CommandBar, SystemDrawer, TimeScrubber } from './components/Chrome'
import Globe from './components/Globe'
import CountryPanel, { TABS, type Tab } from './components/panel/CountryPanel'
import Brief from './components/panel/Brief'
import ModelTab from './components/panel/ModelTab'
import PlanTab from './components/panel/PlanTab'
import Profile from './components/panel/Profile'
import StressTab from './components/panel/StressTab'
import TwinsTab from './components/panel/TwinsTab'
import { buildBrief } from './lib/brief'
import { Boundary, accessColor, hasWebGL, loadFeatures, type CountryFeature } from './components/ui'

const DEFAULT_SPLIT: Split = { solar: 35, rail: 20, industry: 15, fund: 30 }

// Cache per country so revisiting (and the preloaded Libya) is instant
const countryCache = new Map<string, Promise<Country>>()
const twinsCache = new Map<string, Promise<Twins>>()
const cachedCountry = (iso: string) => countryCache.get(iso) ?? countryCache.set(iso, getCountry(iso)).get(iso)!
const cachedTwins = (iso: string) => twinsCache.get(iso) ?? twinsCache.set(iso, getTwins(iso)).get(iso)!

/** Initial state from the URL, e.g. /?c=LBY&invest=10&solar=35&rail=20&industry=15&fund=30&tab=Plan */
function fromUrl() {
  const q = new URLSearchParams(window.location.search)
  const n = (k: string, d: number) => (q.get(k) != null && !Number.isNaN(Number(q.get(k))) ? Number(q.get(k)) : d)
  const tab = q.get('tab') as Tab | null
  return {
    selected: q.get('c'),
    share: Math.min(30, Math.max(0, n('invest', 10))) / 100,
    split: Object.fromEntries(SECTORS.map((k) => [k, n(k, DEFAULT_SPLIT[k])])) as Split,
    supply: (q.get('supply') === 'local' ? 'local' : 'import') as Supply,
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
  const [supply, setSupply] = useState<Supply>(initial.supply)
  const [reform, setReform] = useState<ReformInput | null>(null)
  const [year, setYear] = useState<number | null>(null)
  const [systemOpen, setSystemOpen] = useState(false)
  const [briefOpen, setBriefOpen] = useState(false)
  const [country, setCountry] = useState<Country | null>(null)
  const [twins, setTwins] = useState<Twins | null>(null)
  const [sim, setSim] = useState<Simulation | null>(null)
  const [optimized, setOptimized] = useState<Optimized | null>(null)
  const [optimizing, setOptimizing] = useState<Preset | null>(null)
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
    const t = setTimeout(() => simulate({ iso3: selected, share, split, assumptions: overrides, supply, reform }).then(setSim).catch(() => {}), 120)
    return () => clearTimeout(t)
  }, [selected, share, split, overrides, supply, reform, world])

  // Keep the URL shareable
  useEffect(() => {
    const q = new URLSearchParams()
    if (selected) {
      q.set('c', selected)
      q.set('invest', String(Math.round(share * 100)))
      SECTORS.forEach((k) => q.set(k, String(Math.round(split[k]))))
      if (supply === 'local') q.set('supply', 'local')
      q.set('tab', tab)
    }
    window.history.replaceState(null, '', q.toString() ? `?${q}` : window.location.pathname)
  }, [selected, share, split, supply, tab])

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

  // Priority preset: run the optimizer with that priority and animate the split to its answer
  const animating = useRef(0)
  const runPreset = useCallback(async (preset: Preset) => {
    if (!selected) return
    setOptimizing(preset)
    try {
      const best = await optimize({ iso3: selected, share, split, assumptions: overrides, supply, reform: null, preset })
      setOptimized(best)
      const total = SECTORS.reduce((s, k) => s + split[k], 0) || 1
      const from = Object.fromEntries(SECTORS.map((k) => [k, (split[k] / total) * 100])) as Split
      const start = performance.now()
      const id = ++animating.current
      const step = (now: number) => {
        if (id !== animating.current) return
        const t = Math.min(1, (now - start) / 700)
        const e = 1 - Math.pow(1 - t, 3)
        setSplit(Object.fromEntries(SECTORS.map((k) => [k, t < 1 ? from[k] + (best.split[k] - from[k]) * e : best.split[k]])) as Split)
        if (t < 1) requestAnimationFrame(step)
      }
      requestAnimationFrame(step)
    } finally {
      setOptimizing(null)
    }
  }, [selected, share, split, overrides, supply])

  // Picking a new country always starts on its Profile (a shared URL can still open any tab directly)
  const select = useCallback((iso: string | null) => {
    setSelected(iso)
    setTab('Profile')
  }, [])

  // The Plan tab shows its effect on the globe: jump the timeline to the projected end year
  useEffect(() => {
    if (tab === 'Plan' && world) setYear((y) => (y == null || y <= lastMeasured ? lastMeasured + 10 : y))
  }, [tab, world, lastMeasured])

  if (!hasWebGL()) {
    return <main className="text-mute grid h-full place-items-center p-8">This app needs WebGL for the 3D globe. Try a recent Chrome, Edge or Firefox.</main>
  }

  const panelOpen = !!selected
  const panelWidth = panelOpen ? Math.min(Math.max(window.innerWidth * 0.4, 440), 640) + 16 : 0
  // The selected country's access by calendar year under the current plan
  const planPath = sim && sim.start.access_year
    ? Object.fromEntries(sim.years.map((r) => [sim.start.access_year! + r.year, r.access_pct]))
    : null
  const overlay = sim && tab === 'Plan'
    ? { sites: sim.sites, rail: { coords: sim.rail.coords, fraction: sim.rail.route_km ? sim.rail.funded_km / sim.rail.route_km : 0 } }
    : null

  return (
    <main className="relative h-full overflow-hidden">
      {world && features.length > 0 && (
        <Globe
          features={features}
          countries={countries}
          state={{ year: shownYear, lastMeasured, selected, planPath, overlay, twins: tab === 'Twins' ? twins : null }}
          onSelect={select}
          panelFraction={panelWidth / window.innerWidth}
        />
      )}
      {!world && <div className="text-mute absolute inset-0 grid place-items-center text-[0.9rem]">{error ?? 'Loading the world…'}</div>}

      {world && <CommandBar countries={world.countries} targetRule={world.target_rule} onSelect={select} />}

      {world && !selected && (
        <div className="fade pointer-events-none absolute top-20 left-5 z-10 max-w-[460px]">
          <p className="text-[1.05rem] leading-snug">
            See what a country's own resource income could fund, what each sector returns, and what macro trade-offs it creates.
          </p>
          <p className="text-mute mt-1.5 text-[0.85rem]">
            For development finance institutions, NGOs and trade organizations. The globe shows electricity access in {shownYear}; lighter means more people connected.
          </p>
          <p className="text-mute mt-1.5 text-[0.85rem]">Click a country, or press Ctrl K to search.</p>
        </div>
      )}
      {world && selected && (
        <div className="fade text-mute pointer-events-none absolute top-[72px] left-5 z-10 flex items-center gap-2 text-[0.72rem]">
          <span>Electricity access {shownYear}</span>
          <span className="flex h-2 w-24 overflow-hidden rounded-sm">
            {[0, 25, 50, 75, 100].map((v) => <span key={v} className="flex-1" style={{ background: accessColor(v) }} />)}
          </span>
          <span>0 → 100%</span>
          <span className="text-gold/80 ml-2">gold tint = projected</span>
        </div>
      )}

      {world && (
        <TimeScrubber years={world.years} year={shownYear} lastMeasured={lastMeasured} setYear={setYear} rightInset={panelWidth}
          plan={selected && sim ? { country: country?.name ?? selected, value: planPath?.[shownYear] ?? null } : null} />
      )}

      <Boundary label="System log">
        <SystemDrawer open={systemOpen} />
      </Boundary>

      {selected && (
        <CountryPanel country={country} tab={tab} setTab={setTab} onClose={() => setSelected(null)}
          onExport={country && sim ? () => setBriefOpen(true) : undefined}>
          <Boundary key={`${selected}-${tab}`} label={tab}>
          {!country && <div className="text-mute p-5 text-[0.85rem]">Loading…</div>}
          {country && tab === 'Profile' && <Profile country={country} />}
          {country && tab === 'Plan' && (
            <PlanTab country={country} sim={sim} share={share} setShare={setShare} split={split} setSplit={setSplit}
              onPreset={runPreset} optimizing={optimizing} optimized={optimized} specs={specs} overrides={overrides} setOverrides={setOverrides}
              supply={supply} setSupply={setSupply} reform={reform} setReform={setReform} />
          )}
          {country && tab === 'Twins' && <TwinsTab country={country} twins={twins} />}
          {country && tab === 'Stress' && (sim ? <StressTab sim={sim} /> : <div className="text-mute p-5 text-[0.85rem]">Simulating…</div>)}
          {country && tab === 'Model' && <ModelTab country={country} twins={twins} />}
          </Boundary>
        </CountryPanel>
      )}
      {briefOpen && country && sim && (
        <Brief markdown={buildBrief({ country, sim, twins, split, specs, overrides })} onClose={() => setBriefOpen(false)} />
      )}
    </main>
  )
}

export default App

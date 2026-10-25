import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  getAssumptions,
  getCountry,
  getPeers,
  getWorld,
  simulate,
  SECTORS,
  type AssumptionSpec,
  type Country,
  type Peers,
  type Simulation,
  type Split,
  type World,
} from './api'
import { CommandBar, SystemDrawer, TimeScrubber } from './components/Chrome'
import Advisor from './components/Advisor'
import Globe from './components/Globe'
import CountryPanel, { TABS, type Tab } from './components/panel/CountryPanel'
import Brief from './components/panel/Brief'
import ModelTab from './components/panel/ModelTab'
import PeersTab from './components/panel/PeersTab'
import PlanTab from './components/panel/PlanTab'
import Profile from './components/panel/Profile'
import StressTab from './components/panel/StressTab'
import { buildBrief } from './lib/brief'
import { Boundary, NO_DATA, TIERS, hasWebGL, loadFeatures, setFlagCodes, type CountryFeature } from './components/ui'

const DEMO_COUNTRY = 'LBY'  // the app opens on Libya unless the URL names another country

// Cache per country so revisiting is instant
const countryCache = new Map<string, Promise<Country>>()
const peersCache = new Map<string, Promise<Peers>>()
const cachedCountry = (iso: string) => countryCache.get(iso) ?? countryCache.set(iso, getCountry(iso)).get(iso)!
const cachedPeers = (iso: string) => peersCache.get(iso) ?? peersCache.set(iso, getPeers(iso)).get(iso)!

/** Initial state from the URL, e.g. /?c=NGA&tab=Plan (no split = the recommended mix). Without ?c= the demo country, Libya, opens. */
function fromUrl() {
  const q = new URLSearchParams(window.location.search)
  const tab = q.get('tab') as Tab | null
  const has = SECTORS.every((k) => q.get(k) != null && !Number.isNaN(Number(q.get(k))))
  return {
    selected: q.get('c') ?? DEMO_COUNTRY,
    split: has ? (Object.fromEntries(SECTORS.map((k) => [k, Number(q.get(k))])) as Split) : null,
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
  // null = follow the recommended mix for the selected country
  const [split, setSplit] = useState<Split | null>(initial.split)
  const [playbookLine, setPlaybookLine] = useState<string | null>(null)
  const [overrides, setOverrides] = useState<Record<string, number>>({})
  const [year, setYear] = useState<number | null>(null)
  const [systemOpen, setSystemOpen] = useState(false)
  const [briefOpen, setBriefOpen] = useState(false)
  const [country, setCountry] = useState<Country | null>(null)
  const [peers, setPeers] = useState<Peers | null>(null)
  const [sim, setSim] = useState<Simulation | null>(null)
  const [error, setError] = useState<string | null>(null)

  // Load the world, outlines and assumptions; preload the first quick pick so the first click is instant
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>
    const load = () =>
      Promise.all([getWorld(), loadFeatures(), getAssumptions()])
        .then(([w, f, a]) => {
          setFlagCodes(w.countries.map((c) => [c.iso3, c.iso2]))
          setWorld(w)
          setFeatures(f)
          setSpecs(a)
          setError(null)

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

  // Selected country: profile and peers (cached)
  useEffect(() => {
    setCountry(null)
    setPeers(null)
    setSim(null)
    if (!selected || !world) return
    let live = true
    cachedCountry(selected).then((c) => live && setCountry(c)).catch(() => {})
    cachedPeers(selected).then((p) => live && setPeers(p)).catch(() => live && setPeers(null))
    return () => {
      live = false
    }
  }, [selected, world])

  // Re-simulate as the mix or assumptions change (debounced)
  useEffect(() => {
    if (!selected || !world) return
    const t = setTimeout(() => simulate({ iso3: selected, split, assumptions: overrides }).then(setSim).catch(() => {}), 120)
    return () => clearTimeout(t)
  }, [selected, split, overrides, world])

  // Keep the URL shareable
  useEffect(() => {
    const q = new URLSearchParams()
    if (selected) {
      q.set('c', selected)
      if (split) SECTORS.forEach((k) => q.set(k, String(Math.round(split[k]))))
      q.set('tab', tab)
    }
    window.history.replaceState(null, '', q.toString() ? `?${q}` : window.location.pathname)
  }, [selected, split, tab])

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

  // Dragging the split: a manual mix, no longer the recommendation or a playbook
  const editSplit = useCallback((s: Split) => {
    setSplit(s)
    setPlaybookLine(null)
  }, [])

  // "Use [Peer]'s playbook →" on the Peers tab
  const applyPlaybook = useCallback(() => {
    if (!peers?.playbook) return
    setSplit({ ...peers.playbook.split })
    setPlaybookLine(peers.playbook.line)
    setTab('Plan')
  }, [peers])

  // Picking a new country starts on its Profile with its own recommended mix
  const select = useCallback((iso: string | null) => {
    setSelected(iso)
    setTab('Profile')
    setSplit(null)
    setPlaybookLine(null)
  }, [])

  // The Plan tab shows its effect on the globe: jump the timeline to the plan's final year (snapshot year + 10)
  const planEnd = sim?.start.access_year != null ? sim.start.access_year + 10 : null
  useEffect(() => {
    if (tab === 'Plan' && world && planEnd) setYear(planEnd)
  }, [tab, world, planEnd])

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
    ? {
        markers: [
          { kind: 'solar' as const, lat: sim.sites.solar.lat, lon: sim.sites.solar.lon, text: `Best sun · ${sim.sites.solar.site} · ${sim.sites.solar.value.toFixed(1)} kWh/m²/day` },
          { kind: 'wind' as const, lat: sim.sites.wind.lat, lon: sim.sites.wind.lon, text: `Best wind · ${sim.sites.wind.site} · ${sim.sites.wind.value.toFixed(1)} m/s` },
        ],
      }
    : null

  return (
    <main className="relative h-full overflow-hidden">
      {world && features.length > 0 && (
        <Globe
          features={features}
          countries={countries}
          state={{ year: shownYear, lastMeasured, selected, planPath, overlay, twins: tab === 'Peers' ? peers : null }}
          onSelect={select}
          panelFraction={panelWidth / window.innerWidth}
        />
      )}
      {!world && <div className="text-mute absolute inset-0 grid place-items-center text-[0.9rem]">{error ?? 'Loading the world…'}</div>}

      {world && <CommandBar countries={world.countries} onSelect={select} />}

      {world && (
        <div className="fade text-mute bg-space/70 pointer-events-none absolute top-[72px] left-5 z-10 space-y-1 rounded-md px-2.5 py-2 text-[0.72rem]">
          <div className="text-ink">Electricity access ({shownYear}{shownYear > lastMeasured ? ', forecast' : ''})</div>
          <div className="flex gap-3">
            {[...TIERS].reverse().map((t) => (
              <span key={t.label}><span style={{ color: t.hex }}>●</span> {t.min === 0 ? 'Under 60%' : t.min === 60 ? '60–90%' : 'Over 90%'}</span>
            ))}
          </div>
          <div className="flex gap-3">
            <span><span style={{ color: NO_DATA }}>●</span> No data</span>
          </div>
        </div>
      )}
      {world && !selected && (
        <div className="fade pointer-events-none absolute top-[152px] left-5 z-10 max-w-[440px]">
          <p className="text-[1.05rem] leading-snug">Turning the lights back on.</p>
          <p className="text-mute mt-1.5 text-[0.85rem]">Click a country, or press Ctrl K to search.</p>
        </div>
      )}

      {world && (
        <TimeScrubber years={world.years} year={shownYear} lastMeasured={lastMeasured} setYear={setYear} rightInset={panelWidth || 140}
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
          {country && tab === 'Profile' && <Profile country={country} onPlan={() => setTab('Plan')} />}
          {country && tab === 'Peers' && <PeersTab country={country} peers={peers} onPlaybook={applyPlaybook} />}
          {country && tab === 'Plan' && (
            <PlanTab country={country} sim={sim} split={split} setSplit={editSplit} onRecommended={() => { setSplit(null); setPlaybookLine(null) }}
              playbookLine={playbookLine} rule={peers?.playbook_rule ?? null} specs={specs} overrides={overrides} setOverrides={setOverrides} />
          )}
          {country && tab === 'Stress' && (sim ? <StressTab sim={sim} name={country.name} /> : <div className="text-mute p-5 text-[0.85rem]">Simulating…</div>)}
          {country && tab === 'Model' && <ModelTab country={country} peers={peers} />}
          </Boundary>
        </CountryPanel>
      )}
      <Advisor iso3={selected} name={country?.name ?? null} split={split} overrides={overrides} sim={sim} peers={peers} />
      {briefOpen && country && sim && (
        <Brief markdown={buildBrief({ country, sim, peers, specs, overrides })} onClose={() => setBriefOpen(false)} />
      )}
    </main>
  )
}

export default App

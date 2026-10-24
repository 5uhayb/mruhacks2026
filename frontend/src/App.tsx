import { useEffect, useMemo, useState } from 'react'
import {
  getDeal,
  getMemo,
  getMeta,
  getOverview,
  getPlan,
  optimize,
  type Deal,
  type Meta,
  type OptimizeResult,
  type Overview as OverviewData,
  type Plan,
  type PlanInput,
  type Split,
} from './api'
import { Footer } from './components/ui'
import { money, num, pct, smallPct } from './format'
import Allocate from './tabs/Allocate'
import Memo from './tabs/Memo'
import Overview from './tabs/Overview'
import Projects from './tabs/Projects'
import Stress from './tabs/Stress'

const TABS = ['Overview', 'Allocate', 'Projects', 'Stress', 'Memo'] as const
const DEFAULT_SPLIT: Split = { solar: 40, rail: 30, fund: 30 }

function App() {
  const [meta, setMeta] = useState<Meta | null>(null)
  const [iso3, setIso3] = useState('LBY')
  const [tab, setTab] = useState(0)
  const [overview, setOverview] = useState<OverviewData | null>(null)
  const [waiting, setWaiting] = useState(false)

  const [share, setShare] = useState(0.1)
  const [split, setSplit] = useState<Split>(DEFAULT_SPLIT)
  const [overrides, setOverrides] = useState<Record<string, number>>({})
  const [site, setSite] = useState<string | null>(null)
  const [mw, setMw] = useState(500)

  const [plan, setPlan] = useState<Plan | null>(null)
  const [deal, setDeal] = useState<Deal | null>(null)
  const [memo, setMemo] = useState<string | null>(null)
  const [optimizeResult, setOptimizeResult] = useState<OptimizeResult | null>(null)
  const [optimizing, setOptimizing] = useState(false)

  // Load metadata and the country; retry until the backend is up
  useEffect(() => {
    let cancelled = false
    let timer: ReturnType<typeof setTimeout>
    async function load() {
      try {
        const [m, o] = await Promise.all([getMeta(), getOverview(iso3)])
        if (cancelled) return
        setMeta(m)
        setOverview(o)
        setSite(o.sites[0]?.site ?? null)
        setOptimizeResult(null)
        setWaiting(false)
      } catch {
        if (cancelled) return
        setWaiting(true)
        timer = setTimeout(load, 2000)
      }
    }
    load()
    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [iso3])

  const input: PlanInput = useMemo(() => ({ iso3, share, split, site, mw, assumptions: overrides }), [iso3, share, split, site, mw, overrides])
  const ready = overview?.iso3 === iso3 && site != null

  useEffect(() => {
    if (!ready) return
    const timer = setTimeout(() => {
      getPlan(input).then(setPlan)
      getDeal(input).then(setDeal)
      setMemo(null)
    }, 150)
    return () => clearTimeout(timer)
  }, [input, ready])

  useEffect(() => {
    if (tab === 4 && ready && memo == null) getMemo(input).then(setMemo)
  }, [tab, ready, memo, input])

  // Number keys 1-5 switch tabs (ignored while typing)
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const t = e.target as HTMLElement
      if (['INPUT', 'SELECT', 'TEXTAREA'].includes(t.tagName)) return
      const n = Number(e.key)
      if (n >= 1 && n <= 5) setTab(n - 1)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  async function runOptimize() {
    setOptimizing(true)
    try {
      const r = await optimize(input)
      setOptimizeResult(r)
      setSplit({ solar: Math.round(r.split.solar * 100), rail: Math.round(r.split.rail * 100), fund: Math.round(r.split.fund * 100) })
    } finally {
      setOptimizing(false)
    }
  }

  if (!meta || !overview || !plan || !deal) {
    return (
      <main className="num text-dim grid min-h-screen place-items-center bg-black text-[12px]">
        {waiting ? 'WAITING FOR BACKEND · cd backend; python -m uvicorn main:app --port 8000' : 'LOADING…'}
      </main>
    )
  }

  const m = Object.fromEntries(overview.metrics.map((x) => [x.key, x]))
  const selectable = new Set(meta.countries.map((c) => c.iso3))
  const headline: [string, string, string][] = [
    ['REV 5Y', `${money(overview.revenue.avg)}`, 'Resource revenue, 5-year average of GDP × oil rents (World Bank)'],
    ['ACCESS', pct(m.electricity_access_pct.value), m.electricity_access_pct.source],
    ['RENEW ELEC', smallPct(m.renewable_electricity_pct.value), m.renewable_electricity_pct.source],
    ['GDP/CAP', `$${num(m.gdp_per_capita_usd.value)}`, m.gdp_per_capita_usd.source],
    ['BEST SUN', `${overview.potential.best_site.toUpperCase()} ${overview.potential.best_solar.toFixed(2)}`, `kWh/m²/day · ${overview.potential.source}`],
  ]

  return (
    <main className="flex min-h-screen flex-col bg-black">
      <div className="border-line flex items-center gap-5 border-b px-3 py-1.5">
        <div className="flex items-center gap-2">
          <select
            value={iso3}
            onChange={(e) => {
              setIso3(e.target.value)
              setSplit(DEFAULT_SPLIT)
            }}
            className="num text-amb border-none !p-0 text-[13px] font-semibold"
            title="Change country"
          >
            {meta.countries.map((c) => (
              <option key={c.iso3} value={c.iso3}>{c.iso3}</option>
            ))}
          </select>
          <span className="num text-amb text-[13px] font-semibold">
            {overview.country.toUpperCase()} · RESOURCE ECONOMY
          </span>
        </div>
        {headline.map(([label, value, title]) => (
          <div key={label} className="flex items-baseline gap-1.5" title={title}>
            <span className="text-dim text-[10px] tracking-wider">{label}</span>
            <span className="num text-ink text-[13px]">{value}</span>
          </div>
        ))}
        <div className="num text-dim ml-auto text-[11px]">DATA AS OF {overview.data_as_of}</div>
      </div>

      <nav className="border-line flex border-b">
        {TABS.map((t, i) => (
          <button
            key={t}
            onClick={() => setTab(i)}
            className={`num border-line border-r px-4 py-1 text-[12px] tracking-wider ${i === tab ? 'bg-amb text-black' : 'text-ink hover:text-amb'}`}
          >
            {i + 1} {t.toUpperCase()}
          </button>
        ))}
      </nav>

      <div className="flex-1">
        {tab === 0 && <Overview data={overview} onSelect={setIso3} selectable={selectable} />}
        {tab === 1 && (
          <Allocate
            plan={plan}
            share={share}
            setShare={setShare}
            split={split}
            setSplit={setSplit}
            specs={meta.assumptions}
            overrides={overrides}
            setOverrides={setOverrides}
            onOptimize={runOptimize}
            optimizing={optimizing}
            optimizeResult={optimizeResult}
          />
        )}
        {tab === 2 && site && (
          <Projects deal={deal} sites={overview.sites} site={site} setSite={setSite} mw={mw} setMw={setMw} input={input} iso3={iso3} />
        )}
        {tab === 3 && <Stress plan={plan} />}
        {tab === 4 && <Memo markdown={memo} input={input} country={overview.country} />}
      </div>
      <Footer />
    </main>
  )
}

export default App

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
  type Overview,
  type Plan as PlanData,
  type PlanInput,
  type Split,
} from './api'
import { Footer, GoalBar } from './components/ui'
import Memo from './tabs/Memo'
import Plan from './tabs/Plan'
import Projects from './tabs/Projects'
import Situation from './tabs/Situation'
import Stress from './tabs/Stress'

const TABS = ['Situation', 'Plan', 'Projects', 'Stress test', 'Memo'] as const
const DEFAULT_SPLIT: Split = { solar: 40, rail: 30, fund: 30 }

function App() {
  const [meta, setMeta] = useState<Meta | null>(null)
  const [iso3, setIso3] = useState('LBY')
  const [tab, setTab] = useState(0)
  const [overview, setOverview] = useState<Overview | null>(null)
  const [waiting, setWaiting] = useState(false)

  const [share, setShare] = useState(0.1)
  const [split, setSplit] = useState<Split>(DEFAULT_SPLIT)
  const [overrides, setOverrides] = useState<Record<string, number>>({})
  const [site, setSite] = useState<string | null>(null)
  const [mw, setMw] = useState(500)

  const [plan, setPlan] = useState<PlanData | null>(null)
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
      if (['INPUT', 'SELECT', 'TEXTAREA'].includes((e.target as HTMLElement).tagName)) return
      const n = Number(e.key)
      if (n >= 1 && n <= 5) setTab(n - 1)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  function selectCountry(code: string) {
    setIso3(code)
    setSplit(DEFAULT_SPLIT)
  }

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

  const selectable = new Set(meta.countries.map((c) => c.iso3))
  return (
    <main className="flex min-h-screen flex-col bg-black">
      <div className="border-line flex items-center gap-4 border-b px-4 py-2">
        <span className="num text-amb text-[14px] font-semibold tracking-wider">NAHDA</span>
        <select value={iso3} onChange={(e) => selectCountry(e.target.value)} className="num text-[13px]">
          {meta.countries.map((c) => <option key={c.iso3} value={c.iso3}>{c.country}</option>)}
        </select>
        <span className="text-dim text-[13px]">Turn oil money into power, rail and savings.</span>
        <span className="num text-dim ml-auto text-[11px]">DATA AS OF {overview.data_as_of}</span>
      </div>

      <nav className="border-line flex border-b">
        {TABS.map((t, i) => (
          <button
            key={t}
            onClick={() => setTab(i)}
            className={`num border-line border-r px-5 py-1.5 text-[12px] tracking-wider ${i === tab ? 'bg-amb text-black' : 'hover:text-amb'}`}
          >
            {i + 1} {t.toUpperCase()}
          </button>
        ))}
      </nav>

      {tab !== 4 && <GoalBar plan={plan} />}

      <div className="flex-1">
        {tab === 0 && <Situation data={overview} onSelect={selectCountry} selectable={selectable} />}
        {tab === 1 && (
          <Plan
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

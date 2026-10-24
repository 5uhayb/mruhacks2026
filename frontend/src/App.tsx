import { useEffect, useMemo, useState } from 'react'
import {
  getCountries,
  getCountry,
  optimize,
  project,
  stress,
  type Country,
  type CountryData,
  type OptimizeResult,
  type PlanInput,
  type Split,
  type Stress,
  type YearRow,
} from './api'
import Advisor from './components/Advisor'
import { Card, Stat } from './components/Card'
import { ProjectionChart, StressTest } from './components/Charts'
import Compare from './components/Compare'
import Controls from './components/Controls'
import SiteMap from './components/SiteMap'
import { num, pct, scoreColor, usd } from './format'

const DEFAULT_SPLIT: Split = { solar: 30, rail: 25, education: 25, fund: 20 }

function App() {
  const [countries, setCountries] = useState<Country[]>([])
  const [iso3, setIso3] = useState('LBY')
  const [data, setData] = useState<CountryData | null>(null)
  const [error, setError] = useState<string | null>(null)

  const [oilPrice, setOilPrice] = useState(80)
  const [investShare, setInvestShare] = useState(0.25)
  const [split, setSplit] = useState<Split>(DEFAULT_SPLIT)
  const [site, setSite] = useState<string | null>(null)

  const [years, setYears] = useState<YearRow[]>([])
  const [stressResult, setStressResult] = useState<Stress | null>(null)
  const [stressLoading, setStressLoading] = useState(false)
  const [optimizeResult, setOptimizeResult] = useState<OptimizeResult | null>(null)
  const [optimizing, setOptimizing] = useState(false)

  // Keep retrying until the backend is up, so the page recovers on its own if it started first
  useEffect(() => {
    let cancelled = false
    let timer: ReturnType<typeof setTimeout>
    async function load() {
      try {
        const [list, d] = await Promise.all([getCountries(), getCountry(iso3)])
        if (cancelled) return
        setCountries(list)
        setData(d)
        setSite(d.sites[0]?.site ?? null)
        setOilPrice(Math.round(d.current_brent))
        setSplit(DEFAULT_SPLIT)
        setStressResult(null)
        setOptimizeResult(null)
        setError(null)
      } catch {
        if (cancelled) return
        setError('Waiting for the backend... (cd backend; python -m uvicorn main:app --port 8000)')
        timer = setTimeout(load, 2000)
      }
    }
    load()
    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [iso3])

  const input: PlanInput = useMemo(
    () => ({ iso3, invest_share: investShare, split, oil_price: oilPrice, site }),
    [iso3, investShare, split, oilPrice, site],
  )
  const ready = data?.latest.iso3 === iso3

  // Re-project live as sliders move; also refresh the stress test once it has been run
  useEffect(() => {
    if (!ready) return
    const timer = setTimeout(() => {
      project(input).then((r) => setYears(r.years))
      if (stressResult) stress(input).then(setStressResult)
    }, 120)
    return () => clearTimeout(timer)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [input, ready])

  async function runStress() {
    setStressLoading(true)
    try {
      setStressResult(await stress(input))
    } finally {
      setStressLoading(false)
    }
  }

  async function runOptimize() {
    setOptimizing(true)
    try {
      const result = await optimize(input)
      setOptimizeResult(result)
      setSplit({
        solar: Math.round(result.split.solar * 100),
        rail: Math.round(result.split.rail * 100),
        education: Math.round(result.split.education * 100),
        fund: Math.round(result.split.fund * 100),
      })
    } finally {
      setOptimizing(false)
    }
  }

  if (!data)
    return (
      <main className="grid min-h-screen place-items-center p-6 text-slate-400">
        {error ?? 'Loading data...'}
      </main>
    )

  const c = data.latest
  const norway = data.benchmarks.find((b) => b.iso3 === 'NOR')
  const final = years[years.length - 1]
  const first = years[0]

  return (
    <main className="min-h-screen bg-slate-950 text-slate-100">
      <header className="border-b border-slate-800 bg-gradient-to-r from-amber-500/10 via-transparent to-emerald-500/10">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-4 px-6 py-5">
          <div>
            <h1 className="text-3xl font-extrabold tracking-tight">
              <span className="bg-gradient-to-r from-amber-300 to-emerald-400 bg-clip-text text-transparent">Nahda</span>{' '}
              <span className="text-slate-500 font-normal text-xl">نهضة</span>
            </h1>
            <p className="text-sm text-slate-400">Turn a country's resources into a real plan for revival</p>
          </div>
          <select
            value={iso3}
            onChange={(e) => setIso3(e.target.value)}
            className="rounded-lg border border-slate-700 bg-slate-900 px-4 py-2 text-lg font-semibold outline-none focus:ring-2 focus:ring-amber-400"
          >
            {countries
              .filter((x) => x.group === 'struggling')
              .map((x) => (
                <option key={x.iso3} value={x.iso3}>
                  {x.country}
                </option>
              ))}
          </select>
        </div>
      </header>

      <div className="mx-auto max-w-7xl space-y-6 px-6 py-6">
        <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
          <Stat label="Oil share of economy" value={pct(c.oil_rents_pct_gdp)} sub={`Norway: ${pct(norway?.oil_rents_pct_gdp)}`} accent="#f97316" />
          <Stat label="Electricity access" value={pct(c.electricity_access_pct, 1)} sub={`Norway: ${pct(norway?.electricity_access_pct)}`} accent="#fbbf24" />
          <Stat label="Youth unemployment" value={pct(c.youth_unemployment_pct, 1)} sub={`Norway: ${pct(norway?.youth_unemployment_pct, 1)}`} accent="#a78bfa" />
          <Stat label="Renewable energy" value={pct(c.renewable_energy_pct, 1)} sub={`Norway: ${pct(norway?.renewable_energy_pct)}`} accent="#34d399" />
          <Stat label="Oil profits / year" value={usd(first?.revenue)} sub={`World Bank oil rents at $${oilPrice}/barrel`} accent="#38bdf8" />
        </div>

        <div className="grid gap-6 lg:grid-cols-12">
          <div className="space-y-6 lg:col-span-4">
            <Controls
              oilPrice={oilPrice}
              setOilPrice={setOilPrice}
              investShare={investShare}
              setInvestShare={setInvestShare}
              split={split}
              setSplit={setSplit}
              annualBudget={first?.budget}
              currentBrent={data.current_brent}
              onOptimize={runOptimize}
              optimizing={optimizing}
              optimizeResult={optimizeResult}
              assumptions={data.assumptions}
            />
            <SiteMap sites={data.sites} selected={site} onSelect={setSite} />
          </div>

          <div className="space-y-6 lg:col-span-8">
            <Card title={`${c.country} in 10 years`} subtitle={`If oil stays at $${oilPrice} and ${Math.round(investShare * 100)}% of oil revenue is invested`}>
              {final && (
                <div className="mb-5 grid grid-cols-2 gap-3 md:grid-cols-3">
                  <Stat label="Revitalization score" value={`${num(final.score)}/100`} accent={scoreColor(final.score)} sub="power · jobs · transit · savings" />
                  <Stat label="Electricity access" value={pct(final.electricity_access, 1)} sub={`from ${pct(c.electricity_access_pct, 1)}`} accent="#fbbf24" />
                  <Stat label="Solar built" value={`${num(final.solar_gw, 1)} GW`} sub={final.solar_share >= 100 ? "output exceeds today's demand" : `= ${pct(final.solar_share)} of today's demand`} accent="#f59e0b" />
                  <Stat label="Rail built" value={`${num(final.rail_km)} km`} sub={iso3 === 'LBY' && final.rail_km > 950 ? 'enough for Tripoli → Benghazi' : 'new intercity lines'} accent="#38bdf8" />
                  <Stat label="Youth unemployment" value={pct(final.youth_unemployment, 1)} sub={`from ${pct(c.youth_unemployment_pct, 1)} · ${num(final.youth_jobs)} jobs`} accent="#a78bfa" />
                  <Stat label="Savings fund" value={usd(final.fund)} sub="protection against oil crashes" accent="#34d399" />
                </div>
              )}
              <ProjectionChart
                years={years}
                today={{
                  electricity_access: Number(c.electricity_access_pct ?? 100),
                  youth_unemployment: Number(c.youth_unemployment_pct ?? 0),
                  solar_share: 0,
                  rail_km: 0,
                  fund: 0,
                }}
              />
            </Card>

            <StressTest result={stressResult} loading={stressLoading} onRun={runStress} />
            <Advisor input={input} country={c.country} />
          </div>
        </div>

        <Compare latest={c} benchmarks={data.benchmarks} history={data.history} />

        <footer className="pb-6 text-center text-xs text-slate-500">
          Data: World Bank (WDI, governance indicators), NASA POWER, Brent prices via FRED. Projections are estimates
          based on the assumptions shown in the plan panel.
        </footer>
      </div>
    </main>
  )
}

export default App

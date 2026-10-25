import axios, { type InternalAxiosRequestConfig } from 'axios'
import { log } from './log'

// All requests go to /api/..., which Vite proxies to the local FastAPI backend
export const api = axios.create({ baseURL: '/api' })

// Time every call and write it to the System log, with the server's own description of the work
api.interceptors.request.use((config: InternalAxiosRequestConfig & { started?: number }) => {
  config.started = performance.now()
  return config
})
api.interceptors.response.use(
  (res) => {
    const cfg = res.config as InternalAxiosRequestConfig & { started?: number }
    const meta = res.data?.meta as Meta | undefined
    log({
      method: (cfg.method ?? 'get').toUpperCase(),
      path: `/api${cfg.url}`,
      detail: meta ? `${meta.detail} · ${Math.round(meta.server_ms)}ms server` : 'ok',
      ms: Math.round(performance.now() - (cfg.started ?? 0)),
    })
    return res
  },
  (err) => {
    const cfg = err.config ?? {}
    log({ method: (cfg.method ?? 'get').toUpperCase(), path: `/api${cfg.url ?? ''}`, detail: err.response?.data?.detail ?? err.message, ms: 0, error: true })
    return Promise.reject(err)
  },
)

export const SECTORS = ['solar', 'rail', 'industry', 'fund'] as const
export type Sector = (typeof SECTORS)[number]
export type Split = Record<Sector, number>
export type Point = { year: number; value: number }
export type Meta = { detail: string; server_ms: number }

export type WorldCountry = {
  iso3: string
  iso2: string | null
  name: string
  hover: string
  resource: string
  target: string[]
  access: Record<string, number>
  projected: Record<string, number>
}
export type World = { years: number[]; countries: WorldCountry[]; target_rule: string; meta: Meta }

export type Fact = { text: string; kind: string; unit: string; value: number; year: number; percentile: number; sparkline: Point[] }
export type Factor = { label: string; value: number | null; effect: number }
export type Scores = { rows: number; mae: number; baseline_mae: number; error_reduction: number; r2: number }
export type ModelCard = {
  train_rows: number
  test_rows: number
  train_years: string
  test_years: string
  all: Scores
  under_95: Scores
  declines_share: number
  target: string
  countries: number
  rows: number
  first_year: number
  last_year: number
}
export type Country = {
  iso3: string
  name: string
  resource: string
  classification: { label: string; rules: string; rents_pct_gdp: number }
  facts: Fact[]
  stats: {
    population: number
    electricity_access_pct: number | null
    electricity_access_pct_year: number | null
    renewable_electricity_pct: number | null
    renewable_electricity_pct_year: number | null
    gdp_per_capita_usd: number | null
  }
  revenue: {
    avg?: number
    years?: number[]
    per_person?: number
    low?: { year: number; revenue: number }
    high?: { year: number; revenue: number }
    range_years?: [number, number]
  }
  sun: { site?: string; value?: number; oslo?: number }
  outlook: {
    year: number
    access_now: number
    gap: number
    baseline_pts: number
    raw_change: number
    change: number
    access_in_10: number
    clipped: boolean
    no_gap: boolean
    factors: Factor[]
  } | null
  model_card: ModelCard
  meta: Meta
}

export type Twin = {
  iso3: string
  country: string
  year: number
  similarity: number
  population_then: number
  access_then: number
  access: number[]
  gdp_per_capita: number[]
  turnaround: boolean
  oil_share_then: number | null
  /** The single biggest shift over the next 10 years, as a fact from the data */
  changed: string
  access_change: number
  income_change: number
}
export type ChangeSpan = { from: number | null; to: number | null; from_year: number | null; to_year: number | null }
export type TwinCompare = {
  twin: string
  twin_name: string
  twin_years: [number, number]
  own_years: [number, number]
  rows: { key: string; label: string; unit: string; source: string; twin: ChangeSpan; own: ChangeSpan; score: number | null }[]
  differences: string[]
  meta: Meta
}
export type Twins = {
  year: number
  access_now: number
  gdp_now: number
  population_now: number
  twins: Twin[]
  forecast: { year: number; access: number; access_low: number; access_high: number; gdp: number; gdp_low: number; gdp_high: number }[]
  windows_searched: number
  rule: string
  meta: Meta
}

export type YearRow = {
  year: number
  fund: number
  solar_mw: number
  homes: number
  household_coverage: number
  rail_km: number
  renewable_pct: number
  access_pct: number
}
export type ShockSide = YearRow & { shortfall_total: number; fully_funded: boolean }
export type Simulation = {
  share: number
  base_revenue: number
  pool: number
  per_person: number
  split_amounts: Split
  start: { access: number; clean: number; access_year: number | null; clean_year: number | null }
  years: YearRow[]
  months_covered: number
  access_full_year: number | null
  sites: { site: string; lat: number; lon: number; solar: number; mw: number }[]
  homes: { households: number; home_kwh: number; coverage: number; homes_powered: number; every_home: boolean; left_over_share: number }
  rail: {
    from: string | null
    to: string | null
    route_km: number
    coords: [number, number][] | null
    funded_km: number
    km_per_year: number
    annual_pool: number
    years_to_complete: number | null
    complete_year: number | null
  }
  low_resource: { is_low: boolean; rents_pct_gdp: number }
  household_size: number
  /** Assumptions whose default depends on the country (value actually used) */
  country_defaults: Record<string, number>
  sectors: Record<Sector, SectorEconomics>
  supply: { choice: Supply; label: string; capex_mult: number; build_years: number; jobs: number; local_value: number; note: string }
  reform: ReformResult | null
  shocks: Record<string, {
    label: string
    detail: string
    before: ShockSide
    after: ShockSide
    note: string
    path: { year: number; access_pct: number; renewable_pct: number }[]
  }>
  futures: {
    runs: number
    history_years: string
    resource: string
    access_paths: number[][]
    clean_paths: number[][]
    access_p10: number
    access_p50: number
    access_p90: number
    clean_p10: number
    p_funded: number
  }
  meta: Meta
}
export type SectorEconomics = { capex: number; annual_return: number; payback: number | null; basis: string }
export type Supply = 'import' | 'local'
export type ReformInput = { target_price: number; phase_years: number; rebate_share: number; add_to_plan: boolean }
export type ReformResult = ReformInput & {
  price_now: number
  price: number[]
  freed: number[]
  kept: number[]
  added_to_plan: number[]
  cpi: number[]
  cost_per_home_month: number[]
  rebate_per_home_month: number[]
  net_per_home_month: number[]
  rail_relief: boolean[]
  peak_cpi: number
  warning: boolean
  spending: { value: number; year: number | null; source: string }
  litres_per_person: number
  litres_source: { energy_kgoe: number; year: number; source: string } | null
}
export const PRESETS = ['playbook', 'balanced', 'power', 'mobility', 'growth'] as const
export type Preset = (typeof PRESETS)[number]
export type PresetResult = {
  split: Split
  label: string
  /** One sentence, at most 15 words */
  line: string
  p_funded?: number
  feasible?: boolean
  note?: string
  peer?: string
  peer_name?: string
  peer_year?: number
  rule?: string
}
export type Presets = { presets: Partial<Record<Preset, PresetResult>>; playbook_peer: string | null; plans_tested: number; share: number; meta: Meta }
export type AssumptionSpec = { group: string; value: number; min: number; max: number; unit: string; label: string; note: string }

export type SimulateInput = {
  iso3: string
  share: number
  split: Split
  assumptions: Record<string, number>
  supply: Supply
  reform: ReformInput | null
}

export const getWorld = async () => (await api.get<World>('/world')).data
export const getCountry = async (iso3: string) => (await api.get<Country>(`/country/${iso3}`)).data
export const getTwins = async (iso3: string) => (await api.get<Twins>(`/twins/${iso3}`)).data
export const getTwinCompare = async (iso3: string, twin: string) => (await api.get<TwinCompare>(`/twins/${iso3}/compare/${twin}`)).data
export const simulate = async (input: SimulateInput) => (await api.post<Simulation>('/simulate', input)).data
export const getPresets = async (iso3: string, share: number, supply: Supply) =>
  (await api.get<Presets>(`/presets/${iso3}`, { params: { share, supply } })).data
export const getAssumptions = async () => (await api.get<Record<string, AssumptionSpec>>('/assumptions')).data

export type AdvisorKind = 'peers' | 'split' | 'reform'
export type AdvisorAnswer = { answer: string; sources: { title: string; url: string }[]; mode: 'web' | 'model' | 'offline'; label: string; meta: Meta }
export const askAdvisor = async (input: Omit<SimulateInput, 'assumptions'> & { question: string; kind: AdvisorKind | null }) =>
  (await api.post<AdvisorAnswer>('/advisor', input, { timeout: 45000 })).data

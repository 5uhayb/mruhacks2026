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

export const SECTORS = ['solar', 'rail', 'fund'] as const
export type Sector = (typeof SECTORS)[number]
export type Split = Record<Sector, number>
export type Point = { year: number; value: number }
export type Meta = { detail: string; server_ms: number }

export type WorldCountry = {
  iso3: string
  name: string
  hover: string
  resource: string
  access: Record<string, number>
  projected: Record<string, number>
}
export type World = { years: number[]; countries: WorldCountry[]; meta: Meta }

export type Fact = { text: string; kind: string; value: number; year: number; percentile: number; sparkline: Point[] }
export type Factor = { label: string; value: number | null; effect: number }
export type ModelCard = {
  train_rows: number
  test_rows: number
  train_years: string
  test_years: string
  r2: number
  mae: number
  baseline_no_change_mae: number
  baseline_average_mae: number
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
  outlook: { year: number; access_now: number; change: number; access_in_10: number; factors: Factor[] } | null
  model_card: ModelCard
  meta: Meta
}

export type Twin = { iso3: string; country: string; year: number; similarity: number; access_then: number; access: number[]; gdp_per_capita: number[] }
export type Twins = {
  year: number
  access_now: number
  gdp_now: number
  twins: Twin[]
  forecast: { year: number; access: number; access_low: number; access_high: number; gdp: number; gdp_low: number; gdp_high: number }[]
  windows_searched: number
  meta: Meta
}

export type YearRow = { year: number; fund: number; solar_mw: number; homes: number; rail_km: number; renewable_pct: number; access_pct: number }
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
  shocks: Record<string, { label: string; detail: string; before: ShockSide; after: ShockSide; note: string }>
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
export type Optimized = { split: Split; p_funded: number; access_y10: number; feasible: boolean; plans_tested: number; min_funded: number; meta: Meta }
export type AssumptionSpec = { value: number; min: number; max: number; unit: string; label: string; note: string }

export type SimulateInput = { iso3: string; share: number; split: Split; assumptions: Record<string, number> }

export const getWorld = async () => (await api.get<World>('/world')).data
export const getCountry = async (iso3: string) => (await api.get<Country>(`/country/${iso3}`)).data
export const getTwins = async (iso3: string) => (await api.get<Twins>(`/twins/${iso3}`)).data
export const simulate = async (input: SimulateInput) => (await api.post<Simulation>('/simulate', input)).data
export const optimize = async (input: SimulateInput) => (await api.post<Optimized>('/optimize', input)).data
export const getAssumptions = async () => (await api.get<Record<string, AssumptionSpec>>('/assumptions')).data

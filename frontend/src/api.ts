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

export const SECTORS = ['solar', 'wind', 'grid'] as const
export type Sector = (typeof SECTORS)[number]
export type Split = Record<Sector, number>
export type Point = { year: number; value: number }
export type Meta = { detail: string; server_ms: number }

export type WorldCountry = {
  iso3: string
  iso2: string | null
  name: string
  hover: string
  access: Record<string, number>
  projected: Record<string, number>
}
export type QuickPick = { iso3: string; iso2: string; name: string; access: number; year: number; coverage: number }
export type World = { years: number[]; countries: WorldCountry[]; quick_picks: QuickPick[]; quick_pick_rule: string; meta: Meta }

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
export type Dated = { value: number | null; year: number | null; latest?: { value: number; year: number } | null; last_measured?: number }
export type Site = { site: string; lat: number; lon: number; solar: number; wind: number }
export type BestSite = { value: number; site: string; lat: number; lon: number }
export type Budget = {
  gdp: { base: number; year: number | null; share: number; amount: number }
  resource: { base: number; years: [number, number] | null; word: string; share: number; amount: number }
  total: number
}
export type Country = {
  iso3: string
  name: string
  tier: string
  facts: Fact[]
  profile: { year: number | null; rule: string; access: Dated; urban: Dated; rural: Dated; clean: Dated; resources: { solar: BestSite | null; wind: BestSite | null; sites: Site[] } }
  badges: { label: string; rule: string }[]
  budget: Budget
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

export type Peer = {
  iso3: string
  country: string
  year: number
  similarity: number
  access: number[]
  urban_gain: number | null
  rural_gain: number | null
  clean_gain: number | null
  changed: string
  result: string
  access_change: number
  lesson: string
  detail: {
    years: [number, number]
    series: { year: number; total: number | null; rural: number | null; urban: number | null; clean: number | null }[]
    bullets: string[]
    tradeoff: string | null
  }
}
export type Playbook = { peer: string; peer_name: string; peer_year: number; split: Split; line: string }
export type Peers = {
  year: number
  access_now: number
  top: string | null
  peers: Peer[]
  rule: string
  playbook: Playbook | null
  playbook_rule: string
  windows_searched: number
  meta: Meta
}

export type YearRow = { year: number; access_pct: number; clean_pct: number; solar_mw: number; wind_mw: number; line_km: number; storage_mwh: number }
export type ShockSide = Omit<YearRow, 'year'>
export type Simulation = {
  budget: Budget
  split: Split
  split_amounts: Split
  recommendation: { split: Split; banner: string; solar: number; wind: number }
  start: { access: number; access_year: number | null; clean: number; clean_year: number | null; urban: Dated; rural: Dated; snapshot: number | null }
  years: YearRow[]
  cards: {
    solar: { mw: number; capex: number; payback: number | null; mwh: number; site: BestSite }
    wind: { mw: number; turbines: number; capex: number; payback: number | null; capacity_factor: number; mw_per_turbine: number; site: BestSite }
    grid: { km: number; storage_mwh: number; capex: number; households: number }
    access: { value: number; clean: number; people: number }
  }
  limit: 'lines' | 'generation'
  sites: { solar: BestSite; wind: BestSite }
  household_size: number
  shocks: Record<string, { label: string; detail: string; before: ShockSide; after: ShockSide; note: string; path: { year: number; access_pct: number; clean_pct: number }[] }>
  futures: {
    runs: number
    history_years: string
    access_paths: number[][]
    clean_paths: number[][]
    access_p10: number
    access_p50: number
    access_p90: number
    clean_p10: number
    budget_p10: number
    budget_p90: number
  }
  meta: Meta
}
export type AssumptionSpec = { group: string; value: number; min: number; max: number; unit: string; label: string; note: string }
export type SimulateInput = { iso3: string; split: Split | null; assumptions: Record<string, number> }

export type AdvisorKind = 'mix' | 'peer' | 'siting' | 'first' | 'risk' | 'peer_web'
export type AdvisorAnswer = { answer: string; sources: { title: string; url: string }[]; mode: 'web' | 'model' | 'offline'; label: string; meta: Meta }

export const getWorld = async () => (await api.get<World>('/world')).data
export const getCountry = async (iso3: string) => (await api.get<Country>(`/country/${iso3}`)).data
export const getPeers = async (iso3: string) => (await api.get<Peers>(`/peers/${iso3}`)).data
export const simulate = async (input: SimulateInput) => (await api.post<Simulation>('/simulate', input)).data
export const getAssumptions = async () => (await api.get<Record<string, AssumptionSpec>>('/assumptions')).data
export const askAdvisor = async (input: SimulateInput & { question: string; kind: AdvisorKind | null }) =>
  (await api.post<AdvisorAnswer>('/advisor', input, { timeout: 45000 })).data

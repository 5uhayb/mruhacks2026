import axios from 'axios'

// All requests go to /api/..., which Vite proxies to the FastAPI backend
export const api = axios.create({ baseURL: '/api' })

export const SECTORS = ['solar', 'rail', 'fund'] as const
export type Sector = (typeof SECTORS)[number]
export type Split = Record<Sector, number>

export type Point = { year: number; value: number }
export type Why = { words: string; symbols: string; inputs: { label: string; value: string; source: string }[]; sensitivity: string }

export type AssumptionSpec = { value: number; min: number; max: number; unit: string; label: string; note: string }
export type Peer = {
  iso3: string
  country: string
  group: string
  revenue_avg: number
  revenue_per_person: number
  access_pct: number | null
  renewable_electricity_pct: number
  best_solar: number
  best_site: string
  gdp_per_capita: number | null
  untapped: number
}
export type Meta = {
  countries: Peer[]
  assumptions: Record<string, AssumptionSpec>
  shocks: Record<string, { label: string; detail: string }>
}

export type MetricBlock = {
  key: string
  label: string
  value: number | null
  unit: string
  year: number | null
  sparkline: Point[]
  compare: { diff: number; unit: string; good: boolean; vs: string } | null
  note: string
  source: string
}
export type RevenueYear = { year: number; gdp_usd: number; oil_rents_pct: number; revenue: number }
export type Overview = {
  iso3: string
  country: string
  data_as_of: number
  population: number
  metrics: MetricBlock[]
  revenue: {
    avg: number
    years: number[]
    per_person: number
    history: RevenueYear[]
    worst: RevenueYear
    best: RevenueYear
    note: string
    read: string
    why: Why
  }
  energy: { access: Record<string, Point[]>; read: string }
  potential: {
    best_site: string
    best_solar: number
    benchmarks: { iso3: string; country: string; site: string; solar: number }[]
    note: string
    read: string
    source: string
  }
  peers: Peer[]
  peers_read: string
  untapped_formula: string
  read: string
  sites: { site: string; lat: number; lon: number; solar: number; wind: number }[]
}

export type YearRow = {
  year: number
  revenue: number
  pool: number
  fund: number
  fund_returns: number
  shortfall: number
  solar_mw: number
  solar_mwh: number
  solar_value: number
  homes: number
  rail_km: number
  renewable_pct: number
  access_pct: number
  capital_deployed: number
  value_created: number
  resilience: number
  term_buffer: number
  term_new_income: number
  term_clean_power: number
  term_access: number
}
export type ShockSide = YearRow & { shortfall_total: number; fully_funded: boolean; deal_npv: number }
export type Band = { year: number; p10: number; p50: number; p90: number }
export type Terms = Record<'term_buffer' | 'term_new_income' | 'term_clean_power' | 'term_access' | 'resilience', number>
export type Plan = {
  site: string
  readout: { pool: number; per_person: number; share: number; base_revenue: number; split_amounts: Split; note: string }
  years: YearRow[]
  value_note: string
  resilience: { today: Terms; year10: Terms; note: string; why: Why }
  shocks: Record<string, { label: string; detail: string; before: ShockSide; after: ShockSide; note: string }>
  monte_carlo: {
    runs: number
    p_funded: number
    homes_p10: number
    fund_p10: number
    bands: Record<'pool' | 'fund' | 'homes' | 'resilience', Band[]>
    note: string
    why: Why
  }
  rail_pool: number
}
export type Sensitivity = {
  key: string
  label: string
  unit: string
  low_value: number
  high_value: number
  irr_at_low: number | null
  irr_at_high: number | null
}
export type Deal = {
  site: string
  solar_kwh: number
  mw: number
  capex: number
  annual_mwh: number
  homes: number
  share_of_national_use: number
  annual_value: number
  irr: number | null
  irr_low: number | null
  irr_high: number | null
  npv: number
  discount_rate: number
  npv_at_nor_rate: number
  nor_discount_rate: number
  payback: number | null
  sensitivity: Sensitivity[]
  notes: { building: string; pays: string; breaks: string; same_farm: string }
  why: Why
}
export type Rail = {
  from: string
  to: string
  straight_km: number
  route_km: number
  annual_rail_pool: number
  options: { type: string; cost_min: number; cost_max: number; years_min: number | null; years_max: number | null }[]
  note: string
}
export type OptimizeResult = { split: Split; robust_score: number; current_robust_score: number }

export type PlanInput = {
  iso3: string
  share: number
  split: Split
  site: string | null
  mw: number
  assumptions: Record<string, number>
}

export const getMeta = async () => (await api.get<Meta>('/meta')).data
export const getOverview = async (iso3: string) => (await api.get<Overview>(`/overview/${iso3}`)).data
export const getPlan = async (input: PlanInput) => (await api.post<Plan>('/plan', input)).data
export const getDeal = async (input: PlanInput) => (await api.post<Deal>('/deal', input)).data
export const getRail = async (input: PlanInput, origin: string, destination: string) =>
  (await api.post<Rail>('/rail', { ...input, origin, destination })).data
export const getMemo = async (input: PlanInput) => (await api.post<{ markdown: string }>('/memo', input)).data.markdown
export const optimize = async (input: PlanInput) => (await api.post<OptimizeResult>('/optimize', input)).data

/** Streams the analyst's answer, calling onText with the full text so far */
export async function ask(input: PlanInput, question: string, onText: (text: string) => void) {
  const res = await fetch('/api/advisor', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...input, question }),
  })
  if (!res.ok || !res.body) {
    const detail = await res.json().then((d) => d.detail).catch(() => null)
    throw new Error(detail ?? 'Analyst unavailable.')
  }
  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  let text = ''
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    text += decoder.decode(value, { stream: true })
    onText(text)
  }
}

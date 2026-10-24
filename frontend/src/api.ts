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
  revenue_avg: number
  access_pct: number | null
  renewable_electricity_pct: number
  best_solar: number
  untapped: number
}
export type Meta = {
  countries: Peer[]
  assumptions: Record<string, AssumptionSpec>
  shocks: Record<string, { label: string; detail: string }>
}

export type Site = { site: string; lat: number; lon: number; solar: number; wind: number }
export type Overview = {
  iso3: string
  country: string
  data_as_of: number
  tiles: {
    oil: { value: number; years: number[]; per_person: number; note: string; source: string; why: Why; history: { year: number; revenue: number }[] }
    no_power: { value: number; year: number; note: string; source: string; sparkline: Point[] }
    clean: { value: number; year: number; note: string; source: string; nor: number }
    sun: { site: string; value: number; note: string; source: string }
  }
  peers: Peer[]
  sites: Site[]
}

export const GOAL_KEYS = ['goal_power', 'goal_clean', 'goal_savings', 'goal_rail'] as const
export type GoalKey = (typeof GOAL_KEYS)[number]
export type Goal = { key: GoalKey; label: string; target: string }

export type YearRow = Record<GoalKey | 'goal_score', number> & {
  year: number
  pool: number
  fund: number
  solar_mw: number
  homes: number
  rail_km: number
  renewable_pct: number
  access_pct: number
}
export type ShockSide = YearRow & { shortfall_total: number; fully_funded: boolean; deal_npv: number }
export type Band = { year: number; p10: number; p50: number; p90: number }
export type Plan = {
  site: string
  goals: Goal[]
  route_km: number
  today: Record<GoalKey | 'goal_score', number>
  base_revenue: number
  pool: number
  per_person: number
  split_amounts: Split
  years: YearRow[]
  shocks: Record<string, { label: string; detail: string; before: ShockSide; after: ShockSide; note: string }>
  monte_carlo: { runs: number; p_funded: number; p_goal: Record<GoalKey, number>; fund_bands: Band[]; why: Why }
}
export type Deal = {
  site: string
  solar_kwh: number
  mw: number
  capex: number
  annual_mwh: number
  homes: number
  irr: number | null
  irr_low: number | null
  irr_high: number | null
  npv: number
  discount_rate: number
  npv_at_nor_rate: number
  nor_discount_rate: number
  payback: number | null
  notes: { building: string; pays: string; breaks: string; same_farm: string }
  why: Why
}
export type Rail = {
  from: string
  to: string
  route_km: number
  annual_rail_pool: number
  options: { type: string; cost_min: number; cost_max: number; years_min: number | null; years_max: number | null }[]
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

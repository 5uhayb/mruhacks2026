import axios from 'axios'

// All requests go to /api/..., which Vite proxies to the FastAPI backend
export const api = axios.create({ baseURL: '/api' })

export const SECTORS = ['solar', 'rail', 'education', 'fund'] as const
export type Sector = (typeof SECTORS)[number]
export type Split = Record<Sector, number>

export type Country = { iso3: string; country: string; group: 'struggling' | 'success' }
export type Latest = Record<string, number | string | null> & { iso3: string; country: string }
export type HistoryRow = {
  iso3: string
  year: number
  gdp_per_capita_usd: number | null
  electricity_access_pct: number | null
  oil_rents_pct_gdp: number | null
}
export type Site = {
  site: string
  lat: number
  lon: number
  solar_kwh_m2_day: number
  wind_50m_ms: number
  temp_c: number
  score: number
}
export type CountryData = {
  latest: Latest
  benchmarks: Latest[]
  history: HistoryRow[]
  sites: Site[]
  current_brent: number
  assumptions: Record<string, number>
}
export type YearRow = {
  year: number
  revenue: number
  budget: number
  solar_gw: number
  electricity_access: number
  solar_share: number
  rail_km: number
  youth_jobs: number
  youth_unemployment: number
  fund: number
  score: number
}
export type Band = { year: number; p10: number; p50: number; p90: number }
export type Stress = {
  scenarios: number
  bands: Record<string, Band[]>
  oil_price: Band[]
  crash_share: number
  score_p10: number
  score_p50: number
}
export type OptimizeResult = { split: Split; robust_score: number; current_robust_score: number }
export type PlanInput = { iso3: string; invest_share: number; split: Split; oil_price: number; site: string | null }

export const getCountries = async () => (await api.get<Country[]>('/countries')).data
export const getCountry = async (iso3: string) => (await api.get<CountryData>(`/country/${iso3}`)).data
export const project = async (input: PlanInput) =>
  (await api.post<{ site: string; years: YearRow[] }>('/project', input)).data
export const stress = async (input: PlanInput) => (await api.post<Stress>('/stress', input)).data
export const optimize = async (input: PlanInput) => (await api.post<OptimizeResult>('/optimize', input)).data
/** Streams the advisor's answer, calling onText with the full text so far */
export async function advisor(input: PlanInput, question: string | undefined, onText: (text: string) => void) {
  const res = await fetch('/api/advisor', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...input, question }),
  })
  if (!res.ok || !res.body) {
    const detail = await res.json().then((d) => d.detail).catch(() => null)
    throw new Error(detail ?? 'Advisor unavailable.')
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

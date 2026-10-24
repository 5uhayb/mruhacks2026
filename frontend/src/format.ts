import type { Sector } from './api'

export const SECTOR_INFO: Record<Sector, { label: string; color: string; icon: string }> = {
  solar: { label: 'Solar energy', color: '#fbbf24', icon: '☀️' },
  rail: { label: 'Rail & transit', color: '#38bdf8', icon: '🚆' },
  education: { label: 'Youth jobs & skills', color: '#a78bfa', icon: '🎓' },
  fund: { label: 'Savings fund', color: '#34d399', icon: '🏦' },
}

export function usd(value: number | null | undefined): string {
  if (value == null) return '—'
  const abs = Math.abs(value)
  if (abs >= 1e12) return `$${(value / 1e12).toFixed(1)}T`
  if (abs >= 1e9) return `$${(value / 1e9).toFixed(1)}B`
  if (abs >= 1e6) return `$${(value / 1e6).toFixed(0)}M`
  return `$${Math.round(value).toLocaleString()}`
}

export function num(value: number | string | null | undefined, digits = 0): string {
  if (value == null || typeof value === 'string') return '—'
  return value.toLocaleString(undefined, { maximumFractionDigits: digits, minimumFractionDigits: digits })
}

export function pct(value: number | string | null | undefined, digits = 0): string {
  return value == null || typeof value === 'string' ? '—' : `${num(value, digits)}%`
}

/** Red -> amber -> green for a 0-100 score */
export function scoreColor(score: number): string {
  const hue = Math.max(0, Math.min(120, (score / 100) * 120))
  return `hsl(${hue} 80% 55%)`
}

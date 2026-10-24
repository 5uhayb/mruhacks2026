export function money(v: number | null | undefined, digits = 1): string {
  if (v == null || Number.isNaN(v)) return '—'
  const a = Math.abs(v)
  const sign = v < 0 ? '−' : ''
  if (a >= 1e12) return `${sign}$${(a / 1e12).toFixed(digits)}T`
  if (a >= 1e9) return `${sign}$${(a / 1e9).toFixed(digits)}B`
  if (a >= 1e6) return `${sign}$${(a / 1e6).toFixed(0)}M`
  return `${sign}$${Math.round(a).toLocaleString('en-US')}`
}

export function num(v: number | null | undefined, digits = 0): string {
  if (v == null || Number.isNaN(v)) return '—'
  return v.toLocaleString('en-US', { minimumFractionDigits: digits, maximumFractionDigits: digits })
}

export function pct(v: number | null | undefined, digits = 1): string {
  return v == null ? '—' : `${num(v, digits)}%`
}

/** For 0-1 ratios such as IRR */
export function rate(v: number | null | undefined, digits = 1): string {
  return v == null ? '—' : `${(v * 100).toFixed(digits)}%`
}

/** Small percentages keep 2 decimals so 0.02% does not read as 0.0% */
export function smallPct(v: number | null | undefined): string {
  if (v == null) return '—'
  return v < 1 ? `${v.toFixed(2)}%` : `${v.toFixed(1)}%`
}

export function compact(v: number): string {
  if (Math.abs(v) >= 1e6) return `${(v / 1e6).toFixed(2)}M`
  if (Math.abs(v) >= 1e3) return `${(v / 1e3).toFixed(0)}K`
  return v.toFixed(0)
}

export function formatAssumption(v: number, unit: string): string {
  if (unit.startsWith('$')) return v >= 1e6 ? `$${v / 1e6}M` : v >= 1e3 ? `$${v / 1e3}K` : `$${v}`
  if (unit === 'rate' || unit === 'rate/pt' || unit === '/yr') return `${(v * 100).toFixed(1)}%`
  return v.toLocaleString('en-US')
}

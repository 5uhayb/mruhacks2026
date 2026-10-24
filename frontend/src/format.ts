/** "$16.8B" style, for big numbers on screen */
export function money(v: number | null | undefined, digits = 1): string {
  if (v == null || Number.isNaN(v)) return '—'
  const a = Math.abs(v)
  const sign = v < 0 ? '−' : ''
  if (a >= 1e12) return `${sign}$${(a / 1e12).toFixed(digits)}T`
  if (a >= 1e9) return `${sign}$${(a / 1e9).toFixed(digits)}B`
  if (a >= 1e6) return `${sign}$${(a / 1e6).toFixed(0)}M`
  return `${sign}$${Math.round(a).toLocaleString('en-US')}`
}

/** "$16.8 billion" style, for sentences */
export function moneyWords(v: number): string {
  const a = Math.abs(v)
  if (a >= 1e9) return `$${(v / 1e9).toFixed(1)} billion`
  if (a >= 1e6) return `$${Math.round(v / 1e6)} million`
  return `$${Math.round(v).toLocaleString('en-US')}`
}

export function num(v: number | null | undefined, digits = 0): string {
  if (v == null || Number.isNaN(v)) return '—'
  return v.toLocaleString('en-US', { minimumFractionDigits: digits, maximumFractionDigits: digits })
}

/** Small percentages keep 2 decimals so 0.02% does not read as 0% */
export function pct(v: number | null | undefined): string {
  if (v == null) return '—'
  if (v > 0 && v < 1) return `${v.toFixed(2)}%`
  return `${v.toFixed(v >= 99.95 || v === 0 ? 0 : 1)}%`
}

export function bigCount(v: number): string {
  if (v >= 1e6) return `${(v / 1e6).toFixed(1)} million`
  if (v >= 1e3) return `${Math.round(v / 1e3).toLocaleString('en-US')},000`
  return num(v)
}

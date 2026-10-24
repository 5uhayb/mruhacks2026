/**
 * The one place numbers are turned into text. Every component uses these; nothing formats by hand.
 *
 * Precision rules:
 *  - formatMoney: billions with 1 decimal in cards/sentences, 2 decimals in live readouts (pass 2)
 *  - formatPct: 1 decimal; values between 0 and 1% keep 2 decimals so they never show as 0%
 */

const DASH = '—'
const bad = (v: number | null | undefined): v is null | undefined => v == null || Number.isNaN(v)

/** $6.30B, $302M, $45K, $450. Always has a suffix above $1,000. */
export function formatMoney(v: number | null | undefined, billionsDecimals = 1): string {
  if (bad(v)) return DASH
  const a = Math.abs(v)
  const sign = v < 0 ? '−' : ''
  if (a >= 1e12) return `${sign}$${(a / 1e12).toFixed(billionsDecimals)}T`
  if (a >= 1e9) return `${sign}$${(a / 1e9).toFixed(billionsDecimals)}B`
  if (a >= 1e6) return `${sign}$${Math.round(a / 1e6)}M`
  if (a >= 1e3) return `${sign}$${Math.round(a / 1e3)}K`
  return `${sign}$${Math.round(a)}`
}

/** $1.7 billion, $302 million: for full sentences */
export function formatMoneyWords(v: number | null | undefined): string {
  if (bad(v)) return DASH
  const a = Math.abs(v)
  const sign = v < 0 ? '−' : ''
  if (a >= 1e9) return `${sign}$${(a / 1e9).toFixed(1)} billion`
  if (a >= 1e6) return `${sign}$${Math.round(a / 1e6)} million`
  return `${sign}$${formatInt(a)}`
}

/** 2404335 → "2,404,335" */
export function formatInt(v: number | null | undefined): string {
  if (bad(v)) return DASH
  return Math.round(v).toLocaleString('en-US')
}

/** Fixed decimals with thousands separators: formatNumber(1234.5, 1) → "1,234.5" */
export function formatNumber(v: number | null | undefined, decimals = 0): string {
  if (bad(v)) return DASH
  return v.toLocaleString('en-US', { minimumFractionDigits: decimals, maximumFractionDigits: decimals })
}

/** "2.4 million", "7,557 MW", "260 km" */
export function formatCompact(v: number | null | undefined, unit = ''): string {
  if (bad(v)) return DASH
  const suffix = unit ? ` ${unit}` : ''
  if (Math.abs(v) >= 1e6) return `${(v / 1e6).toFixed(1)} million${suffix}`
  return `${formatInt(v)}${suffix}`
}

/** 77.4%, 100%, 0.02% (never rounds a non-zero value down to 0%) */
export function formatPct(v: number | null | undefined, decimals = 1): string {
  if (bad(v)) return DASH
  const a = Math.abs(v)
  if (a > 0 && a < 0.01) return '<0.01%'
  if (a > 0 && a < 1) return `${v.toFixed(Math.max(2, decimals))}%`
  const s = v.toFixed(decimals)
  // 100.0% and 50.0% read better as 100% and 50%
  return `${Number(s) === Math.round(Number(s)) ? Math.round(Number(s)) : s}%`
}

/** Signed change with an arrow: "▲ +12%", "▼ −3.1 pts", "— 0 pts" */
export function formatDelta(v: number | null | undefined, unit = '%', decimals = 0): string {
  if (bad(v)) return DASH
  const rounded = Number(v.toFixed(decimals))
  if (rounded === 0) return `— 0${unit}`
  const body = Math.abs(rounded).toFixed(decimals)
  return rounded > 0 ? `▲ +${body}${unit}` : `▼ −${body}${unit}`
}

import { describe, expect, it } from 'vitest'
import { formatCompact, formatDelta, formatInt, formatMoney, formatMoneyWords, formatPct } from './format'

describe('formatMoney', () => {
  it('always uses a suffix', () => {
    expect(formatMoney(6.3e9)).toBe('$6.3B')
    expect(formatMoney(6.3e9, 2)).toBe('$6.30B')
    expect(formatMoney(302e6)).toBe('$302M')
    expect(formatMoney(45_000)).toBe('$45K')
    expect(formatMoney(450)).toBe('$450')
    expect(formatMoney(1.2e12)).toBe('$1.2T')
  })
  it('shows every 1% step of the investment readout', () => {
    expect(formatMoney(25.5e9 * 0.1, 2)).toBe('$2.55B')
    expect(formatMoney(25.5e9 * 0.11, 2)).toBe('$2.81B')
  })
  it('handles negatives and missing values', () => {
    expect(formatMoney(-2.5e9)).toBe('−$2.5B')
    expect(formatMoney(null)).toBe('—')
    expect(formatMoney(Number.NaN)).toBe('—')
  })
})

describe('formatInt', () => {
  it('puts a separator every 3 digits', () => {
    expect(formatInt(2404335)).toBe('2,404,335')
    expect(formatInt(999)).toBe('999')
    expect(formatInt(1000)).toBe('1,000')
    expect(formatInt(1234567.6)).toBe('1,234,568')
  })
})

describe('formatPct', () => {
  it('never turns a small non-zero share into 0%', () => {
    expect(formatPct(0.0214)).toBe('0.02%')
    expect(formatPct(0.004)).toBe('<0.01%')
    expect(formatPct(0)).toBe('0%')
  })
  it('drops .0 on whole numbers only', () => {
    expect(formatPct(77.4)).toBe('77.4%')
    expect(formatPct(100)).toBe('100%')
    expect(formatPct(99.8)).toBe('99.8%')
  })
})

describe('formatCompact and formatDelta', () => {
  it('compacts large counts', () => {
    expect(formatCompact(2_404_335)).toBe('2.4 million')
    expect(formatCompact(7557, 'MW')).toBe('7,557 MW')
    expect(formatCompact(260, 'km')).toBe('260 km')
  })
  it('signs every change with an arrow', () => {
    expect(formatDelta(12)).toBe('▲ +12%')
    expect(formatDelta(-12)).toBe('▼ −12%')
    expect(formatDelta(-3.14, ' pts', 1)).toBe('▼ −3.1 pts')
    expect(formatDelta(0.01)).toBe('— 0%')
  })
  it('writes money for sentences', () => {
    expect(formatMoneyWords(1.68e9)).toBe('$1.7 billion')
    expect(formatMoneyWords(302e6)).toBe('$302 million')
  })
})

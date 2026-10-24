import type { AssumptionSpec, Country, Peers, Simulation } from '../api'
import { formatCompact, formatInt, formatMoney, formatNumber, formatPct } from './format'

export const LIMITATIONS = [
  'Assumes new lines connect homes; local grid studies are needed.',
  'Solar and wind are variable, not baseload; storage and the grid cover gaps. Seasonal storage is not modelled.',
  'Wind speeds are NASA 50 m point averages; turbine sites need detailed local studies.',
  'Costs, capacity factors and connections per km are editable estimates.',
  'The impact model cannot predict declines in electricity access.',
]

function assumptionValue(s: AssumptionSpec, v: number): string {
  if (s.unit.startsWith('$')) return `${formatMoney(v)} ${s.unit.slice(1)}`.trim()
  if (s.unit === 'rate' || s.unit === 'ratio') return formatPct(v * 100)
  return `${formatNumber(v, v % 1 ? 2 : 0)} ${s.unit}`
}

/** One-page Markdown brief. Every number comes from the app's current state. */
export function buildBrief(args: {
  country: Country
  sim: Simulation
  peers: Peers | null
  specs: Record<string, AssumptionSpec>
  overrides: Record<string, number>
  date?: Date
}): string {
  const { country: c, sim, peers, specs, overrides } = args
  const p = c.profile
  const cd = sim.cards
  const start = sim.start.access_year ?? new Date().getFullYear()
  const b = sim.budget
  const assumptionLines = Object.entries(specs).map(([k, s]) => {
    const v = overrides[k] ?? (k === 'household_size' ? sim.household_size : s.value)
    return `- ${s.label}: ${assumptionValue(s, v)}${k in overrides ? ' (edited)' : ''}`
  })
  return [
    `# ${c.name}: electrification brief`,
    `${c.tier}. Generated ${(args.date ?? new Date()).toISOString().slice(0, 10)}. Data from the World Bank and NASA POWER (each value with its year); everything under "Plan" and "Stress test" is a model estimate.`,
    '',
    '## Where it stands',
    `- Electricity access: ${formatPct(p.access.value)} (${p.access.year}); urban ${formatPct(p.urban.value, 0)} (${p.urban.year ?? 'no data'}), rural ${formatPct(p.rural.value, 0)} (${p.rural.year ?? 'no data'}).`,
    `- Clean electricity: ${formatPct(p.clean.value)} (${p.clean.year}).`,
    p.resources.solar ? `- Best solar: ${formatNumber(p.resources.solar.value, 2)} kWh/m²/day at ${p.resources.solar.site}; best wind (50 m): ${formatNumber(p.resources.wind?.value, 2)} m/s at ${p.resources.wind?.site}.` : '',
    `- Budget (estimate): ${formatMoney(b.total, 2)} a year = ${formatPct(b.gdp.share * 100)} of GDP (${formatMoney(b.gdp.amount, 2)})${b.resource.amount ? ` + ${formatPct(b.resource.share * 100, 0)} of ${b.resource.word} income (${formatMoney(b.resource.amount, 2)})` : ''}.`,
    '',
    '## Peers that closed the gap',
    ...(peers?.peers.length ? peers.peers.map((x) => `- **${x.country} ${x.year}** (${Math.round(x.similarity)}% match): ${x.changed} ${x.result}.`) : ['- No peer meets the selection rule.']),
    '',
    `## Plan by ${start + 10} (estimates)`,
    `- ${sim.recommendation.banner}`,
    `- Mix used: solar ${formatPct(sim.split.solar, 0)}, wind ${formatPct(sim.split.wind, 0)}, grid & storage ${formatPct(sim.split.grid, 0)}.`,
    `- Solar added: ${formatCompact(cd.solar.mw, 'MW')}, ${formatMoney(cd.solar.capex)}, payback ${cd.solar.payback != null ? `${formatNumber(cd.solar.payback, 1)} years` : 'n/a'}.`,
    `- Wind added: ${formatCompact(cd.wind.mw, 'MW')} (~${formatInt(cd.wind.turbines)} turbines), ${formatMoney(cd.wind.capex)}.`,
    `- Grid & storage: ${formatCompact(cd.grid.km, 'km')} of lines, ${formatCompact(cd.grid.storage_mwh, 'MWh')} of storage, ${formatMoney(cd.grid.capex)}.`,
    `- Electricity access: ${formatPct(cd.access.value)}; clean share ${formatPct(cd.access.clean)}.`,
    '',
    '## Stress test',
    ...Object.values(sim.shocks).map((s) => `- **${s.label}:** access ${formatPct(s.before.access_pct)} → ${formatPct(s.after.access_pct)}.`),
    `- ${sim.futures.runs} budget futures: in 9 of 10, access reaches ${formatPct(sim.futures.access_p10)}.`,
    '',
    '## Key assumptions',
    ...assumptionLines,
    '',
    '## Limitations',
    ...LIMITATIONS.map((l) => `- ${l}`),
  ]
    .filter((line, i, all) => line !== '' || all[i - 1] !== '')
    .join('\n')
}

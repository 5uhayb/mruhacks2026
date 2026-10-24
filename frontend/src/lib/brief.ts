import type { AssumptionSpec, Country, Simulation, Split, Twins } from '../api'
import { formatCompact, formatInt, formatMoney, formatNumber, formatPct } from './format'

export const LIMITATIONS = [
  'Assumes new power can reach homes through the grid; transmission and connection upgrades are not modelled.',
  'Storage for solar beyond daytime demand is not costed.',
  'Rail: only the cost is modelled, not the benefits.',
  'Governance: the money has to reach the projects; weak institutions raise costs and delays.',
  'Fuel subsidies: burning less oil and gas at home may mean subsidy changes that affect household bills.',
  'The impact model cannot predict declines in electricity access.',
]

function assumptionValue(s: AssumptionSpec, v: number): string {
  if (s.unit.startsWith('$')) return `${formatMoney(v)} ${s.unit.slice(1)}`.trim()
  if (s.unit === 'rate' || s.unit === 'rate/pt' || s.unit === '/yr') return formatPct(v * 100)
  if (s.unit === 'ratio') return formatPct(v * 100, 0)
  return `${formatNumber(v, v % 1 ? 2 : 0)} ${s.unit}`
}

/** One-page Markdown brief. Every number comes from the app's current state. */
export function buildBrief(args: {
  country: Country
  sim: Simulation
  twins: Twins | null
  split: Split
  specs: Record<string, AssumptionSpec>
  overrides: Record<string, number>
  date?: Date
}): string {
  const { country: c, sim, twins, specs, overrides } = args
  const y = sim.years[sim.years.length - 1]
  const startYear = sim.start.access_year ?? new Date().getFullYear()
  const endYear = startYear + 10
  const total = args.split.solar + args.split.rail + args.split.fund || 1
  const pct = (k: keyof Split) => formatPct((args.split[k] / total) * 100, 0)
  const r = c.revenue
  const h = sim.homes
  const homes = h.every_home
    ? `enough to cover the electricity use of every home (about ${formatCompact(h.households)} households), with ${formatPct(h.left_over_share * 100, 0)} left over for business and industry`
    : `${formatPct(h.coverage * 100, 0)} of the country's ${formatCompact(h.households)} households`
  const rail = sim.rail.from
    ? `${formatInt(sim.rail.funded_km)} of ${formatInt(sim.rail.route_km)} km, ${sim.rail.from} → ${sim.rail.to}`
    : `${formatInt(sim.rail.funded_km)} km of new intercity rail`
  const twinEnd = twins?.forecast[twins.forecast.length - 1]
  const shockLines = Object.values(sim.shocks).map(
    (s) => `- **${s.label}:** savings ${formatMoney(s.before.fund)} → ${formatMoney(s.after.fund)}, solar ${formatCompact(s.before.solar_mw, 'MW')} → ${formatCompact(s.after.solar_mw, 'MW')}, access ${formatPct(s.before.access_pct)} → ${formatPct(s.after.access_pct)}.`,
  )
  const assumptionLines = Object.entries(specs).map(([k, s]) => {
    const v = overrides[k] ?? (k === 'household_size' ? sim.household_size : s.value)
    return `- ${s.label}: ${assumptionValue(s, v)}${k in overrides ? ' (edited)' : ''}`
  })

  return [
    `# ${c.name}: Nahda plan brief`,
    `${c.classification.label}. Generated ${(args.date ?? new Date()).toISOString().slice(0, 10)}. Real data from the World Bank and NASA POWER (each value with its latest available year); everything under "Results" and "Stress test" is a model estimate.`,
    '',
    '## Where it stands',
    `- Electricity access: ${formatPct(sim.start.access)} (latest available, ${sim.start.access_year}).`,
    `- Clean electricity: ${formatPct(sim.start.clean)} of all electricity (latest available, ${sim.start.clean_year}).`,
    r.avg != null && r.years
      ? `- ${c.resource[0].toUpperCase() + c.resource.slice(1)} income: ${formatMoney(r.avg)} a year, 5-year average (${r.years[0]}–${r.years[r.years.length - 1]}).`
      : '- Resource income: no data.',
    '',
    '## Plan settings',
    `- Invest ${formatPct(sim.share * 100, 0)} of ${c.resource} income: ${formatMoney(sim.pool, 2)} a year.`,
    `- Split: solar ${pct('solar')} (${formatMoney(sim.split_amounts.solar, 2)}), rail ${pct('rail')} (${formatMoney(sim.split_amounts.rail, 2)}), savings ${pct('fund')} (${formatMoney(sim.split_amounts.fund, 2)}) a year.`,
    sim.low_resource.is_low ? `- Resource income is a small share of this economy (${formatPct(sim.low_resource.rents_pct_gdp)} of GDP), so this plan has limited impact here.` : '',
    '',
    `## Results by ${endYear} (estimates)`,
    `- Solar built: ${formatCompact(y.solar_mw, 'MW')}; ${homes}.`,
    `- Electricity access: ${formatPct(y.access_pct)}. Clean electricity: ${formatPct(y.renewable_pct)}.`,
    `- Rail: ${rail}.`,
    `- Savings fund: ${formatMoney(y.fund)}, about ${formatNumber(sim.months_covered, 1)} months of ${c.resource} income.`,
    '',
    '## If nothing changes',
    twinEnd ? `- Historical twins suggest ${formatPct(twinEnd.access)} electricity access by ${twinEnd.year}.` : '',
    c.outlook ? `- Impact model predicts ${formatPct(c.outlook.access_in_10)} by ${c.outlook.year + 10}.` : '',
    '',
    '## Stress test',
    ...shockLines,
    `- ${sim.futures.runs} futures from ${sim.futures.history_years} ${sim.futures.resource} income history: at least 90% of planned spending happens in ${formatPct(sim.futures.p_funded * 100, 0)} of futures; in 9 of 10, electricity access reaches ${formatPct(sim.futures.access_p10)}.`,
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

import type { AssumptionSpec, Country, Simulation, Split, Twins } from '../api'
import { formatCompact, formatInt, formatMoney, formatNumber, formatPct } from './format'

export const LIMITATIONS = [
  'Assumes new power can reach homes through the grid; transmission and connection upgrades are not modelled.',
  'Storage for solar beyond daytime demand is not costed.',
  'Sector returns (rail, tourism & industry) and fuel reform effects use editable planning estimates, not measurements.',
  'Governance: the money has to reach the projects; weak institutions raise costs and delays.',
  'Fuel price reform ignores changes in how much fuel people buy; the current pump price is a placeholder to set per country.',
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
  const total = args.split.solar + args.split.rail + args.split.industry + args.split.fund || 1
  const pct = (k: keyof Split) => formatPct((args.split[k] / total) * 100, 0)
  const SECTOR_NAMES: Record<keyof Split, string> = { solar: 'Power (solar)', rail: 'Transport (rail)', industry: 'Tourism & industry', fund: 'Savings fund' }
  const sectorLines = (Object.keys(SECTOR_NAMES) as (keyof Split)[]).map((k) => {
    const e = sim.sectors[k]
    return `- **${SECTOR_NAMES[k]}:** ${k === 'fund' ? 'saved' : 'invested'} ${formatMoney(e.capex)}; returns ${formatMoney(e.annual_return)}/yr by ${endYear}; payback ${e.payback != null ? `${formatNumber(e.payback, 1)} years` : 'none needed (capital stays liquid)'}. ${e.basis}.`
  })
  const rf = sim.reform
  const full = rf ? Math.min(rf.phase_years, 10) - 1 : 0
  const relief = rf ? rf.rail_relief.indexOf(true) : -1
  const reformLines = rf
    ? [
        '',
        '## Fuel price reform (estimates)',
        `- Pump price from $${formatNumber(rf.price_now, 2)}/L (estimate) to $${formatNumber(rf.target_price, 2)}/L over ${rf.phase_years} years; ${formatPct(rf.rebate_share * 100, 0)} of savings returned as cash rebates.`,
        `- Subsidy freed: ${formatMoney(rf.freed[full])}/yr at full price; ${formatMoney(rf.kept[full])}/yr kept${rf.add_to_plan ? ' and added to the plan' : ''}.`,
        `- Consumer inflation: +${formatNumber(rf.peak_cpi * 100, 1)}% CPI per year during phase-in${rf.warning ? ' (above the warning threshold)' : ''}. Rebates lower household cost, not inflation.`,
        `- Net cost per household: ${formatMoney(rf.net_per_home_month[full])}/month after rebates.`,
        relief >= 0 ? `- Rail freight relief from ${startYear + relief + 1}, when the corridor is complete.` : '- No rail freight relief within 10 years: the corridor is not complete.',
      ]
    : []
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
    const v = overrides[k] ?? sim.country_defaults[k] ?? s.value
    return `- ${s.label}: ${assumptionValue(s, v)}${k in overrides ? ' (edited)' : ''}`
  })

  return [
    `# ${c.name}: pre-feasibility brief`,
    `${c.classification.label}. Generated ${(args.date ?? new Date()).toISOString().slice(0, 10)}. A capital allocation scenario for development finance institutions, NGOs and trade organizations, not a recommendation to any government. Real data from the World Bank and NASA POWER (each value with its latest available year); everything under "Results", "Sectors", "Fuel price reform" and "Stress test" is a model estimate.`,
    '',
    '## Where it stands',
    `- Electricity access: ${formatPct(sim.start.access)} (latest available, ${sim.start.access_year}).`,
    `- Clean electricity: ${formatPct(sim.start.clean)} of all electricity (latest available, ${sim.start.clean_year}).`,
    r.avg != null && r.years
      ? `- ${c.resource[0].toUpperCase() + c.resource.slice(1)} income: ${formatMoney(r.avg)} a year, 5-year average (${r.years[0]}–${r.years[r.years.length - 1]}).`
      : '- Resource income: no data.',
    '',
    '## Scenario settings',
    `- Invest ${formatPct(sim.share * 100, 0)} of ${c.resource} income: ${formatMoney(sim.pool, 2)} a year.`,
    `- Split: power ${pct('solar')} (${formatMoney(sim.split_amounts.solar, 2)}), transport ${pct('rail')} (${formatMoney(sim.split_amounts.rail, 2)}), tourism & industry ${pct('industry')} (${formatMoney(sim.split_amounts.industry, 2)}), savings ${pct('fund')} (${formatMoney(sim.split_amounts.fund, 2)}) a year.`,
    `- Solar sourcing: ${sim.supply.label} (build cost ×${formatNumber(sim.supply.capex_mult, 2)}). ${sim.supply.note}`,
    sim.low_resource.is_low ? `- Resource income is a small share of this economy (${formatPct(sim.low_resource.rents_pct_gdp)} of GDP), so this plan has limited impact here.` : '',
    '',
    `## Results by ${endYear} (estimates)`,
    `- Solar built: ${formatCompact(y.solar_mw, 'MW')}; ${homes}.`,
    `- Electricity access: ${formatPct(y.access_pct)}. Clean electricity: ${formatPct(y.renewable_pct)}.`,
    `- Rail: ${rail}.`,
    `- Savings fund: ${formatMoney(y.fund)}, about ${formatNumber(sim.months_covered, 1)} months of ${c.resource} income.`,
    '',
    `## Sectors: cost, yearly return and payback (estimates)`,
    ...sectorLines,
    ...reformLines,
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

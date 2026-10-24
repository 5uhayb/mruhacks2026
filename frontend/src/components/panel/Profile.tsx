import type { Country } from '../../api'
import { formatMoney, formatNumber, formatPct } from '../../lib/format'
import { Info, Section, Sparkline, Stat } from '../ui'

function percentileText(p: number, kind: string): string | null {
  if (kind === 'decline' || kind === 'diversify') return null
  return p >= 50 ? `Top ${Math.max(1, Math.round(100 - p))}%` : `Bottom ${Math.max(1, Math.round(p))}%`
}

function trendYears(country: Country): string {
  const years = country.facts.flatMap((f) => f.sparkline.map((p) => p.year))
  return years.length ? `${Math.min(...years)}–${Math.max(...years)}` : 'n/a'
}

export default function Profile({ country }: { country: Country }) {
  const s = country.stats
  const r = country.revenue
  return (
    <>
      <Section title="What stands out" right={`World percentile · 20-year trend (${trendYears(country)})`}>
        <ul className="space-y-4">
          {country.facts.map((f) => {
            const badge = percentileText(f.percentile, f.kind)
            return (
              <li key={f.text} className="flex items-start gap-4">
                <div className="flex-1">
                  <p className="text-[0.95rem] leading-snug">{f.text}</p>
                  <div className="text-faint num mt-1 text-[0.72rem]">
                    {badge && <span className="text-mute">{badge} of countries · </span>}World Bank, {f.year}
                  </div>
                </div>
                <Sparkline points={f.sparkline} unit={f.unit} />
              </li>
            )
          })}
        </ul>
      </Section>

      <Section title="Today">
        <div className="grid grid-cols-2 gap-x-6 gap-y-5">
          <Stat label="Has electricity" value={formatPct(s.electricity_access_pct)}
            sub={`Latest available: ${s.electricity_access_pct_year ?? 'n/a'}`} />
          <Stat label="Clean electricity" value={formatPct(s.renewable_electricity_pct)}
            sub={`Latest available: ${s.renewable_electricity_pct_year ?? 'n/a'}`} />
          <Stat
            label={`${country.resource} income per year`}
            value={formatMoney(r.avg)}
            sub={r.years
              ? `5-year average (${r.years[0]}–${r.years[r.years.length - 1]}) · ${formatMoney(r.per_person)} per person`
              : 'No resource income data'}
          />
          <Stat
            label="Sunlight"
            value={<>{formatNumber(country.sun.value, 1)}<span className="text-mute ml-1 text-[0.8rem]">kWh/m²/day</span></>}
            sub={country.sun.value && country.sun.oslo
              ? `${formatNumber(country.sun.value / country.sun.oslo, 1)}× Oslo · ${country.sun.site} · NASA average`
              : undefined}
          />
        </div>
        {r.low && r.high && r.range_years && (
          <p className="text-mute mt-4 text-[0.82rem]">
            Income swung from {formatMoney(r.low.revenue)} ({r.low.year}) to {formatMoney(r.high.revenue)} ({r.high.year}).{' '}
            <Info text={`${country.resource[0].toUpperCase() + country.resource.slice(1)} income = GDP × ${country.resource} rents (% of GDP), World Bank, for ${r.range_years[0]}–${r.range_years[1]}. Rents are profits for the whole economy, not government revenue.${r.range_years[1] < (s.electricity_access_pct_year ?? 0) ? ` Resource income data ends in ${r.range_years[1]}.` : ''}`} />
          </p>
        )}
      </Section>
    </>
  )
}

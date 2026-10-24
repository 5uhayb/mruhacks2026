import type { Country } from '../../api'
import { money, num, pct } from '../../format'
import { Section, Sparkline, Stat } from '../ui'

function percentileText(p: number, kind: string): string | null {
  if (kind === 'decline' || kind === 'diversify') return null
  return p >= 50 ? `Top ${Math.max(1, Math.round(100 - p))}%` : `Bottom ${Math.max(1, Math.round(p))}%`
}

export default function Profile({ country }: { country: Country }) {
  const s = country.stats
  const r = country.revenue
  return (
    <>
      <Section title="What stands out" right="World percentile · last 20 years">
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
                <Sparkline points={f.sparkline} />
              </li>
            )
          })}
        </ul>
      </Section>

      <Section title="Today">
        <div className="grid grid-cols-2 gap-x-6 gap-y-5">
          <Stat label={`Has electricity · ${s.electricity_access_pct_year ?? ''}`} value={pct(s.electricity_access_pct)} />
          <Stat label={`Clean electricity · ${s.renewable_electricity_pct_year ?? ''}`} value={pct(s.renewable_electricity_pct)} />
          <Stat
            label={`${country.resource} income · ${r.years ? `${r.years[0]}–${r.years[r.years.length - 1]} avg` : ''}`}
            value={money(r.avg)}
            sub={r.per_person != null ? `$${num(r.per_person)} per person a year` : 'No resource income data'}
          />
          <Stat
            label="Sunlight"
            value={<>{num(country.sun.value, 1)}<span className="text-mute ml-1 text-[0.8rem]">kWh/m²/day</span></>}
            sub={country.sun.value && country.sun.oslo ? `${(country.sun.value / country.sun.oslo).toFixed(1)}× Oslo · ${country.sun.site} (NASA)` : undefined}
          />
        </div>
        {r.low && r.high && (
          <p className="text-mute mt-4 text-[0.82rem]">
            {country.resource[0].toUpperCase() + country.resource.slice(1)} income ranged from {money(r.low.revenue)} ({r.low.year}) to {money(r.high.revenue)} ({r.high.year}) over the last 10 years of data.
          </p>
        )}
      </Section>
    </>
  )
}

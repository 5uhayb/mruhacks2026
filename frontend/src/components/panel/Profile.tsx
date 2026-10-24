import type { Country, Dated } from '../../api'
import { formatMoney, formatNumber, formatPct } from '../../lib/format'
import { Info, Section, Sparkline, Stat } from '../ui'

function percentileText(p: number, kind: string): string | null {
  if (kind === 'decline') return null
  return p >= 50 ? `Top ${Math.max(1, Math.round(100 - p))}%` : `Bottom ${Math.max(1, Math.round(p))}%`
}

const dated = (d: Dated, digits = 1) => ({ value: formatPct(d.value, digits), sub: d.year ? `Latest available: ${d.year}` : 'No data' })

export default function Profile({ country, onPlan }: { country: Country; onPlan: () => void }) {
  const p = country.profile
  const r = p.resources
  const b = country.budget
  const badge = (label: string) => country.badges.find((x) => x.label === label)
  const sun = badge('High solar potential')
  const wind = badge('Promising wind')
  return (
    <>
      {country.facts.length > 0 && (
        <Section title="What stands out">
          <ul className="space-y-4">
            {country.facts.map((f) => {
              const pct = percentileText(f.percentile, f.kind)
              return (
                <li key={f.text} className="flex items-start gap-4">
                  <div className="flex-1">
                    <p className="text-[0.95rem] leading-snug">{f.text}</p>
                    <div className="text-faint num mt-1 text-[0.72rem]">{pct && <span className="text-mute">{pct} of countries · </span>}World Bank, {f.year}</div>
                  </div>
                  <Sparkline points={f.sparkline} unit={f.unit} />
                </li>
              )
            })}
          </ul>
        </Section>
      )}

      <Section title="Electricity access">
        <div className="grid grid-cols-2 gap-x-6 gap-y-5">
          <Stat label="Total" {...dated(p.access)} />
          <Stat label="Clean share" {...dated(p.clean)} />
          <Stat label="Urban" {...dated(p.urban, 0)} />
          <Stat label="Rural" {...dated(p.rural, 0)} />
        </div>
      </Section>

      <Section title="Energy potential" right={<Info text="NASA POWER annual averages at the country's cached points (center, North, South, East, West, and named cities where available). Sunlight: ALLSKY_SFC_SW_DWN. Wind: WS50M, wind speed at 50 m; point estimates only, turbine sites need detailed local studies. Badge thresholds are editable in Plan → Assumptions." />}>
        <div className="grid grid-cols-2 gap-x-6 gap-y-5">
          <Stat label="Best solar" value={r.solar ? <>{formatNumber(r.solar.value, 2)}<span className="text-mute ml-1 text-[0.8rem]">kWh/m²/day</span></> : '—'}
            sub={r.solar ? `${r.solar.site} · NASA POWER` : undefined} />
          <Stat label="Best wind (50 m)" value={r.wind ? <>{formatNumber(r.wind.value, 2)}<span className="text-mute ml-1 text-[0.8rem]">m/s</span></> : '—'}
            sub={r.wind ? `${r.wind.site} · NASA POWER` : undefined} />
        </div>
        <div className="mt-3 flex flex-wrap gap-2">
          {sun && <span title={sun.rule} className="bg-gold/15 text-gold rounded px-2 py-0.5 text-[0.75rem]">☀ {sun.label}</span>}
          {wind && <span title={wind.rule} className="bg-cyan/15 text-cyan rounded px-2 py-0.5 text-[0.75rem]">{wind.label}</span>}
          {!sun && !wind && <span className="text-mute text-[0.8rem]">Neither resource passes its threshold; see Plan for the mix.</span>}
        </div>
      </Section>

      <Section title="Available budget" right={<button onClick={onPlan} className="hover:text-ink">Edit in Plan →</button>}>
        <div className="num text-gold text-[1.4rem]">{formatMoney(b.total, 2)} <span className="text-mute text-[0.85rem]">a year (estimate)</span></div>
        <div className="text-mute mt-1.5 space-y-0.5 text-[0.82rem]">
          <div>{formatPct(b.gdp.share * 100)} of GDP ({formatMoney(b.gdp.base)}, {b.gdp.year}) = {formatMoney(b.gdp.amount, 2)}</div>
          {b.resource.base > 0
            ? <div>+ {formatPct(b.resource.share * 100, 0)} of {b.resource.word} income ({formatMoney(b.resource.base)}/yr) = {formatMoney(b.resource.amount, 2)}</div>
            : <div>No resource income in the World Bank data.</div>}
        </div>
      </Section>
    </>
  )
}

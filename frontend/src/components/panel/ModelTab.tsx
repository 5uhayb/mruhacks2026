import { useState } from 'react'
import type { Country, Factor, Peers } from '../../api'
import { formatInt, formatNumber, formatPct } from '../../lib/format'
import { Section } from '../ui'

/** Plain subject for one factor, from its value */
function subject(name: string, f: Factor): string {
  const v = f.value
  switch (f.label) {
    case 'Current electricity access':
      return `${name}'s current access (${formatPct(v, 0)})`
    case 'Rural electricity access':
      return v == null ? 'Missing recent rural access data' : `Rural access of ${formatPct(v, 0)}`
    case '5-year connection trend':
      if (v == null) return `${name}'s connection trend`
      return v < -0.5 ? `${name}'s falling connection trend (${formatNumber(v, 1)} points in 5 years)`
        : v > 0.5 ? `${name}'s rising connection trend (+${formatNumber(v, 1)} points in 5 years)` : `${name}'s flat connection trend`
    case 'How much the country invests':
      return v == null ? 'Missing investment data' : `Investment of ${formatPct(v, 0)} of the economy`
    case 'Clean electricity share':
      return v == null ? 'The clean electricity share' : `A clean electricity share of ${formatPct(v)}`
    default:
      return f.label
  }
}

const people = (e: number) => `about ${formatNumber(Math.abs(e), 1)}% ${e < 0 ? 'fewer' : 'more'} people connected`

export default function ModelTab({ country }: { country: Country; peers: Peers | null }) {
  const [details, setDetails] = useState(false)
  const m = country.model_card
  const o = country.outlook
  const top = o && !o.no_gap ? o.factors.filter((f) => Math.abs(f.effect) >= 0.05).slice(0, 3) : []
  return (
    <>
      <Section title="Our forecast">
        {!o && <p className="text-mute text-[0.88rem]">Not enough data to forecast {country.name}.</p>}
        {o?.no_gap && <p className="text-[0.95rem]">Everyone in {country.name} already has power ({formatPct(o.access_now)} in {o.year}).</p>}
        {o && !o.no_gap && (
          <p className="text-[1rem] leading-snug">
            Without a new plan, about <span className="num text-gold">{formatPct(o.access_in_10, 0)}</span> of people in {country.name} will have power by {o.year + 10} (now {formatPct(o.access_now, 0)}, {o.year}).
          </p>
        )}
      </Section>

      {top.length > 0 && (
        <Section title="What's driving it">
          <ul className="space-y-2 text-[0.9rem] leading-snug">
            {top.map((f, i) => (
              <li key={f.label}>
                {i === 0
                  ? `${subject(country.name, f)} ${f.value == null ? `pulls the forecast ${f.effect < 0 ? 'down' : 'up'} the most` : `is the biggest thing ${f.effect < 0 ? 'holding it back' : 'speeding it up'}`} (${people(f.effect)}).`
                  : `${subject(country.name, f)} ${f.value == null ? `also pulls the forecast ${f.effect < 0 ? 'down' : 'up'}` : f.effect < 0 ? 'also holds it back' : 'also helps'} (${people(f.effect)}).`}
              </li>
            ))}
          </ul>
          <p className="text-faint mt-2 text-[0.72rem]">Only electricity factors: current access, rural access, 5-year connection trend, investment and clean share.</p>
        </Section>
      )}

      <Section title="How accurate is it?" right={<button onClick={() => setDetails(!details)} className="hover:text-ink">{details ? 'Hide details' : 'Details'}</button>}>
        <p className="text-[0.9rem] leading-snug">
          When we tested it on past countries, it was usually within about {formatNumber(m.all.mae, 1)}% of what really happened,
          about {formatNumber(m.all.baseline_mae / m.all.mae, 1)} times as accurate as assuming nothing changes.
        </p>
        {details && (
          <div className="text-mute mt-3 space-y-2 text-[0.78rem] leading-snug">
            <table className="num w-full">
              <thead>
                <tr className="text-faint text-left text-[0.68rem] uppercase">
                  <th className="pb-1 font-normal">Tested on</th><th className="pb-1 font-normal">Cases</th><th className="pb-1 font-normal">Typical miss</th>
                  <th className="pb-1 font-normal">No-change miss</th><th className="pb-1 font-normal">R²</th>
                </tr>
              </thead>
              <tbody>
                {[['All countries', m.all], ['Below 95% access', m.under_95]].map(([label, s]) => {
                  const sc = s as typeof m.all
                  return (
                    <tr key={label as string} className="border-edge border-t">
                      <td className="py-1 font-sans">{label as string}</td><td>{formatInt(sc.rows)}</td><td>{formatNumber(sc.mae, 2)}</td>
                      <td>{formatNumber(sc.baseline_mae, 2)}</td><td>{formatNumber(sc.r2, 2)}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
            <p>
              Gradient-boosted decision trees (LightGBM, explained with SHAP) learn from {m.countries} countries: trained on 10-year stretches starting {m.train_years},
              tested on stretches starting {m.test_years} that it never saw. Misses are in % of the population. It forecasts the share of people still
              without power who get connected, so it never goes above 100%; access fell in {formatPct(m.declines_share * 100)} of past cases, which it treats as no progress.
            </p>
          </div>
        )}
      </Section>
    </>
  )
}

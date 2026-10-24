import { Area, CartesianGrid, ComposedChart, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import type { Country, Twins } from '../../api'
import { formatMoney, formatPct } from '../../lib/format'
import { Section, Sparkline } from '../ui'

const AXIS = { stroke: '#4b5468', fontSize: 11, tickLine: false, axisLine: false, fontFamily: 'Geist Mono Variable' }

export default function TwinsTab({ country, twins }: { country: Country; twins: Twins | null }) {
  if (!twins) return <Section title="Historical twins"><p className="text-mute text-[0.85rem]">Searching history…</p></Section>
  const f = twins.forecast
  const end = f[f.length - 1]
  const data = f.map((p) => ({ year: p.year, access: p.access, range: [p.access_low, p.access_high] }))
  return (
    <>
      <Section title="Countries that were here before" right="Matched on a 5-year path of 5 indicators">
        <ul className="space-y-4">
          {twins.twins.map((t) => {
            const gdpChange = t.gdp_per_capita[t.gdp_per_capita.length - 1] / t.gdp_per_capita[0] - 1
            return (
              <li key={t.iso3} className="flex items-center gap-4">
                <div className="num text-cyan w-12 text-[1.2rem]">{Math.round(t.similarity)}%</div>
                <div className="flex-1">
                  <div className="text-[0.95rem]">{t.country} <span className="text-mute">in {t.year}</span></div>
                  <div className="text-mute text-[0.78rem]">
                    Next 10 years: access {formatPct(t.access[0])} → {formatPct(t.access[t.access.length - 1])}, income per person {gdpChange >= 0 ? '+' : ''}{Math.round(gdpChange * 100)}%
                  </div>
                </div>
                <Sparkline points={t.access.map((v, i) => ({ year: t.year + i, value: v }))} color="#5ec8e5" />
              </li>
            )
          })}
        </ul>
        <p className="text-faint mt-3 text-[0.75rem]">Similarity: 100% means an identical path; a typical country's closest match scores about 37%.</p>
      </Section>

      <Section title="What history suggests, without a plan" right="Weighted by similarity · band = range of the 3 twins">
        <p className="mb-3 text-[0.95rem] leading-snug">
          If {country.name} follows its twins, about <span className="text-cyan num">{formatPct(end.access)}</span> of people would have electricity by {end.year}
          {' '}(range {formatPct(end.access_low)}–{formatPct(end.access_high)}), and income per person would be about {formatMoney(end.gdp)}.
        </p>
        <div className="h-[150px]">
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={data} margin={{ top: 6, right: 8, left: -18, bottom: 0 }}>
              <CartesianGrid stroke="#1e2638" vertical={false} />
              <XAxis dataKey="year" {...AXIS} />
              <YAxis {...AXIS} domain={[0, 100]} ticks={[0, 50, 100]} tickFormatter={(v) => `${v}%`} />
              <Tooltip contentStyle={{ background: '#0d1320', border: '1px solid #1e2638', borderRadius: 6, fontSize: 12 }} formatter={(v) => (Array.isArray(v) ? `${formatPct(Number(v[0]))} – ${formatPct(Number(v[1]))}` : formatPct(Number(v)))} />
              <Area dataKey="range" stroke="none" fill="#5ec8e5" fillOpacity={0.12} animationDuration={600} />
              <Line dataKey="access" stroke="#5ec8e5" strokeWidth={2} dot={false} animationDuration={800} />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
        {country.outlook && (
          <p className="text-mute mt-3 text-[0.82rem]">
            The impact model, trained on {country.model_card.countries} countries, predicts {formatPct(country.outlook.access_in_10)} for the same year. See Model for why.
          </p>
        )}
      </Section>
    </>
  )
}

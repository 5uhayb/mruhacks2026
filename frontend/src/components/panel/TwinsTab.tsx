import { Area, CartesianGrid, ComposedChart, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import type { Country, Twins } from '../../api'
import { formatCompact, formatDelta, formatMoney, formatNumber, formatPct } from '../../lib/format'
import { Section, Sparkline } from '../ui'

const AXIS = { stroke: '#4b5468', fontSize: 11, tickLine: false, axisLine: false, fontFamily: 'Geist Mono Variable' }

/** y-axis that fits the data: from 10 below the lowest value to 5 above the highest, within 0–100 */
export function fitDomain(values: number[]): [number, number] {
  const lo = Math.max(0, Math.floor(Math.min(...values) - 10))
  const hi = Math.min(100, Math.ceil(Math.max(...values) + 5))
  return [lo, Math.max(hi, lo + 5)]
}

export default function TwinsTab({ country, twins }: { country: Country; twins: Twins | null }) {
  if (!twins) return <Section title="Historical twins"><p className="text-mute text-[0.85rem]">Searching history…</p></Section>
  const f = twins.forecast
  const end = f[f.length - 1]
  const data = f.map((p) => ({ year: p.year, access: p.access, range: [p.access_low, p.access_high] }))
  const domain = fitDomain(f.flatMap((p) => [p.access_low, p.access_high]))
  const o = country.outlook
  const modelYear = o ? o.year + 10 : null
  const gdpChange = (end.gdp / twins.gdp_now - 1) * 100
  const differ = o && Math.abs(o.access_in_10 - end.access) > 5
  return (
    <>
      <Section title="Countries that were here before" right="Matched on a 5-year path · population within 10×">
        <ul className="space-y-4">
          {twins.twins.map((t) => {
            const change = (t.gdp_per_capita[t.gdp_per_capita.length - 1] / t.gdp_per_capita[0] - 1) * 100
            return (
              <li key={t.iso3} className="flex items-center gap-4">
                <div className="num text-cyan w-12 text-[1.2rem]">{Math.round(t.similarity)}%</div>
                <div className="flex-1">
                  <div className="text-[0.95rem]">{t.country} <span className="text-mute">in {t.year} · population {formatCompact(t.population_then)}</span></div>
                  <div className="text-mute text-[0.78rem]">
                    {t.year}–{t.year + 10}: access {formatPct(t.access[0])} → {formatPct(t.access[t.access.length - 1])} · income per person {formatDelta(change)}
                  </div>
                </div>
                <Sparkline points={t.access.map((v, i) => ({ year: t.year + i, value: v }))} color="#5ec8e5" />
              </li>
            )
          })}
        </ul>
        <p className="text-faint mt-3 text-[0.75rem]">Similarity: 100% means an identical path; a typical country's closest match scores about 37%.</p>
      </Section>

      <Section title="If nothing changes: two independent methods">
        <div className="grid grid-cols-2 gap-3">
          <div className="border-edge rounded-md border p-3">
            <div className="label">Historical twins suggest</div>
            <div className="num text-cyan mt-1 text-[1.5rem]">{formatPct(end.access)}</div>
            <div className="text-mute text-[0.78rem]">by {end.year} · range {formatPct(end.access_low)}–{formatPct(end.access_high)}</div>
          </div>
          <div className="border-edge rounded-md border p-3">
            <div className="label">Impact model predicts</div>
            <div className="num mt-1 text-[1.5rem]">{o ? formatPct(o.access_in_10) : '—'}</div>
            <div className="text-mute text-[0.78rem]">{modelYear ? `by ${modelYear} · test error ±${formatNumber(country.model_card.under_95.mae, 1)} pts` : 'not enough data'}</div>
          </div>
        </div>
        {differ && (
          <p className="text-mute mt-2 text-[0.78rem] leading-snug">
            They differ because the twins copy what three similar countries actually did next, while the model averages patterns across {country.model_card.countries} countries.
          </p>
        )}
        <p className="mt-4 text-[0.92rem] leading-snug">
          Following its twins, electricity access would be about <span className="num text-cyan">{formatPct(end.access)}</span> by {end.year}{' '}
          ({formatDelta(end.access - twins.access_now, ' pts', 1)} vs today's {formatPct(twins.access_now)}), and income per person about{' '}
          {formatMoney(end.gdp)} ({formatDelta(gdpChange)} vs today's {formatMoney(twins.gdp_now)}).
        </p>
        <div className="mt-3 h-[150px]">
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={data} margin={{ top: 6, right: 8, left: -12, bottom: 0 }}>
              <CartesianGrid stroke="#1e2638" vertical={false} />
              <XAxis dataKey="year" {...AXIS} />
              <YAxis {...AXIS} domain={domain} tickFormatter={(v) => `${v}%`} allowDecimals={false} />
              <Tooltip contentStyle={{ background: '#0d1320', border: '1px solid #1e2638', borderRadius: 6, fontSize: 12 }}
                formatter={(v) => (Array.isArray(v) ? `${formatPct(Number(v[0]))} – ${formatPct(Number(v[1]))}` : formatPct(Number(v)))} />
              <Area dataKey="range" stroke="none" fill="#5ec8e5" fillOpacity={0.14} animationDuration={600} />
              <Line dataKey="access" stroke="#5ec8e5" strokeWidth={2} dot={false} animationDuration={800} />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
        <p className="text-faint mt-1 text-[0.72rem]">Electricity access, % of people · line = weighted twin forecast · band = range of the 3 twins</p>
      </Section>
    </>
  )
}

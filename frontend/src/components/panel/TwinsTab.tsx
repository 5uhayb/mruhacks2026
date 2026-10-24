import { useEffect, useState } from 'react'
import { Area, CartesianGrid, ComposedChart, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { getTwinCompare, type ChangeSpan, type Country, type Presets, type TwinCompare, type Twins } from '../../api'
import { formatDelta, formatMoney, formatNumber, formatPct } from '../../lib/format'
import { Flag, Info, Section, Sparkline } from '../ui'

const compareCache = new Map<string, Promise<TwinCompare>>()
const cachedCompare = (iso: string, twin: string) =>
  compareCache.get(`${iso}-${twin}`) ?? compareCache.set(`${iso}-${twin}`, getTwinCompare(iso, twin)).get(`${iso}-${twin}`)!

function span(c: ChangeSpan, unit: string) {
  if (c.from == null || c.to == null) return <span className="text-faint">no data</span>
  const f = (v: number) => (unit === 'US$' ? formatMoney(v) : formatPct(v))
  return <>{f(c.from)} → {f(c.to)} <span className="text-faint">({c.from_year}–{c.to_year})</span></>
}

/** What the twin did over the 10 years after its match, next to this country's own last 10 years */
function Compare({ country, twin }: { country: Country; twin: string }) {
  const [data, setData] = useState<TwinCompare | null>(null)
  const [failed, setFailed] = useState(false)
  useEffect(() => {
    let live = true
    cachedCompare(country.iso3, twin).then((d) => live && setData(d)).catch(() => live && setFailed(true))
    return () => {
      live = false
    }
  }, [country.iso3, twin])
  if (failed) return <p className="text-mute mt-2 text-[0.8rem]">Comparison unavailable.</p>
  if (!data) return <p className="text-mute mt-2 text-[0.8rem]">Comparing…</p>
  return (
    <div className="border-edge bg-space/40 fade mt-2 rounded-md border p-3">
      <div className="label mb-2">What {data.twin_name} did differently</div>
      {data.differences.length ? (
        <ol className="space-y-1.5 text-[0.84rem] leading-snug">
          {data.differences.map((d, i) => <li key={i}><span className="num text-cyan mr-1.5">{i + 1}</span>{d}</li>)}
        </ol>
      ) : <p className="text-mute text-[0.82rem]">Not enough shared data to compare.</p>}
      <table className="mt-3 w-full text-[0.76rem]">
        <thead>
          <tr className="text-faint text-left text-[0.66rem] uppercase">
            <th className="pb-1 font-normal">Indicator</th>
            <th className="pb-1 font-normal">{data.twin_name}, after match</th>
            <th className="pb-1 font-normal">{country.name}, last 10 yrs</th>
          </tr>
        </thead>
        <tbody className="num">
          {data.rows.map((r) => (
            <tr key={r.key} className="border-edge border-t" title={r.source}>
              <td className="text-mute py-1 pr-2 font-sans">{r.label[0].toUpperCase() + r.label.slice(1)} <span className="text-faint">{r.unit}</span></td>
              <td className="py-1 pr-2">{span(r.twin, r.unit)}</td>
              <td className="py-1">{span(r.own, r.unit)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="text-faint mt-2 text-[0.7rem]">World Bank data (hover a row for the indicator code). Ranked by how differently the two moved, relative to a typical 10-year change worldwide.</p>
    </div>
  )
}

const AXIS = { stroke: '#4b5468', fontSize: 11, tickLine: false, axisLine: false, fontFamily: 'Geist Mono Variable' }

/** y-axis that fits the data: from 10 below the lowest value to 5 above the highest, within 0–100 */
export function fitDomain(values: number[]): [number, number] {
  const lo = Math.max(0, Math.floor(Math.min(...values) - 10))
  const hi = Math.min(100, Math.ceil(Math.max(...values) + 5))
  return [lo, Math.max(hi, lo + 5)]
}

export default function TwinsTab({ country, twins, presets, onPlaybook }: { country: Country; twins: Twins | null; presets: Presets | null; onPlaybook: () => void }) {
  const [open, setOpen] = useState<string | null>(null)
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
      <Section title="Peer playbook" right={<Info text={`Twins: the 3 countries whose 5-year path (access, oil rents, income, clean power, urbanization, population) best matches ${country.name}'s latest 5 years, by dynamic time warping, population within 10×. Similarity 100% = identical path; a typical closest match scores about 37%. ${twins.rule}`} />}>
        <ul className="space-y-2.5">
          {twins.twins.map((t) => {
            const isOpen = open === t.iso3
            const best = presets?.playbook_peer === t.iso3
            return (
              <li key={t.iso3} className={`rounded-md border ${best ? 'border-gold/50' : 'border-edge'}`}>
                <button onClick={() => setOpen(isOpen ? null : t.iso3)} aria-expanded={isOpen} className="flex w-full items-start gap-3 p-3 text-left">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 text-[0.95rem]">
                      <Flag iso3={t.iso3} /><span className="font-medium">{t.country}</span>
                      <span title={twins.rule} className={`rounded px-1.5 py-0.5 text-[0.68rem] ${t.turnaround ? 'bg-cyan/15 text-cyan' : 'bg-edge text-mute'}`}>
                        {t.turnaround ? 'Turnaround peer' : 'Stagnated peer'}
                      </span>
                    </div>
                    <div className="num text-mute mt-1 text-[0.76rem]">
                      {Math.round(t.similarity)}% match · {t.year} · access {formatPct(t.access_then, 0)} · oil {t.oil_share_then != null ? `${formatPct(t.oil_share_then, 0)} of GDP` : 'no data'}
                    </div>
                    <div className="mt-0.5 text-[0.84rem]">{t.changed}</div>
                    <div className="text-mute mt-0.5 text-[0.78rem]">
                      Result: access {formatDelta(t.access_change, ' pts')} · income per person {formatDelta(t.income_change)}
                    </div>
                  </div>
                  <Sparkline points={t.access.map((v, i) => ({ year: t.year + i, value: v }))} color="#5ec8e5" unit="%" />
                  <span className="text-mute w-3 text-[0.8rem]">{isOpen ? '▴' : '▾'}</span>
                </button>
                {best && (
                  <div className="px-3 pb-3">
                    <button onClick={onPlaybook} className="border-gold text-gold hover:bg-gold hover:text-space rounded-md border px-3 py-1.5 text-[0.82rem] transition-colors">
                      Use {t.country}'s playbook →
                    </button>
                  </div>
                )}
                {isOpen && <div className="px-3 pb-3"><Compare country={country} twin={t.iso3} /></div>}
              </li>
            )
          })}
        </ul>
        <p className="text-faint mt-3 text-[0.75rem]">
          {presets && !presets.playbook_peer ? 'No turnaround peer among the closest matches, so no playbook.' : 'Click a peer to compare it with ' + country.name + '.'}
        </p>
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
        <p className="mt-3 text-[0.9rem] leading-snug">
          Following its twins: access <span className="num text-cyan">{formatPct(end.access)}</span>, income per person {formatMoney(end.gdp)} ({formatDelta(gdpChange)}) by {end.year}.{' '}
          <Info text={`Each twin's next-10-year change is applied to ${country.name} today (access ${formatPct(twins.access_now)}, income ${formatMoney(twins.gdp_now)}), weighted by similarity; the band is the range of the 3 twins.${differ ? ` The impact model differs because it averages patterns across ${country.model_card.countries} countries, while twins copy what 3 similar countries actually did.` : ''}`} />
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
        <p className="text-faint mt-1 text-[0.72rem]">Electricity access, %: line = twin forecast, band = range of the 3 twins.</p>
      </Section>
    </>
  )
}

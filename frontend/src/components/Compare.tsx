import { CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import type { HistoryRow, Latest } from '../api'
import { num, pct, usd } from '../format'
import { Card } from './Card'

const COLORS: Record<string, string> = { NOR: '#60a5fa', ARE: '#f472b6', BWA: '#2dd4bf' }
const MAIN = '#fbbf24'

const ROWS: { key: string; label: string; format: (v: number) => string; higherIsBetter: boolean }[] = [
  { key: 'gdp_per_capita_usd', label: 'GDP per person', format: usd, higherIsBetter: true },
  { key: 'oil_rents_pct_gdp', label: 'Oil share of economy', format: (v) => pct(v), higherIsBetter: false },
  { key: 'electricity_access_pct', label: 'Electricity access', format: (v) => pct(v), higherIsBetter: true },
  { key: 'renewable_energy_pct', label: 'Renewable energy', format: (v) => pct(v), higherIsBetter: true },
  { key: 'youth_unemployment_pct', label: 'Youth unemployment', format: (v) => pct(v), higherIsBetter: false },
  { key: 'investment_pct_gdp', label: 'Investment (% of GDP)', format: (v) => pct(v), higherIsBetter: true },
  { key: 'control_of_corruption', label: 'Control of corruption', format: (v) => num(v, 1), higherIsBetter: true },
]

export default function Compare({ latest, benchmarks, history }: {
  latest: Latest
  benchmarks: Latest[]
  history: HistoryRow[]
}) {
  const all = [latest, ...benchmarks]
  const colorOf = (iso3: string) => COLORS[iso3] ?? MAIN

  const years = [...new Set(history.map((h) => h.year))].sort()
  const series = years.map((year) => {
    const row: Record<string, number | null> = { year }
    for (const c of all) row[c.iso3] = history.find((h) => h.year === year && h.iso3 === c.iso3)?.gdp_per_capita_usd ?? null
    return row
  })

  return (
    <Card title="Learn from countries that got it right" subtitle="Latest World Bank data">
      <div className="grid gap-6 lg:grid-cols-2">
        <div className="space-y-3">
          {ROWS.map((r) => {
            const values = all.map((c) => (typeof c[r.key] === 'number' ? (c[r.key] as number) : null))
            const nums = values.filter((v): v is number => v != null)
            const min = Math.min(0, ...nums)
            const max = Math.max(...nums, 1e-9)
            return (
              <div key={r.key}>
                <div className="mb-1 text-xs text-slate-400">
                  {r.label} <span className="text-slate-600">({r.higherIsBetter ? 'higher' : 'lower'} is better)</span>
                </div>
                {all.map((c, i) => (
                  <div key={c.iso3} className="flex items-center gap-2 text-xs">
                    <span className="w-20 truncate text-slate-300">{c.country}</span>
                    <div className="h-2.5 flex-1 rounded bg-slate-800">
                      {values[i] != null && (
                        <div
                          className="h-full rounded"
                          style={{
                            width: `${Math.max(2, ((values[i]! - min) / (max - min)) * 100)}%`,
                            background: colorOf(c.iso3),
                          }}
                        />
                      )}
                    </div>
                    <span className="w-16 text-right font-mono text-slate-300">
                      {values[i] == null ? 'no data' : r.format(values[i]!)}
                    </span>
                  </div>
                ))}
              </div>
            )
          })}
        </div>
        <div>
          <div className="mb-1 text-sm text-slate-300">GDP per person over time (log scale)</div>
          <ResponsiveContainer width="100%" height={300}>
            <LineChart data={series} margin={{ right: 10 }}>
              <CartesianGrid stroke="#1e293b" vertical={false} />
              <XAxis dataKey="year" stroke="#64748b" fontSize={12} />
              <YAxis scale="log" domain={['auto', 'auto']} stroke="#64748b" fontSize={12} tickFormatter={usd} width={55} />
              <Tooltip
                contentStyle={{ background: '#0f172a', border: '1px solid #334155', borderRadius: 8 }}
                formatter={(v, name) => [usd(Number(v)), all.find((c) => c.iso3 === name)?.country ?? name]}
              />
              <Legend formatter={(iso3) => all.find((c) => c.iso3 === iso3)?.country ?? iso3} />
              {all.map((c) => (
                <Line
                  key={c.iso3}
                  dataKey={c.iso3}
                  stroke={colorOf(c.iso3)}
                  strokeWidth={c.iso3 === latest.iso3 ? 3 : 1.5}
                  dot={false}
                  connectNulls
                />
              ))}
            </LineChart>
          </ResponsiveContainer>
          <p className="mt-2 text-xs text-slate-400">
            Norway saves oil revenue in a national fund that invests abroad, now worth around $1.8 trillion. Botswana
            used diamond money to fund schools and roads. Both kept oil and diamond booms from wrecking the rest of the
            economy.
          </p>
        </div>
      </div>
    </Card>
  )
}

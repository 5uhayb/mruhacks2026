import { useState } from 'react'
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import type { Overview as OverviewData, Peer } from '../api'
import { AXIS, BarSpark, GRID, Metric, Note, Panel, Read, TOOLTIP, Why } from '../components/ui'
import { money, num, pct, smallPct } from '../format'

const BENCH_NAMES: Record<string, string> = { NOR: 'NOR', ARE: 'ARE', BWA: 'BWA' }

function AccessChart({ data, iso3 }: { data: OverviewData['energy']['access']; iso3: string }) {
  const years = [...new Set(Object.values(data).flatMap((s) => s.map((p) => p.year)))].sort()
  const rows = years.map((year) => {
    const row: Record<string, number | null> = { year }
    for (const [c, s] of Object.entries(data)) row[c] = s.find((p) => p.year === year)?.value ?? null
    return row
  })
  return (
    <ResponsiveContainer width="100%" height={110}>
      <LineChart data={rows} margin={{ top: 4, right: 28, left: -18, bottom: 0 }}>
        <CartesianGrid {...GRID} vertical={false} />
        <XAxis dataKey="year" {...AXIS} interval="preserveStartEnd" />
        <YAxis {...AXIS} domain={[0, 100]} ticks={[0, 50, 100]} />
        <Tooltip {...TOOLTIP} formatter={(v) => pct(Number(v))} />
        {Object.keys(data)
          .filter((c) => c !== iso3)
          .map((c) => (
            <Line key={c} dataKey={c} stroke="#4a4a4a" strokeWidth={1} dot={false} connectNulls isAnimationActive={false}
              label={false} name={BENCH_NAMES[c] ?? c} />
          ))}
        <Line dataKey={iso3} stroke="#e6e6e6" strokeWidth={1.5} dot={false} connectNulls isAnimationActive={false} name={iso3} />
      </LineChart>
    </ResponsiveContainer>
  )
}

type SortKey = keyof Pick<Peer, 'country' | 'revenue_avg' | 'revenue_per_person' | 'access_pct' | 'renewable_electricity_pct' | 'best_solar' | 'untapped'>

function Peers({ peers, iso3, formula, onSelect, selectable }: {
  peers: Peer[]
  iso3: string
  formula: string
  onSelect: (iso3: string) => void
  selectable: Set<string>
}) {
  const [sort, setSort] = useState<{ key: SortKey; desc: boolean }>({ key: 'untapped', desc: true })
  const sorted = [...peers].sort((a, b) => {
    const [x, y] = [a[sort.key] ?? -Infinity, b[sort.key] ?? -Infinity]
    const cmp = typeof x === 'string' ? x.localeCompare(String(y)) : Number(x) - Number(y)
    return sort.desc ? -cmp : cmp
  })
  const cols: { key: SortKey; label: string; title?: string; render: (p: Peer) => string }[] = [
    { key: 'country', label: 'Country', render: (p) => p.country },
    { key: 'revenue_avg', label: 'Rev 5Y', title: 'Resource revenue, 5-year average (GDP × oil rents)', render: (p) => money(p.revenue_avg) },
    { key: 'revenue_per_person', label: '$/Person', render: (p) => `$${num(p.revenue_per_person)}` },
    { key: 'access_pct', label: 'Access', title: 'World Bank EG.ELC.ACCS.ZS', render: (p) => pct(p.access_pct) },
    { key: 'renewable_electricity_pct', label: 'Renew Elec', title: 'World Bank EG.ELC.RNEW.ZS', render: (p) => smallPct(p.renewable_electricity_pct) },
    { key: 'best_solar', label: 'Best Sun', title: 'kWh/m²/day at best site, NASA POWER', render: (p) => num(p.best_solar, 2) },
    { key: 'untapped', label: 'Untapped', title: formula, render: (p) => num(p.untapped) },
  ]
  return (
    <table className="num w-full text-[12px]">
      <thead>
        <tr className="border-line border-b">
          <th className="text-dim pr-2 text-left font-normal">TKR</th>
          {cols.map((c) => (
            <th
              key={c.key}
              title={c.title}
              onClick={() => setSort({ key: c.key, desc: sort.key === c.key ? !sort.desc : true })}
              className={`cursor-pointer pr-2 font-normal uppercase select-none ${c.key === 'country' ? 'text-left' : 'text-right'} ${sort.key === c.key ? 'text-amb' : 'text-dim'}`}
            >
              {c.label}
              {sort.key === c.key ? (sort.desc ? ' ↓' : ' ↑') : ''}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {sorted.map((p, i) => (
          <tr
            key={p.iso3}
            onClick={() => selectable.has(p.iso3) && onSelect(p.iso3)}
            className={`${i % 2 ? 'bg-white/[0.03]' : ''} ${p.iso3 === iso3 ? 'text-amb' : 'text-ink'} ${selectable.has(p.iso3) ? 'cursor-pointer hover:bg-white/[0.06]' : ''}`}
          >
            <td className="pr-2">{p.iso3}</td>
            {cols.map((c) => (
              <td key={c.key} className={`pr-2 ${c.key === 'country' ? 'text-left font-sans' : 'text-right'}`}>
                {c.render(p)}
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  )
}

export default function Overview({ data, onSelect, selectable }: {
  data: OverviewData
  onSelect: (iso3: string) => void
  selectable: Set<string>
}) {
  const m = Object.fromEntries(data.metrics.map((x) => [x.key, x]))
  const rev = data.revenue
  const maxSolar = Math.max(data.potential.best_solar, ...data.potential.benchmarks.map((b) => b.solar))
  const solarRows = [
    { iso3: data.iso3, site: data.potential.best_site, solar: data.potential.best_solar },
    ...data.potential.benchmarks,
  ]
  return (
    <div className="grid grid-cols-12">
      <Panel title="Resource Revenue" right={`GDP × OIL RENTS · ${rev.years[0]}–${rev.years[rev.years.length - 1]}`} className="col-span-4">
        <div className="flex items-baseline gap-3">
          <span className="num text-ink text-[22px] font-medium" title="5-year average of GDP × oil rents % (World Bank NY.GDP.MKTP.CD × NY.GDP.PETR.RT.ZS)">
            {money(rev.avg)}
          </span>
          <span className="text-dim num text-[11px]">/YR · 5Y AVG</span>
          <span className="num text-ink ml-auto text-[13px]">${num(rev.per_person)}<span className="text-dim text-[11px]"> /PERSON</span></span>
        </div>
        <div className="mt-2">
          <BarSpark values={rev.history.map((r) => ({ year: r.year, value: r.revenue }))} highlight={rev.years} />
        </div>
        <div className="mt-2"><Note>{rev.note}</Note></div>
        <Why why={rev.why} />
        <Metric m={m.oil_rents_pct_gdp} />
        <Read>{rev.read}</Read>
      </Panel>

      <Panel title="Energy Gap" right="VS NOR · ARE · BWA (GREY)" className="col-span-4">
        <Metric m={m.electricity_access_pct} />
        <AccessChart data={data.energy.access} iso3={data.iso3} />
        <Metric m={m.renewable_electricity_pct} />
        <Read>{data.energy.read}</Read>
      </Panel>

      <Panel title="Untapped Potential" right="KWH/M²/DAY · NASA POWER" className="col-span-4">
        <table className="num w-full text-[12px]">
          <tbody>
            {solarRows.map((r) => (
              <tr key={r.iso3} title={data.potential.source}>
                <td className={`w-10 ${r.iso3 === data.iso3 ? 'text-amb' : 'text-dim'}`}>{r.iso3}</td>
                <td className="text-dim w-20 font-sans">{r.site}</td>
                <td className="px-2">
                  <div className="h-[6px]" style={{ width: `${(r.solar / maxSolar) * 100}%`, background: r.iso3 === data.iso3 ? '#e6e6e6' : '#4a4a4a' }} />
                </td>
                <td className="text-ink w-10 text-right">{num(r.solar, 2)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="mt-2"><Note>{data.potential.note}</Note></div>
        <Metric m={m.gdp_per_capita_usd} />
        <Metric m={m.government_effectiveness} />
        <Read>{data.potential.read}</Read>
      </Panel>

      <Panel title="Peers · Screener" right="CLICK A ROW TO LOAD · HOVER UNTAPPED FOR FORMULA" className="col-span-8">
        <Peers peers={data.peers} iso3={data.iso3} formula={data.untapped_formula} onSelect={onSelect} selectable={selectable} />
        <Read>{data.peers_read}</Read>
      </Panel>

      <Panel title="Overview · Read" className="col-span-4">
        <Note>{data.read.replace(/^READ: /, '')}</Note>
      </Panel>
    </div>
  )
}

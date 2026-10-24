import type { Overview } from '../api'
import { Big, Panel, Sparkline, Why } from '../components/ui'
import { money, num, pct, smallPct } from '../format'

export default function Situation({ data, onSelect, selectable }: {
  data: Overview
  onSelect: (iso3: string) => void
  selectable: Set<string>
}) {
  const t = data.tiles
  const max = Math.max(...t.oil.history.map((h) => h.revenue))
  return (
    <div className="grid grid-cols-12">
      <Panel title="Oil money" className="col-span-3">
        <Big label="Per year" value={money(t.oil.value)} line={t.oil.note} title={t.oil.source} />
        <Why why={t.oil.why} />
      </Panel>
      <Panel title="No electricity" className="col-span-3">
        <Big label={`Of people · ${t.no_power.year}`} value={pct(t.no_power.value)} line={t.no_power.note} title={t.no_power.source} />
        <div className="mt-2"><Sparkline points={t.no_power.sparkline} /></div>
      </Panel>
      <Panel title="Clean electricity" className="col-span-3">
        <Big label={`Of all power · ${t.clean.year}`} value={smallPct(t.clean.value)} line={t.clean.note} title={t.clean.source} />
        <div className="text-dim num mt-2 text-[11px]">NORWAY: {smallPct(t.clean.nor)}</div>
      </Panel>
      <Panel title="Best sunlight" className="col-span-3">
        <Big label={t.sun.site} value={<>{num(t.sun.value, 2)}<span className="text-dim text-[14px]"> kWh/m²/day</span></>} line={t.sun.note} title={t.sun.source} />
      </Panel>

      <Panel title="Oil money by year" right="BRIGHT BARS = YEARS IN THE AVERAGE" className="col-span-6">
        <div className="flex h-44 items-end gap-1">
          {t.oil.history.map((h) => (
            <div key={h.year} className="flex flex-1 flex-col items-center" title={`${h.year}: ${money(h.revenue)}`}>
              <span className="num text-dim mb-1 text-[9px]">{money(h.revenue, 0)}</span>
              <div className="w-full" style={{ height: `${(h.revenue / max) * 120}px`, background: t.oil.years.includes(h.year) ? '#e6e6e6' : '#3a3a3a' }} />
              <span className="num text-dim mt-1 text-[10px]">{String(h.year).slice(2)}</span>
            </div>
          ))}
        </div>
        <p className="mt-3 text-[13px]">Any plan funded from this needs savings for the bad years.</p>
      </Panel>

      <Panel title="Compare countries" right="CLICK TO SWITCH" className="col-span-6">
        <table className="num w-full text-[13px]">
          <thead>
            <tr className="text-dim border-line border-b text-[10px] uppercase">
              <th className="py-1 text-left font-normal">Country</th>
              <th className="text-right font-normal">Oil $/yr</th>
              <th className="text-right font-normal">Has power</th>
              <th className="text-right font-normal">Clean</th>
              <th className="text-right font-normal">Sun</th>
            </tr>
          </thead>
          <tbody>
            {data.peers.filter((p) => selectable.has(p.iso3)).map((p) => (
              <tr
                key={p.iso3}
                onClick={() => onSelect(p.iso3)}
                className={`cursor-pointer hover:bg-white/[0.06] ${p.iso3 === data.iso3 ? 'text-amb' : ''}`}
              >
                <td className="py-0.5 font-sans">{p.country}</td>
                <td className="text-right">{money(p.revenue_avg)}</td>
                <td className="text-right">{pct(p.access_pct, 0)}</td>
                <td className="text-right">{smallPct(p.renewable_electricity_pct)}</td>
                <td className="text-right">{num(p.best_solar, 1)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Panel>
    </div>
  )
}

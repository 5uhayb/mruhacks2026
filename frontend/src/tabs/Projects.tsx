import { useEffect, useState } from 'react'
import { CircleMarker, MapContainer, TileLayer, Tooltip, useMap } from 'react-leaflet'
import { getRail, type Deal, type PlanInput, type Rail, type Site } from '../api'
import { Big, Panel, Why } from '../components/ui'
import { money, num, rate } from '../format'

function FitToSites({ sites }: { sites: Site[] }) {
  const map = useMap()
  useEffect(() => {
    if (sites.length) map.fitBounds(sites.map((s) => [s.lat, s.lon] as [number, number]), { padding: [24, 24], maxZoom: 6 })
  }, [map, sites])
  return null
}

function SiteMap({ sites, selected, onSelect }: { sites: Site[]; selected: string; onSelect: (s: string) => void }) {
  const max = Math.max(...sites.map((s) => s.solar))
  const min = Math.min(...sites.map((s) => s.solar))
  return (
    <MapContainer center={[27, 17]} zoom={5} scrollWheelZoom={false} className="h-[360px] w-full">
      <TileLayer attribution="Tiles &copy; Esri" url="https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Base/MapServer/tile/{z}/{y}/{x}" />
      <FitToSites sites={sites} />
      {sites.map((s) => {
        const active = s.site === selected
        return (
          <CircleMarker
            key={s.site}
            center={[s.lat, s.lon]}
            radius={5 + ((s.solar - min) / (max - min || 1)) * 9}
            pathOptions={{ color: active ? '#ffb000' : '#808080', weight: 1, fillColor: active ? '#ffb000' : '#e6e6e6', fillOpacity: active ? 0.9 : 0.35 }}
            eventHandlers={{ click: () => onSelect(s.site) }}
          >
            <Tooltip>{s.site.toUpperCase()} · {s.solar.toFixed(2)} kWh/m²/day</Tooltip>
          </CircleMarker>
        )
      })}
    </MapContainer>
  )
}

function RailPanel({ input, sites }: { input: PlanInput; sites: Site[] }) {
  const cities = sites.map((s) => s.site)
  const [from, setFrom] = useState(cities.includes('Tripoli') ? 'Tripoli' : cities[0])
  const [to, setTo] = useState(cities.includes('Benghazi') ? 'Benghazi' : cities[1])
  const [rail, setRail] = useState<Rail | null>(null)
  useEffect(() => {
    if (from && to && from !== to) getRail(input, from, to).then(setRail)
  }, [input, from, to])
  const cheap = rail?.options[0]
  return (
    <Panel title="Rail between two cities" right="COST ONLY · BENEFITS NOT MODELLED" className="flex-1">
      <div className="mb-3 flex items-center gap-2">
        <select value={from} onChange={(e) => setFrom(e.target.value)}>{cities.map((c) => <option key={c}>{c}</option>)}</select>
        <span className="text-dim">→</span>
        <select value={to} onChange={(e) => setTo(e.target.value)}>{cities.map((c) => <option key={c}>{c}</option>)}</select>
      </div>
      {rail && cheap && (
        <div className="grid grid-cols-3 gap-4">
          <Big label="Track length" value={`${num(rail.route_km)} km`} size="text-[22px]" />
          <Big label="Cost (basic rail)" value={`${money(cheap.cost_min)}–${money(cheap.cost_max)}`} size="text-[22px]" />
          <Big
            label="Years to fund"
            value={rail.annual_rail_pool > 0 ? `${num(cheap.years_min)}–${num(cheap.years_max)}` : '—'}
            line={rail.annual_rail_pool > 0 ? `at ${money(rail.annual_rail_pool)}/yr` : 'No rail budget in the plan'}
            size="text-[22px]"
          />
        </div>
      )}
    </Panel>
  )
}

export default function Projects({ deal, sites, site, setSite, mw, setMw, input, iso3 }: {
  deal: Deal
  sites: Site[]
  site: string
  setSite: (s: string) => void
  mw: number
  setMw: (v: number) => void
  input: PlanInput
  iso3: string
}) {
  const pays = deal.npv > 0
  return (
    <div className="grid grid-cols-12">
      <div className="col-span-7 flex flex-col">
        <Panel title="Pick a solar site" right="BIGGER DOT = MORE SUN">
          <div className="mb-2 flex items-center gap-2 text-[12px]">
            <select value={site} onChange={(e) => setSite(e.target.value)}>
              {sites.map((s) => <option key={s.site} value={s.site}>{s.site} · {s.solar.toFixed(2)}</option>)}
            </select>
            <input type="number" className="w-20 text-right" value={mw} min={50} max={2000} step={50}
              onChange={(e) => setMw(Math.min(2000, Math.max(50, Number(e.target.value))))} />
            <span className="text-dim num">MW</span>
          </div>
          <SiteMap sites={sites} selected={site} onSelect={setSite} />
        </Panel>
        <RailPanel input={input} sites={sites} />
      </div>

      <div className="col-span-5 flex flex-col">
        <Panel title={`${num(deal.mw)} MW solar farm · ${deal.site}`}>
          <div className={`num mb-4 border-l-2 pl-3 text-[20px] font-semibold ${pays ? 'border-up text-up' : 'border-dn text-dn'}`}>
            {deal.payback == null ? 'NEVER PAYS BACK' : `PAYS BACK IN ${num(deal.payback, 1)} YEARS`}
          </div>
          <div className="grid grid-cols-3 gap-y-4">
            <Big label="Cost" value={money(deal.capex)} size="text-[22px]" />
            <Big label="Return (IRR)" value={rate(deal.irr)} line={`${rate(deal.irr_low)}–${rate(deal.irr_high)}`} size="text-[22px]" />
            <Big label="Value today" value={money(deal.npv)} line={`NPV at ${rate(deal.discount_rate)}`} size="text-[22px]" />
            <Big label="Power" value={`${num(deal.annual_mwh / 1000)} GWh`} line="per year" size="text-[22px]" />
            <Big label="Homes" value={`${num(deal.homes / 1000)}K`} line="powered" size="text-[22px]" />
          </div>
          <ul className="mt-4 space-y-1 text-[13px]">
            <li><span className="text-up">+</span> {deal.notes.pays}</li>
            <li><span className="text-dn">−</span> {deal.notes.breaks}</li>
          </ul>
          <Why why={deal.why} />
        </Panel>

        <Panel title="Same farm in Norway" className="flex-1">
          <div className="grid grid-cols-2 gap-4">
            <Big label={`${iso3} · cost of money ${rate(deal.discount_rate)}`} value={money(deal.npv)} line="value today" size="text-[22px]" />
            <Big label={`NOR · cost of money ${rate(deal.nor_discount_rate)}`} value={money(deal.npv_at_nor_rate)} line="value today" size="text-[22px]" />
          </div>
          <p className="mt-3 text-[13px]">{deal.notes.same_farm}</p>
        </Panel>
      </div>
    </div>
  )
}

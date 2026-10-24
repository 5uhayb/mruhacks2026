import { useEffect, useState } from 'react'
import { CircleMarker, MapContainer, TileLayer, Tooltip, useMap } from 'react-leaflet'
import { getRail, type Deal, type Overview, type PlanInput, type Rail } from '../api'
import { Cell, Note, Panel, Read, Why } from '../components/ui'
import { money, num, rate } from '../format'

function FitToSites({ sites }: { sites: Overview['sites'] }) {
  const map = useMap()
  useEffect(() => {
    if (sites.length) map.fitBounds(sites.map((s) => [s.lat, s.lon] as [number, number]), { padding: [24, 24], maxZoom: 6 })
  }, [map, sites])
  return null
}

function SiteMap({ sites, selected, onSelect }: { sites: Overview['sites']; selected: string; onSelect: (s: string) => void }) {
  const max = Math.max(...sites.map((s) => s.solar))
  const min = Math.min(...sites.map((s) => s.solar))
  return (
    <MapContainer center={[27, 17]} zoom={5} scrollWheelZoom={false} className="h-[380px] w-full">
      <TileLayer
        attribution="Tiles &copy; Esri"
        url="https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Base/MapServer/tile/{z}/{y}/{x}"
      />
      <FitToSites sites={sites} />
      {sites.map((s) => {
        const active = s.site === selected
        return (
          <CircleMarker
            key={s.site}
            center={[s.lat, s.lon]}
            radius={4 + ((s.solar - min) / (max - min || 1)) * 8}
            pathOptions={{ color: active ? '#ffb000' : '#808080', weight: 1, fillColor: active ? '#ffb000' : '#e6e6e6', fillOpacity: active ? 0.9 : 0.35 }}
            eventHandlers={{ click: () => onSelect(s.site) }}
          >
            <Tooltip>
              {s.site.toUpperCase()} · {s.solar.toFixed(2)} kWh/m²/day · wind {s.wind.toFixed(1)} m/s
            </Tooltip>
          </CircleMarker>
        )
      })}
    </MapContainer>
  )
}

function RailPanel({ input, sites }: { input: PlanInput; sites: Overview['sites'] }) {
  const cities = sites.map((s) => s.site)
  const [from, setFrom] = useState(cities.includes('Tripoli') ? 'Tripoli' : cities[0])
  const [to, setTo] = useState(cities.includes('Benghazi') ? 'Benghazi' : cities[1])
  const [rail, setRail] = useState<Rail | null>(null)
  useEffect(() => {
    if (from && to && from !== to) getRail(input, from, to).then(setRail)
  }, [input, from, to])

  return (
    <Panel title="Rail · City Pair" right="COST AND FUNDING TIMELINE ONLY">
      <div className="mb-2 flex items-center gap-2 text-[12px]">
        <select value={from} onChange={(e) => setFrom(e.target.value)}>
          {cities.map((c) => <option key={c}>{c}</option>)}
        </select>
        <span className="text-dim">→</span>
        <select value={to} onChange={(e) => setTo(e.target.value)}>
          {cities.map((c) => <option key={c}>{c}</option>)}
        </select>
        {rail && (
          <span className="num text-dim ml-auto text-[11px]">
            {num(rail.straight_km)} KM STRAIGHT · <span className="text-ink">{num(rail.route_km)} KM ROUTE</span>
          </span>
        )}
      </div>
      {rail && (
        <>
          <table className="num w-full text-[12px]">
            <thead>
              <tr className="text-dim border-line border-b text-[10px] uppercase">
                <th className="text-left font-normal">Rail type</th>
                <th className="text-right font-normal">$/km</th>
                <th className="text-right font-normal">Total cost</th>
                <th className="text-right font-normal">Years of rail budget</th>
              </tr>
            </thead>
            <tbody>
              {rail.options.map((o) => (
                <tr key={o.type} className="border-line border-b">
                  <td className="font-sans">{o.type}</td>
                  <td className="text-dim text-right">{money(o.cost_min / rail.route_km, 0)}–{money(o.cost_max / rail.route_km, 0)}</td>
                  <td className="text-right">{money(o.cost_min)}–{money(o.cost_max)}</td>
                  <td className="text-right">{o.years_min == null ? '—' : `${num(o.years_min, 1)}–${num(o.years_max, 1)}`}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="mt-2">
            <Note>
              {rail.annual_rail_pool > 0
                ? `At the current rail allocation of ${money(rail.annual_rail_pool)}/yr, the cheapest option takes ${num(rail.options[0].years_min, 1)}–${num(rail.options[0].years_max, 1)} years to fund. `
                : 'The current split puts nothing into rail, so there is no funding timeline. Raise Rail on tab 2. '}
              {rail.note}
            </Note>
          </div>
        </>
      )}
    </Panel>
  )
}

export default function Projects({ deal, sites, site, setSite, mw, setMw, input, iso3 }: {
  deal: Deal
  sites: Overview['sites']
  site: string
  setSite: (s: string) => void
  mw: number
  setMw: (v: number) => void
  input: PlanInput
  iso3: string
}) {
  return (
    <div className="grid grid-cols-12">
      <div className="col-span-7 flex flex-col">
        <Panel title="Solar Sites" right="NASA POWER · MARKER SIZE = SUNLIGHT">
          <div className="mb-2 flex items-center gap-2 text-[12px]">
            <span className="lbl">Site</span>
            <select value={site} onChange={(e) => setSite(e.target.value)}>
              {sites.map((s) => (
                <option key={s.site} value={s.site}>{s.site} · {s.solar.toFixed(2)}</option>
              ))}
            </select>
            <span className="lbl ml-3">Size</span>
            <input type="number" className="w-20 text-right" value={mw} min={50} max={2000} step={50}
              onChange={(e) => setMw(Math.min(2000, Math.max(50, Number(e.target.value))))} />
            <span className="text-dim num">MW</span>
          </div>
          <SiteMap sites={sites} selected={site} onSelect={setSite} />
        </Panel>
        <RailPanel input={input} sites={sites} />
      </div>

      <div className="col-span-5 flex flex-col">
        <Panel title={`Deal Card · ${deal.site}`} right={`${num(deal.mw)} MW · ${deal.solar_kwh.toFixed(2)} KWH/M²/DAY`}>
          <div className="border-line grid grid-cols-3 border-t border-l">
            <Cell label="CAPEX" value={money(deal.capex)} />
            <Cell label="Annual output" value={`${num(deal.annual_mwh / 1000)} GWh`} />
            <Cell label="Homes powered" value={num(deal.homes)} sub={`${(deal.share_of_national_use * 100).toFixed(1)}% of national use`} />
            <Cell label="IRR" value={rate(deal.irr)} sub={`${rate(deal.irr_low)} / ${rate(deal.irr_high)} low/high`} />
            <Cell label="NPV" value={money(deal.npv)} sub={`at ${rate(deal.discount_rate)}`} />
            <Cell label="Payback" value={deal.payback == null ? '—' : `${num(deal.payback, 1)} yrs`} />
          </div>
          <Why why={deal.why} />
          <div className="mt-2 space-y-2">
            <div><div className="lbl">What you're building</div><Note>{deal.notes.building}</Note></div>
            <div><div className="lbl">Why it pays</div><Note>{deal.notes.pays}</Note></div>
            <div><div className="lbl">What could break it</div><Note>{deal.notes.breaks}</Note></div>
          </div>
        </Panel>

        <Panel title="Sensitivity · IRR Across Each Range">
          <table className="num w-full text-[12px]">
            <thead>
              <tr className="text-dim border-line border-b text-[10px] uppercase">
                <th className="text-left font-normal">Assumption</th>
                <th className="text-right font-normal">At low</th>
                <th className="text-right font-normal">At high</th>
              </tr>
            </thead>
            <tbody>
              {deal.sensitivity.map((s, i) => (
                <tr key={s.key} className={i === 0 ? 'text-amb' : ''}>
                  <td className="font-sans">{s.label}</td>
                  <td className="text-right">{rate(s.irr_at_low)}</td>
                  <td className="text-right">{rate(s.irr_at_high)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <Read>READ: Base IRR {rate(deal.irr)}. The top row moves it most; that is the number to verify first.</Read>
        </Panel>

        <Panel title="Same Farm, Different Country" className="flex-1">
          <table className="num w-full text-[12px]">
            <thead>
              <tr className="text-dim border-line border-b text-[10px] uppercase">
                <th className="text-left font-normal" />
                <th className="text-right font-normal">{iso3}</th>
                <th className="text-right font-normal">NOR</th>
              </tr>
            </thead>
            <tbody>
              <tr><td className="text-dim font-sans">Cost of capital</td><td className="text-right">{rate(deal.discount_rate)}</td><td className="text-right">{rate(deal.nor_discount_rate)}</td></tr>
              <tr><td className="text-dim font-sans">IRR (same sun)</td><td className="text-right">{rate(deal.irr)}</td><td className="text-right">{rate(deal.irr)}</td></tr>
              <tr>
                <td className="text-dim font-sans">IRR − cost of capital</td>
                <td className={`text-right ${(deal.irr ?? 0) > deal.discount_rate ? 'text-up' : 'text-dn'}`}>{rate((deal.irr ?? 0) - deal.discount_rate)}</td>
                <td className={`text-right ${(deal.irr ?? 0) > deal.nor_discount_rate ? 'text-up' : 'text-dn'}`}>{rate((deal.irr ?? 0) - deal.nor_discount_rate)}</td>
              </tr>
              <tr><td className="text-dim font-sans">NPV</td><td className="text-right">{money(deal.npv)}</td><td className="text-right">{money(deal.npv_at_nor_rate)}</td></tr>
            </tbody>
          </table>
          <div className="mt-2"><Note>{deal.notes.same_farm}</Note></div>
        </Panel>
      </div>
    </div>
  )
}

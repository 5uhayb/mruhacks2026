import { useEffect } from 'react'
import { CircleMarker, MapContainer, TileLayer, Tooltip, useMap } from 'react-leaflet'
import type { Site } from '../api'
import { num, scoreColor } from '../format'
import { Card } from './Card'

function FitToSites({ sites }: { sites: Site[] }) {
  const map = useMap()
  useEffect(() => {
    if (sites.length) map.fitBounds(sites.map((s) => [s.lat, s.lon] as [number, number]), { padding: [30, 30], maxZoom: 6 })
  }, [map, sites])
  return null
}

export default function SiteMap({ sites, selected, onSelect }: {
  sites: Site[]
  selected: string | null
  onSelect: (site: string) => void
}) {
  const chosen = sites.find((s) => s.site === selected)
  return (
    <Card title="Solar & wind sites" subtitle="NASA satellite data. Click a site to build solar there.">
      <div className="h-72 overflow-hidden rounded-lg">
        <MapContainer center={[27, 17]} zoom={5} scrollWheelZoom={false} className="h-full w-full">
          <TileLayer
            attribution="Imagery &copy; Esri, Maxar, Earthstar Geographics"
            url="https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}"
          />
          <FitToSites sites={sites} />
          {sites.map((s) => (
            <CircleMarker
              key={s.site}
              center={[s.lat, s.lon]}
              radius={s.site === selected ? 13 : 8}
              pathOptions={{
                color: s.site === selected ? '#ffffff' : scoreColor(s.score),
                weight: s.site === selected ? 3 : 1,
                fillColor: scoreColor(s.score),
                fillOpacity: 0.85,
              }}
              eventHandlers={{ click: () => onSelect(s.site) }}
            >
              <Tooltip>
                <strong>{s.site}</strong> · score {num(s.score)}
                <br />☀️ {num(s.solar_kwh_m2_day, 1)} kWh/m²/day · 💨 {num(s.wind_50m_ms, 1)} m/s
              </Tooltip>
            </CircleMarker>
          ))}
        </MapContainer>
      </div>
      {chosen && (
        <div className="mt-3 text-sm">
          <div>
            Building at <strong>{chosen.site}</strong>
          </div>
          <div className="text-slate-400">
            ☀️ {num(chosen.solar_kwh_m2_day, 2)} kWh/m²/day · 💨 {num(chosen.wind_50m_ms, 1)} m/s ·{' '}
            <span style={{ color: scoreColor(chosen.score) }}>score {num(chosen.score)}</span>
          </div>
        </div>
      )}
    </Card>
  )
}

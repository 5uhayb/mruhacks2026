import type { ReactNode } from 'react'
import type { Country } from '../../api'
import { formatPct } from '../../lib/format'
import { Flag } from '../ui'

// Story order: where it stands → who closed a similar gap → the plan → does it survive → how it works
export const TABS = ['Profile', 'Peers', 'Plan', 'Stress', 'Model'] as const
export type Tab = (typeof TABS)[number]

export default function CountryPanel({ country, tab, setTab, onClose, onExport, children }: {
  country: Country | null
  tab: Tab
  setTab: (t: Tab) => void
  onClose: () => void
  /** Opens the printable brief; undefined until the plan has been simulated */
  onExport?: () => void
  children: ReactNode
}) {
  return (
    <aside className="bg-panel border-edge slide-in absolute top-[140px] right-4 bottom-[68px] z-20 flex w-[min(40vw,640px)] min-w-[440px] flex-col overflow-hidden rounded-md border">
      <header className="border-edge border-b px-5 pt-4">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 className="flex items-center gap-2.5 text-[1.5rem] leading-tight font-semibold tracking-tight">
              {country && <Flag iso3={country.iso3} />}{country?.name ?? 'Loading…'}
            </h2>
            {country && (
              <div className="text-mute mt-0.5 cursor-help text-[0.8rem] underline decoration-dotted underline-offset-4"
                title="Tiers by latest electricity access: Critical below 60%, Struggling 60–90%, Connected 90%+.">
                {country.tier} · {formatPct(country.profile.access.value)} access ({country.profile.access.year}) · {country.iso3}
              </div>
            )}
          </div>
          <div className="flex shrink-0 items-center gap-4">
            <button onClick={onExport} disabled={!onExport} className="border-edge hover:border-mute rounded-md border px-2.5 py-1 text-[0.78rem] disabled:opacity-40">
              Export brief
            </button>
            <button onClick={onClose} className="text-mute hover:text-ink text-[0.8rem]" aria-label="Close panel">Close <kbd className="num border-edge ml-1 rounded border px-1 text-[0.65rem]">Esc</kbd></button>
          </div>
        </div>
        <nav className="mt-3 flex gap-5" aria-label="Sections">
          {TABS.map((t) => (
            <button key={t} onClick={() => setTab(t)}
              className={`-mb-px border-b-2 pb-2 text-[0.85rem] transition-colors ${t === tab ? 'border-ink text-ink' : 'text-mute hover:text-ink border-transparent'}`}>
              {t}
            </button>
          ))}
        </nav>
      </header>
      <div className="scroll-thin flex-1 overflow-y-auto">{children}</div>
    </aside>
  )
}

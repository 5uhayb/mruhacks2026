import type { ReactNode } from 'react'
import type { Country } from '../../api'

export const TABS = ['Profile', 'Plan', 'Twins', 'Stress', 'Model'] as const
export type Tab = (typeof TABS)[number]

export default function CountryPanel({ country, tab, setTab, onClose, children }: {
  country: Country | null
  tab: Tab
  setTab: (t: Tab) => void
  onClose: () => void
  children: ReactNode
}) {
  return (
    <aside className="bg-panel border-edge slide-in absolute top-[68px] right-4 bottom-4 z-20 flex w-[min(40vw,640px)] min-w-[440px] flex-col overflow-hidden rounded-md border">
      <header className="border-edge border-b px-5 pt-4">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 className="text-[1.5rem] leading-tight font-semibold tracking-tight">{country?.name ?? 'Loading…'}</h2>
            {country && (
              <div className="text-mute mt-0.5 cursor-help text-[0.8rem] underline decoration-dotted underline-offset-4" title={country.classification.rules}>
                {country.classification.label}
              </div>
            )}
          </div>
          <button onClick={onClose} className="text-mute hover:text-ink text-[0.8rem]" aria-label="Close panel">Close <kbd className="num border-edge ml-1 rounded border px-1 text-[0.65rem]">Esc</kbd></button>
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

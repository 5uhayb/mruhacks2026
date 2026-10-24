import { useRef } from 'react'
import { SECTORS, type Sector, type Split } from '../../api'
import { formatMoney } from '../../lib/format'

const STYLE: Record<Sector, { label: string; color: string }> = {
  solar: { label: 'Solar', color: '#f2a93b' },
  rail: { label: 'Rail', color: '#9a7a45' },
  fund: { label: 'Savings', color: '#4b5468' },
}

/** One bar split three ways; drag the two round handles to move money between solar, rail and savings */
export default function SplitBar({ split, setSplit, amounts }: { split: Split; setSplit: (s: Split) => void; amounts: Split | null }) {
  const bar = useRef<HTMLDivElement>(null)
  const total = SECTORS.reduce((s, k) => s + split[k], 0) || 1
  const solar = (split.solar / total) * 100
  const rail = (split.rail / total) * 100
  const cut1 = solar
  const cut2 = solar + rail

  function drag(handle: 1 | 2) {
    return (e: React.PointerEvent<HTMLButtonElement>) => {
      e.preventDefault()
      const el = e.currentTarget
      el.setPointerCapture(e.pointerId)
      const move = (ev: PointerEvent) => {
        const r = bar.current!.getBoundingClientRect()
        const x = Math.round(Math.min(100, Math.max(0, ((ev.clientX - r.left) / r.width) * 100)))
        if (handle === 1) {
          const c1 = Math.min(x, cut2)
          setSplit({ solar: c1, rail: cut2 - c1, fund: 100 - cut2 })
        } else {
          const c2 = Math.max(x, cut1)
          setSplit({ solar: cut1, rail: c2 - cut1, fund: 100 - c2 })
        }
      }
      const up = () => {
        el.removeEventListener('pointermove', move)
        el.removeEventListener('pointerup', up)
      }
      el.addEventListener('pointermove', move)
      el.addEventListener('pointerup', up)
    }
  }

  return (
    <div>
      <div ref={bar} className="relative mt-5 h-3 rounded-full">
        <div className="absolute inset-0 flex overflow-hidden rounded-full">
          {SECTORS.map((k) => (
            <div key={k} style={{ width: `${(split[k] / total) * 100}%`, background: STYLE[k].color }} />
          ))}
        </div>
        {[1, 2].map((h) => (
          <button
            key={h}
            onPointerDown={drag(h as 1 | 2)}
            aria-label={h === 1 ? 'Divider between solar and rail' : 'Divider between rail and savings'}
            className="border-panel bg-ink absolute top-1/2 h-5 w-5 -translate-x-1/2 -translate-y-1/2 cursor-ew-resize touch-none rounded-full border-[3px] shadow transition-transform hover:scale-110 active:scale-110"
            style={{ left: `${h === 1 ? cut1 : cut2}%` }}
          />
        ))}
      </div>
      <div className="mt-3 grid grid-cols-3 gap-2 text-[0.8rem]">
        {SECTORS.map((k) => (
          <div key={k}>
            <span className="mr-1.5 inline-block h-2 w-2 rounded-full align-middle" style={{ background: STYLE[k].color }} />
            <span className="text-mute">{STYLE[k].label}</span>{' '}
            <span className="num">{Math.round((split[k] / total) * 100)}%</span>
            {amounts && <span className="num text-faint ml-1">{formatMoney(amounts[k], 2)}</span>}
          </div>
        ))}
      </div>
      <p className="text-faint mt-1 text-[0.72rem]">Drag the round handles to change the split.</p>
    </div>
  )
}

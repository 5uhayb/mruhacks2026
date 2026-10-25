import { useRef } from 'react'
import { SECTORS, type Sector, type Split } from '../../api'
import { formatMoney } from '../../lib/format'

export const SECTOR_STYLE: Record<Sector, { label: string; color: string }> = {
  solar: { label: 'Power (Solar & Grid)', color: '#f2a93b' },
  rail: { label: 'Transportation', color: '#9a7a45' },
  industry: { label: 'Tourism & Economy', color: '#5ec8e5' },
  fund: { label: 'Savings fund', color: '#4b5468' },
}

/** One bar split four ways; drag the round handles to move money between neighbouring sectors */
export default function SplitBar({ split, setSplit, amounts }: { split: Split; setSplit: (s: Split) => void; amounts: Split | null }) {
  const bar = useRef<HTMLDivElement>(null)
  const total = SECTORS.reduce((s, k) => s + split[k], 0) || 1
  const shares = SECTORS.map((k) => (split[k] / total) * 100)
  // cuts[i] = where sector i ends (cumulative %)
  const cuts = shares.slice(0, -1).map((_, i) => shares.slice(0, i + 1).reduce((a, b) => a + b, 0))

  function drag(handle: number) {
    return (e: React.PointerEvent<HTMLButtonElement>) => {
      e.preventDefault()
      const el = e.currentTarget
      el.setPointerCapture(e.pointerId)
      const move = (ev: PointerEvent) => {
        const r = bar.current!.getBoundingClientRect()
        const x = Math.round(Math.min(100, Math.max(0, ((ev.clientX - r.left) / r.width) * 100)))
        const next = [...cuts]
        next[handle] = Math.min(Math.max(x, handle > 0 ? cuts[handle - 1] : 0), handle < cuts.length - 1 ? cuts[handle + 1] : 100)
        const edges = [0, ...next, 100]
        setSplit(Object.fromEntries(SECTORS.map((k, i) => [k, edges[i + 1] - edges[i]])) as Split)
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
      <div ref={bar} className="relative mt-4 h-3 rounded-full">
        <div className="absolute inset-0 flex overflow-hidden rounded-full">
          {SECTORS.map((k, i) => (
            <div key={k} style={{ width: `${shares[i]}%`, background: SECTOR_STYLE[k].color }} />
          ))}
        </div>
        {cuts.map((c, i) => (
          <button
            key={i}
            onPointerDown={drag(i)}
            aria-label={`Divider between ${SECTOR_STYLE[SECTORS[i]].label} and ${SECTOR_STYLE[SECTORS[i + 1]].label}`}
            className="border-panel bg-ink absolute top-1/2 h-5 w-5 -translate-x-1/2 -translate-y-1/2 cursor-ew-resize touch-none rounded-full border-[3px] shadow transition-transform hover:scale-110 active:scale-110"
            style={{ left: `${c}%` }}
          />
        ))}
      </div>
      <div className="mt-3 grid grid-cols-2 gap-x-3 gap-y-1 text-[0.8rem]">
        {SECTORS.map((k, i) => (
          <div key={k} className="flex items-baseline gap-1.5">
            <span className="inline-block h-2 w-2 shrink-0 rounded-full" style={{ background: SECTOR_STYLE[k].color }} />
            <span className="text-mute">{SECTOR_STYLE[k].label}</span>
            <span className="num">{Math.round(shares[i])}%</span>
            {amounts && <span className="num text-faint">{formatMoney(amounts[k], 2)}/yr</span>}
          </div>
        ))}
      </div>
    </div>
  )
}

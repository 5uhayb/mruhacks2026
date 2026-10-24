import { useState } from 'react'

/** Printable one-page brief. Renders the Markdown as simple document text; copy or print it. */
export default function Brief({ markdown, onClose }: { markdown: string; onClose: () => void }) {
  const [copied, setCopied] = useState(false)
  const lines = markdown.split('\n')
  return (
    <div className="brief-backdrop fixed inset-0 z-50 grid place-items-center bg-black/60 p-6" onClick={onClose}>
      <div className="brief-sheet bg-panel border-edge flex max-h-[90vh] w-[760px] max-w-full flex-col rounded-md border" onClick={(e) => e.stopPropagation()}>
        <div className="brief-actions border-edge flex items-center justify-between gap-3 border-b px-5 py-3">
          <span className="label">Export brief</span>
          <div className="flex gap-2">
            <button
              onClick={async () => {
                await navigator.clipboard.writeText(markdown)
                setCopied(true)
                setTimeout(() => setCopied(false), 1500)
              }}
              className="border-edge hover:border-mute rounded-md border px-3 py-1.5 text-[0.82rem]"
            >
              {copied ? 'Copied' : 'Copy as Markdown'}
            </button>
            <button onClick={() => window.print()} className="border-gold text-gold hover:bg-gold hover:text-space rounded-md border px-3 py-1.5 text-[0.82rem]">
              Print / Save as PDF
            </button>
            <button onClick={onClose} className="text-mute hover:text-ink px-2 text-[0.82rem]">Close</button>
          </div>
        </div>
        <article className="brief-doc scroll-thin overflow-y-auto px-8 py-6 text-[0.88rem] leading-relaxed">
          {lines.map((line, i) => {
            const bold = (t: string) => t.split(/\*\*(.+?)\*\*/g).map((part, j) => (j % 2 ? <strong key={j}>{part}</strong> : part))
            if (line.startsWith('# ')) return <h1 key={i} className="text-[1.4rem] font-semibold">{line.slice(2)}</h1>
            if (line.startsWith('## ')) return <h2 key={i} className="label mt-5 mb-1.5">{line.slice(3)}</h2>
            if (line.startsWith('- ')) return <p key={i} className="ml-3 -indent-3">· {bold(line.slice(2))}</p>
            if (!line) return null
            return <p key={i} className="text-mute mt-1 text-[0.8rem]">{bold(line)}</p>
          })}
        </article>
      </div>
    </div>
  )
}

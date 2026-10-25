import { useEffect, useState } from 'react'
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { getPeerWeb, type Country, type Peer, type Peers, type WebPart } from '../../api'
import { formatPct } from '../../lib/format'
import { Flag, Info, Section, Sparkline } from '../ui'

const AXIS = { stroke: '#4b5468', fontSize: 11, tickLine: false, axisLine: false, fontFamily: 'Geist Mono Variable' }
const LINES = [
  { key: 'total', label: 'Total access', color: '#f2a93b' },
  { key: 'rural', label: 'Rural', color: '#5ec8e5' },
  { key: 'urban', label: 'Urban', color: '#8a94a8' },
  { key: 'clean', label: 'Clean share', color: '#7bd88f' },
] as const

const webCache = new Map<string, Promise<WebPart>>()

/** "What [peer] did": one example from Google Search, cached per peer; says so plainly when no source is found */
function WhatTheyDid({ iso3, peer }: { iso3: string; peer: Peer }) {
  const [web, setWeb] = useState<WebPart | null>(null)
  useEffect(() => {
    let live = true
    const key = `${peer.iso3}-${peer.year}`
    const job = webCache.get(key) ?? webCache.set(key, getPeerWeb(iso3, peer.iso3, peer.year)).get(key)!
    job.then((w) => live && setWeb(w)).catch(() => live && setWeb({ unavailable: 'the web lookup did not answer' }))
    return () => {
      live = false
    }
  }, [iso3, peer])
  return (
    <div className="border-edge rounded-md border p-3">
      <div className="label text-cyan mb-1">What {peer.country} did · From the web</div>
      {!web && <p className="text-mute text-[0.82rem]">Looking for a sourced example…</p>}
      {web?.text && (
        <>
          <p className="text-[0.84rem] leading-snug">{web.text}</p>
          <ol className="mt-2 space-y-0.5 text-[0.74rem]">
            {web.sources?.map((s, i) => <li key={i}><a href={s.url} target="_blank" rel="noreferrer" className="text-cyan hover:underline">{i + 1}. {s.title}</a></li>)}
          </ol>
        </>
      )}
      {web?.unavailable && (
        <p className="text-mute text-[0.82rem] leading-snug">No sourced example: {web.unavailable}. We don't show one rather than guess.</p>
      )}
    </div>
  )
}

function Detail({ country, peer, isPlaybookPeer, onPlaybook, onBack }: {
  country: Country
  peer: Peer
  isPlaybookPeer: boolean
  onPlaybook: () => void
  onBack: () => void
}) {
  const d = peer.detail
  return (
    <Section title={`${peer.country}, ${d.years[0]}–${d.years[1]}`} right={<button onClick={onBack} className="hover:text-ink">← All peers</button>}>
      <div className="space-y-4">
        <div>
          <p className="text-[0.9rem] leading-snug">{peer.match.story}</p>
          <table className="text-faint num mt-2 w-full text-[0.74rem]">
            <thead>
              <tr className="text-left"><th className="pb-0.5 font-normal" /><th className="pb-0.5 font-normal">{peer.match.me}</th><th className="pb-0.5 font-normal">{peer.match.them}</th></tr>
            </thead>
            <tbody>
              {peer.match.rows.map((r) => (
                <tr key={r.label} className="border-edge border-t"><td className="py-0.5 pr-2 font-sans">{r.label}</td><td>{r.me}</td><td>{r.them}</td></tr>
              ))}
            </tbody>
          </table>
          {peer.match.difference && <p className="text-mute mt-1.5 text-[0.8rem]">{peer.match.difference}</p>}
        </div>
        <div className="h-[180px]">
          <div className="text-mute mb-1 flex flex-wrap gap-x-3 text-[0.72rem]">
            {LINES.map((l) => <span key={l.key}><span className="mr-1 inline-block h-[2px] w-3 align-middle" style={{ background: l.color }} />{l.label}</span>)}
          </div>
          <ResponsiveContainer width="100%" height="88%">
            <LineChart data={d.series} margin={{ top: 6, right: 8, left: -12, bottom: 0 }}>
              <CartesianGrid stroke="#1e2638" vertical={false} />
              <XAxis dataKey="year" {...AXIS} />
              <YAxis {...AXIS} domain={[0, 100]} tickFormatter={(v) => `${v}%`} />
              <Tooltip contentStyle={{ background: '#0d1320', border: '1px solid #1e2638', borderRadius: 6, fontSize: 12 }}
                formatter={(v, n) => [formatPct(Number(v)), LINES.find((l) => l.key === n)?.label ?? String(n)]} />
              {LINES.map((l) => <Line key={l.key} dataKey={l.key} stroke={l.color} strokeWidth={l.key === 'total' ? 2.5 : 1.5} dot={false} connectNulls animationDuration={500} />)}
            </LineChart>
          </ResponsiveContainer>
        </div>

        <div>
          <div className="label mb-1.5">What changed · World Bank data</div>
          <ul className="space-y-1 text-[0.85rem] leading-snug">{d.bullets.map((b) => <li key={b}>• {b}</li>)}</ul>
        </div>

        {d.tradeoff && (
          <div className="border-gold/50 bg-gold/10 rounded-md border px-3 py-2 text-[0.84rem] leading-snug">
            <span className="text-gold">Trade-off: </span>{d.tradeoff}
          </div>
        )}

        <WhatTheyDid iso3={country.iso3} peer={peer} />

        <div className="border-edge rounded-md border p-3">
          <div className="label mb-1">Lesson for {country.name}</div>
          <p className="text-[0.88rem] leading-snug">{peer.lesson}</p>
          {isPlaybookPeer && (
            <button onClick={onPlaybook} className="border-gold text-gold hover:bg-gold hover:text-space mt-2.5 rounded-md border px-3 py-1.5 text-[0.82rem] transition-colors">
              Use {peer.country}'s playbook →
            </button>
          )}
        </div>
      </div>
    </Section>
  )
}

/** Peers that closed their electricity gap: a ranked list, and a detail view for each */
export default function PeersTab({ country, peers, onPlaybook }: { country: Country; peers: Peers | null; onPlaybook: () => void }) {
  const [open, setOpen] = useState<string | null>(null)
  if (!peers) return <Section title="Peers"><p className="text-mute text-[0.85rem]">Searching history…</p></Section>
  const chosen = peers.peers.find((p) => p.iso3 === open)
  if (chosen) {
    return <Detail country={country} peer={chosen} isPlaybookPeer={peers.playbook?.peer === chosen.iso3} onPlaybook={onPlaybook} onBack={() => setOpen(null)} />
  }
  return (
    <Section title="Peers that closed the gap" right={<Info text={peers.rule} label="Selection rule" />}>
      {peers.peers.length === 0 ? (
        <p className="text-[0.9rem]">No peer meets the rule for {country.name} (access {formatPct(peers.access_now)}).</p>
      ) : (
        <>
          {peers.top && <p className="mb-3 text-[0.9rem] leading-snug">{peers.top}</p>}
          <ul className="space-y-2.5">
            {peers.peers.map((p, i) => (
              <li key={p.iso3}>
                <button onClick={() => setOpen(p.iso3)} className={`hover:border-mute w-full rounded-md border p-3 text-left transition-colors ${i === 0 ? 'border-gold/50' : 'border-edge'}`}>
                  <div className="flex items-start gap-3">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 text-[0.9rem]">
                        <span className="num text-faint text-[0.72rem]">#{i + 1}</span>
                        <Flag iso3={p.iso3} /><span className="font-medium">{p.country}</span>
                        <span className="num text-mute text-[0.76rem]">{p.year} · {Math.round(p.similarity)}% similar · started at {formatPct(p.access[0], 0)}</span>
                      </div>
                      <div className="mt-1 text-[0.84rem] leading-snug">{p.match.story}</div>
                      <div className="text-mute mt-0.5 text-[0.78rem]">{p.result}</div>
                    </div>
                    <Sparkline points={p.access.map((v, j) => ({ year: p.year + j, value: v }))} color="#5ec8e5" unit="%" />
                    <span className="text-mute text-[0.8rem]">›</span>
                  </div>
                </button>
              </li>
            ))}
          </ul>
          <p className="text-faint mt-3 text-[0.75rem]">Click a peer for its 10-year story and the lesson for {country.name}.</p>
        </>
      )}
    </Section>
  )
}

import type { Country, Peers } from '../../api'
import { formatPct } from '../../lib/format'
import { Flag, Info, Section, Sparkline } from '../ui'

/** Peers that closed their electricity gap, each in 3 lines, with the top peer's playbook */
export default function PeersTab({ country, peers, onPlaybook }: { country: Country; peers: Peers | null; onPlaybook: () => void }) {
  if (!peers) return <Section title="Peers"><p className="text-mute text-[0.85rem]">Searching history…</p></Section>
  return (
    <Section title="Peers that closed the gap" right={<Info text={peers.rule} label="Selection rule" />}>
      {peers.peers.length === 0 ? (
        <p className="text-[0.9rem]">No peer meets the rule for {country.name} (access {formatPct(peers.access_now)}).</p>
      ) : (
        <ul className="space-y-2.5">
          {peers.peers.map((p) => {
            const top = peers.playbook?.peer === p.iso3
            return (
              <li key={p.iso3} className={`rounded-md border p-3 ${top ? 'border-gold/50' : 'border-edge'}`}>
                <div className="flex items-start gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 text-[0.9rem]">
                      <Flag iso3={p.iso3} /><span className="font-medium">{p.country}</span>
                      <span className="num text-mute text-[0.76rem]">{p.year} · {Math.round(p.similarity)}% match · started at {formatPct(p.access[0], 0)}</span>
                    </div>
                    <div className="mt-1 text-[0.84rem]">{p.changed}</div>
                    <div className="text-mute mt-0.5 text-[0.78rem]">{p.result}</div>
                  </div>
                  <Sparkline points={p.access.map((v, i) => ({ year: p.year + i, value: v }))} color="#5ec8e5" unit="%" />
                </div>
                {top && peers.playbook && (
                  <button onClick={onPlaybook} className="border-gold text-gold hover:bg-gold hover:text-space mt-2.5 rounded-md border px-3 py-1.5 text-[0.82rem] transition-colors">
                    Use {p.country}'s playbook →
                  </button>
                )}
              </li>
            )
          })}
        </ul>
      )}
      {peers.playbook && (
        <p className="text-faint mt-3 text-[0.75rem]">
          Playbook: {peers.playbook.line} <Info text={peers.playbook_rule} />
        </p>
      )}
    </Section>
  )
}

import type { Country, Twins } from '../../api'
import { formatNumber, formatPct } from '../../lib/format'
import { Section } from '../ui'

function Shap({ outlook }: { outlook: NonNullable<Country['outlook']> }) {
  const max = Math.max(...outlook.factors.map((f) => Math.abs(f.effect)), 0.1)
  return (
    <div className="space-y-2">
      {outlook.factors.map((f) => (
        <div key={f.label} className="grid grid-cols-[1fr_200px_56px] items-center gap-3 text-[0.82rem]">
          <span className="text-mute truncate">{f.label}</span>
          <div className="relative h-3">
            <div className="bg-edge absolute top-0 bottom-0 left-1/2 w-px" />
            <div className="absolute top-0 bottom-0 rounded-sm"
              style={{ left: f.effect >= 0 ? '50%' : `${50 - (Math.abs(f.effect) / max) * 50}%`, width: `${(Math.abs(f.effect) / max) * 50}%`, background: f.effect >= 0 ? '#e8ecf3' : '#4b5468' }} />
          </div>
          <span className={`num text-right ${f.effect >= 0 ? '' : 'text-mute'}`}>{f.effect >= 0 ? '+' : '−'}{Math.abs(f.effect).toFixed(1)}</span>
        </div>
      ))}
    </div>
  )
}

export default function ModelTab({ country, twins }: { country: Country; twins: Twins | null }) {
  const m = country.model_card
  const o = country.outlook
  return (
    <>
      <Section title="Why the model predicts this" right="SHAP, percentage points">
        {o ? (
          <>
            <p className="mb-3 text-[0.92rem] leading-snug">
              Predicted change in electricity access over 10 years: <span className="num">{o.change >= 0 ? '+' : ''}{o.change.toFixed(1)} pts</span>,
              from {formatPct(o.access_now)} ({o.year}) to <span className="num">{formatPct(o.access_in_10)}</span>. Bars show which factors push it up or down.
            </p>
            <Shap outlook={o} />
          </>
        ) : (
          <p className="text-mute text-[0.85rem]">Not enough data for this country.</p>
        )}
      </Section>

      <Section title="Model card · impact model">
        <dl className="grid grid-cols-2 gap-x-6 gap-y-3 text-[0.85rem]">
          <div><dt className="label">Algorithm</dt><dd className="mt-0.5">LightGBM, 400 trees</dd></div>
          <div><dt className="label">Predicts</dt><dd className="mt-0.5">10-year change in electricity access</dd></div>
          <div><dt className="label">Training data</dt><dd className="num mt-0.5">{m.countries} countries · {m.first_year}–{m.last_year} · {formatNumber(m.rows)} rows</dd></div>
          <div><dt className="label">Split (by time)</dt><dd className="num mt-0.5">train {m.train_years} · test {m.test_years}</dd></div>
          <div><dt className="label">Test R²</dt><dd className="num mt-0.5 text-[1.2rem]">{m.r2.toFixed(2)}</dd></div>
          <div><dt className="label">Test error (MAE)</dt><dd className="num mt-0.5 text-[1.2rem]">{m.mae.toFixed(1)} pts</dd></div>
        </dl>
        <p className="text-mute mt-3 text-[0.8rem] leading-snug">
          Trained on {formatNumber(m.train_rows)} starting points, tested on {formatNumber(m.test_rows)} later ones. No test year overlaps a training outcome.
          Guessing "no change" would be off by {m.baseline_no_change_mae.toFixed(1)} points; the model is off by {m.mae.toFixed(1)}.
        </p>
      </Section>

      <Section title="Pipeline">
        <ol className="num text-mute space-y-1.5 text-[0.78rem]">
          <li><span className="text-ink">Data</span> · World Bank panel, {m.countries} countries, forward-filled within country · NASA sunlight per country</li>
          <li><span className="text-cyan">Twins</span> · DTW over {twins ? formatNumber(twins.windows_searched) : 'about 3,000'} five-year windows, best match per country</li>
          <li><span className="text-ink">Impact</span> · LightGBM + SHAP, time-split evaluation</li>
          <li><span className="text-gold">Optimizer</span> · grid search over splits, ≥80% of futures funded</li>
          <li><span className="text-down">Stress</span> · 500 block-bootstrap futures from the country's own income history</li>
        </ol>
      </Section>
    </>
  )
}

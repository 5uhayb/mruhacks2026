import type { Country, Scores, Twins } from '../../api'
import { formatDelta, formatInt, formatNumber, formatPct } from '../../lib/format'
import { Info, Section } from '../ui'

const pts = (v: number) => `${v >= 0 ? '+' : '−'}${formatNumber(Math.abs(v), 1)} pts`

function Shap({ outlook }: { outlook: NonNullable<Country['outlook']> }) {
  const max = Math.max(...outlook.factors.map((f) => Math.abs(f.effect)), 0.1)
  const factorsSum = outlook.factors.reduce((s, f) => s + f.effect, 0)
  return (
    <>
      {/* The arithmetic, visibly: baseline + factors = prediction */}
      <div className="border-edge num mb-4 grid grid-cols-3 rounded-md border text-center text-[0.8rem]">
        <div className="border-edge border-r px-2 py-2"><div className="text-mute text-[0.7rem]">Model baseline</div>{pts(outlook.baseline_pts)}</div>
        <div className="border-edge border-r px-2 py-2"><div className="text-mute text-[0.7rem]">This country's factors</div>{pts(factorsSum)}</div>
        <div className="px-2 py-2"><div className="text-mute text-[0.7rem]">Prediction</div><span className="text-ink">{pts(outlook.raw_change)}</span></div>
      </div>
      <div className="space-y-2">
        {outlook.factors.map((f) => (
          <div key={f.label} className="grid grid-cols-[minmax(0,1fr)_170px_70px] items-center gap-3 text-[0.82rem]">
            <span className="text-mute">{f.label}</span>
            <div className="relative h-3">
              <div className="bg-edge absolute top-0 bottom-0 left-1/2 w-px" />
              <div className="absolute top-0 bottom-0 rounded-sm"
                style={{ left: f.effect >= 0 ? '50%' : `${50 - (Math.abs(f.effect) / max) * 50}%`, width: `${(Math.abs(f.effect) / max) * 50}%`, background: f.effect >= 0 ? '#e8ecf3' : '#4b5468' }} />
            </div>
            <span className={`num text-right ${f.effect >= 0 ? '' : 'text-mute'}`}>{pts(f.effect)}</span>
          </div>
        ))}
      </div>
      {outlook.clipped && (
        <p className="text-mute mt-3 text-[0.78rem]">The raw prediction fell outside what is possible, so the forecast is capped at {formatPct(outlook.access_in_10)}.</p>
      )}
    </>
  )
}

function Metrics({ title, s, sentence }: { title: string; s: Scores; sentence: string }) {
  return (
    <div className="border-edge rounded-md border p-3">
      <div className="mb-2 flex items-baseline justify-between">
        <span className="text-[0.85rem]">{title}</span>
        <span className="num text-faint text-[0.72rem]">{formatInt(s.rows)} test windows</span>
      </div>
      <div className="num grid grid-cols-4 gap-2 text-[0.8rem]">
        <div><div className="label">MAE</div>{formatNumber(s.mae, 1)} pts</div>
        <div><div className="label">No-change MAE</div>{formatNumber(s.baseline_mae, 1)} pts</div>
        <div><div className="label">Error cut</div>{formatDelta(-s.error_reduction * 100)}</div>
        <div><div className="label">R²</div>{formatNumber(s.r2, 2)}</div>
      </div>
      <p className="text-mute mt-2 text-[0.78rem] leading-snug">{sentence.split('. ')[0].replace(/\.$/, '')}. <Info text={sentence} /></p>
    </div>
  )
}

export default function ModelTab({ country, twins }: { country: Country; twins: Twins | null }) {
  const m = country.model_card
  const o = country.outlook
  return (
    <>
      <div className="border-edge border-b px-5 py-4">
        <div className="label text-cyan">Supervised learning</div>
        <p className="mt-1 text-[0.95rem] leading-snug">
          Gradient-boosted decision trees (LightGBM) trained on historical country panel data to predict the share of the electricity gap closed over 10 years.
        </p>
      </div>
      <Section title="What drives this forecast">
        <p className="text-mute -mt-1 mb-3 text-[0.8rem]">How much each factor pushes the 10-year prediction up or down (percentage points).</p>
        {!o && <p className="text-mute text-[0.85rem]">Not enough data for this country.</p>}
        {o?.no_gap && <p className="text-[0.92rem]">No gap left to close: {formatPct(o.access_now)} of people already have electricity ({o.year}). Baseline and prediction are both 0 pts.</p>}
        {o && !o.no_gap && (
          <>
            <p className="mb-3 text-[0.92rem] leading-snug">
              From {formatPct(o.access_now)} ({o.year}) to <span className="num">{formatPct(o.access_in_10)}</span> by {o.year + 10}: the model closes{' '}
              {formatPct((o.change / o.gap) * 100, 0)} of the remaining {formatNumber(o.gap, 1)}-point gap.
            </p>
            <Shap outlook={o} />
          </>
        )}
      </Section>

      <Section title="How accurate is it" right={`Tested on ${m.test_years}, trained on ${m.train_years}`}>
        <div className="space-y-3">
          <Metrics title="All countries" s={m.all}
            sentence={`On unseen years, predictions were off by ${formatNumber(m.all.mae, 1)} points on average, ${formatPct(m.all.error_reduction * 100, 0)} better than assuming no change. R² is helped by the many countries already at 100%, which are easy to predict.`} />
          <Metrics title="Countries below 95% access at the start" s={m.under_95}
            sentence={`Where the forecast matters, the error is larger (${formatNumber(m.under_95.mae, 1)} points) but still ${formatPct(m.under_95.error_reduction * 100, 0)} below assuming no change. The model explains ${formatPct(m.under_95.r2 * 100, 0)} of the variation here: useful, not precise.`} />
        </div>
      </Section>

      <Section title="Model card">
        <dl className="grid grid-cols-2 gap-x-6 gap-y-3 text-[0.85rem]">
          <div><dt className="label">Algorithm</dt><dd className="mt-0.5">LightGBM, 400 trees · SHAP</dd></div>
          <div><dt className="label">Predicts</dt><dd className="mt-0.5">Share of the remaining electricity gap closed in 10 years</dd></div>
          <div><dt className="label">Data</dt><dd className="num mt-0.5">{m.countries} countries · {m.first_year}–{m.last_year} · {formatInt(m.rows)} rows</dd></div>
          <div><dt className="label">Split by time</dt><dd className="num mt-0.5">train {m.train_years} ({formatInt(m.train_rows)}) · test {m.test_years}</dd></div>
        </dl>
        <p className="text-mute mt-3 text-[0.78rem] leading-snug">
          Tested only on years it never trained on. <Info text={`No test year overlaps a training outcome. Forecasts are bounded to 0–100% by design. Access fell in ${formatPct(m.declines_share * 100)} of training windows; the model treats those as no progress, so it cannot predict a decline.`} />
        </p>
      </Section>

      <Section title="Pipeline">
        <ol className="num text-mute space-y-1.5 text-[0.78rem]">
          <li><span className="text-ink">Data</span> · World Bank panel, {m.countries} countries, forward-filled within country · NASA sunlight per country</li>
          <li><span className="text-cyan">Twins</span> · DTW over {twins ? formatInt(twins.windows_searched) : 'about 3,000'} five-year windows, best match per country</li>
          <li><span className="text-ink">Impact</span> · LightGBM + SHAP, time-split evaluation</li>
          <li><span className="text-gold">Optimizer</span> · grid search over splits, ≥80% of futures funded</li>
          <li><span className="text-down">Stress</span> · 500 block-bootstrap futures from the country's own income history</li>
        </ol>
      </Section>
    </>
  )
}

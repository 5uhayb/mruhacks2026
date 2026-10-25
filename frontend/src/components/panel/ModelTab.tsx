import type { Country, Peers, Scores } from '../../api'
import { formatDelta, formatInt, formatNumber, formatPct } from '../../lib/format'
import { Info, Section } from '../ui'

/** Change in the share of people with electricity, in plain words: "+12.8%" (percentage points of the population) */
const more = (v: number) => `${v >= 0 ? '+' : '−'}${formatNumber(Math.abs(v), 1)}%`

function Drivers({ country, outlook }: { country: Country; outlook: NonNullable<Country['outlook']> }) {
  const max = Math.max(...outlook.factors.map((f) => Math.abs(f.effect)), 0.1)
  const factorsSum = outlook.factors.reduce((s, f) => s + f.effect, 0)
  return (
    <>
      {/* The arithmetic, visibly: a typical country + what's different = forecast */}
      <div className="border-edge mb-4 grid grid-cols-3 rounded-md border text-[0.8rem]">
        <div className="border-edge border-r px-3 py-2">
          <div className="text-ink">A typical country</div>
          <div className="text-mute mt-0.5 leading-snug">connects about <span className="num text-ink">{more(outlook.baseline_pts)}</span> more of its people over 10 years.</div>
        </div>
        <div className="border-edge border-r px-3 py-2">
          <div className="text-ink">What's different about {country.name}</div>
          <div className="text-mute mt-0.5 leading-snug">{factorsSum < 0 ? 'slows' : 'speeds'} this up by <span className="num text-ink">{more(Math.abs(factorsSum))}</span>.</div>
        </div>
        <div className="px-3 py-2">
          <div className="text-ink">10-year forecast without a new plan</div>
          <div className="text-mute mt-0.5 leading-snug">
            <span className="num text-ink">{more(outlook.change)}</span> more people connected ({formatPct(outlook.access_now)} → {formatPct(outlook.access_in_10)} by {country.outlook!.year + 10}).
          </div>
        </div>
      </div>
      <div className="text-faint mb-1 grid grid-cols-[minmax(0,1fr)_170px_70px] gap-3 text-[0.7rem]">
        <span />
        <span className="flex justify-between"><span>← Slows progress</span><span>Speeds up progress →</span></span>
        <span />
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
            <span className={`num text-right ${f.effect >= 0 ? '' : 'text-mute'}`}>{more(f.effect)}</span>
          </div>
        ))}
      </div>
      {outlook.clipped && (
        <p className="text-mute mt-3 text-[0.78rem]">The raw forecast fell outside what is possible, so it is capped at {formatPct(outlook.access_in_10)}.</p>
      )}
      <p className="text-faint mt-3 text-[0.7rem]">Factor effects are SHAP values from a LightGBM model, in percent of the population.</p>
    </>
  )
}

function Accuracy({ title, s, sentence }: { title: string; s: Scores; sentence: string }) {
  return (
    <div className="border-edge rounded-md border p-3">
      <div className="mb-2 flex items-baseline justify-between">
        <span className="text-[0.85rem]">{title}</span>
        <span className="num text-faint text-[0.72rem]">{formatInt(s.rows)} test cases</span>
      </div>
      <div className="num grid grid-cols-3 gap-2 text-[0.8rem]">
        <div><div className="label">Typical miss</div>{formatNumber(s.mae, 1)}%</div>
        <div><div className="label">If we assume no change</div>{formatNumber(s.baseline_mae, 1)}%</div>
        <div><div className="label">Error cut</div>{formatDelta(-s.error_reduction * 100)}</div>
      </div>
      <p className="text-mute mt-2 text-[0.78rem] leading-snug">{sentence.split('. ')[0].replace(/\.$/, '')}. <Info text={`${sentence} Technical: MAE ${formatNumber(s.mae, 2)} vs ${formatNumber(s.baseline_mae, 2)} for no change; R² ${formatNumber(s.r2, 2)}.`} /></p>
    </div>
  )
}

export default function ModelTab({ country, peers }: { country: Country; peers: Peers | null }) {
  const m = country.model_card
  const o = country.outlook
  return (
    <>
      <div className="border-edge border-b px-5 py-4">
        <div className="text-[1rem]">What happens without a new plan?</div>
        <p className="text-mute mt-1 text-[0.85rem] leading-snug">A forecast learned from how {m.countries} countries actually changed over 10-year stretches.</p>
        <p className="text-faint mt-1 text-[0.7rem]">Supervised learning: gradient-boosted decision trees (LightGBM) predicting the share of the electricity gap closed over 10 years.</p>
      </div>
      <Section title="What drives this forecast">
        {!o && <p className="text-mute text-[0.85rem]">Not enough data for this country.</p>}
        {o?.no_gap && <p className="text-[0.92rem]">Everyone already has electricity ({formatPct(o.access_now)} in {o.year}), so there is no gap left to close.</p>}
        {o && !o.no_gap && <Drivers country={country} outlook={o} />}
      </Section>

      <Section title="How accurate is it" right={`Tested on ${m.test_years}, learned from ${m.train_years}`}>
        <div className="space-y-3">
          <Accuracy title="All countries" s={m.all}
            sentence={`On years it never saw, the forecast missed by ${formatNumber(m.all.mae, 1)}% of the population on average, ${formatPct(m.all.error_reduction * 100, 0)} better than assuming no change. Many countries are already at 100%, which are easy to forecast.`} />
          <Accuracy title="Countries still connecting people" s={m.under_95}
            sentence={`Where it matters most (below 95% access), the miss is larger, ${formatNumber(m.under_95.mae, 1)}%, but still ${formatPct(m.under_95.error_reduction * 100, 0)} better than assuming no change. Useful as a guide, not a precise prediction.`} />
        </div>
      </Section>

      <Section title="About the forecast">
        <dl className="grid grid-cols-2 gap-x-6 gap-y-3 text-[0.85rem]">
          <div><dt className="label">Forecasts</dt><dd className="mt-0.5">Share of people still without power who get connected in 10 years</dd></div>
          <div><dt className="label">Learned from</dt><dd className="num mt-0.5">{m.countries} countries · {m.first_year}–{m.last_year}</dd></div>
        </dl>
        <p className="text-mute mt-3 text-[0.78rem] leading-snug">
          Tested only on years it never learned from. <Info text={`Algorithm: LightGBM, 400 trees, explained with SHAP. Trained on ${m.train_years} (${formatInt(m.train_rows)} cases), tested on ${m.test_years}; no test year overlaps a training outcome. Forecasts are bounded to 0–100%. Access fell in ${formatPct(m.declines_share * 100)} of training cases; the model treats those as no progress, so it cannot forecast a decline.`} />
        </p>
      </Section>

      <Section title="How it's built">
        <ol className="text-mute space-y-1.5 text-[0.78rem]">
          <li><span className="text-ink">Data</span> · World Bank figures for {m.countries} countries, including urban and rural access · NASA sun and wind readings</li>
          <li><span className="text-cyan">Peers</span> · countries with the most similar 5-year path that went on to connect many more people{peers ? ` (${formatInt(peers.windows_searched)} candidates)` : ''}</li>
          <li><span className="text-ink">Forecast</span> · the model above, checked on years it never saw</li>
          <li><span className="text-gold">Plan</span> · solar, wind, grid and reserve split by return, risk and safety limits</li>
          <li><span className="text-down">Stress</span> · 500 budget futures from the country's own history, plus 3 shocks</li>
        </ol>
      </Section>
    </>
  )
}

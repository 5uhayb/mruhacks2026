import { useEffect, useState } from 'react'
import { getHealth, predict, type Health, type Predict } from './api'

function App() {
  const [health, setHealth] = useState<Health | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [input, setInput] = useState('1, 2, 3')
  const [result, setResult] = useState<Predict | null>(null)

  useEffect(() => {
    getHealth()
      .then(setHealth)
      .catch(() => setError('Backend not reachable. Is it running on port 8000?'))
  }, [])

  async function handlePredict() {
    const values = input.split(',').map((v) => Number(v.trim())).filter((v) => !Number.isNaN(v))
    setResult(await predict(values))
  }

  return (
    <main className="min-h-screen bg-slate-950 text-slate-100 flex items-center justify-center p-6">
      <div className="w-full max-w-md space-y-6">
        <h1 className="text-3xl font-bold">MRUHacks 2026 🚀</h1>

        <div className="rounded-lg bg-slate-900 p-4">
          <h2 className="font-semibold mb-1">Backend status</h2>
          {health && <p className="text-emerald-400">Connected ({health.status})</p>}
          {error && <p className="text-red-400">{error}</p>}
          {!health && !error && <p className="text-slate-400">Checking...</p>}
        </div>

        <div className="rounded-lg bg-slate-900 p-4 space-y-3">
          <h2 className="font-semibold">Try the model</h2>
          <input
            className="w-full rounded bg-slate-800 px-3 py-2 outline-none focus:ring-2 focus:ring-indigo-500"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Comma-separated numbers"
          />
          <button
            className="w-full rounded bg-indigo-600 px-3 py-2 font-medium hover:bg-indigo-500"
            onClick={handlePredict}
          >
            Predict
          </button>
          {result && <p>Prediction: <span className="font-mono">{result.prediction}</span></p>}
        </div>
      </div>
    </main>
  )
}

export default App

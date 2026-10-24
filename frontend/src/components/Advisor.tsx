import { useState } from 'react'
import Markdown from 'react-markdown'
import { advisor, type PlanInput } from '../api'
import { Card } from './Card'

export default function Advisor({ input, country }: { input: PlanInput; country: string }) {
  const [reply, setReply] = useState<string | null>(null)
  const [question, setQuestion] = useState('')
  const [loading, setLoading] = useState(false)

  async function ask(q?: string) {
    setLoading(true)
    setReply(null)
    try {
      await advisor(input, q, setReply)
    } catch (err) {
      setReply(err instanceof Error ? err.message : 'Advisor unavailable.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <Card
      title="AI economic advisor"
      subtitle="Gemini writes a plan from the numbers above"
      action={
        <button
          onClick={() => ask()}
          disabled={loading}
          className="shrink-0 rounded-lg bg-indigo-500 px-4 py-2 text-sm font-semibold hover:bg-indigo-400 disabled:opacity-60"
        >
          {loading ? 'Thinking...' : `📜 Write ${country}'s plan`}
        </button>
      }
    >
      {reply ? (
        <div className="md max-h-[28rem] overflow-y-auto pr-2 text-sm text-slate-200">
          <Markdown>{reply}</Markdown>
        </div>
      ) : (
        <p className="text-sm text-slate-400">
          {loading ? 'Reading the data and drafting a plan...' : 'Generate a phased 10-year plan, with risks and real-world precedents.'}
        </p>
      )}
      <form
        className="mt-4 flex gap-2"
        onSubmit={(e) => {
          e.preventDefault()
          if (question.trim()) ask(question)
        }}
      >
        <input
          className="flex-1 rounded-lg bg-slate-800 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-indigo-500"
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          placeholder="Ask a follow-up, e.g. How do we stop this money being stolen?"
        />
        <button className="rounded-lg bg-slate-700 px-4 py-2 text-sm hover:bg-slate-600" disabled={loading}>
          Ask
        </button>
      </form>
    </Card>
  )
}

import { useState } from 'react'
import Markdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { ask, type PlanInput } from '../api'
import { Note, Panel } from '../components/ui'

export default function Memo({ markdown, input, country }: { markdown: string | null; input: PlanInput; country: string }) {
  const [question, setQuestion] = useState('')
  const [answer, setAnswer] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  function download() {
    if (!markdown) return
    const url = URL.createObjectURL(new Blob([markdown], { type: 'text/markdown' }))
    const a = document.createElement('a')
    a.href = url
    a.download = `nahda-${country.toLowerCase().replaceAll(' ', '-')}-memo.md`
    a.click()
    URL.revokeObjectURL(url)
  }

  async function submit() {
    if (!question.trim()) return
    setLoading(true)
    setAnswer('')
    try {
      await ask(input, question, setAnswer)
    } catch (err) {
      setAnswer(err instanceof Error ? err.message : 'Analyst unavailable.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="grid grid-cols-12">
      <Panel
        title="Plan Memo"
        right={
          <button onClick={download} disabled={!markdown} className="text-amb hover:underline">
            [DOWNLOAD .MD]
          </button>
        }
        className="col-span-8"
      >
        {markdown ? (
          <div className="memo max-w-3xl">
            <Markdown remarkPlugins={[remarkGfm]}>{markdown}</Markdown>
          </div>
        ) : (
          <p className="text-dim num">GENERATING…</p>
        )}
      </Panel>
      <Panel title="Ask the Analyst" right="GEMINI · USES ONLY THE MEMO'S NUMBERS" className="col-span-4">
        <form
          className="flex gap-1"
          onSubmit={(e) => {
            e.preventDefault()
            submit()
          }}
        >
          <input
            type="text"
            className="flex-1 text-[12px]"
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            placeholder="e.g. What happens if oil stays low for 3 years?"
          />
          <button disabled={loading} className="border-amb text-amb hover:bg-amb border px-2 text-[11px] hover:text-black disabled:opacity-50">
            {loading ? '…' : 'ASK'}
          </button>
        </form>
        {answer != null && (
          <div className="border-amb mt-3 border-l pl-2">
            <Note>{answer || '…'}</Note>
          </div>
        )}
      </Panel>
    </div>
  )
}

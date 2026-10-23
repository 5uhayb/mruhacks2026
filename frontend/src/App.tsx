import { useEffect, useState } from 'react'
import { isAxiosError } from 'axios'
import { chat, getHealth, type Health } from './api'

type Message = { role: 'user' | 'ai'; text: string; imageUrl?: string }

function App() {
  const [health, setHealth] = useState<Health | null>(null)
  const [healthError, setHealthError] = useState(false)
  const [messages, setMessages] = useState<Message[]>([])
  const [input, setInput] = useState('')
  const [image, setImage] = useState<File | null>(null)
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    getHealth().then(setHealth).catch(() => setHealthError(true))
  }, [])

  async function handleSend() {
    if (!input.trim() || loading) return
    const userMsg: Message = {
      role: 'user',
      text: input,
      imageUrl: image ? URL.createObjectURL(image) : undefined,
    }
    setMessages((m) => [...m, userMsg])
    setInput('')
    setImage(null)
    setLoading(true)
    try {
      const reply = await chat(userMsg.text, image ?? undefined)
      setMessages((m) => [...m, { role: 'ai', text: reply }])
    } catch (err) {
      const detail = isAxiosError(err) ? err.response?.data?.detail : undefined
      setMessages((m) => [...m, { role: 'ai', text: detail ?? 'Something went wrong. Try again.' }])
    } finally {
      setLoading(false)
    }
  }

  return (
    <main className="min-h-screen bg-slate-950 text-slate-100 flex justify-center p-6">
      <div className="w-full max-w-2xl flex flex-col gap-4">
        <header className="flex items-center justify-between">
          <h1 className="text-3xl font-bold">MRUHacks 2026 🚀</h1>
          <span className={`text-sm ${health ? 'text-emerald-400' : healthError ? 'text-red-400' : 'text-slate-400'}`}>
            {health ? '● Backend connected' : healthError ? '● Backend offline' : '● Checking...'}
          </span>
        </header>

        <section className="flex-1 rounded-lg bg-slate-900 p-4 space-y-3 min-h-[50vh] overflow-y-auto">
          {messages.length === 0 && <p className="text-slate-500">Ask Gemini anything, or attach an image.</p>}
          {messages.map((msg, i) => (
            <div key={i} className={msg.role === 'user' ? 'text-right' : ''}>
              <div
                className={`inline-block max-w-[85%] rounded-lg px-3 py-2 whitespace-pre-wrap text-left ${
                  msg.role === 'user' ? 'bg-indigo-600' : 'bg-slate-800'
                }`}
              >
                {msg.imageUrl && <img src={msg.imageUrl} className="mb-2 max-h-48 rounded" />}
                {msg.text}
              </div>
            </div>
          ))}
          {loading && <p className="text-slate-400 animate-pulse">Thinking...</p>}
        </section>

        <div className="flex gap-2 items-center">
          <label className="cursor-pointer rounded bg-slate-800 px-3 py-2 hover:bg-slate-700" title="Attach image">
            📎
            <input
              type="file"
              accept="image/*"
              className="hidden"
              onChange={(e) => setImage(e.target.files?.[0] ?? null)}
            />
          </label>
          <input
            className="flex-1 rounded bg-slate-800 px-3 py-2 outline-none focus:ring-2 focus:ring-indigo-500"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleSend()}
            placeholder={image ? `Ask about ${image.name}...` : 'Type a message...'}
          />
          <button
            className="rounded bg-indigo-600 px-4 py-2 font-medium hover:bg-indigo-500 disabled:opacity-50"
            onClick={handleSend}
            disabled={loading}
          >
            Send
          </button>
        </div>
      </div>
    </main>
  )
}

export default App

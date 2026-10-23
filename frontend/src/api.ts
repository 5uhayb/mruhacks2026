import axios from 'axios'
import { z } from 'zod'

// All requests go to /api/..., which Vite proxies to the FastAPI backend
export const api = axios.create({ baseURL: '/api' })

const HealthSchema = z.object({
  status: z.string(),
  time: z.string(),
})
export type Health = z.infer<typeof HealthSchema>

export async function getHealth(): Promise<Health> {
  const res = await api.get('/health')
  return HealthSchema.parse(res.data)
}

const PredictSchema = z.object({
  input: z.array(z.number()),
  prediction: z.number(),
})
export type Predict = z.infer<typeof PredictSchema>

export async function predict(values: number[]): Promise<Predict> {
  const res = await api.post('/predict', { values })
  return PredictSchema.parse(res.data)
}

const ChatSchema = z.object({ reply: z.string() })

export async function chat(message: string, image?: File): Promise<string> {
  const form = new FormData()
  form.append('message', message)
  if (image) form.append('image', image)
  const res = await api.post('/chat', form)
  return ChatSchema.parse(res.data).reply
}

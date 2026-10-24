import { useSyncExternalStore } from 'react'

/** A small store for the System drawer: one line per real API call */
export type LogLine = { id: number; time: string; method: string; path: string; detail: string; ms: number; error?: boolean }

let lines: LogLine[] = []
let nextId = 1
const listeners = new Set<() => void>()

export function log(line: Omit<LogLine, 'id' | 'time'>) {
  const time = new Date().toLocaleTimeString('en-GB', { hour12: false })
  lines = [...lines.slice(-80), { ...line, id: nextId++, time }]
  listeners.forEach((l) => l())
}

export function useLog(): LogLine[] {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb)
      return () => listeners.delete(cb)
    },
    () => lines,
  )
}

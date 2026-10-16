import { type ClassValue, clsx } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

export function formatDuration(ms?: number | null): string {
  if (ms == null) return "0ms"
  if (ms < 1000) return `${Math.round(ms)}ms`
  return `${(ms / 1000).toFixed(2)}s`
}

export function formatTime(ts?: number | string | null): string {
  if (!ts) return "--:--:--"
  try {
    const d = typeof ts === "number" ? new Date(ts > 1e11 ? ts : ts * 1000) : new Date(ts)
    return d.toLocaleTimeString()
  } catch {
    return String(ts)
  }
}

/**
 * Generate a deterministic hash from a string
 */
export function stringHash(str: string): number {
  let hash = 0
  for (let i = 0; i < str.length; i++) {
    hash = (hash << 5) - hash + str.charCodeAt(i)
    hash |= 0
  }
  return Math.abs(hash)
}

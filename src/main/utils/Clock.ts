export interface Clock {
  now(): number
  nowIso(): string
}

export const systemClock: Clock = {
  now: () => Date.now(),
  nowIso: () => new Date().toISOString()
}

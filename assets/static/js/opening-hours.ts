// Pure, framework-free helpers for the opening-hours app. Kept separate from
// main.ts so they can be unit-tested with `bun:test`; main.ts is the (untestable,
// no-exports) browser entry that wires these into the DOM.
//
// All of the app's data arrives in the launch URL's query string — one param per
// weekday (`mon`..`sun`), each a comma-separated list of `HH:MM-HH:MM` ranges —
// plus `name`, `tz`, `format`, and `note`. See .well-known/signage-app.json.

// Monday-first: retail weeks read Mon→Sun, and it keeps the array index stable
// regardless of locale (JS `getDay()` is Sunday-first).
export const DAY_KEYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'] as const
export type DayKey = (typeof DAY_KEYS)[number]

export const DAY_LABELS: Record<DayKey, string> = {
  mon: 'Monday',
  tue: 'Tuesday',
  wed: 'Wednesday',
  thu: 'Thursday',
  fri: 'Friday',
  sat: 'Saturday',
  sun: 'Sunday'
}

// Minutes from local midnight. `close <= open` means the range runs past midnight
// into the next day (e.g. a bar open 18:00–02:00).
export type Range = { open: number; close: number }
export type DaySchedule = { key: DayKey; ranges: Range[] }
export type Week = DaySchedule[] // always length 7, Mon→Sun

// A parsed clock time as minutes-of-day. Accepts `H:MM` or `HH:MM`, hours 0–24
// (24:00 = end of day = 1440). Returns null for anything malformed.
export const parseTime = (raw: string): number | null => {
  const match = /^(\d{1,2}):(\d{2})$/.exec(raw.trim())
  if (!match) return null
  const h = Number(match[1])
  const m = Number(match[2])
  if (h > 24 || m > 59) return null
  const total = h * 60 + m
  if (total > 1440) return null
  return total
}

// Parse one day's value, e.g. "09:00-17:00" or "09:00-12:00,13:00-18:00".
// Blank or "closed" (any case) yields no ranges. Degenerate/malformed ranges are
// dropped rather than throwing, so a bad URL still renders the rest of the week.
export const parseRanges = (raw: string): Range[] => {
  const value = raw.trim()
  if (value === '' || value.toLowerCase() === 'closed') return []
  const ranges: Range[] = []
  for (const part of value.split(',')) {
    const [openStr, closeStr] = part.split(/[-–—]/)
    if (openStr === undefined || closeStr === undefined) continue
    const open = parseTime(openStr)
    const close = parseTime(closeStr)
    if (open === null || close === null) continue
    if (open === close) continue // zero-length range is meaningless
    ranges.push({ open, close })
  }
  return ranges
}

// Build the full Mon→Sun week from the query params. A day with no param (or an
// empty/closed value) is simply closed.
export const parseWeek = (params: URLSearchParams): Week =>
  DAY_KEYS.map((key) => ({ key, ranges: parseRanges(params.get(key) ?? '') }))

const WEEKDAY_INDEX: Record<string, number> = {
  Mon: 0,
  Tue: 1,
  Wed: 2,
  Thu: 3,
  Fri: 4,
  Sat: 5,
  Sun: 6
}

// The current weekday (0=Mon…6=Sun) and minutes-of-day in a given IANA time zone.
// Uses Intl so it's correct across DST without a date library. Falls back to the
// runtime's local zone if `tz` is missing or invalid.
export const zonedNow = (date: Date, tz?: string): { dayIndex: number; minutes: number } => {
  const read = (timeZone?: string) => {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone,
      weekday: 'short',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false
    }).formatToParts(date)
    const get = (type: string) => parts.find((p) => p.type === type)?.value ?? ''
    const dayIndex = WEEKDAY_INDEX[get('weekday')] ?? 0
    // Intl can render midnight as "24" under hour12:false; fold it back to 0.
    const minutes = (Number(get('hour')) % 24) * 60 + Number(get('minute'))
    return { dayIndex, minutes }
  }
  try {
    return read(tz || undefined)
  } catch {
    return read(undefined)
  }
}

export type OpensAt = { dayIndex: number; minutes: number; offsetDays: number }
export type OpenStatus =
  | { open: true; closesAt: number }
  | { open: false; opensAt: OpensAt | null }

// Is the business open right now, and when does it next change? Expands each day's
// ranges into a concrete timeline spanning yesterday through a week ahead (so
// overnight ranges and the next opening are both found), then locates `now` on it.
export const getStatus = (week: Week, now: { dayIndex: number; minutes: number }): OpenStatus => {
  type Interval = { start: number; end: number; dayIndex: number; open: number }
  const intervals: Interval[] = []
  for (let offset = -1; offset <= 7; offset++) {
    const dayIndex = (((now.dayIndex + offset) % 7) + 7) % 7
    for (const range of week[dayIndex].ranges) {
      const base = offset * 1440
      const end = range.close <= range.open ? range.close + 1440 : range.close
      intervals.push({ start: base + range.open, end: base + end, dayIndex, open: range.open })
    }
  }

  const nowVal = now.minutes
  const current = intervals.find((i) => i.start <= nowVal && nowVal < i.end)
  if (current) return { open: true, closesAt: ((current.end % 1440) + 1440) % 1440 }

  let next: Interval | null = null
  for (const i of intervals) {
    if (i.start > nowVal && (next === null || i.start < next.start)) next = i
  }
  if (!next) return { open: false, opensAt: null }
  return {
    open: false,
    opensAt: { dayIndex: next.dayIndex, minutes: next.open, offsetDays: Math.floor(next.start / 1440) }
  }
}

const pad2 = (n: number): string => String(n).padStart(2, '0')

// Whether to render times as 24-hour. Explicit `format` ("12"/"24") wins;
// otherwise guess from the time zone — the Americas lean 12-hour, most of the
// rest of the world 24-hour.
export const prefers24h = (format: string, tz?: string): boolean => {
  if (format === '24') return true
  if (format === '12') return false
  return !(tz ?? '').startsWith('America/')
}

// Minutes-of-day → clock string, e.g. 540 → "9:00 AM" or "09:00".
export const formatTime = (minutes: number, use24h: boolean): string => {
  const m = ((Math.round(minutes) % 1440) + 1440) % 1440
  const h = Math.floor(m / 60)
  const mm = m % 60
  if (use24h) return `${pad2(h)}:${pad2(mm)}`
  const period = h < 12 ? 'AM' : 'PM'
  const h12 = h % 12 === 0 ? 12 : h % 12
  return `${h12}:${pad2(mm)} ${period}`
}

// A day's ranges as a display string, e.g. "9:00 AM – 5:00 PM" or "Closed".
// A full 00:00–24:00 day reads as "Open 24 hours"; a range ending at midnight
// shows "midnight"/"24:00" rather than folding to 00:00 (which reads as the start).
export const formatRanges = (ranges: Range[], use24h: boolean): string => {
  if (ranges.length === 0) return 'Closed'
  const first = ranges[0]
  if (ranges.length === 1 && first && first.open === 0 && first.close === 1440) {
    return 'Open 24 hours'
  }
  const endOfDay = use24h ? '24:00' : 'midnight'
  return ranges
    .map((r) => {
      const close = r.close === 1440 ? endOfDay : formatTime(r.close, use24h)
      return `${formatTime(r.open, use24h)} – ${close}`
    })
    .join(', ')
}

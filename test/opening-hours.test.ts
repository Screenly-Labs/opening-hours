import { describe, expect, test } from 'bun:test'
import {
  DAY_KEYS,
  formatRanges,
  formatTime,
  getStatus,
  parseRanges,
  parseTime,
  parseWeek,
  prefers24h,
  type Week,
  zonedNow
} from '../assets/static/js/opening-hours'

describe('parseTime', () => {
  test('parses HH:MM and H:MM', () => {
    expect(parseTime('09:00')).toBe(540)
    expect(parseTime('9:30')).toBe(570)
    expect(parseTime('00:00')).toBe(0)
    expect(parseTime('24:00')).toBe(1440) // end-of-day sentinel
  })

  test('rejects malformed or out-of-range times', () => {
    for (const bad of ['', 'noon', '9', '9:5', '25:00', '10:60', '12:00pm', '-1:00']) {
      expect(parseTime(bad)).toBeNull()
    }
  })
})

describe('parseRanges', () => {
  test('parses a single range', () => {
    expect(parseRanges('09:00-17:00')).toEqual([{ open: 540, close: 1020 }])
  })

  test('parses multiple comma-separated ranges (midday break)', () => {
    expect(parseRanges('09:00-12:00,13:00-17:00')).toEqual([
      { open: 540, close: 720 },
      { open: 780, close: 1020 }
    ])
  })

  test('treats blank and "closed" as no ranges', () => {
    expect(parseRanges('')).toEqual([])
    expect(parseRanges('  ')).toEqual([])
    expect(parseRanges('Closed')).toEqual([])
  })

  test('keeps overnight ranges (close <= open)', () => {
    expect(parseRanges('18:00-02:00')).toEqual([{ open: 1080, close: 120 }])
  })

  test('drops malformed or zero-length parts but keeps valid ones', () => {
    expect(parseRanges('09:00-17:00,garbage,10:00-10:00')).toEqual([{ open: 540, close: 1020 }])
  })

  test('accepts en/em dashes as separators', () => {
    expect(parseRanges('09:00–17:00')).toEqual([{ open: 540, close: 1020 }])
  })
})

describe('parseWeek', () => {
  test('builds a 7-day Mon→Sun week, missing days closed', () => {
    const week = parseWeek(new URLSearchParams('mon=09:00-17:00&sat=10:00-14:00'))
    expect(week.map((d) => d.key)).toEqual([...DAY_KEYS])
    expect(week[0].ranges).toEqual([{ open: 540, close: 1020 }])
    expect(week[5].ranges).toEqual([{ open: 600, close: 840 }])
    expect(week[6].ranges).toEqual([]) // Sunday: no param → closed
  })
})

// A helper to build a week from a param string for the status tests.
const weekOf = (qs: string): Week => parseWeek(new URLSearchParams(qs))
const MON_FRI_9_5 = 'mon=09:00-17:00&tue=09:00-17:00&wed=09:00-17:00&thu=09:00-17:00&fri=09:00-17:00'

describe('getStatus', () => {
  test('open during business hours reports when it closes', () => {
    // Wednesday (index 2), 10:00
    const status = getStatus(weekOf(MON_FRI_9_5), { dayIndex: 2, minutes: 600 })
    expect(status).toEqual({ open: true, closesAt: 1020 })
  })

  test('before opening reports opening later the same day', () => {
    // Monday 08:00
    const status = getStatus(weekOf(MON_FRI_9_5), { dayIndex: 0, minutes: 480 })
    expect(status).toEqual({ open: false, opensAt: { dayIndex: 0, minutes: 540, offsetDays: 0 } })
  })

  test('after closing reports opening tomorrow', () => {
    // Monday 18:00 → opens Tuesday
    const status = getStatus(weekOf(MON_FRI_9_5), { dayIndex: 0, minutes: 1080 })
    expect(status).toEqual({ open: false, opensAt: { dayIndex: 1, minutes: 540, offsetDays: 1 } })
  })

  test('closed weekend rolls forward to Monday', () => {
    // Saturday (5) noon → opens Monday, two days out
    const status = getStatus(weekOf(MON_FRI_9_5), { dayIndex: 5, minutes: 720 })
    expect(status).toEqual({ open: false, opensAt: { dayIndex: 0, minutes: 540, offsetDays: 2 } })
  })

  test('exactly at closing time counts as closed', () => {
    const status = getStatus(weekOf(MON_FRI_9_5), { dayIndex: 2, minutes: 1020 })
    expect(status.open).toBe(false)
  })

  test('overnight range is open past midnight', () => {
    // Bar open Fri 18:00–02:00. Saturday 01:00 is still open (from Friday's range).
    const week = weekOf('fri=18:00-02:00')
    const status = getStatus(week, { dayIndex: 5, minutes: 60 })
    expect(status).toEqual({ open: true, closesAt: 120 })
  })

  test('never-open week reports no opening time', () => {
    const status = getStatus(weekOf(''), { dayIndex: 0, minutes: 600 })
    expect(status).toEqual({ open: false, opensAt: null })
  })

  test('midday-break gap reads as closed until the afternoon range', () => {
    const week = weekOf('mon=09:00-12:00,13:00-17:00')
    const status = getStatus(week, { dayIndex: 0, minutes: 750 }) // 12:30
    expect(status).toEqual({ open: false, opensAt: { dayIndex: 0, minutes: 780, offsetDays: 0 } })
  })
})

describe('formatTime', () => {
  test('24-hour', () => {
    expect(formatTime(540, true)).toBe('09:00')
    expect(formatTime(1020, true)).toBe('17:00')
    expect(formatTime(0, true)).toBe('00:00')
  })

  test('12-hour', () => {
    expect(formatTime(540, false)).toBe('9:00 AM')
    expect(formatTime(1020, false)).toBe('5:00 PM')
    expect(formatTime(0, false)).toBe('12:00 AM')
    expect(formatTime(720, false)).toBe('12:00 PM')
  })
})

describe('formatRanges', () => {
  test('renders ranges and closed days', () => {
    expect(formatRanges([{ open: 540, close: 1020 }], false)).toBe('9:00 AM – 5:00 PM')
    expect(
      formatRanges(
        [
          { open: 540, close: 720 },
          { open: 780, close: 1020 }
        ],
        true
      )
    ).toBe('09:00 – 12:00, 13:00 – 17:00')
    expect(formatRanges([], false)).toBe('Closed')
  })

  test('renders a full day as "Open 24 hours"', () => {
    expect(formatRanges([{ open: 0, close: 1440 }], true)).toBe('Open 24 hours')
  })

  test('renders a midnight close as end-of-day, not 00:00', () => {
    expect(formatRanges([{ open: 1080, close: 1440 }], true)).toBe('18:00 – 24:00')
    expect(formatRanges([{ open: 1080, close: 1440 }], false)).toBe('6:00 PM – midnight')
  })
})

describe('prefers24h', () => {
  test('explicit format wins', () => {
    expect(prefers24h('24', 'America/New_York')).toBe(true)
    expect(prefers24h('12', 'Europe/London')).toBe(false)
  })

  test('infers from time zone when unset', () => {
    expect(prefers24h('', 'America/New_York')).toBe(false)
    expect(prefers24h('', 'Europe/Stockholm')).toBe(true)
    expect(prefers24h('', undefined)).toBe(true)
  })
})

describe('zonedNow', () => {
  test('derives weekday and minutes in a target zone', () => {
    // 2026-07-01 is a Wednesday. At 12:00 UTC it's 08:00 in New York (still Wed).
    const date = new Date('2026-07-01T12:00:00Z')
    expect(zonedNow(date, 'America/New_York')).toEqual({ dayIndex: 2, minutes: 480 })
  })

  test('crosses the date line into the previous day', () => {
    // 2026-07-01T02:00Z is still Tuesday 22:00 in New York.
    const date = new Date('2026-07-01T02:00:00Z')
    expect(zonedNow(date, 'America/New_York')).toEqual({ dayIndex: 1, minutes: 1320 })
  })

  test('falls back gracefully on an invalid zone', () => {
    const result = zonedNow(new Date('2026-07-01T12:00:00Z'), 'Not/AZone')
    expect(result.dayIndex).toBeGreaterThanOrEqual(0)
    expect(result.dayIndex).toBeLessThanOrEqual(6)
  })
})

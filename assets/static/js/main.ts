// Browser entry. esbuild bundles this (inlining ./opening-hours) into a
// self-contained classic script with no exports, so it loads from a plain
// <script>. Keep it export-free and free of top-level await.

// Side-effect import: installs the replaceChildren shim for the older-browser
// degraded mode. Must stay first so the shim is in place before any render.
import './polyfills'
import {
  DAY_KEYS,
  DAY_LABELS,
  formatRanges,
  formatTime,
  getStatus,
  parseWeek,
  prefers24h,
  zonedNow
} from './opening-hours'

// Shown when the page is opened with no settings (e.g. the store preview or a
// bare visit), so the board is never blank and demonstrates the format. Real
// deployments carry their hours in the launch URL's query string.
const EXAMPLE =
  'name=Corner+Coffee&mon=07:00-18:00&tue=07:00-18:00&wed=07:00-18:00&thu=07:00-18:00&fri=07:00-19:00&sat=08:00-19:00&sun=09:00-16:00&note=Kitchen+closes+30+minutes+before+we+do'

const text = (id: string, value: string): void => {
  const el = document.getElementById(id)
  if (el) el.textContent = value
}

// Turn a closed-status opening time into a customer-facing sentence.
const opensSentence = (
  opensAt: { dayIndex: number; minutes: number; offsetDays: number },
  use24h: boolean
): string => {
  const at = formatTime(opensAt.minutes, use24h)
  if (opensAt.offsetDays === 0) return `Opens at ${at}`
  if (opensAt.offsetDays === 1) return `Opens tomorrow at ${at}`
  return `Opens ${DAY_LABELS[DAY_KEYS[opensAt.dayIndex]]} at ${at}`
}

const render = (params: URLSearchParams): void => {
  const week = parseWeek(params)
  const tz = params.get('tz') || undefined
  const use24h = prefers24h(params.get('format') || '', tz)
  const name = params.get('name')?.trim() || 'Opening hours'
  const note = params.get('note')?.trim() || ''

  document.title = name === 'Opening hours' ? 'Opening Hours' : `${name} | Opening Hours`
  text('biz-name', name)

  const now = zonedNow(new Date(), tz)
  const status = getStatus(week, now)

  document.documentElement.dataset.status = status.open ? 'open' : 'closed'
  text('status-word', status.open ? 'Open' : 'Closed')
  if (status.open) {
    text('status-detail', `Open until ${status.closesAt === 0 ? 'midnight' : formatTime(status.closesAt, use24h)}`)
  } else {
    text('status-detail', status.opensAt ? opensSentence(status.opensAt, use24h) : '')
  }

  // Rebuild the week rows, highlighting today.
  const body = document.getElementById('week-body')
  if (body) {
    body.replaceChildren(
      ...week.map((day, index) => {
        const row = document.createElement('tr')
        row.className = 'day'
        if (day.ranges.length === 0) row.classList.add('day--closed')
        if (index === now.dayIndex) {
          row.classList.add('day--today')
          row.setAttribute('aria-current', 'date')
        }
        const th = document.createElement('th')
        th.scope = 'row'
        th.className = 'day__name'
        th.textContent = DAY_LABELS[day.key]
        // Purely decorative dotted leader between the day and its hours.
        const leader = document.createElement('td')
        leader.className = 'day__leader'
        leader.setAttribute('aria-hidden', 'true')
        const td = document.createElement('td')
        td.className = 'day__hours'
        td.textContent = formatRanges(day.ranges, use24h)
        row.append(th, leader, td)
        return row
      })
    )
  }

  const noteEl = document.getElementById('note')
  if (noteEl) {
    noteEl.textContent = note
    noteEl.hidden = note === ''
  }

  document.documentElement.dataset.state = 'ready'
}

// On a Screenly player the viewer is already a Screenly customer, so the
// promotional Screenly badge is removed. The 'screenly-viewer' token in the
// user agent marks these devices; every other browser keeps the badge.
const removeScreenlyBranding = (): void => {
  if (navigator.userAgent.includes('screenly-viewer')) {
    document.querySelector('.brand')?.remove()
  }
}

const init = (): void => {
  removeScreenlyBranding()
  const params = new URLSearchParams(window.location.search || `?${EXAMPLE}`)
  render(params)
  // Keep "Open now" and the today marker honest without a reload: repaint each
  // minute so the status flips exactly on the boundary.
  window.setInterval(() => render(params), 60_000)
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init)
} else {
  init()
}

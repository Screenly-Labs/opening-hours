# CLAUDE.md

Guidance for working in this repo.

## What this is

A **static** full-screen opening-hours board for retail/hospitality signage,
hosted on **GitHub Pages**. It shows the week's hours, highlights today, and tells
customers whether the shop is **open right now**. Sibling to the `quotes` app
(also static, also Pages), and to the `weather-app`/`clock-app` (those are
Cloudflare Workers — this one has **no server**). Random/live logic is entirely
client-side.

Unlike Quotes, this is a **settings** app: a shop's hours are not baked in, they
arrive in the launch URL's query string (`?name=…&mon=09:00-17:00&…&tz=…`). One
deployment serves every business.

## Stack & conventions

- **Bun** for everything (package manager, bundler, test runner). Use `bun` /
  `bunx` — never npm/npx.
- **TypeScript**, strict. All browser JS is authored as `.ts` and bundled by Bun.
- **Tailwind CSS v4**, CSS-first: tokens live in `@theme` in
  `assets/static/styles/tailwind.css`; compiled by `@tailwindcss/cli` at build.
- **Biome** for lint/format: single quotes, no semicolons, 2-space, 100 cols.
  CSS is intentionally excluded from Biome (it doesn't parse Tailwind at-rules).

## Commands

```sh
bun install         # deps; vendored fonts come from @fontsource via sync-fonts
bun run dev         # build + serve dist/ locally
bun run build       # assemble dist/ (see below)
bun test            # bun:test — parsing/status helpers + manifest guard
bun run typecheck   # tsc --noEmit
bun run lint        # biome lint --error-on-warnings
```

## Layout & build

Web root is served from the site root (custom domain), so assets are referenced
absolutely as `/static/...`.

- `index.html` — the page shell. Ships a static worked example inline (Corner
  Coffee) so the board is never blank pre-JS or in the store preview. Asset URLs
  carry `?v=__ASSET_VERSION__`, replaced at build.
- `assets/static/js/opening-hours.ts` — **pure, exported, unit-tested** helpers:
  parse per-day range strings (`parseTime`/`parseRanges`/`parseWeek`), compute
  open/closed + next change with time-zone and overnight handling (`zonedNow`,
  `getStatus`), and format times (`formatTime`/`formatRanges`/`prefers24h`).
- `assets/static/js/main.ts` — the browser **entry**. Reads the query string
  (falls back to the example), renders the board, sets `data-status` on `<html>`
  (which flips the whole-board tint), and repaints every minute so "open now" and
  the today marker stay honest. Keep it **export-free** and free of top-level
  `await` so Bun bundles it to a self-contained classic script.
- `.well-known/signage-app.json` — the [app-store manifest](../app-store/docs/app-manifest.md).
  This app **has settings**: a JSON-Schema of one field per weekday plus
  `name`/`tz`/`format`/`note`, and an RFC 6570 `launch.template`
  (`{?name,tz,format,mon,…,sun,note}`) that serialises them into one query
  expression. Served from the site root at `/.well-known/signage-app.json`
  (GitHub Pages sends `application/json` + `Access-Control-Allow-Origin: *`).
  `test/manifest.test.ts` guards it against the store's schema.

`build.js` builds into `dist/` **without mutating sources**: vendor fonts → copy
`index.html` + static assets + `.well-known/` → compile+minify Tailwind →
bundle+minify the TS → stamp a sha256 content hash into `?v=` URLs → write `CNAME`.
There is no shipped dataset — the data is the URL — so nothing but JS+CSS feeds
the cache-busting hash. `dist/` is gitignored and is the artifact Pages publishes.

## Design — "Storefront board"

The hero is the **Open/Closed status**, not the business name, because that's the
customer's real question. The signature is that the **whole board is tinted by
state** (`--ground`/`--signal` flip on `html[data-status]`): storefront green
`--color-open` when open, aubergine `--color-closed` when closed — readable across
a room. A brass (`--color-gilt`) tab marks today; a dotted leader ties each day to
its hours (the printed-plaque vernacular). Bricolage Grotesque (display: name +
status word) over Hanken Grotesk (tabular schedule numerals). One fluid root
font-size (`clamp(vw+vh)`) is orientation-neutral; children size in `rem`, so it
works from the 800×480 Pi display to 4K, portrait and landscape, no breakpoints.
The single entrance animation is gated behind `prefers-reduced-motion`.

## Quality bars

- **Accessibility:** target a 100 Lighthouse/PageSpeed accessibility score —
  semantic `table`/`th[scope]` schedule, `role="status"`, `aria-current` on today,
  AA contrast on both grounds, `lang`, named links, zoomable viewport,
  reduced-motion respected.
- **Resolutions:** must look correct at every entry in the README table, both
  orientations.
- Run `typecheck`, `lint`, and `test` before pushing (CI enforces them).

## Deploy

Push to **`master`** → `.github/workflows/deploy-pages.yml` builds and publishes
to Pages. PRs run `ci.yml` (typecheck + lint + test + build). Action versions are
SHA-pinned.

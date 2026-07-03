#!/usr/bin/env bun
/* global Bun */
// Builds the static site into ./dist for GitHub Pages. Like the Quotes app this
// is a plain static bundle — no server. The opening-hours data isn't shipped as
// a file: it arrives entirely in the launch URL's query string (see the manifest
// at .well-known/signage-app.json), so there's no dataset to copy or hash. Steps:
//   1. vendor fonts from @fontsource (sync-fonts.js)
//   2. assemble dist/ (index.html + static assets + .well-known, copied not mutated)
//   3. compile Tailwind v4 CSS (minified)
//   4. bundle TypeScript → browser JS (minified, ./opening-hours inlined)
//   5. stamp a content hash into asset URLs (?v=) for cache-busting
//   6. write CNAME for the custom domain
// dist/ is gitignored; CI uploads it as the Pages artifact.

import { rm, mkdir, cp, readFile, writeFile } from 'node:fs/promises'
import { run as syncFonts } from './sync-fonts.js'

const DIST = 'dist'
const DOMAIN = 'opening-hours.srly.io'

// 1. Vendor the Bun-managed webfonts into ./assets before copying.
await syncFonts()

// 2. Fresh dist/, then copy the web root (everything served at /static/...), the
// page shell, and the signage manifest served at the well-known path. Sources
// are never minified in place.
await rm(DIST, { recursive: true, force: true })
await mkdir(`${DIST}/static`, { recursive: true })
await cp('assets/static/fonts', `${DIST}/static/fonts`, { recursive: true })
await cp('assets/static/images', `${DIST}/static/images`, { recursive: true })
await cp('index.html', `${DIST}/index.html`)
// Signage app manifest served at /.well-known/signage-app.json (see the
// app-store's docs/app-manifest.md). GitHub Pages returns it as application/json
// with Access-Control-Allow-Origin: * so the store and players can fetch it.
await cp('.well-known', `${DIST}/.well-known`, { recursive: true })

// 3. Tailwind: compile + minify the source CSS to the served stylesheet.
const tailwind = Bun.spawn(
  [
    'node_modules/.bin/tailwindcss',
    '--input',
    'assets/static/styles/tailwind.css',
    '--output',
    `${DIST}/static/styles/main.css`,
    '--minify'
  ],
  { stdout: 'inherit', stderr: 'inherit' }
)
if ((await tailwind.exited) !== 0) {
  console.error('✗ Tailwind build failed')
  process.exit(1)
}
console.log(`✓ CSS: ${DIST}/static/styles/main.css`)

// 4. TypeScript → browser JS. main.ts imports ./opening-hours; external:[]
// inlines it so the output is a single self-contained classic script.
const js = await Bun.build({
  entrypoints: ['assets/static/js/main.ts'],
  minify: true,
  target: 'browser',
  external: []
})
if (!js.success) {
  console.error('✗ JS build failed')
  for (const message of js.logs) console.error(message)
  process.exit(1)
}
await Bun.write(`${DIST}/static/js/main.js`, await js.outputs[0].text())
console.log(`✓ JS: ${DIST}/static/js/main.js`)

// 5. Cache-busting: hash the built JS + CSS so the token changes exactly when
// shipped code changes, then stamp it into the page's asset URLs.
const fingerprint = await Promise.all([
  readFile(`${DIST}/static/js/main.js`),
  readFile(`${DIST}/static/styles/main.css`)
])
const hasher = new Bun.CryptoHasher('sha256')
for (const buf of fingerprint) hasher.update(buf)
const version = hasher.digest('hex').slice(0, 10)

const html = await readFile(`${DIST}/index.html`, 'utf8')
await writeFile(`${DIST}/index.html`, html.replaceAll('__ASSET_VERSION__', version))
console.log(`✓ Stamped asset version ${version}`)

// 6. Custom domain for GitHub Pages.
await writeFile(`${DIST}/CNAME`, `${DOMAIN}\n`)
console.log(`✓ CNAME: ${DOMAIN}`)

console.log('Build complete → dist/')

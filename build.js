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
import { bundleJs, injectGate, processCss } from '@screenly-labs/signage-kit/build'
import { run as syncFonts } from './sync-fonts.js'

const DIST = 'dist'
const DOMAIN = 'opening-hours.srly.io'

// The degraded-mode support floor, the CSS down-leveling recipe (cascade-layers
// flatten + Lightning CSS), the JS bundler, and the inline degraded-mode gate all
// come from @screenly-labs/signage-kit. This file only orchestrates the
// app-specific steps. See the degraded-mode notes in index.html / tailwind.css.

// 1. Vendor the Bun-managed webfonts into ./assets before copying.
await syncFonts()

// 2. Fresh dist/, then copy the web root (everything served at /static/...), the
// page shell, and the signage manifest served at the well-known path. Sources
// are never minified in place.
await rm(DIST, { recursive: true, force: true })
await mkdir(`${DIST}/static`, { recursive: true })
// Create the output subdirs up front so Tailwind/esbuild never race an absent dir.
await mkdir(`${DIST}/static/styles`, { recursive: true })
await mkdir(`${DIST}/static/js`, { recursive: true })
await cp('assets/static/fonts', `${DIST}/static/fonts`, { recursive: true })
await cp('assets/static/images', `${DIST}/static/images`, { recursive: true })
// Copy the page shell with the shared degraded-mode gate injected before the
// stylesheet.
await writeFile(`${DIST}/index.html`, injectGate(await readFile('index.html', 'utf8')))
// Signage app manifest served at /.well-known/signage-app.json (see the
// app-store's docs/app-manifest.md). GitHub Pages returns it as application/json
// with Access-Control-Allow-Origin: * so the store and players can fetch it.
await cp('.well-known', `${DIST}/.well-known`, { recursive: true })

// 3. Tailwind -> the kit's CSS pipeline (flatten @layer, down-level to the floor).
const cssOut = `${DIST}/static/styles/main.css`
const tailwind = Bun.spawn(
  [
    'node_modules/.bin/tailwindcss',
    '--input',
    'assets/static/styles/tailwind.css',
    '--output',
    cssOut
  ],
  { stdout: 'inherit', stderr: 'inherit' }
)
if ((await tailwind.exited) !== 0) {
  console.error('✗ Tailwind build failed')
  process.exit(1)
}
await writeFile(cssOut, await processCss(await readFile(cssOut, 'utf8'), { flattenLayers: true, filename: cssOut }))
console.log(`✓ CSS: ${cssOut}`)

// 4. Client TS -> the kit's bundler (self-contained IIFE at the floor's syntax level).
await bundleJs('assets/static/js/main.ts', `${DIST}/static/js/main.js`)
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

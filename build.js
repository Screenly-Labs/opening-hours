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
import cascadeLayers from '@csstools/postcss-cascade-layers'
import browserslist from 'browserslist'
import { build as esbuild } from 'esbuild'
import { browserslistToTargets, transform as lightningcss } from 'lightningcss'
import postcss from 'postcss'
import { run as syncFonts } from './sync-fonts.js'

const DIST = 'dist'
const DOMAIN = 'opening-hours.srly.io'
const cssTargets = browserslistToTargets(browserslist())

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

// 3. Tailwind: compile the source CSS (unminified), then down-level + minify it
// for the browserslist floor. cascade-layers flattens @layer into :not(#\#)
// specificity so the cascade survives on engines that drop @layer contents;
// Lightning CSS then lowers color-mix()/nesting, adds prefixes, and minifies.
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
const flattened = await postcss([cascadeLayers()]).process(await readFile(cssOut, 'utf8'), {
  from: cssOut
})
const { code: cssCode } = lightningcss({
  filename: cssOut,
  code: Buffer.from(flattened.css),
  minify: true,
  targets: cssTargets
})
await writeFile(cssOut, cssCode)
console.log(`✓ CSS: ${cssOut} (Tailwind → cascade-layers flatten → Lightning CSS)`)

// 4. TypeScript → browser JS with esbuild. Bundles main.ts (inlining
// ./opening-hours and the polyfills shim), lowers modern syntax (?., ??, spread)
// to the ES2017 floor so old engines can parse it, and emits an IIFE so the
// output stays a self-contained self-executing classic script loadable from a
// plain <script>.
try {
  await esbuild({
    entryPoints: ['assets/static/js/main.ts'],
    bundle: true,
    minify: true,
    format: 'iife',
    target: ['es2017'],
    outfile: `${DIST}/static/js/main.js`
  })
} catch (err) {
  console.error('✗ JS build failed')
  console.error(err)
  process.exit(1)
}
console.log(`✓ JS: ${DIST}/static/js/main.js (esbuild, iife, es2017)`)

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

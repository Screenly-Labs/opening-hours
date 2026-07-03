#!/usr/bin/env bun
/* global Bun */
// Copies the self-hosted webfont files out of the Bun-managed @fontsource
// packages and into ./assets/static/fonts, where they're shipped to /static/fonts/.
// Bun owns the font versions (package.json); this step vendors the exact files we
// serve ourselves — no CDN at runtime.
//
// Fonts: Bricolage Grotesque (display face, "standard" axis = opsz + wght + wdth)
// for the business name and the big Open/Closed status; Hanken Grotesk for the
// schedule rows and their tabular numerals.

const FONTS = [
  '@fontsource-variable/bricolage-grotesque/files/bricolage-grotesque-latin-standard-normal.woff2',
  '@fontsource-variable/hanken-grotesk/files/hanken-grotesk-latin-wght-normal.woff2'
]
const DEST_DIR = 'assets/static/fonts'

export const run = async () => {
  let count = 0

  for (const rel of FONTS) {
    const file = rel.split('/').pop()
    const src = Bun.file(`node_modules/${rel}`)

    if (!(await src.exists())) {
      console.error(`✗ Missing ${file} — run \`bun install\` first.`)
      process.exit(1)
    }

    await Bun.write(`${DEST_DIR}/${file}`, src)
    console.log(`✓ Font: ${DEST_DIR}/${file}`)
    count++
  }

  console.log(`Fonts synced — ${count} file(s) vendored from @fontsource.`)
}

// Allow running standalone: `bun run sync-fonts.js`
if (import.meta.main) {
  await run()
}

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const appSource = readFileSync(new URL('../src/App.jsx', import.meta.url), 'utf8')

test('authenticated app content can shrink beside the fixed desktop sidebar', () => {
  const mainClass = appSource.match(/<main className="([^"]+)"/)?.[1]

  assert.ok(mainClass, 'expected the authenticated layout to render a main element')
  assert.match(
    mainClass,
    /(?:^|\s)min-w-0(?:\s|$)/,
    'the flex content must be allowed to shrink instead of trailing beyond the viewport',
  )
})

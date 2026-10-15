import test from 'node:test'
import assert from 'node:assert/strict'

import { BAG_KG, bagsToKg, formatBags, formatWeight, formatWeightWithBags, kgToBags, toKg } from '../src/utils/units.js'

test('a bag is 25 kg in both directions', () => {
  assert.equal(BAG_KG, 25)
  assert.equal(bagsToKg(40), 1000)
  assert.equal(bagsToKg(2.5), 62.5)
  assert.equal(kgToBags(125), 5)
})

test('entries typed in bags, kg or tons all become kg', () => {
  assert.equal(toKg('4', 'bags'), 100)
  assert.equal(toKg('12.5', 'kg'), 12.5)
  assert.equal(toKg('1.2', 'tons'), 1200)
  assert.equal(toKg('', 'kg'), null)
  assert.equal(toKg('abc', 'kg'), null)
})

test('below 1000 kg reads in kg', () => {
  assert.equal(formatWeight(975), '975 kg')
  assert.equal(formatWeight(12.5), '12.5 kg')
  assert.equal(formatWeight(999.99), '999.99 kg')
  assert.equal(formatWeight(0), '0 kg')
})

test('1000 kg and above reads in tons', () => {
  assert.equal(formatWeight(1000), '1 t')
  assert.equal(formatWeight(1250), '1.25 t')
  assert.equal(formatWeight(12300), '12.3 t')
  assert.equal(formatWeight(26314.005), '26.314 t')
})

test('signed changes show direction', () => {
  assert.equal(formatWeight(50, { signed: true }), '+50 kg')
  assert.equal(formatWeight(-1500, { signed: true }), '−1.5 t')
})

test('bag equivalents', () => {
  assert.equal(formatBags(1000), '40 bags')
  assert.equal(formatBags(25), '1 bag')
  assert.equal(formatBags(30), '1.2 bags')
  assert.equal(formatWeightWithBags(1250), '1.25 t · 50 bags')
})

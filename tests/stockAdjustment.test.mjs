import test from 'node:test'
import assert from 'node:assert/strict'

import { previewStockAdjustment, validateStockAdjustment } from '../src/utils/stockAdjustment.js'

test('add preview returns the hand-calculated closing stock', () => {
  assert.equal(previewStockAdjustment(100, 'add', 12.5), 112.5)
})

test('remove preview returns the hand-calculated closing stock', () => {
  assert.equal(previewStockAdjustment(100, 'remove', 30), 70)
})

test('removal greater than opening stock is rejected', () => {
  assert.equal(
    validateStockAdjustment({ current: 5, operation: 'remove', quantity: 6, reason: 'Count correction' }),
    'Cannot remove more than the available 5.00 kg.',
  )
})

test('zero and malformed quantities are rejected', () => {
  assert.equal(
    validateStockAdjustment({ current: 5, operation: 'add', quantity: 0, reason: 'Count correction' }),
    'Quantity must be greater than zero.',
  )
  assert.equal(
    validateStockAdjustment({ current: 5, operation: 'add', quantity: 'bags', reason: 'Count correction' }),
    'Quantity must be greater than zero.',
  )
})

test('a reason is required', () => {
  assert.equal(
    validateStockAdjustment({ current: 5, operation: 'add', quantity: 1, reason: '   ' }),
    'Reason is required.',
  )
})

test('valid adjustment has no validation error', () => {
  assert.equal(
    validateStockAdjustment({ current: 5, operation: 'remove', quantity: 2, reason: 'Damaged bag' }),
    '',
  )
})

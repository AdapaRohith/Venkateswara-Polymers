import test from 'node:test'
import assert from 'node:assert/strict'

import {
  activityActionLabel,
  activityRowActions,
  describeEntryReversal,
  getRecordBadge,
  normalizeImpactReceipt,
  previewFloorTransfer,
  previewProductionUsage,
  serializeActivityFilters,
} from '../src/utils/stockLedger.js'


test('floor transfer preview preserves plant total', () => {
  assert.deepEqual(
    previewFloorTransfer({ warehouseKg: 500, floorKg: 50, quantityKg: 100 }),
    {
      warehouseOpeningKg: 500,
      warehouseClosingKg: 400,
      floorOpeningKg: 50,
      floorClosingKg: 150,
      plantOpeningKg: 550,
      plantClosingKg: 550,
    },
  )
})


test('floor transfer preview rejects warehouse overdraw', () => {
  assert.deepEqual(
    previewFloorTransfer({ warehouseKg: 20, floorKg: 50, quantityKg: 30 }),
    { error: 'Only 20.00 kg is available in Warehouse Stock.' },
  )
})


test('production preview reduces floor and plant but not warehouse', () => {
  assert.deepEqual(
    previewProductionUsage({ warehouseKg: 400, floorKg: 150, quantityKg: 30 }),
    {
      warehouseOpeningKg: 400,
      warehouseClosingKg: 400,
      floorOpeningKg: 150,
      floorClosingKg: 120,
      plantOpeningKg: 550,
      plantClosingKg: 520,
    },
  )
})


test('preview rejects negative or malformed quantities', () => {
  assert.deepEqual(
    previewProductionUsage({ floorKg: 10, quantityKg: 'bags' }),
    { error: 'Enter a valid quantity greater than zero.' },
  )
})


test('production delete copy names the exact restoration', () => {
  assert.equal(
    describeEntryReversal({ sourceDomain: 'PRODUCTION', materialName: 'OPALENE', quantityKg: 30 }),
    'Delete this production entry? 30.00 kg of OPALENE will be restored to Floor Stock. The reversal will remain visible in Stock Activity.',
  )
})


test('floor transfer delete copy explains both locations', () => {
  assert.equal(
    describeEntryReversal({ sourceDomain: 'FLOOR_TRANSFER', materialName: 'OPALENE', quantityKg: 10 }),
    'Delete this floor transfer? 10.00 kg of OPALENE will move from Floor Stock back to Warehouse Stock. The reversal will remain visible in Stock Activity.',
  )
})


test('receipt normalization preserves authoritative closing balances', () => {
  assert.deepEqual(
    normalizeImpactReceipt({ warehouse_closing_kg: 400, floor_closing_kg: 150 }),
    { warehouseClosingKg: 400, floorClosingKg: 150 },
  )
})


test('entry and activity badges are visibly distinct', () => {
  assert.notDeepEqual(getRecordBadge('entry'), getRecordBadge('activity'))
  assert.equal(getRecordBadge('entry').label, 'Editable entry')
  assert.equal(getRecordBadge('activity').label, 'Read-only activity')
})


test('activity actions never expose destructive controls', () => {
  const actions = activityRowActions({ entryPath: '/production-log', sourceId: 21 })
  assert.deepEqual(actions.map((action) => action.label), ['View Entry'])
  assert.deepEqual(activityRowActions({ entryPath: null, sourceId: null }), [])
})


test('activity filters serialize only populated values', () => {
  assert.equal(
    serializeActivityFilters({ dateFrom: '2026-10-01', dateTo: '', sourceDomain: 'PRODUCTION', action: 'CREATE' }),
    'date_from=2026-10-01&source_domain=PRODUCTION&action=CREATE',
  )
})


test('activity labels explain stock meaning in plain language', () => {
  assert.equal(activityActionLabel('RAW_INPUT', 'CREATE'), 'Received')
  assert.equal(activityActionLabel('FLOOR_TRANSFER', 'CREATE'), 'Moved to Floor')
  assert.equal(activityActionLabel('PRODUCTION', 'CREATE'), 'Used in Production')
  assert.equal(activityActionLabel('MANUAL_ADJUSTMENT', 'CREATE'), 'Corrected')
  assert.equal(activityActionLabel('PRODUCTION', 'REVERSE'), 'Reversed')
  assert.equal(activityActionLabel('RAW_INPUT', 'LEGACY'), 'Legacy')
})

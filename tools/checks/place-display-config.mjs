// Run: node --experimental-strip-types tools/checks/place-display-config.mjs
import assert from 'node:assert/strict'
import { placeDisplayConfig } from '../../app/src/native/placeDisplayConfig.ts'
import { layoutMarkers } from '../../app/src/native/markerLayout.ts'

const ids = Array.from({ length: 9 }, (_, i) => `aaaaaaaa-1111-4111-8111-${String(i + 1).padStart(12, '0')}`)
const candidates = ids.map((id, i) => ({
  marker: { id, placeId: id, ...placeDisplayConfig({ id }) },
  x: 50 + i * 100, y: 100,
  base: { left: 30 + i * 100, top: 80, right: 70 + i * 100, bottom: 120 },
  stack: { left: 30 + i * 100, top: 20, right: 70 + i * 100, bottom: 60 },
}))
const viewport = { left: 0, top: 0, right: 1000, bottom: 300 }
const visibleAt = zoom => layoutMarkers(candidates, zoom, viewport, '', new Set()).visible
assert.equal(visibleAt(14.99).size, 0, 'fallback must not reveal configured places early')
assert.deepEqual([...visibleAt(15)].sort(), [ids[0], ids[2], ids[3]].sort())
assert.equal(visibleAt(16.49).size, 3)
assert.equal(visibleAt(16.5).size, 6)
assert.equal(visibleAt(17.49).size, 6)
assert.equal(visibleAt(17.5).size, 9)
assert.equal(visibleAt(15).size, 3, 'zooming out hides later batches again')

const collision = candidates.slice(0, 2).map(c => ({ ...c, base: candidates[0].base }))
assert.deepEqual([...layoutMarkers(collision, 18, viewport, '', new Set()).visible], [ids[0]])
assert.equal(placeDisplayConfig({ id: ids[0], minDisplayZoom: 18 }).minDisplayZoom, 18)
assert.equal(placeDisplayConfig({ id: ids[0], displayPriority: -1 }).displayPriority, -1)
assert.equal(placeDisplayConfig({ id: ids[0], displayLevel: 'school' }).minDisplayZoom, undefined)
assert.equal(placeDisplayConfig({ id: 'unknown' }).minDisplayZoom, undefined)
console.log('Place display checks passed: zoom batches, fallback, collisions, and maintenance overrides.')

import assert from 'node:assert/strict'
import { DriverPlayback } from './driverPlayback.ts'

const base = Date.parse('2026-01-01T00:00:00.000Z')
const stamp = seconds => new Date(base + seconds * 1000).toISOString()
const point = (lat, lon, seconds) => ({ lat, lon, recorded_at: stamp(seconds) })

const playback = new DriverPlayback({ playbackDelayMs: 1000, maxGapMs: 15_000 })
assert.equal(playback.addLocation(point(0, 0, 0), 0), true)
assert.equal(playback.addLocation(point(0, 0.001, 5), 5_000), true)
assert.equal(playback.addLocation(point(0, 0.001, 5), 5_500), false)
assert.equal(playback.diagnosticsSnapshot.duplicates, 1)

const interpolated = playback.frame(3_500)
assert.equal(interpolated?.mode, 'interpolated')
assert.ok((interpolated?.position.lng || 0) > 0.0004 && (interpolated?.position.lng || 0) < 0.0006)

assert.equal(playback.addLocation(point(0, 0.0006, 3), 6_000), true)
const reordered = playback.frame(4_500)
assert.equal(reordered?.mode, 'interpolated')
assert.ok((reordered?.position.lng || 0) > 0.0005)
assert.ok(playback.diagnosticsSnapshot.outOfOrder >= 1)

const held = playback.frame(8_000)
assert.equal(held?.mode, 'held')
assert.equal(held?.position.lng, 0.001)

const routePlayback = new DriverPlayback({ playbackDelayMs: 1000 })
routePlayback.setRoute([{ lat: 0, lng: 0 }, { lat: 0, lng: 0.01 }, { lat: 0.01, lng: 0.01 }])
assert.equal(routePlayback.addLocation(point(0, 0, 0), 0), true)
assert.equal(routePlayback.addLocation(point(0, 0.001, 5), 5_000), true)
const routeFrame = routePlayback.frame(3_500)
assert.equal(routeFrame?.mode, 'interpolated')
assert.ok(Math.abs(routeFrame?.position.lat || 0) < 0.00001)
assert.ok((routeFrame?.position.lng || 0) > 0.0003)

const broken = new DriverPlayback({ playbackDelayMs: 1000 })
broken.addLocation(point(0, 0, 0), 0)
broken.addLocation(point(0, 0.1, 30), 30_000)
assert.equal(broken.frame(31_500)?.mode, 'discontinuity')

console.log('driverPlayback tests passed')

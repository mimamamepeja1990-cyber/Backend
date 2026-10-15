export type PlaybackPoint = { lat: number; lng: number }

export type DriverLocationSample = PlaybackPoint & {
  sourceAt?: number
  timelineAt: number
  receivedAt: number
  breakBefore?: boolean
}

export type PlaybackFrame = {
  position: PlaybackPoint
  mode: 'initial' | 'interpolated' | 'held' | 'discontinuity'
  staleMs: number
  fromAt?: number
  toAt?: number
}

export type PlaybackDiagnostics = {
  received: number
  accepted: number
  duplicates: number
  outOfOrder: number
  discontinuities: number
  interpolatedFrames: number
  heldFrames: number
}

type RoutePoint = PlaybackPoint & { distance: number }

const EARTH_RADIUS_M = 6_371_000

function finite(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

function toEpochMs(value: unknown): number | undefined {
  if (value instanceof Date) {
    const time = value.getTime()
    return Number.isFinite(time) ? time : undefined
  }
  if (typeof value === 'number' && Number.isFinite(value)) {
    const ms = Math.abs(value) < 10_000_000_000 ? value * 1000 : value
    return Number.isFinite(ms) ? ms : undefined
  }
  if (typeof value === 'string' && value.trim()) {
    const parsed = Date.parse(value)
    return Number.isFinite(parsed) ? parsed : undefined
  }
  return undefined
}

function radians(value: number) { return value * Math.PI / 180 }

export function distanceMeters(a: PlaybackPoint, b: PlaybackPoint): number {
  const dLat = radians(b.lat - a.lat)
  const dLng = radians(b.lng - a.lng)
  const latA = radians(a.lat)
  const latB = radians(b.lat)
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(latA) * Math.cos(latB) * Math.sin(dLng / 2) ** 2
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h)))
}

function interpolate(a: PlaybackPoint, b: PlaybackPoint, ratio: number): PlaybackPoint {
  return {
    lat: a.lat + (b.lat - a.lat) * ratio,
    lng: a.lng + (b.lng - a.lng) * ratio,
  }
}

function buildRoute(points: PlaybackPoint[]): RoutePoint[] {
  const route: RoutePoint[] = []
  let total = 0
  const normalized = points.filter(point => finite(point?.lat) && finite(point?.lng))
  normalized.forEach((point, index) => {
    if (index > 0) total += distanceMeters(normalized[index - 1], point)
    route.push({ lat: point.lat, lng: point.lng, distance: total })
  })
  return route
}

function projectOnRoute(point: PlaybackPoint, route: RoutePoint[]): { distance: number; offset: number } | null {
  if (route.length < 2) return null
  let best: { distance: number; offset: number } | null = null
  const latitudeScale = Math.cos(radians(point.lat))
  for (let index = 1; index < route.length; index += 1) {
    const start = route[index - 1]
    const end = route[index]
    const x = (point.lng - start.lng) * latitudeScale
    const y = point.lat - start.lat
    const dx = (end.lng - start.lng) * latitudeScale
    const dy = end.lat - start.lat
    const denominator = dx * dx + dy * dy
    const ratio = denominator > 0 ? Math.max(0, Math.min(1, (x * dx + y * dy) / denominator)) : 0
    const candidate = { lat: start.lat + (end.lat - start.lat) * ratio, lng: start.lng + (end.lng - start.lng) * ratio }
    const offset = distanceMeters(point, candidate)
    if (!best || offset < best.offset) best = { distance: start.distance + (end.distance - start.distance) * ratio, offset }
  }
  return best
}

function pointAtRouteDistance(route: RoutePoint[], distance: number): PlaybackPoint {
  if (!route.length) return { lat: 0, lng: 0 }
  if (distance <= 0) return route[0]
  if (distance >= route[route.length - 1].distance) return route[route.length - 1]
  for (let index = 1; index < route.length; index += 1) {
    const before = route[index - 1]
    const after = route[index]
    if (distance <= after.distance) {
      const ratio = (distance - before.distance) / Math.max(1, after.distance - before.distance)
      return interpolate(before, after, ratio)
    }
  }
  return route[route.length - 1]
}

export class DriverPlayback {
  private samples: DriverLocationSample[] = []
  private route: RoutePoint[] = []
  private sourceToMonoOffset?: number
  private readonly maxSamples: number
  private readonly playbackDelayMs: number
  private readonly maxGapMs: number
  private readonly maxSpeedMps: number
  private diagnostics: PlaybackDiagnostics = { received: 0, accepted: 0, duplicates: 0, outOfOrder: 0, discontinuities: 0, interpolatedFrames: 0, heldFrames: 0 }

  constructor(options: { playbackDelayMs?: number; maxSamples?: number; maxGapMs?: number; maxSpeedMps?: number } = {}) {
    this.playbackDelayMs = Math.max(1000, Math.min(8000, options.playbackDelayMs ?? 3500))
    this.maxSamples = Math.max(8, Math.min(120, options.maxSamples ?? 48))
    this.maxGapMs = Math.max(5000, Math.min(60_000, options.maxGapMs ?? 15_000))
    this.maxSpeedMps = Math.max(10, Math.min(80, options.maxSpeedMps ?? 45))
  }

  addLocation(location: AnyRecord, receivedAt: number, receivedWallTime = Date.now()): boolean {
    this.diagnostics.received += 1
    const lat = Number(location?.lat)
    const lng = Number(location?.lon ?? location?.lng)
    if (!finite(lat) || !finite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) return false
    const sourceAt = toEpochMs(location?.recorded_at ?? location?.timestamp)
    if (sourceAt !== undefined && this.sourceToMonoOffset === undefined) this.sourceToMonoOffset = receivedAt - sourceAt
    const timelineAt = sourceAt !== undefined && this.sourceToMonoOffset !== undefined
      ? sourceAt + this.sourceToMonoOffset
      : receivedAt
    const duplicate = this.samples.some(sample =>
      Math.abs(sample.timelineAt - timelineAt) < 2 && distanceMeters(sample, { lat, lng }) < 1,
    )
    if (duplicate) {
      this.diagnostics.duplicates += 1
      return false
    }
    const latest = this.samples[this.samples.length - 1]
    if (latest && timelineAt < latest.timelineAt) this.diagnostics.outOfOrder += 1
    const sample: DriverLocationSample = { lat, lng, sourceAt, timelineAt, receivedAt }
    const insertionIndex = this.samples.findIndex(item => item.timelineAt > timelineAt)
    const previous = insertionIndex < 0 ? this.samples[this.samples.length - 1] : insertionIndex > 0 ? this.samples[insertionIndex - 1] : undefined
    if (insertionIndex < 0) this.samples.push(sample)
    else this.samples.splice(insertionIndex, 0, sample)
    if (previous) {
      const dt = sample.timelineAt - previous.timelineAt
      const meters = distanceMeters(previous, sample)
      const allowed = Math.max(300, (Math.max(0, dt) / 1000) * this.maxSpeedMps * 2 + 100)
      if (dt <= 0 || dt > this.maxGapMs || meters > allowed) {
        sample.breakBefore = true
        this.diagnostics.discontinuities += 1
      }
    }
    while (this.samples.length > this.maxSamples) this.samples.shift()
    this.diagnostics.accepted += 1
    this.refreshRouteProjection()
    void receivedWallTime
    return true
  }

  setRoute(points: PlaybackPoint[]) {
    const next = buildRoute(points)
    const changed = next.length !== this.route.length || next.some((point, index) => {
      const previous = this.route[index]
      return !previous || previous.lat !== point.lat || previous.lng !== point.lng
    })
    if (changed) {
      this.route = next
      this.refreshRouteProjection()
    }
  }

  private refreshRouteProjection() {
    if (this.route.length < 2) return
    this.samples.forEach(sample => {
      const projection = projectOnRoute(sample, this.route)
      ;(sample as DriverLocationSample & { routeDistance?: number }).routeDistance = projection && projection.offset <= 150 ? projection.distance : undefined
    })
  }

  frame(now: number): PlaybackFrame | null {
    if (!this.samples.length) return null
    const displayAt = now - this.playbackDelayMs
    const first = this.samples[0]
    const last = this.samples[this.samples.length - 1]
    if (displayAt < first.timelineAt) {
      this.diagnostics.heldFrames += 1
      return { position: first, mode: 'initial', staleMs: 0, toAt: first.timelineAt }
    }
    if (last.breakBefore && displayAt >= last.timelineAt) {
      this.diagnostics.discontinuities += 1
      return { position: last, mode: 'discontinuity', staleMs: 0, fromAt: this.samples.length > 1 ? this.samples[this.samples.length - 2].timelineAt : undefined, toAt: last.timelineAt }
    }
    if (displayAt >= last.timelineAt) {
      this.diagnostics.heldFrames += 1
      return { position: last, mode: 'held', staleMs: Math.max(0, displayAt - last.timelineAt), fromAt: last.timelineAt }
    }
    let afterIndex = this.samples.findIndex(sample => sample.timelineAt >= displayAt)
    if (afterIndex <= 0) afterIndex = 1
    const before = this.samples[afterIndex - 1]
    const after = this.samples[afterIndex]
    if (after.breakBefore) {
      this.diagnostics.heldFrames += 1
      if (displayAt < after.timelineAt) return { position: before, mode: 'held', staleMs: Math.max(0, displayAt - before.timelineAt), fromAt: before.timelineAt, toAt: after.timelineAt }
      this.diagnostics.discontinuities += 1
      return { position: after, mode: 'discontinuity', staleMs: 0, fromAt: before.timelineAt, toAt: after.timelineAt }
    }
    const ratio = Math.max(0, Math.min(1, (displayAt - before.timelineAt) / Math.max(1, after.timelineAt - before.timelineAt)))
    const beforeRoute = (before as DriverLocationSample & { routeDistance?: number }).routeDistance
    const afterRoute = (after as DriverLocationSample & { routeDistance?: number }).routeDistance
    let position: PlaybackPoint
    if (beforeRoute !== undefined && afterRoute !== undefined && afterRoute >= beforeRoute) {
      position = pointAtRouteDistance(this.route, beforeRoute + (afterRoute - beforeRoute) * ratio)
    } else {
      position = interpolate(before, after, ratio)
    }
    this.diagnostics.interpolatedFrames += 1
    return { position, mode: 'interpolated', staleMs: 0, fromAt: before.timelineAt, toAt: after.timelineAt }
  }

  get size() { return this.samples.length }
  get diagnosticsSnapshot() { return { ...this.diagnostics } }
}

type AnyRecord = Record<string, any>

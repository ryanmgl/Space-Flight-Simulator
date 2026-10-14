import { BODIES, DEFAULT_SPACECRAFT, DT, SUN_RADIUS, add, applyThrust, bodyPosition, collision, collisionBetween, cross, dot, currentMass, isArrival, length, makeInitialSample, maxStepDeltaV, mul, relativeArrivalSpeed, sub, targetPosition, targetVelocity, unit, verlet } from '../physics/model'
import type { Body, Burn, Encounter, Route, RouteResult, Sample, SearchParams, Vec } from '../physics/model'
import { nondominated } from './pareto'

const CONTROL_STEPS = 4
const MAX_BURN = .5 // Maximum commanded delta-v per control action.
const BURN_THRESHOLD = .025
const ZERO: Vec = { x: 0, y: 0, z: 0 }
const UP: Vec = { x: 0, y: 0, z: 1 }
type Variant = { speed: number; side: -1 | 0 | 1; lift: -1 | 0 | 1; clearance: number }
export type AdaptiveProgress = { trial: number; total: number; expanded: number; candidates: number; collisions: number }

function closestOnSegment(start: Vec, end: Vec, center: Vec): { along: number; distance: number } {
  const travel = sub(end, start)
  const span = length(travel)
  if (!span) return { along: 0, distance: length(sub(start, center)) }
  const direction = mul(travel, 1 / span)
  const along = Math.max(0, Math.min(span, dot(sub(center, start), direction)))
  return { along, distance: length(sub(add(start, mul(direction, along)), center)) }
}

function detourWaypoint(params: SearchParams, variant: Variant): Vec | null {
  if (!variant.side && !variant.lift) return null
  const travel = sub(targetPosition(params, params.launchTime), params.start)
  const distance = length(travel)
  if (!distance) return null
  const normal = unit(cross(UP, travel))
  const lift = unit(cross(travel, normal))
  let selected: { center: Vec; radius: number; along: number } | null = null
  const sun = closestOnSegment(params.start, targetPosition(params, params.launchTime), ZERO)
  if (sun.along > 0 && sun.along < distance && sun.distance < SUN_RADIUS + variant.clearance) selected = { center: ZERO, radius: SUN_RADIUS, along: sun.along }
  for (const body of BODIES) {
    const initial = bodyPosition(body, params.launchTime)
    const estimate = closestOnSegment(params.start, targetPosition(params, params.launchTime), initial)
    const encounterTime = params.launchTime + estimate.along / Math.max(.75, variant.speed)
    const center = bodyPosition(body, encounterTime)
    const crossing = closestOnSegment(params.start, targetPosition(params, params.launchTime), center)
    if (crossing.along > 0 && crossing.along < distance && crossing.distance < body.radius + variant.clearance && (!selected || crossing.along < selected.along)) {
      selected = { center, radius: body.radius, along: crossing.along }
    }
  }
  return selected ? add(selected.center, mul(unit(add(mul(normal, variant.side), mul(lift, variant.lift))), selected.radius + variant.clearance + .15)) : null
}

function guidedDirection(pos: Vec, goal: Vec, absoluteTime: number, speed: number, side: -1 | 0 | 1, lift: -1 | 0 | 1, targetBody?: string | null): Vec {
  let direction = unit(sub(goal, pos))
  const lookAhead = Math.min(length(sub(goal, pos)), Math.max(.45, speed * .5))
  const bodies: Array<{ center: Vec; radius: number; body?: Body }> = [{ center: ZERO, radius: SUN_RADIUS }, ...BODIES.map(body => ({ center: bodyPosition(body, absoluteTime), radius: body.radius, body }))]
  for (const item of bodies) {
    const rough = closestOnSegment(pos, add(pos, mul(direction, lookAhead)), item.center)
    const future = item.body ? bodyPosition(item.body, absoluteTime + rough.along / Math.max(speed, .5)) : item.center
    const approach = closestOnSegment(pos, add(pos, mul(direction, lookAhead)), future)
    const margin = item.radius + (item.body ? item.body.name === targetBody ? .012 : .20 : .33)
    if (approach.along > 0 && approach.distance < margin) {
      const away = unit(sub(pos, future))
      const turn = side || (cross(direction, away).z >= 0 ? 1 : -1)
      const tangent = unit(add(mul(cross(UP, away), turn), mul(cross(direction, away), lift)))
      const strength = Math.min(2, (margin - approach.distance) / margin + .7)
      direction = unit(add(direction, add(mul(tangent, strength), mul(away, strength * .45))))
    }
  }
  return direction
}

function routeFromSamples(samples: Sample[], burns: Burn[], params: SearchParams): Route {
  const encounters: Encounter[] = []
  const seen = new Set<string>()
  for (const sample of samples) {
    for (const body of BODIES) {
      const distance = length(sub(sample.pos, bodyPosition(body, params.launchTime + sample.t)))
      if (distance < body.radius + .12 && !seen.has(body.name)) {
        seen.add(body.name)
        encounters.push({ t: sample.t, pos: sample.pos, body: body.name, distance })
      }
    }
  }
  const last = samples[samples.length - 1]
  return { samples, burns, encounters, travelTime: last.t, fuel: last.fuel, arrivalSpeed: length(last.vel), relativeArrivalSpeed: relativeArrivalSpeed(last, params), propellantUsed: last.propellantUsed, id: `extended:${last.t.toFixed(4)}:${last.fuel.toFixed(4)}` }
}

function simulateVariant(params: SearchParams, variant: Variant, maxTime: number, countAction: () => void): { route: Route | null; collided: boolean } {
  let sample = makeInitialSample(params.start, params.launchTime)
  if (collision(sample.pos, params.launchTime)) return { route: null, collided: true }
  const samples: Sample[] = [sample]
  const burns: Burn[] = []
  const waypoint = detourWaypoint(params, variant)
  let passedWaypoint = !waypoint
  const maxActions = Math.ceil(maxTime / (CONTROL_STEPS * DT))
  for (let action = 0; action < maxActions; action++) {
    countAction()
    if (!passedWaypoint && waypoint && length(sub(waypoint, sample.pos)) < Math.max(.22, variant.speed * .06)) passedWaypoint = true
    let dv = ZERO
    if (variant.speed > 0) {
      const now = params.launchTime + sample.t
      let intercept = targetPosition(params, now)
      let eta = 0
      if (passedWaypoint) {
        for (let i = 0; i < 3; i++) {
          eta = Math.min(2, length(sub(intercept, sample.pos)) / Math.max(variant.speed, .75))
          intercept = targetPosition(params, now + eta)
        }
      }
      const goal = passedWaypoint ? intercept : waypoint!
      const remaining = length(sub(goal, sample.pos))
      const direction = guidedDirection(sample.pos, goal, now, variant.speed, variant.side, variant.lift, params.targetBody)
      const craft = params.spacecraft ?? DEFAULT_SPACECRAFT
      const brakingAcceleration = craft.maxThrust / currentMass(sample, craft)
      const safeSpeed = Math.min(variant.speed, Math.sqrt((params.arrivalSpeedLimit ?? .35) ** 2 + 2 * brakingAcceleration * Math.max(0, remaining - params.targetRadius)))
      const desiredVelocity = add(passedWaypoint ? targetVelocity(params, now + eta) : ZERO, mul(direction, safeSpeed))
      const correction = sub(desiredVelocity, sample.vel)
      const magnitude = length(correction)
      if (magnitude > BURN_THRESHOLD) dv = mul(correction, Math.min(MAX_BURN, magnitude) / magnitude)
    }
    const burnStart = sample
    let delivered = ZERO
    let burnSteps = 0
    for (let step = 0; step < CONTROL_STEPS; step++) {
      const craft = params.spacecraft ?? DEFAULT_SPACECRAFT
      const desiredStep = mul(dv, 1 / CONTROL_STEPS)
      const desiredMagnitude = length(desiredStep)
      const allowed = maxStepDeltaV(sample, craft, DT, params.budget)
      const actualStep = desiredMagnitude ? mul(desiredStep, Math.min(1, allowed / desiredMagnitude)) : ZERO
      sample = applyThrust(sample, actualStep, craft, DT, params.budget)!
      if (length(actualStep) > 1e-9) { delivered = add(delivered, actualStep); burnSteps++ }
      const prior = sample
      sample = verlet(sample, DT, params.launchTime)
      if (collisionBetween(prior.pos, sample.pos, params.launchTime + prior.t, params.launchTime + sample.t)) return { route: null, collided: true }
      samples.push(sample)
      if (isArrival(sample, params)) {
        if (burnSteps) burns.push({ t: burnStart.t, pos: burnStart.pos, dv: delivered, duration: burnSteps * DT, propellant: sample.propellantUsed - burnStart.propellantUsed })
        return { route: routeFromSamples(samples, burns, params), collided: false }
      }
    }
    if (burnSteps) burns.push({ t: burnStart.t, pos: burnStart.pos, dv: delivered, duration: burnSteps * DT, propellant: sample.propellantUsed - burnStart.propellantUsed })
  }
  return { route: null, collided: false }
}

// Extended search varies cruise speed and detour side. Every candidate is still
// produced by the shared fixed-step gravity and burn functions, then collision checked.
export function searchAdaptiveRoutes(params: SearchParams, onProgress?: (progress: AdaptiveProgress) => void): RouteResult {
  const distance = length(sub(targetPosition(params, params.launchTime), params.start))
  const maxTime = Math.min(120, Math.max(params.targetBody ? 6 : 3, 2 + distance / .65))
  const speeds = [...new Set([.75, 1.1, 1.6, 2.3, 3.2, 4.5, Math.min(12, Math.max(5.5, distance / 8))])]
  const variants: Variant[] = [{ speed: 0, side: 0, lift: 0, clearance: 0 }, ...speeds.flatMap(speed => [
    { speed, side: 0 as const, lift: 0 as const, clearance: 0 },
    { speed, side: 1 as const, lift: 0 as const, clearance: .45 }, { speed, side: -1 as const, lift: 0 as const, clearance: .45 },
    { speed, side: 1 as const, lift: 0 as const, clearance: .8 }, { speed, side: -1 as const, lift: 0 as const, clearance: .8 },
    { speed, side: 0 as const, lift: 1 as const, clearance: .45 }, { speed, side: 0 as const, lift: -1 as const, clearance: .45 },
  ])]
  const arrivals: Route[] = []
  let expanded = 0, collisions = 0
  for (const [index, variant] of variants.entries()) {
    const attempt = simulateVariant(params, variant, maxTime, () => { expanded++ })
    if (attempt.collided) collisions++
    if (attempt.route) arrivals.push(attempt.route)
    onProgress?.({ trial: index + 1, total: variants.length, expanded, candidates: arrivals.length, collisions })
  }
  const feasible = nondominated(arrivals)
  const fastest = [...feasible].sort((a, b) => a.travelTime - b.travelTime || a.fuel - b.fuel)[0] ?? null
  const lowestFuel = [...feasible].sort((a, b) => a.fuel - b.fuel || a.travelTime - b.travelTime)[0] ?? null
  return { fastest, lowestFuel: fastest === lowestFuel ? fastest : lowestFuel, candidates: arrivals.length, expanded, collisions, fuelRejected: 0, status: fastest ? 'feasible' : 'no-route', extended: true, searchTimeLimit: maxTime }
}

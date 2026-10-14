export type Vec = { x: number; y: number; z: number }
export type Body = { name: string; orbit: number; period: number; phase: number; inclination: number; node: number; mu: number; radius: number; color: string; size: number }
export type Sample = { t: number; pos: Vec; vel: Vec; acc: Vec; fuel: number; propellantUsed: number }
export type Burn = { t: number; pos: Vec; dv: Vec; duration: number; propellant: number }
export type Encounter = { t: number; pos: Vec; body: string; distance: number }
export type Route = { samples: Sample[]; burns: Burn[]; encounters: Encounter[]; travelTime: number; fuel: number; arrivalSpeed: number; relativeArrivalSpeed: number; propellantUsed: number; id: string }
export type RouteResult = { fastest: Route | null; lowestFuel: Route | null; candidates: number; expanded: number; collisions: number; fuelRejected: number; status: 'feasible' | 'collision' | 'out-of-fuel' | 'no-route'; extended?: boolean; searchTimeLimit?: number }
export type Spacecraft = { dryMass: number; propellantMass: number; exhaustVelocity: number; maxThrust: number }
export type SearchParams = { start: Vec; target: Vec; targetBody?: string | null; launchTime: number; budget: number; targetRadius: number; arrivalSpeedLimit?: number; spacecraft?: Spacecraft }

// Educational distance units (DU) are compressed. Circular periods follow
// Kepler's law for the model Sun so planet and probe velocities are consistent.
// Time is a model year (yr); velocity is DU/yr; mu is DU^3/yr^2; fuel is total delta-v in DU/yr.
export const SUN_MU = 1.7
export const SUN_RADIUS = 0.11
export const DT = 0.0125
export const TARGET_RADIUS = 0.115
export const ARRIVAL_SPEED_LIMIT = 0.35
// Mass is kg; exhaust velocity is DU/yr; thrust is kg·DU/yr².
export const DEFAULT_SPACECRAFT: Spacecraft = { dryMass: 800, propellantMass: 1200, exhaustVelocity: 8, maxThrust: 32000 }
// A visual guide just beyond Neptune's orbit; extended routing may go beyond it.
export const ORBIT_GUIDE_RADIUS = 5.4
function circularPeriod(radius: number): number { return 2 * Math.PI * Math.sqrt(radius ** 3 / SUN_MU) }
export const BODIES: Body[] = [
  { name: 'Mercury', orbit: .42, period: circularPeriod(.42), phase: 2.1, inclination: .16, node: .84, mu: .000005, radius: .022, color: '#aeb9c4', size: 3.5 },
  { name: 'Venus', orbit: .73, period: circularPeriod(.73), phase: 3.2, inclination: -.12, node: 1.34, mu: .000025, radius: .030, color: '#dfb574', size: 5 },
  { name: 'Earth', orbit: 1.0, period: circularPeriod(1), phase: 1.45, inclination: .08, node: .35, mu: .000040, radius: .034, color: '#6da8fa', size: 5.5 },
  { name: 'Mars', orbit: 1.48, period: circularPeriod(1.48), phase: 2.55, inclination: .22, node: .86, mu: .000012, radius: .027, color: '#e88e72', size: 4.5 },
  { name: 'Jupiter', orbit: 2.16, period: circularPeriod(2.16), phase: 4.5, inclination: -.08, node: 1.75, mu: .00060, radius: .065, color: '#e9bc93', size: 9 },
  { name: 'Saturn', orbit: 2.98, period: circularPeriod(2.98), phase: 4.05, inclination: .18, node: 1.98, mu: .00023, radius: .054, color: '#e5d5a2', size: 8 },
  { name: 'Uranus', orbit: 3.94, period: circularPeriod(3.94), phase: 5.72, inclination: -.24, node: 1.29, mu: .000085, radius: .042, color: '#8ed4df', size: 6.5 },
  { name: 'Neptune', orbit: 5.03, period: circularPeriod(5.03), phase: 3.55, inclination: .13, node: 2.30, mu: .00010, radius: .041, color: '#638bea', size: 6.5 },
]
export function bodyDisplayRadius(body: Body): number { return Math.max(body.radius, body.size * .01) }
export const PRESET: SearchParams = { start: { x: 1.02, y: -.04, z: 0 }, target: bodyPosition(BODIES[4], 0), targetBody: 'Jupiter', launchTime: 0, budget: 5.5, targetRadius: TARGET_RADIUS, arrivalSpeedLimit: ARRIVAL_SPEED_LIMIT, spacecraft: DEFAULT_SPACECRAFT }

export function add(a: Vec, b: Vec): Vec { return { x: a.x + b.x, y: a.y + b.y, z: a.z + b.z } }
export function sub(a: Vec, b: Vec): Vec { return { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z } }
export function mul(a: Vec, s: number): Vec { return { x: a.x * s, y: a.y * s, z: a.z * s } }
export function dot(a: Vec, b: Vec): number { return a.x * b.x + a.y * b.y + a.z * b.z }
export function cross(a: Vec, b: Vec): Vec { return { x: a.y * b.z - a.z * b.y, y: a.z * b.x - a.x * b.z, z: a.x * b.y - a.y * b.x } }
export function length(v: Vec): number { return Math.hypot(v.x, v.y, v.z) }
export function unit(v: Vec): Vec { const l = length(v); return l ? mul(v, 1 / l) : { x: 0, y: 0, z: 0 } }
function orbitalVector(body: Body, a: number, radius: number): Vec {
  const c = Math.cos(body.node), s = Math.sin(body.node), ci = Math.cos(body.inclination), si = Math.sin(body.inclination)
  const u = radius * Math.cos(a), v = radius * Math.sin(a)
  return { x: c * u - s * ci * v, y: s * u + c * ci * v, z: si * v }
}
export function bodyPosition(body: Body, t: number): Vec { return orbitalVector(body, body.phase - body.node + 2 * Math.PI * t / body.period, body.orbit) }
export function bodyVelocity(body: Body, t: number): Vec { return orbitalVector(body, body.phase - body.node + 2 * Math.PI * t / body.period + Math.PI / 2, 2 * Math.PI * body.orbit / body.period) }
export function destinationBody(params: SearchParams): Body | undefined { return BODIES.find(body => body.name === params.targetBody) }
export function targetPosition(params: SearchParams, absoluteTime: number): Vec { const body = destinationBody(params); return body ? bodyPosition(body, absoluteTime) : params.target }
export function targetVelocity(params: SearchParams, absoluteTime: number): Vec { const body = destinationBody(params); return body ? bodyVelocity(body, absoluteTime) : { x: 0, y: 0, z: 0 } }
export function relativeArrivalSpeed(sample: Sample, params: SearchParams): number { return length(sub(sample.vel, targetVelocity(params, params.launchTime + sample.t))) }
export function isArrival(sample: Sample, params: SearchParams): boolean {
  return !collision(sample.pos, params.launchTime + sample.t) && length(sub(sample.pos, targetPosition(params, params.launchTime + sample.t))) <= params.targetRadius && relativeArrivalSpeed(sample, params) <= (params.arrivalSpeedLimit ?? ARRIVAL_SPEED_LIMIT)
}
export function maximumDeltaV(craft: Spacecraft): number { return craft.exhaustVelocity * Math.log((craft.dryMass + craft.propellantMass) / craft.dryMass) }
export function currentMass(sample: Sample, craft: Spacecraft): number { return craft.dryMass + craft.propellantMass - sample.propellantUsed }
export function maxStepDeltaV(sample: Sample, craft: Spacecraft, dt: number, budget: number): number {
  const mass = currentMass(sample, craft)
  const propellant = Math.min(craft.propellantMass - sample.propellantUsed, craft.maxThrust * dt / craft.exhaustVelocity)
  return Math.max(0, Math.min(budget - sample.fuel, propellant > 0 ? craft.exhaustVelocity * Math.log(mass / (mass - propellant)) : 0))
}
export function initialVelocity(pos: Vec): Vec { const r = Math.max(length(pos), SUN_RADIUS); const axis = Math.hypot(pos.x, pos.y) < 1e-6 ? { x: 0, y: 1, z: 0 } : { x: 0, y: 0, z: 1 }; return mul(unit(cross(axis, pos)), Math.sqrt(SUN_MU / r)) }

export function gravityContribution(pos: Vec, bodyPos: Vec, mu: number): Vec {
  const d = sub(bodyPos, pos)
  const r2 = Math.max(dot(d, d), .000001)
  return mul(d, mu / (r2 * Math.sqrt(r2)))
}
export function gravitationalContributions(pos: Vec, t: number): { name: string; distance: number; acc: Vec }[] {
  return [
    { name: 'Sun', distance: length(pos), acc: gravityContribution(pos, { x: 0, y: 0, z: 0 }, SUN_MU) },
    ...BODIES.map(body => { const bp = bodyPosition(body, t); return { name: body.name, distance: length(sub(pos, bp)), acc: gravityContribution(pos, bp, body.mu) } }),
  ]
}
export function acceleration(pos: Vec, t: number): Vec {
  let a: Vec = { x: 0, y: 0, z: 0 }
  for (const item of gravitationalContributions(pos, t)) a = add(a, item.acc)
  return a
}
export function collision(pos: Vec, t: number): string | null {
  if (length(pos) <= SUN_RADIUS) return 'Sun'
  for (const body of BODIES) if (length(sub(pos, bodyPosition(body, t))) <= body.radius) return body.name
  return null
}
function segmentDistance(a: Vec, b: Vec): number {
  const d = sub(b, a)
  const denom = dot(d, d)
  const u = denom ? Math.max(0, Math.min(1, -dot(a, d) / denom)) : 0
  return length(add(a, mul(d, u)))
}
export function collisionBetween(from: Vec, to: Vec, fromTime: number, toTime: number): string | null {
  if (segmentDistance(from, to) <= SUN_RADIUS) return 'Sun'
  for (const body of BODIES) {
    const relativeStart = sub(from, bodyPosition(body, fromTime))
    const relativeEnd = sub(to, bodyPosition(body, toTime))
    if (segmentDistance(relativeStart, relativeEnd) <= body.radius) return body.name
  }
  return null
}

// Velocity Verlet uses acceleration at both ends of the same fixed step.
export function verlet(sample: Sample, dt = DT, launchTime = 0): Sample {
  const a0 = acceleration(sample.pos, launchTime + sample.t)
  const nextPos = add(add(sample.pos, mul(sample.vel, dt)), mul(a0, .5 * dt * dt))
  const a1 = acceleration(nextPos, launchTime + sample.t + dt)
  const nextVel = add(sample.vel, mul(add(a0, a1), .5 * dt))
  return { t: sample.t + dt, pos: nextPos, vel: nextVel, acc: a1, fuel: sample.fuel, propellantUsed: sample.propellantUsed }
}

// One finite-thrust step. The rocket equation tracks propellant; a requested burn
// must fit both the chosen delta-v budget and this step's thrust capability.
export function applyThrust(sample: Sample, dv: Vec, craft: Spacecraft, dt: number, budget: number): Sample | null {
  const magnitude = length(dv)
  if (magnitude > maxStepDeltaV(sample, craft, dt, budget) + 1e-9) return null
  const mass = currentMass(sample, craft)
  const propellant = magnitude ? mass * (1 - Math.exp(-magnitude / craft.exhaustVelocity)) : 0
  return { ...sample, vel: add(sample.vel, dv), fuel: sample.fuel + magnitude, propellantUsed: sample.propellantUsed + propellant }
}

export function makeInitialSample(start: Vec, launchTime: number): Sample {
  return { t: 0, pos: start, vel: initialVelocity(start), acc: acceleration(start, launchTime), fuel: 0, propellantUsed: 0 }
}

export function formatVec(v: Vec, digits = 2): string { return `${v.x.toFixed(digits)}, ${v.y.toFixed(digits)}, ${v.z.toFixed(digits)}` }

import { describe, expect, it } from 'vitest'
import { BODIES, DEFAULT_SPACECRAFT, DT, PRESET, acceleration, applyThrust, bodyDisplayRadius, bodyPosition, bodyVelocity, collision, collisionBetween, gravityContribution, isArrival, makeInitialSample, maxStepDeltaV, maximumDeltaV, relativeArrivalSpeed, targetPosition, verlet } from './model'

describe('gravity and fixed-step physics', () => {
  it('keeps distinct inclined planets separated throughout their motion', () => {
    expect(new Set(BODIES.map(body => body.orbit)).size).toBe(BODIES.length)
    expect(new Set(BODIES.map(body => body.inclination)).size).toBe(BODIES.length)
    expect(new Set(BODIES.map(body => body.phase)).size).toBe(BODIES.length)
    expect(BODIES.every(body => Math.abs(bodyPosition(body, 0).z) > .02)).toBe(true)
    for (let t = 0; t <= 120; t += .05) {
      for (let i = 0; i < BODIES.length; i++) {
        const a = bodyPosition(BODIES[i], t)
        const onOrbit = bodyPosition(BODIES[i], t + BODIES[i].period)
        expect(Math.hypot(a.x - onOrbit.x, a.y - onOrbit.y, a.z - onOrbit.z)).toBeLessThan(1e-10)
        for (let j = i + 1; j < BODIES.length; j++) {
          const b = bodyPosition(BODIES[j], t)
          const clearance = Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z) - bodyDisplayRadius(BODIES[i]) - bodyDisplayRadius(BODIES[j])
          expect(clearance).toBeGreaterThan(.05)
        }
      }
    }
  })
  it('points toward the attracting body and follows inverse square magnitude', () => {
    const near = gravityContribution({ x: 1, y: 0, z: 0 }, { x: 0, y: 0, z: 0 }, 2)
    const far = gravityContribution({ x: 2, y: 0, z: 0 }, { x: 0, y: 0, z: 0 }, 2)
    expect(near.x).toBeLessThan(0)
    expect(near.y).toBe(0)
    expect(Math.abs(near.x / far.x)).toBeCloseTo(4, 8)
  })
  it('adds the Sun and planet gravity as a finite vector', () => {
    const a = acceleration({ x: 1, y: 0, z: .4 }, 0)
    expect(a.x).toBeLessThan(0)
    expect(Number.isFinite(a.y)).toBe(true)
    expect(a.z).toBeLessThan(0)
  })
  it('produces identical states for identical fixed steps', () => {
    const start = makeInitialSample({ x: 1.02, y: -.04, z: .2 }, 0)
    const run = () => { let s = start; for (let i = 0; i < 50; i++) s = verlet(s, DT, 0); return s }
    expect(run()).toEqual(run())
    expect(run().t).toBeCloseTo(50 * DT, 10)
  })
  it('detects body collisions and enforces thrust, propellant, and selected delta-v limits', () => {
    expect(collision({ x: 0, y: 0, z: 0 }, 0)).toBe('Sun')
    expect(collisionBetween({ x: -.2, y: 0, z: 0 }, { x: .2, y: 0, z: 0 }, 0, DT)).toBe('Sun')
    expect(collisionBetween({ x: -.2, y: 0, z: .2 }, { x: .2, y: 0, z: .2 }, 0, DT)).toBeNull()
    const start = makeInitialSample({ x: 1.02, y: -.04, z: 0 }, 0)
    const permitted = maxStepDeltaV(start, DEFAULT_SPACECRAFT, DT, .5)
    expect(applyThrust(start, { x: 0, y: 0, z: permitted + .01 }, DEFAULT_SPACECRAFT, DT, .5)).toBeNull()
    const first = applyThrust(start, { x: 0, y: 0, z: permitted }, DEFAULT_SPACECRAFT, DT, .5)!
    expect(first.fuel).toBeCloseTo(permitted)
    expect(first.propellantUsed).toBeGreaterThan(0)
    expect(first.vel.z).toBeCloseTo(permitted)
    expect(applyThrust(first, { x: .5, y: 0, z: 0 }, DEFAULT_SPACECRAFT, DT, .5)).toBeNull()
    expect(maximumDeltaV(DEFAULT_SPACECRAFT)).toBeGreaterThan(PRESET.budget)
  })
  it('moves a planet destination and requires low relative arrival speed', () => {
    const params = { ...PRESET, targetBody: 'Mars' }
    const now = targetPosition(params, 0)
    const later = targetPosition(params, .2)
    expect(now).toEqual(bodyPosition(BODIES.find(body => body.name === 'Mars')!, 0))
    expect(later).not.toEqual(now)
    const near = { ...makeInitialSample(now, 0), pos: { x: now.x + .08, y: now.y, z: now.z }, vel: { x: 0, y: 0, z: 0 } }
    expect(isArrival(near, params)).toBe(false)
    expect(relativeArrivalSpeed(near, params)).toBeGreaterThan(params.arrivalSpeedLimit!)
    expect(isArrival({ ...near, vel: bodyVelocity(BODIES.find(body => body.name === 'Mars')!, 0) }, params)).toBe(true)
  })
})

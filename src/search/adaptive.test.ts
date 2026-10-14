import { describe, expect, it } from 'vitest'
import { PRESET, TARGET_RADIUS, collisionBetween, isArrival, length, sub, targetPosition } from '../physics/model'
import { searchAdaptiveRoutes } from './adaptive'
import { searchRoutes } from './search'

describe('extended route search', () => {
  it('keeps the selected fuel budget strict and finds a longer feasible flight when the budget allows it', () => {
    const params = { ...PRESET, targetBody: null, start: { x: .96, y: 1.87, z: .15 }, target: { x: -7.44, y: .59, z: -.2 }, launchTime: 2, budget: 1.5, targetRadius: TARGET_RADIUS }
    expect(searchRoutes(params).status).not.toBe('feasible')
    expect(searchAdaptiveRoutes(params).fastest).toBeNull()
    const largerBudget = { ...params, budget: 7 }
    const result = searchAdaptiveRoutes(largerBudget)
    expect(result.status).toBe('feasible')
    const route = result.lowestFuel!
    const last = route.samples.at(-1)!
    expect(isArrival(last, largerBudget)).toBe(true)
    expect(route.fuel).toBeCloseTo(last.fuel)
    expect(route.fuel).toBeLessThanOrEqual(largerBudget.budget)
    expect(route.propellantUsed).toBeCloseTo(last.propellantUsed)
    expect(route.propellantUsed).toBeLessThanOrEqual(largerBudget.spacecraft!.propellantMass)
  }, 30000)
  it('rendezvous with moving Jupiter at limited relative speed using finite burns', () => {
    const result = searchAdaptiveRoutes(PRESET)
    expect(result.status).toBe('feasible')
    const route = result.fastest!
    const last = route.samples.at(-1)!
    expect(targetPosition(PRESET, PRESET.launchTime + last.t)).not.toEqual(targetPosition(PRESET, PRESET.launchTime))
    expect(length(sub(last.pos, targetPosition(PRESET, PRESET.launchTime + last.t)))).toBeLessThanOrEqual(PRESET.targetRadius)
    expect(isArrival(last, PRESET)).toBe(true)
    expect(route.travelTime).toBeCloseTo(last.t, 10)
    expect(route.fuel).toBeCloseTo(last.fuel, 10)
    expect(route.propellantUsed).toBeCloseTo(last.propellantUsed, 10)
    expect(route.relativeArrivalSpeed).toBeLessThanOrEqual(PRESET.arrivalSpeedLimit!)
    expect(route.fuel).toBeLessThanOrEqual(PRESET.budget)
    expect(route.burns.every(burn => burn.duration > 0 && burn.propellant > 0)).toBe(true)
    expect(route.burns.reduce((total, burn) => total + length(burn.dv), 0)).toBeCloseTo(route.fuel, 6)
    expect(route.burns.reduce((total, burn) => total + burn.propellant, 0)).toBeCloseTo(route.propellantUsed, 6)
    expect(route.samples.some(sample => Math.abs(sample.pos.z) > 1e-4)).toBe(true)
    expect(route.burns.some(burn => Math.abs(burn.dv.z) > 1e-4)).toBe(true)
    expect(route.samples.every((sample, i) => i === 0 || !collisionBetween(route.samples[i - 1].pos, sample.pos, PRESET.launchTime + route.samples[i - 1].t, PRESET.launchTime + sample.t))).toBe(true)
  }, 30000)
})

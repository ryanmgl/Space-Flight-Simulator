import { describe, expect, it } from 'vitest'
import { PRESET, TARGET_RADIUS, collisionBetween, length, sub } from '../physics/model'
import { nondominated } from './pareto'
import { searchRoutes } from './search'

describe('route selection', () => {
  it('keeps nondominated time/fuel tradeoffs', () => {
    const options = [{ travelTime: 1, fuel: .5 }, { travelTime: 1.2, fuel: .4 }, { travelTime: 1.4, fuel: .6 }]
    expect(nondominated(options)).toEqual(options.slice(0, 2))
  })
  it('finds a physically sampled preset arrival and matching metrics', () => {
    const fixedParams = { ...PRESET, targetBody: null, target: { x: .81, y: .78, z: 0 } }
    const result = searchRoutes(fixedParams)
    expect(result.status).toBe('feasible')
    for (const route of [result.fastest, result.lowestFuel]) {
      expect(route).not.toBeNull()
      const last = route!.samples.at(-1)!
      expect(length(sub(last.pos, fixedParams.target))).toBeLessThanOrEqual(TARGET_RADIUS + 1e-8)
      expect(route!.travelTime).toBeCloseTo(last.t, 10)
      expect(route!.fuel).toBeCloseTo(last.fuel, 10)
      expect(route!.arrivalSpeed).toBeCloseTo(length(last.vel), 10)
      expect(route!.relativeArrivalSpeed).toBeLessThanOrEqual(fixedParams.arrivalSpeedLimit! + 1e-8)
      expect(route!.fuel).toBeLessThanOrEqual(fixedParams.budget + 1e-8)
    }
  }, 30000)
  it('does not call a fast coast past the target a valid arrival', () => {
    const start = { x: .6, y: 0, z: 0 }
    const target = { x: -.6, y: 0, z: 0 }
    expect(collisionBetween(start, target, 0, 0)).toBe('Sun')
    const result = searchRoutes({ start, target, launchTime: 0, budget: 0, targetRadius: TARGET_RADIUS })
    expect(result.fastest).toBeNull()
  }, 30000)
})

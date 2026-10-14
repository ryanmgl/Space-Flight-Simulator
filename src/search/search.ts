import { BODIES, DEFAULT_SPACECRAFT, DT, acceleration, applyThrust, bodyPosition, collision, collisionBetween, cross, dot, isArrival, length, makeInitialSample, mul, relativeArrivalSpeed, sub, targetPosition, unit, verlet } from '../physics/model'
import type { Burn, Encounter, Route, RouteResult, Sample, SearchParams, Vec } from '../physics/model'
import { nondominated } from './pareto'

const STEPS_PER_ACTION = 8
const MAX_LAYERS = 17
const BEAM_WIDTH = 130
const MAX_EXPANDED = 18000
const BURN_SIZES = [.16, .32]

type Node = { sample: Sample; parent: Node | null; segment: Sample[]; burn: Burn | null; score: number }
export type Progress = { layer: number; total: number; expanded: number; candidates: number; collisions: number; fuelRejected: number; phase?: 'beam' | 'extended' }

function aimPoint(sample: Sample, params: SearchParams): Vec {
  const now = params.launchTime + sample.t
  const current = targetPosition(params, now)
  const flight = Math.min(3, length(sub(current, sample.pos)) / Math.max(1, length(sample.vel)))
  return targetPosition(params, now + flight)
}

function makeActions(sample: Sample, params: SearchParams): Vec[] {
  const toward = unit(sub(aimPoint(sample, params), sample.pos))
  const forward = unit(sample.vel)
  const normal = unit(cross({ x: 0, y: 0, z: 1 }, toward))
  const vertical = unit(cross(toward, normal))
  const directions = [toward, forward, mul(forward, -1), normal, mul(normal, -1), vertical, mul(vertical, -1)]
  return [{ x: 0, y: 0, z: 0 }, ...BURN_SIZES.flatMap(size => directions.map(dir => mul(dir, size)))]
}

function routeFromNode(node: Node, params: SearchParams): Route {
  const chain: Node[] = []
  for (let p: Node | null = node; p; p = p.parent) chain.push(p)
  chain.reverse()
  const samples = chain.flatMap((part, i) => i === 0 ? [part.sample] : part.segment)
  const burns = chain.flatMap(part => part.burn ? [part.burn] : [])
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
  const last = node.sample
  return { samples, burns, encounters, travelTime: last.t, fuel: last.fuel, arrivalSpeed: length(last.vel), relativeArrivalSpeed: relativeArrivalSpeed(last, params), propellantUsed: last.propellantUsed, id: `${last.t.toFixed(4)}:${last.fuel.toFixed(4)}` }
}

function score(sample: Sample, params: SearchParams): number {
  const target = aimPoint(sample, params)
  const distance = length(sub(target, sample.pos))
  const approach = Math.max(0, dot(sub(target, sample.pos), sample.vel) / (distance || 1))
  return distance / Math.max(.55, approach + .4) + sample.fuel * .30 + sample.t * .03
}

// A bounded, discretized beam search. It searches states at each action horizon, while
// keeping multiple fuel bands so a fuel-free coast remains available for comparison.
export function searchRoutes(params: SearchParams, onProgress?: (progress: Progress) => void): RouteResult {
  const initial = makeInitialSample(params.start, params.launchTime)
  let beam: Node[] = [{ sample: initial, parent: null, segment: [], burn: null, score: score(initial, params) }]
  const arrivals: Node[] = []
  let expanded = 0, collisions = 0, fuelRejected = 0
  if (collision(initial.pos, params.launchTime)) return { fastest: null, lowestFuel: null, candidates: 0, expanded: 0, collisions: 1, fuelRejected: 0, status: 'collision' }

  for (let layer = 0; layer < MAX_LAYERS && beam.length && expanded < MAX_EXPANDED; layer++) {
    const next: Node[] = []
    for (const parent of beam) {
      if (expanded >= MAX_EXPANDED) break
      for (const dv of makeActions(parent.sample, params)) {
        if (expanded >= MAX_EXPANDED) break
        expanded++
        let sample = parent.sample
        const segment: Sample[] = []
        let failed = false, arrived = false
        for (let i = 0; i < STEPS_PER_ACTION; i++) {
          const stepped = applyThrust(sample, mul(dv, 1 / STEPS_PER_ACTION), params.spacecraft ?? DEFAULT_SPACECRAFT, DT, params.budget)
          if (!stepped) { fuelRejected++; failed = true; break }
          sample = stepped
          const prior = sample
          sample = verlet(sample, DT, params.launchTime)
          if (collisionBetween(prior.pos, sample.pos, params.launchTime + prior.t, params.launchTime + sample.t)) { collisions++; failed = true; break }
          segment.push(sample)
          if (isArrival(sample, params)) { arrived = true; break }
        }
        if (failed) continue
        const burn = length(dv) > 0 ? { t: parent.sample.t, pos: parent.sample.pos, dv: mul(dv, segment.length / STEPS_PER_ACTION), duration: segment.length * DT, propellant: sample.propellantUsed - parent.sample.propellantUsed } : null
        const node: Node = { sample, parent, segment, burn, score: score(sample, params) }
        if (arrived) arrivals.push(node)
        else next.push(node)
      }
    }

    // Keep best state in each quantized cell, separately for five fuel bands.
    const cells = new Map<string, Node>()
    for (const node of next) {
      const s = node.sample
      const key = [Math.round(s.pos.x / .075), Math.round(s.pos.y / .075), Math.round(s.pos.z / .075), Math.round(s.vel.x / .19), Math.round(s.vel.y / .19), Math.round(s.vel.z / .19), Math.floor(s.fuel / .18)].join(':')
      const old = cells.get(key)
      if (!old || node.score < old.score) cells.set(key, node)
    }
    const ranked = [...cells.values()].sort((a, b) => a.score - b.score)
    const free = ranked.filter(n => n.sample.fuel < 1e-8).slice(0, 8)
    const economical = ranked.filter(n => n.sample.fuel > 1e-8 && n.sample.fuel <= .32).slice(0, 30)
    const selected = new Set<Node>([...free, ...economical])
    beam = [...selected, ...ranked.filter(n => !selected.has(n)).slice(0, BEAM_WIDTH - selected.size)]
    onProgress?.({ layer: layer + 1, total: MAX_LAYERS, expanded, candidates: arrivals.length, collisions, fuelRejected })
  }

  const feasible = nondominated(arrivals.map(n => ({ node: n, travelTime: n.sample.t, fuel: n.sample.fuel })))
  const fastestNode = [...feasible].sort((a, b) => a.travelTime - b.travelTime || a.fuel - b.fuel)[0]?.node
  const fuelNode = [...feasible].sort((a, b) => a.fuel - b.fuel || a.travelTime - b.travelTime)[0]?.node
  const fastest = fastestNode ? routeFromNode(fastestNode, params) : null
  const lowestFuel = fuelNode ? (fuelNode === fastestNode ? fastest : routeFromNode(fuelNode, params)) : null
  return { fastest, lowestFuel, candidates: arrivals.length, expanded, collisions, fuelRejected, status: fastest ? 'feasible' : params.budget < .16 && fuelRejected ? 'out-of-fuel' : 'no-route' }
}

// Recompute a route's acceleration with the same physics for the live data panel.
export function sampleWithGravity(sample: Sample, launchTime: number): Sample {
  return { ...sample, acc: acceleration(sample.pos, launchTime + sample.t) }
}

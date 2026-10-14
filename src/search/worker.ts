import { searchRoutes } from './search'
import { searchAdaptiveRoutes } from './adaptive'
import type { SearchParams } from '../physics/model'

self.onmessage = (event: MessageEvent<{ id: number; params: SearchParams }>) => {
  const { id, params } = event.data
  const bounded = searchRoutes(params, progress => self.postMessage({ type: 'progress', id, progress: { ...progress, phase: 'beam' } }))
  if (bounded.status === 'feasible' || bounded.status === 'collision') {
    self.postMessage({ type: 'result', id, result: bounded })
    return
  }
  const extended = searchAdaptiveRoutes(params, progress => self.postMessage({ type: 'progress', id, progress: {
    layer: progress.trial, total: progress.total, expanded: bounded.expanded + progress.expanded,
    candidates: progress.candidates, collisions: bounded.collisions + progress.collisions,
    fuelRejected: bounded.fuelRejected, phase: 'extended',
  } }))
  self.postMessage({ type: 'result', id, result: { ...extended, expanded: bounded.expanded + extended.expanded, collisions: bounded.collisions + extended.collisions, fuelRejected: bounded.fuelRejected } })
}

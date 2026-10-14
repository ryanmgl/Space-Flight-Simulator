export type Objectives = { travelTime: number; fuel: number }
export function dominates(a: Objectives, b: Objectives): boolean {
  return a.travelTime <= b.travelTime + 1e-8 && a.fuel <= b.fuel + 1e-8 && (a.travelTime < b.travelTime - 1e-8 || a.fuel < b.fuel - 1e-8)
}
export function nondominated<T extends Objectives>(items: T[]): T[] {
  return items.filter((item, i) => !items.some((other, j) => i !== j && dominates(other, item)))
}

export interface Seg { id: string; start: number; end: number }
export interface Placed<T> { item: T; start: number; end: number; lane: number; lanes: number }

/** Side-by-side lanes for overlapping events of one day column (minutes after local midnight). Greedy by start time. */
export function placeEvents<T extends Seg>(items: T[]): Placed<T>[] {
  const sorted = [...items].sort((a, b) => a.start - b.start || b.end - a.end)
  const out: Placed<T>[] = []
  let cluster: Placed<T>[] = []; let clusterEnd = -1
  const flush = () => { const lanes = Math.max(1, ...cluster.map((c) => c.lane + 1)); cluster.forEach((c) => (c.lanes = lanes)); out.push(...cluster); cluster = [] }
  for (const it of sorted) {
    if (cluster.length && it.start >= clusterEnd) { flush(); clusterEnd = -1 }
    const used = new Set(cluster.filter((c) => c.end > it.start).map((c) => c.lane))
    let lane = 0; while (used.has(lane)) lane++
    cluster.push({ item: it, start: it.start, end: it.end, lane, lanes: 1 }); clusterEnd = Math.max(clusterEnd, it.end)
  }
  flush()
  return out
}

import type { DB, Order, Sku, Truck } from './store'

/** 件数换算箱数 */
export function boxify(qty: number, perBox: number) {
  const per = perBox > 0 ? perBox : 1
  const full = Math.floor(qty / per)
  const tail = qty % per
  const total = full + (tail > 0 ? 1 : 0)
  return { full, tail, total }
}

/** 单箱体积，单位 m³ */
export function boxVolume(sku: Sku) {
  return (sku.boxL * sku.boxW * sku.boxH) / 1_000_000
}

export type LineDetail = {
  sku: Sku
  qty: number
  full: number
  tail: number
  boxes: number
  volume: number
  weight: number
}

export type OrderSummary = {
  lines: LineDetail[]
  totalQty: number
  totalBoxes: number
  totalVolume: number
  totalWeight: number
}

export function summarize(db: DB, order: Order): OrderSummary {
  const lines: LineDetail[] = []
  for (const line of order.lines) {
    const sku = db.skus.find((s) => s.id === line.skuId)
    if (!sku) continue
    const b = boxify(line.qty, sku.perBox)
    lines.push({
      sku,
      qty: line.qty,
      full: b.full,
      tail: b.tail,
      boxes: b.total,
      volume: b.total * boxVolume(sku),
      weight: b.total * sku.boxWeight,
    })
  }
  return {
    lines,
    totalQty: lines.reduce((s, l) => s + l.qty, 0),
    totalBoxes: lines.reduce((s, l) => s + l.boxes, 0),
    totalVolume: lines.reduce((s, l) => s + l.volume, 0),
    totalWeight: lines.reduce((s, l) => s + l.weight, 0),
  }
}

export type TruckPlan = {
  truck: Truck
  capacityVolume: number
  volumeRate: number
  weightRate: number
  overVolume: boolean
  overWeight: boolean
  trucksNeeded: number
  /** 按主导箱规估算：每层可放箱数 */
  perLayer: number
  layers: number
  layout: {
    skuName: string
    boxL: number
    boxW: number
    boxH: number
    perLayer: number
    layers: number
    capacityPerTruck: number
    trucks: number
  }[]
}

const orientations = (l: number, w: number, h: number): [number, number, number][] => [
  [l, w, h], [w, l, h], [l, h, w], [h, l, w], [w, h, l], [h, w, l],
]

/** 单一箱规在车厢里的最大装载数（允许六个方向摆放） */
export function maxBoxesFor(truck: Truck, l: number, w: number, h: number) {
  let best = 0
  let bestPerLayer = 0
  let bestLayers = 0
  for (const [a, b, c] of orientations(l, w, h)) {
    if (a <= 0 || b <= 0 || c <= 0) continue
    const na = Math.floor(truck.L / a)
    const nb = Math.floor(truck.W / b)
    const nc = Math.floor(truck.H / c)
    const total = na * nb * nc
    if (total > best) {
      best = total
      bestPerLayer = na * nb
      bestLayers = nc
    }
  }
  return { total: best, perLayer: bestPerLayer, layers: bestLayers }
}

export function planTruck(truck: Truck, summary: OrderSummary): TruckPlan {
  const capacityVolume = (truck.L * truck.W * truck.H) / 1_000_000
  const volumeRate = capacityVolume > 0 ? summary.totalVolume / capacityVolume : 0
  const weightRate = truck.maxWeight > 0 ? summary.totalWeight / truck.maxWeight : 0

  const layout = summary.lines
    .map((l) => {
      const m = maxBoxesFor(truck, l.sku.boxL, l.sku.boxW, l.sku.boxH)
      return {
        skuName: l.sku.name,
        boxL: l.sku.boxL,
        boxW: l.sku.boxW,
        boxH: l.sku.boxH,
        perLayer: m.perLayer,
        layers: m.layers,
        capacityPerTruck: m.total || 1,
        trucks: Math.ceil(l.boxes / (m.total || 1)),
      }
    })
    .sort((a, b) => b.capacityPerTruck - a.capacityPerTruck)

  const dominant = layout[0]

  return {
    truck,
    capacityVolume,
    volumeRate,
    weightRate,
    overVolume: volumeRate > 1,
    overWeight: weightRate > 1,
    trucksNeeded: Math.max(1, Math.max(volumeRate, weightRate) > 0 ? Math.ceil(Math.max(volumeRate, weightRate)) : 1),
    perLayer: dominant?.perLayer ?? 0,
    layers: dominant?.layers ?? 0,
    layout,
  }
}

/** 车厢能装下的估算层数（按主导箱规） */
export function loadSuggestion(plan: TruckPlan, summary: OrderSummary) {
  const d = plan.layout[0]
  if (!d) return []
  const out: string[] = []
  const perLayer = d.perLayer || 1
  const layers = d.layers || 1
  const capacity = perLayer * layers
  if (capacity >= summary.totalBoxes) {
    const needLayers = Math.ceil(summary.totalBoxes / perLayer)
    out.push(`每层可放 ${perLayer} 箱，铺 ${needLayers} 层即可装完（车厢最多 ${layers} 层）`)
  } else {
    const trucks = Math.ceil(summary.totalBoxes / capacity)
    out.push(`单车最多装 ${capacity} 箱，本单需 ${trucks} 车`)
  }
  return out
}

export function fmt(n: number, digits = 2) {
  return Number.isFinite(n) ? n.toFixed(digits).replace(/\.?0+$/, '') : '0'
}

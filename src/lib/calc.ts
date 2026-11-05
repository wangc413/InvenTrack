import type { DB, Order, Pallet, Sku, Truck } from './store'

/** 件数换算箱数 */
export function boxify(qty: number, perBox: number) {
  const per = perBox > 0 ? perBox : 1
  const full = Math.floor(qty / per)
  const tail = qty % per
  return { full, tail, total: full + (tail > 0 ? 1 : 0) }
}

/** 单箱体积，单位 m³ */
export function boxVolume(sku: Sku) {
  return (sku.boxL * sku.boxW * sku.boxH) / 1_000_000
}

export type PalletStat = {
  pallet: Pallet
  boxes: number
  qty: number
  volume: number
  weight: number
  /** 铺满拖板图用的箱子序列，每个元素对应一箱，值是品项在调色板里的序号 */
  segments: { skuId: string; color: number; count: number }[]
}

export type LineDetail = {
  sku: Sku
  boxes: number
  qty: number
  volume: number
  weight: number
}

export type OrderSummary = {
  pallets: PalletStat[]
  lines: LineDetail[]
  totalPallets: number
  totalQty: number
  totalBoxes: number
  totalVolume: number
  totalWeight: number
}

export function summarizePallet(db: DB, pallet: Pallet, colorOf: (skuId: string) => number): PalletStat {
  let boxes = 0
  let qty = 0
  let volume = 0
  let weight = 0
  const segments: PalletStat['segments'] = []

  for (const it of pallet.items) {
    const sku = db.skus.find((s) => s.id === it.skuId)
    if (!sku) continue
    boxes += it.boxes
    qty += it.boxes * sku.perBox
    volume += it.boxes * boxVolume(sku)
    weight += it.boxes * sku.boxWeight
    segments.push({ skuId: sku.id, color: colorOf(sku.id), count: it.boxes })
  }

  return { pallet, boxes, qty, volume, weight, segments }
}

export function summarize(db: DB, order: Order): OrderSummary {
  const colorIndex = new Map<string, number>()
  const colorOf = (id: string) => {
    if (!colorIndex.has(id)) colorIndex.set(id, colorIndex.size)
    return colorIndex.get(id)!
  }

  const pallets = order.pallets.map((p) => summarizePallet(db, p, colorOf))

  const boxMap = new Map<string, number>()
  for (const p of order.pallets) {
    for (const it of p.items) boxMap.set(it.skuId, (boxMap.get(it.skuId) ?? 0) + it.boxes)
  }

  const lines: LineDetail[] = []
  for (const [skuId, boxes] of boxMap) {
    const sku = db.skus.find((s) => s.id === skuId)
    if (!sku) continue
    lines.push({
      sku,
      boxes,
      qty: boxes * sku.perBox,
      volume: boxes * boxVolume(sku),
      weight: boxes * sku.boxWeight,
    })
  }
  lines.sort((a, b) => b.boxes - a.boxes)

  return {
    pallets,
    lines,
    totalPallets: pallets.length,
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
    trucksNeeded: Math.max(1, Math.ceil(Math.max(volumeRate, weightRate))),
    perLayer: dominant?.perLayer ?? 0,
    layers: dominant?.layers ?? 0,
    layout,
  }
}

export function fmt(n: number, digits = 2) {
  return Number.isFinite(n) ? n.toFixed(digits).replace(/\.?0+$/, '') : '0'
}

/** 拖板配色，按品项顺序循环。黑白灰阶，靠明度区分同一块板上的不同品项 */
export const PALLET_COLORS = [
  { fill: '#d2d4d8', stroke: '#6f6f76' },
  { fill: '#bfc2c8', stroke: '#64646b' },
  { fill: '#acb0b7', stroke: '#5a5a61' },
  { fill: '#c8cbd0', stroke: '#73737a' },
  { fill: '#b5b9bf', stroke: '#616168' },
  { fill: '#a2a6ae', stroke: '#55555c' },
]

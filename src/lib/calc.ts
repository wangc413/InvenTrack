import { palletBoxes, type DB, type Order, type Pallet, type Sku, type Truck } from './store'

/** 件数换算箱数 */
export function boxify(qty: number, perBox: number) {
  const per = perBox > 0 ? perBox : 1
  const full = Math.floor(qty / per)
  const tail = qty % per
  return { full, tail, total: full + (tail > 0 ? 1 : 0) }
}

/** 件数拆成整箱 + 零头件（按绝对值拆，正负另看） */
export function splitBoxes(qty: number, perBox: number) {
  const per = perBox > 0 ? perBox : 1
  const abs = Math.abs(qty)
  const boxes = Math.floor(abs / per)
  return { boxes, tail: abs - boxes * per }
}

/** 结存 / 余量的箱数文案：「42 箱」「41 箱 + 3 件」 */
export function boxText(qty: number, perBox: number) {
  const { boxes, tail } = splitBoxes(qty, perBox)
  if (tail === 0) return `${boxes} 箱`
  return boxes > 0 ? `${boxes} 箱 + ${tail} 件` : `${tail} 件`
}

/** 流水数量文案，带正负号：「+42 箱」「−6 箱」「+3 件」 */
export function moveText(qty: number, perBox: number) {
  if (qty === 0) return '0'
  const sign = qty > 0 ? '+' : '−'
  const { boxes, tail } = splitBoxes(qty, perBox)
  if (tail === 0) return `${sign}${boxes} 箱`
  return boxes > 0 ? `${sign}${boxes} 箱 ${tail} 件` : `${sign}${tail} 件`
}

/** 单箱体积，单位 m³（外箱尺寸按毫米存） */
export function boxVolume(sku: Sku) {
  return (sku.boxL * sku.boxW * sku.boxH) / 1_000_000_000
}

/* ---------- 托盘的物理边界 ---------- */

/** 标准托盘占地，毫米 */
export const PALLET_L = 1200
export const PALLET_W = 1000
/** 托盘本身高度（顶板算进来） */
export const PALLET_H = 145
/** 连托盘一起的码垛上限，1.8 米，再高叉车看不稳也进不了车厢 */
export const MAX_STACK_H = 1800

/**
 * 这个箱规一层最多能码几个：按托盘实际尺寸排，允许箱子转 90°。
 * 以前是「每层固定 6 个」，烧麦那种 465×410 的箱子其实只能码 4 个。
 */
export function maxPerLayer(sku: Sku) {
  const l = Math.max(1, sku.boxL)
  const w = Math.max(1, sku.boxW)
  const plain = Math.floor(PALLET_L / l) * Math.floor(PALLET_W / w)
  const turned = Math.floor(PALLET_L / w) * Math.floor(PALLET_W / l)
  return Math.max(1, plain, turned)
}

/** 这个箱规最多能码几层：按 1.8 米总高倒推 */
export function maxLayers(sku: Sku) {
  return Math.max(1, Math.floor((MAX_STACK_H - PALLET_H) / Math.max(50, sku.boxH)))
}

/** 一块板上按“每层几个”铺开，占多大地方（毫米） */
export function stackLayout(sku: Sku, perLayer: number) {
  const n = Math.max(1, Math.min(perLayer, 40))
  let best = { cols: 1, rows: n, L: sku.boxL, W: n * sku.boxW, score: Number.POSITIVE_INFINITY }
  for (let cols = 1; cols <= n; cols++) {
    const rows = Math.ceil(n / cols)
    const L = cols * sku.boxL
    const W = rows * sku.boxW
    const waste = cols * rows - n
    // 目标长宽比接近标准托盘 1.2 : 1，同时别留太多空格子
    const score = Math.abs(Math.log(L / W / 1.2)) + waste * 0.18
    if (score < best.score) best = { cols, rows, L, W, score }
  }
  return best
}

export type PalletStat = {
  pallet: Pallet
  sku: Sku | undefined
  boxes: number
  qty: number
  volume: number
  weight: number
}

export type LineDetail = {
  sku: Sku
  prodDate: string
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

export function statOfPallet(db: DB, pallet: Pallet): PalletStat {
  const sku = db.skus.find((s) => s.id === pallet.skuId)
  const boxes = palletBoxes(pallet)
  return {
    pallet,
    sku,
    boxes,
    qty: sku ? boxes * sku.perBox : 0,
    volume: sku ? boxes * boxVolume(sku) : 0,
    weight: sku ? boxes * sku.boxWeight : 0,
  }
}

export function summarize(db: DB, order: Order): OrderSummary {
  const pallets = order.pallets.map((p) => statOfPallet(db, p))

  const map = new Map<string, LineDetail>()
  for (const p of pallets) {
    if (!p.sku) continue
    const key = `${p.pallet.skuId}|${p.pallet.prodDate}`
    const cur = map.get(key)
    if (cur) {
      cur.boxes += p.boxes
      cur.qty += p.qty
      cur.volume += p.volume
      cur.weight += p.weight
    } else {
      map.set(key, {
        sku: p.sku,
        prodDate: p.pallet.prodDate,
        boxes: p.boxes,
        qty: p.qty,
        volume: p.volume,
        weight: p.weight,
      })
    }
  }
  const lines = [...map.values()].sort((a, b) => b.boxes - a.boxes)

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
  const capacityVolume = (truck.L * truck.W * truck.H) / 1_000_000_000
  const volumeRate = capacityVolume > 0 ? summary.totalVolume / capacityVolume : 0
  const weightRate = truck.maxWeight > 0 ? summary.totalWeight / truck.maxWeight : 0

  const layout = summary.lines
    .map((l) => {
      const m = maxBoxesFor(truck, l.sku.boxL, l.sku.boxW, l.sku.boxH)
      return {
        skuName: l.sku.shortName,
        boxL: l.sku.boxL,
        boxW: l.sku.boxW,
        boxH: l.sku.boxH,
        perLayer: m.perLayer,
        layers: m.layers,
        capacityPerTruck: m.total || 1,
      }
    })
    .sort((a, b) => b.capacityPerTruck - a.capacityPerTruck)

  return {
    truck,
    capacityVolume,
    volumeRate,
    weightRate,
    overVolume: volumeRate > 1,
    overWeight: weightRate > 1,
    trucksNeeded: Math.max(1, Math.ceil(Math.max(volumeRate, weightRate))),
    layout,
  }
}

export function fmt(n: number, digits = 2) {
  return Number.isFinite(n) ? n.toFixed(digits).replace(/\.?0+$/, '') : '0'
}

/** 日期显示：11-03 */
export function fmtDate(d: string) {
  if (!d) return '未填日期'
  const parts = d.split('-')
  return parts.length === 3 ? `${parts[1]}-${parts[2]}` : d
}

export function fmtTime(at: number) {
  const d = new Date(at)
  const p = (n: number) => String(n).padStart(2, '0')
  return `${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`
}

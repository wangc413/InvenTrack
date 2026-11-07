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

/* ---------- 一层的码法 ---------- */

/**
 * 一个箱位。单位毫米，坐标相对托盘中心：
 * x 顺着托盘长边（1.2 m），z 顺着托盘宽边（1 m）。
 * turn = 这箱转 90°（长边改为顺着 1 m 那边）。
 */
export type Slot = { x: number; z: number; turn: boolean }

export type LayerPlan = {
  /** 满层几个 */
  perLayer: number
  slots: Slot[]
  /** 给界面看的一句话，如「3 竖 + 4 横（2×2）」 */
  note: string
  /** true = 现场固定的码法，不是按箱规算出来的 */
  fixed: boolean
  /** 一层摆下来比托盘多出来的尺寸（毫米），摆不下才会填 */
  over?: { x: number; z: number }
}

/** 按箱规铺成整齐的方阵，能转 90° 就转，取放得多的那种 */
function gridPlan(sku: Sku): LayerPlan {
  const l = Math.max(1, sku.boxL)
  const w = Math.max(1, sku.boxW)
  const plain = { cols: Math.floor(PALLET_L / l), rows: Math.floor(PALLET_W / w), turn: false }
  const turned = { cols: Math.floor(PALLET_L / w), rows: Math.floor(PALLET_W / l), turn: true }
  const best = turned.cols * turned.rows > plain.cols * plain.rows ? turned : plain
  const cols = Math.max(1, best.cols)
  const rows = Math.max(1, best.rows)
  const dx = best.turn ? w : l
  const dz = best.turn ? l : w
  const slots: Slot[] = []
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      slots.push({ x: (c - (cols - 1) / 2) * dx, z: (r - (rows - 1) / 2) * dz, turn: best.turn })
    }
  }
  return { perLayer: slots.length, slots, note: `${cols} × ${rows} 方阵`, fixed: false }
}

/**
 * 盒马包子的固定码法：一层 7 个 = 3 竖 + 4 横（4 个横的挤成 2×2）。
 *
 *   竖：箱子长边顺着 1.2 m 那边，3 个沿着 1 m 那边排开
 *   横：转 90°，4 个在剩下的地方铺成 2×2
 *
 * 以肉包 500×335 算：1.2 m 上 500 + 2×335 = 1170，还剩 30 mm 下手；
 * 1 m 上 3×335 = 1005（挤一挤）对 2×500 = 1000，两边都刚好齐板。
 */
function baoPlan(sku: Sku): LayerPlan {
  const l = Math.max(1, sku.boxL)
  const w = Math.max(1, sku.boxW)
  const spanX = l + 2 * w // 竖的一排 + 横的 2 列
  const spanZ = Math.max(3 * w, 2 * l)
  const x0 = -spanX / 2
  const slots: Slot[] = []
  // 3 竖：贴左边，沿 z 排开
  for (let i = 0; i < 3; i++) {
    slots.push({ x: x0 + l / 2, z: -spanZ / 2 + w / 2 + i * w, turn: false })
  }
  // 4 横：2 列 × 2 排，占右边
  for (let r = 0; r < 2; r++) {
    for (let c = 0; c < 2; c++) {
      slots.push({ x: x0 + l + w / 2 + c * w, z: -spanZ / 2 + l / 2 + r * l, turn: true })
    }
  }
  return { perLayer: slots.length, slots, note: '3 竖 + 4 横（2×2）', fixed: true }
}

/**
 * 烧麦的固定码法：一层 5 个 = 后排 3 竖 + 前排 2 横，前排两个之间留一道缝。
 *
 *   竖：410 顺着 1.2 m 那边，3 个并排（3×410 = 1230，两边各挤 15 mm，纸箱本身有压缩量）
 *   横：465 顺着 1.2 m 那边，2 个摆前面，居中，中间空出一道窄缝
 *
 * 缝宽不是硬凑的：1.2 m 上摆 2 个 465 还剩 1200 − 930 = 270，
 * 这份余量平分成三份 —— 左边余量、中间缝、右边余量 各 90 mm。
 * 这样前排两个都落在托盘里（外沿 ±510，没探出 600），缝也不至于宽到抽掉一块，
 * 下一层调头过来正好压住。
 *
 * 进深 465 + 410 = 875，1 m 这边还宽裕，叉车插得进。
 */
function shaomaiPlan(sku: Sku): LayerPlan {
  const l = Math.max(1, sku.boxL) // 465
  const w = Math.max(1, sku.boxW) // 410
  const spanZ = l + w
  /** 前排两个中间那道缝：托盘长边剩下的余量三等分，不留负值 */
  const gap = Math.max(0, (PALLET_L - 2 * l) / 3)
  const stepX = l + gap
  const slots: Slot[] = []
  // 后排 3 竖：长边（l）顺进深方向，w 顺着 1.2 m 并排
  for (let i = 0; i < 3; i++) {
    slots.push({ x: (i - 1) * w, z: -spanZ / 2 + l / 2, turn: true })
  }
  // 前排 2 横：l 顺着 1.2 m，整体居中，中间空出 gap
  for (let j = 0; j < 2; j++) {
    slots.push({ x: (j - 0.5) * stepX, z: -spanZ / 2 + l + w / 2, turn: false })
  }
  return { perLayer: slots.length, slots, note: '3 竖 + 2 横（留缝）', fixed: true }
}

/**
 * 饺子的固定码法：一层 10 个 = 左边 6 个（2 列 × 3 排）+ 右边 4 个（1 列 × 4 排，转 90°）。
 *
 *   左块 6 竖：长边 430 顺着 1.2 m，3 排占 3×430 = 1290；2 列顺着 1 m 占 2×300 = 600
 *   右块 4 横：转 90°，4 排顺着 1.2 m 占 4×300 = 1200（正好齐着板长），1 列顺 1 m 占 430
 *
 * 两块拼起来 600 + 430 = 1030 对 1 m —— 左右各探 15 mm；
 * 长边这块 3×430 = 1290 对 1.2 m —— 前后各探 45 mm。
 * 现场就是这么码的（纸箱有压缩量、垛外面还有缠膜和挡板），所以只把探出量报上去提醒，不硬拦。
 * 右块沿板长居中，跟左块的 3 排错开半格，下一层调头过来正好压住缝。
 */
function jiaoziPlan(sku: Sku): LayerPlan {
  const l = Math.max(1, sku.boxL) // 430
  const w = Math.max(1, sku.boxW) // 300
  const spanZ = 2 * w + l // 顺着 1 m 那边：左 2 列 + 右 1 列
  const spanX = Math.max(3 * l, 4 * w) // 顺着 1.2 m 那边
  const z0 = -spanZ / 2
  const slots: Slot[] = []
  // 左块 6 竖：2 列 × 3 排
  for (let c = 0; c < 2; c++) {
    for (let r = 0; r < 3; r++) {
      slots.push({ x: (r - 1) * l, z: z0 + w / 2 + c * w, turn: false })
    }
  }
  // 右块 4 横：转 90°，1 列 × 4 排，沿板长居中
  for (let r = 0; r < 4; r++) {
    slots.push({ x: (r - 1.5) * w, z: z0 + 2 * w + l / 2, turn: true })
  }
  const over = { x: Math.max(0, spanX - PALLET_L), z: Math.max(0, spanZ - PALLET_W) }
  return {
    perLayer: slots.length,
    slots,
    note: '6 竖（2×3）+ 4 横（一列）',
    fixed: true,
    ...(over.x > 0 || over.z > 0 ? { over } : {}),
  }
}

/**
 * 按「一层要几个」铺：箱子一行一行码，整行要么长边顺 1.2 m、要么转 90°。
 * 摆不满托盘时按最省的方式选行数，算出探出多少 —— 现场确实会把箱子堆到板沿外，
 * 所以这里不硬拦，只把探出量报上去让界面提醒。
 */
function rowsPlan(sku: Sku, want: number): LayerPlan {
  const l = Math.max(1, sku.boxL)
  const w = Math.max(1, sku.boxW)
  const capA = Math.max(1, Math.floor(PALLET_L / l)) // 长边顺 1.2 m
  const capB = Math.max(1, Math.floor(PALLET_L / w)) // 转 90°

  let best: { rows: { n: number; turn: boolean }[]; x: number; z: number; over: number } | null = null

  for (let na = 0; na <= want; na++) {
    for (let nb = 0; nb <= want; nb++) {
      if (na * capA + nb * capB < want) continue
      // 先排满行，再从末尾削掉多余的
      const rows: { n: number; turn: boolean }[] = [
        ...Array.from({ length: na }, () => ({ n: capA, turn: false })),
        ...Array.from({ length: nb }, () => ({ n: capB, turn: true })),
      ]
      let extra = na * capA + nb * capB - want
      for (let i = rows.length - 1; i >= 0 && extra > 0; i--) {
        const cut = Math.min(rows[i].n, extra)
        rows[i].n -= cut
        extra -= cut
      }
      const kept = rows.filter((r) => r.n > 0)
      if (kept.length === 0) continue
      const x = Math.max(...kept.map((r) => r.n * (r.turn ? w : l)))
      const z = kept.reduce((sum, r) => sum + (r.turn ? l : w), 0)
      const over = Math.max(0, x - PALLET_L) + Math.max(0, z - PALLET_W)
      if (!best || over < best.over || (over === best.over && z < best.z)) {
        best = { rows: kept, x, z, over }
      }
    }
  }

  const rows = best?.rows ?? [{ n: Math.min(want, capA), turn: false }]
  const depth = rows.reduce((sum, r) => sum + (r.turn ? l : w), 0)

  const slots: Slot[] = []
  let cursor = -depth / 2
  for (const r of rows) {
    const rh = r.turn ? l : w
    const rw = r.n * (r.turn ? w : l)
    for (let i = 0; i < r.n; i++) {
      const dx = r.turn ? w : l
      slots.push({ x: -rw / 2 + dx / 2 + i * dx, z: cursor + rh / 2, turn: r.turn })
    }
    cursor += rh
  }

  const over = { x: Math.max(0, (best?.x ?? 0) - PALLET_L), z: Math.max(0, depth - PALLET_W) }
  const note = `${rows.map((r) => r.n).join(' + ')} ${['一', '两', '三', '四'][rows.length - 1] ?? rows.length}排`
  return {
    perLayer: slots.length,
    slots,
    note,
    fixed: true,
    ...(over.x > 0 || over.z > 0 ? { over } : {}),
  }
}

/**
 * 现场定的「一层几个」：
 *   包子 7（3 竖 + 4 横）、糯米鸡 7（同样码法）、烧麦 5（3 竖 + 2 横留缝）、
 *   饺子 10（6 竖 + 4 横，两块拼，两边略探出板沿）、菜团子 8（2 + 3 + 3 三排，比板宽 24 cm）。
 * 只写死一行个数，具体怎么摆还是按箱规算，换箱规不会算出重叠。
 */
export function layerPlan(sku: Sku): LayerPlan {
  const key = `${sku.name}${sku.shortName}`
  if (/烧麦/.test(key)) return shaomaiPlan(sku)
  if (/饺子|水饺/.test(key)) return jiaoziPlan(sku)
  if (/菜团子/.test(key)) return rowsPlan(sku, 8)
  if (/菜包|肉包|糯米鸡/.test(key)) return baoPlan(sku)
  return gridPlan(sku)
}

/**
 * 这一层实际摆在哪：单数层整体转 180°。
 * 现场是这么码的 —— 上下层的缝错开压住，垛才不歪；所以「每层几个」不变，方向隔层调头。
 */
export function layerSlots(plan: LayerPlan, layer: number): Slot[] {
  if (layer % 2 === 0) return plan.slots
  return plan.slots.map((s) => ({ x: -s.x, z: -s.z, turn: s.turn }))
}

/** 这个品满层几个 */
export function perLayerOf(sku: Sku) {
  return layerPlan(sku).perLayer
}

/** 满层几个（旧名，等价于 perLayerOf） */
export function maxPerLayer(sku: Sku) {
  return perLayerOf(sku)
}

/** 这个箱规最多能码几层：按 1.8 米总高倒推 */
export function maxLayers(sku: Sku) {
  return Math.max(1, Math.floor((MAX_STACK_H - PALLET_H) / Math.max(50, sku.boxH)))
}

/**
 * 层数口算式：「8 层 × 7 个 + 顶层 6 个」，一眼能对上总数。
 * 顶层码满就不带尾巴，直接「7 层 × 7 个」；只有一层时也不搞乘法。
 */
export function layerExpr(layers: number, perLayer: number, topCount: number) {
  const top = Math.min(Math.max(1, topCount), Math.max(1, perLayer))
  if (layers <= 1) return `1 层 ${top} 个`
  return top >= perLayer ? `${layers} 层 × ${perLayer} 个` : `${layers - 1} 层 × ${perLayer} 个 + 顶层 ${top} 个`
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

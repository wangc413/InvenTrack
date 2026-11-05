import { useSyncExternalStore } from 'react'

export type Sku = {
  id: string
  code: string
  name: string
  spec: string
  unit: string
  perBox: number
  boxL: number
  boxW: number
  boxH: number
  boxWeight: number
}

export type Batch = {
  id: string
  skuId: string
  batchNo: string
  /** 入库时的总量，只作记录；实际余量由流水算出 */
  qty: number
  prodDate: string
  createdAt: number
}

export type MoveType = 'in' | 'out' | 'return' | 'adjust'

/**
 * 一条库存流水。
 * 关键设计：库存不存“当前值”，永远由流水累加得到。
 * 这样发货、退货、盘点、撤销都只是“再记一笔”，不会出现两处数字对不上。
 */
export type Move = {
  id: string
  at: number
  type: MoveType
  skuId: string
  batchId: string
  /** 带符号：正数增加库存，负数减少库存 */
  qty: number
  /** 关联单号或来源，撤销时靠它找回原流水 */
  ref: string
  note: string
  /** 已被撤销过：避免“发车→撤销→再发车→再撤销”时把库存补两次 */
  voided?: boolean
}

/** 一个拖板上某品项放了几箱 */
export type PalletItem = { skuId: string; boxes: number }

/** 一块拖板 */
export type Pallet = {
  id: string
  no: string
  items: PalletItem[]
  createdAt: number
}

export type Order = {
  id: string
  no: string
  customer: string
  remark: string
  createdAt: number
  status: 'draft' | 'shipped'
  pallets: Pallet[]
}

export type Truck = {
  id: string
  name: string
  L: number
  W: number
  H: number
  maxWeight: number
}

export type DB = {
  skus: Sku[]
  batches: Batch[]
  moves: Move[]
  orders: Order[]
  trucks: Truck[]
  seq: number
}

const KEY = 'inventrack.v1'

const uid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4)

function seed(): DB {
  const today = new Date().toISOString().slice(0, 10)
  const now = Date.now()
  const a: Sku = {
    id: 'demo1', code: '6901234567890', name: '示例·纸箱装A', spec: '500g×12',
    unit: '箱', perBox: 12, boxL: 40, boxW: 30, boxH: 25, boxWeight: 6.5,
  }
  const b: Sku = {
    id: 'demo2', code: '6909876543210', name: '示例·礼盒B', spec: '250g×24',
    unit: '箱', perBox: 24, boxL: 50, boxW: 35, boxH: 30, boxWeight: 9,
  }
  const ba: Batch = { id: uid(), skuId: a.id, batchNo: 'B20261101', qty: 240, prodDate: today, createdAt: now }
  const bb: Batch = { id: uid(), skuId: b.id, batchNo: 'B20261028', qty: 120, prodDate: today, createdAt: now }
  return {
    skus: [a, b],
    batches: [ba, bb],
    moves: [
      { id: uid(), at: now, type: 'in', skuId: a.id, batchId: ba.id, qty: 240, ref: '期初', note: '示例入库' },
      { id: uid(), at: now, type: 'in', skuId: b.id, batchId: bb.id, qty: 120, ref: '期初', note: '示例入库' },
    ],
    orders: [],
    trucks: [{ id: uid(), name: '4.2米厢货', L: 420, W: 200, H: 220, maxWeight: 2000 }],
    seq: 1,
  }
}

function migrate(raw: Record<string, unknown>): DB {
  const base = seed()
  const data = raw as Partial<DB>

  const orders = (data.orders ?? []).map((o) => {
    const legacy = o as Order & { lines?: { skuId: string; qty: number }[] }
    const pallets = Array.isArray(legacy.pallets) ? legacy.pallets : []
    return { ...legacy, pallets } as Order
  })

  // 批次：丢掉旧的 left 字段，余量一律由流水算
  const rawBatches = (Array.isArray(data.batches) ? data.batches : base.batches) as (Batch & { left?: number })[]
  const batches: Batch[] = rawBatches.map((b) => ({
    id: b.id,
    skuId: b.skuId,
    batchNo: b.batchNo ?? '无批次',
    qty: Number(b.qty) || 0,
    prodDate: b.prodDate ?? '',
    createdAt: Number(b.createdAt) || Date.now(),
  }))

  // 没有流水的老数据：按“入库总量 - 已发出”倒推，保证结转后的余量和以前一致
  let moves: Move[]
  if (Array.isArray(data.moves)) {
    moves = data.moves
  } else {
    moves = []
    for (const b of rawBatches) {
      const at = Number(b.createdAt) || Date.now()
      const total = Number(b.qty) || 0
      const left = b.left
      if (total > 0) {
        moves.push({ id: uid(), at, type: 'in', skuId: b.skuId, batchId: b.id, qty: total, ref: '期初', note: '历史结转' })
      }
      if (typeof left !== 'number') continue
      const used = total - left
      if (used > 0) {
        moves.push({ id: uid(), at, type: 'out', skuId: b.skuId, batchId: b.id, qty: -used, ref: '期初', note: '历史已发' })
      } else if (used < 0) {
        // 老数据里余量比入库量还多（当时手工加过），补一笔调整把差额补上
        moves.push({ id: uid(), at, type: 'adjust', skuId: b.skuId, batchId: b.id, qty: -used, ref: '期初', note: '历史盘盈' })
      }
    }
  }

  return {
    skus: data.skus ?? base.skus,
    batches,
    moves,
    orders,
    trucks: data.trucks?.length ? data.trucks : base.trucks,
    seq: data.seq ?? 1,
  }
}

function readLocal(): DB | null {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return null
    return migrate(JSON.parse(raw))
  } catch {
    return null
  }
}

/* ---------- 持久化：浏览器数据库（IndexedDB）为主，localStorage 兜底 ---------- */

const IDB_NAME = 'inventrack'
const IDB_STORE = 'kv'
const IDB_KEY = 'db'

export type StorageMode = 'idb' | 'local'

export type StorageInfo = {
  /** idb = 浏览器数据库（容量按手机剩余空间算）；local = 老式缓存（约 5MB 封顶） */
  mode: StorageMode
  ready: boolean
  /** 写入失败等异常信息，空字符串表示正常 */
  error: string
  /** 当前数据字符数 */
  chars: number
  /** 最近一次落盘时间 */
  savedAt: number
  /** 浏览器是否同意了“长期保留数据” */
  persisted: boolean
}

let info: StorageInfo = { mode: 'local', ready: false, error: '', chars: 0, savedAt: 0, persisted: false }
const infoListeners = new Set<() => void>()
const emitInfo = () => {
  info = { ...info }
  infoListeners.forEach((fn) => fn())
}

let idb: IDBDatabase | null = null

function openIdb(): Promise<IDBDatabase | null> {
  return new Promise((resolve) => {
    try {
      if (typeof indexedDB === 'undefined') return resolve(null)
      const req = indexedDB.open(IDB_NAME, 1)
      req.onupgradeneeded = () => {
        const db = req.result
        if (!db.objectStoreNames.contains(IDB_STORE)) db.createObjectStore(IDB_STORE)
      }
      req.onsuccess = () => resolve(req.result)
      req.onerror = () => resolve(null)
      req.onblocked = () => resolve(null)
    } catch {
      resolve(null)
    }
  })
}

function idbGet(key: string): Promise<unknown> {
  return new Promise((resolve) => {
    if (!idb) return resolve(null)
    try {
      const req = idb.transaction(IDB_STORE, 'readonly').objectStore(IDB_STORE).get(key)
      req.onsuccess = () => resolve(req.result ?? null)
      req.onerror = () => resolve(null)
    } catch {
      resolve(null)
    }
  })
}

function idbSet(key: string, value: unknown): Promise<boolean> {
  return new Promise((resolve) => {
    if (!idb) return resolve(false)
    try {
      const tx = idb.transaction(IDB_STORE, 'readwrite')
      tx.objectStore(IDB_STORE).put(value, key)
      tx.oncomplete = () => resolve(true)
      tx.onerror = () => resolve(false)
      tx.onabort = () => resolve(false)
    } catch {
      resolve(false)
    }
  })
}

let state: DB = seed()
const listeners = new Set<() => void>()

/** 启动时调用一次：把数据从磁盘读回内存，并完成 localStorage → IndexedDB 的迁移 */
export async function initStore() {
  const local = readLocal()
  const db = await openIdb()

  if (db) {
    idb = db
    info.mode = 'idb'
    const stored = await idbGet(IDB_KEY)
    if (stored && typeof stored === 'object') {
      state = migrate(stored as Record<string, unknown>)
    } else if (local) {
      state = local
      await idbSet(IDB_KEY, local)
    } else {
      state = seed()
      await idbSet(IDB_KEY, state)
    }
    // 迁移完成，删掉 localStorage 里的旧副本，免得两份各占一份配额
    try {
      localStorage.removeItem(KEY)
    } catch {
      /* 忽略 */
    }
  } else {
    state = local ?? seed()
    info.mode = 'local'
    if (!local) info.error = '这台手机的浏览器不支持数据库，已退回缓存模式，容量有限'
  }

  info.chars = JSON.stringify(state).length
  info.ready = true
  emitInfo()
  listeners.forEach((fn) => fn())

  // 申请“长期保留”，降低被浏览器当缓存清掉的可能（Chrome 静默同意，Safari 不支持）
  try {
    if (navigator.storage?.persist) {
      info.persisted = await navigator.storage.persist()
      emitInfo()
    }
  } catch {
    /* 忽略 */
  }
}

let timer: ReturnType<typeof setTimeout> | null = null
let writing = false
let pending = false

function schedulePersist() {
  if (timer) clearTimeout(timer)
  timer = setTimeout(() => {
    timer = null
    void persist()
  }, 120)
}

async function persist() {
  const data = state
  info.chars = JSON.stringify(data).length

  if (info.mode === 'idb') {
    if (writing) {
      pending = true
      return
    }
    writing = true
    const ok = await idbSet(IDB_KEY, data)
    writing = false
    if (!ok) {
      info.mode = 'local'
      info.error = '数据库写入失败，已切回缓存模式，请尽快导出备份'
    }
    if (pending) {
      pending = false
      void persist()
    } else {
      info.savedAt = Date.now()
      emitInfo()
    }
    return
  }

  try {
    localStorage.setItem(KEY, JSON.stringify(data))
    info.error = ''
  } catch {
    info.error = '手机存储已满，最新改动没能存下来，请立即导出备份'
  }
  info.savedAt = Date.now()
  emitInfo()
}

/** 立即落盘（切后台、关页面前调用，避免丢掉最后几下操作） */
export function flush() {
  if (timer) {
    clearTimeout(timer)
    timer = null
  }
  void persist()
}

if (typeof window !== 'undefined') {
  window.addEventListener('pagehide', flush)
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') flush()
  })
}

function commit(next: DB) {
  state = next
  schedulePersist()
  listeners.forEach((fn) => fn())
}

export function subscribe(fn: () => void) {
  listeners.add(fn)
  return () => {
    listeners.delete(fn)
  }
}

export function subscribeInfo(fn: () => void) {
  infoListeners.add(fn)
  return () => {
    infoListeners.delete(fn)
  }
}

export const getState = () => state
export const useDB = () => useSyncExternalStore(subscribe, getState, getState)

export const getInfo = () => info
export const useStorageInfo = () => useSyncExternalStore(subscribeInfo, getInfo, getInfo)

export function replaceAll(next: DB) {
  commit(migrate(next as unknown as Record<string, unknown>))
}

export function resetAll() {
  commit(seed())
}

/* ---------- 品项 ---------- */

export function saveSku(input: Omit<Sku, 'id'> & { id?: string }) {
  const id = input.id ?? uid()
  const sku: Sku = { ...input, id }
  const exists = state.skus.some((s) => s.id === id)
  commit({
    ...state,
    skus: exists ? state.skus.map((s) => (s.id === id ? sku : s)) : [sku, ...state.skus],
  })
  return id
}

export function removeSku(id: string) {
  commit({
    ...state,
    skus: state.skus.filter((s) => s.id !== id),
    batches: state.batches.filter((b) => b.skuId !== id),
    moves: state.moves.filter((m) => m.skuId !== id),
  })
}

/* ---------- 库存流水 ---------- */

function pushMove(db: DB, move: Omit<Move, 'id' | 'at'> & { at?: number }): Move[] {
  const m: Move = { ...move, id: uid(), at: move.at ?? Date.now() }
  return [m, ...db.moves]
}

/** 入库：建一个批次，同时记一条入账流水 */
export function addBatch(input: { skuId: string; batchNo: string; qty: number; prodDate: string; note?: string }) {
  if (!(input.qty > 0)) return ''
  const batch: Batch = {
    id: uid(),
    skuId: input.skuId,
    batchNo: input.batchNo || '无批次',
    qty: input.qty,
    prodDate: input.prodDate,
    createdAt: Date.now(),
  }
  commit({
    ...state,
    batches: [batch, ...state.batches],
    moves: pushMove(state, {
      type: 'in',
      skuId: input.skuId,
      batchId: batch.id,
      qty: input.qty,
      ref: '入库',
      note: input.note ?? '手工入库',
    }),
  })
  return batch.id
}

/** 退货 / 补货：往已有批次里加数量 */
export function returnToBatch(batchId: string, qty: number, note = '退货入库') {
  const batch = state.batches.find((b) => b.id === batchId)
  if (!batch || !(qty > 0)) return
  commit({
    ...state,
    batches: state.batches.map((b) => (b.id === batchId ? { ...b, qty: b.qty + qty } : b)),
    moves: pushMove(state, {
      type: 'return',
      skuId: batch.skuId,
      batchId,
      qty,
      ref: '退货',
      note,
    }),
  })
}

/** 盘点：把某批次调成实际数量，差额记一笔调整流水 */
export function adjustBatch(batchId: string, actual: number, note = '盘点调整') {
  const batch = state.batches.find((b) => b.id === batchId)
  if (!batch) return
  const current = batchLeft(state, batchId)
  const diff = Math.round(actual) - current
  if (diff === 0) return
  commit({
    ...state,
    moves: pushMove(state, {
      type: 'adjust',
      skuId: batch.skuId,
      batchId,
      qty: diff,
      ref: '盘点',
      note: `${note}（账面 ${current} → 实盘 ${Math.round(actual)}）`,
    }),
  })
}

/** 删除批次：连同它的流水一起删掉（等于这批货从账上消失） */
export function removeBatch(id: string) {
  commit({
    ...state,
    batches: state.batches.filter((b) => b.id !== id),
    moves: state.moves.filter((m) => m.batchId !== id),
  })
}

/* ---------- 车次 / 发货单 ---------- */

export function createOrder(customer: string, remark = '') {
  const d = new Date()
  const ymd = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`
  const order: Order = {
    id: uid(),
    no: `FH${ymd}-${String(state.seq).padStart(3, '0')}`,
    customer: customer || '未填客户',
    remark,
    createdAt: Date.now(),
    status: 'draft',
    pallets: [],
  }
  commit({ ...state, orders: [order, ...state.orders], seq: state.seq + 1 })
  return order.id
}

export function updateOrder(id: string, patch: Partial<Order>) {
  commit({ ...state, orders: state.orders.map((o) => (o.id === id ? { ...o, ...patch } : o)) })
}

export function removeOrder(id: string) {
  commit({ ...state, orders: state.orders.filter((o) => o.id !== id) })
}

/* ---------- 拖板 ---------- */

export function addPallet(orderId: string) {
  const pallet: Pallet = { id: uid(), no: '', items: [], createdAt: Date.now() }
  commit({
    ...state,
    orders: state.orders.map((o) => {
      if (o.id !== orderId) return o
      const nextPallet = { ...pallet, no: `P${o.pallets.length + 1}` }
      pallet.no = nextPallet.no
      return { ...o, pallets: [...o.pallets, nextPallet] }
    }),
  })
  return pallet.id
}

export function removePallet(orderId: string, palletId: string) {
  commit({
    ...state,
    orders: state.orders.map((o) => {
      if (o.id !== orderId) return o
      const pallets = o.pallets
        .filter((p) => p.id !== palletId)
        .map((p, i) => ({ ...p, no: `P${i + 1}` }))
      return { ...o, pallets }
    }),
  })
}

/** 设置某个拖板上某品项的箱数，0 表示移除 */
export function setItemBoxes(orderId: string, palletId: string, skuId: string, boxes: number) {
  commit({
    ...state,
    orders: state.orders.map((o) => {
      if (o.id !== orderId) return o
      return {
        ...o,
        pallets: o.pallets.map((p) => {
          if (p.id !== palletId) return p
          const idx = p.items.findIndex((it) => it.skuId === skuId)
          let items = p.items
          if (idx >= 0) {
            items = boxes > 0
              ? p.items.map((it, i) => (i === idx ? { ...it, boxes } : it))
              : p.items.filter((_, i) => i !== idx)
          } else if (boxes > 0) {
            items = [...p.items, { skuId, boxes }]
          }
          return { ...p, items }
        }),
      }
    }),
  })
}

export function movePallet(orderId: string, palletId: string, dir: -1 | 1) {
  commit({
    ...state,
    orders: state.orders.map((o) => {
      if (o.id !== orderId) return o
      const idx = o.pallets.findIndex((p) => p.id === palletId)
      const to = idx + dir
      if (idx < 0 || to < 0 || to >= o.pallets.length) return o
      const pallets = [...o.pallets]
      const [moved] = pallets.splice(idx, 1)
      pallets.splice(to, 0, moved)
      return { ...o, pallets: pallets.map((p, i) => ({ ...p, no: `P${i + 1}` })) }
    }),
  })
}

/** 这车货每个品项要出多少箱 */
export function needOf(order: Order) {
  const need = new Map<string, number>()
  for (const p of order.pallets) {
    for (const it of p.items) {
      need.set(it.skuId, (need.get(it.skuId) ?? 0) + it.boxes)
    }
  }
  return need
}

/** 发车前对一下账：哪些品项不够，各差多少件 */
export function shortages(db: DB, order: Order) {
  const out: { sku: Sku; need: number; have: number; short: number }[] = []
  for (const [skuId, boxes] of needOf(order)) {
    const sku = db.skus.find((s) => s.id === skuId)
    if (!sku) continue
    const need = boxes * (sku.perBox || 1)
    const have = stockOf(db, skuId)
    if (need > have) out.push({ sku, need, have, short: need - have })
  }
  return out
}

/**
 * 确认发车：按拖板汇总箱数，折成件数后先进先出扣库存。
 * 扣减不是改数字，而是给每个被吃到的批次记一笔负数流水。
 * 库存不够时照样记（账面会出现负数），前端负责提示。
 */
export function shipOrder(id: string) {
  const order = state.orders.find((o) => o.id === id)
  if (!order || order.status === 'shipped') return

  let moves = state.moves
  const newMoves: Move[] = []

  for (const [skuId, boxes] of needOf(order)) {
    const sku = state.skus.find((s) => s.id === skuId)
    let remain = boxes * (sku?.perBox || 1)

    const pool = state.batches
      .filter((b) => b.skuId === skuId)
      .map((b) => ({ batch: b, left: batchLeft(state, b.id) }))
      .filter((x) => x.left > 0)
      .sort((a, b) => a.batch.createdAt - b.batch.createdAt)

    for (const { batch, left } of pool) {
      if (remain <= 0) break
      const take = Math.min(left, remain)
      remain -= take
      newMoves.push({
        id: uid(),
        at: Date.now(),
        type: 'out',
        skuId,
        batchId: batch.id,
        qty: -take,
        ref: order.no,
        note: '发车出库',
      })
    }

    // 所有批次都吃空了还不够：记一笔无批次的负数流水，把缺口显性化，方便事后补
    if (remain > 0) {
      newMoves.push({
        id: uid(),
        at: Date.now(),
        type: 'out',
        skuId,
        batchId: '',
        qty: -remain,
        ref: order.no,
        note: '库存不足，超发部分',
      })
    }
  }

  moves = [...newMoves.reverse(), ...moves]

  commit({
    ...state,
    moves,
    orders: state.orders.map((o) => (o.id === id ? { ...o, status: 'shipped' } : o)),
  })
}

/** 撤销发车：把这单的出库流水逐条反向记回去，单据退回未发车 */
export function unshipOrder(id: string) {
  const order = state.orders.find((o) => o.id === id)
  if (!order || order.status !== 'shipped') return

  const outs = state.moves.filter((m) => m.type === 'out' && m.ref === order.no && !m.voided)
  if (outs.length === 0) return

  const back: Move[] = outs.map((m) => ({
    id: uid(),
    at: Date.now(),
    type: 'return',
    skuId: m.skuId,
    batchId: m.batchId,
    qty: -m.qty,
    ref: order.no,
    note: '撤销发车，库存回补',
  }))

  const reversed = new Set(outs.map((m) => m.id))

  commit({
    ...state,
    moves: [...back, ...state.moves.map((m) => (reversed.has(m.id) ? { ...m, voided: true } : m))],
    orders: state.orders.map((o) => (o.id === id ? { ...o, status: 'draft' } : o)),
  })
}

/* ---------- 车厢 ---------- */

export function saveTruck(t: Omit<Truck, 'id'> & { id?: string }) {
  const id = t.id ?? uid()
  const truck: Truck = { ...t, id }
  const exists = state.trucks.some((x) => x.id === id)
  commit({
    ...state,
    trucks: exists ? state.trucks.map((x) => (x.id === id ? truck : x)) : [...state.trucks, truck],
  })
}

/* ---------- 查询 ---------- */

export const skuById = (skus: Sku[], id: string) => skus.find((s) => s.id === id)

type Projection = { bySku: Map<string, number>; byBatch: Map<string, number> }
let projFor: DB | null = null
let proj: Projection = { bySku: new Map(), byBatch: new Map() }

/** 把全部流水累加成“每个品项、每个批次还剩多少”。按数据对象缓存，一次改动只算一遍 */
function project(db: DB): Projection {
  if (projFor === db) return proj
  const bySku = new Map<string, number>()
  const byBatch = new Map<string, number>()
  for (const m of db.moves) {
    bySku.set(m.skuId, (bySku.get(m.skuId) ?? 0) + m.qty)
    if (m.batchId) byBatch.set(m.batchId, (byBatch.get(m.batchId) ?? 0) + m.qty)
  }
  projFor = db
  proj = { bySku, byBatch }
  return proj
}

export const batchLeft = (db: DB, batchId: string) => project(db).byBatch.get(batchId) ?? 0
export const stockOf = (db: DB, skuId: string) => project(db).bySku.get(skuId) ?? 0

/** 某品项还有货的批次，按入库先后排（先进先出用这个顺序） */
export function batchesOf(db: DB, skuId: string) {
  return db.batches
    .filter((b) => b.skuId === skuId)
    .map((batch) => ({ batch, left: batchLeft(db, batch.id) }))
    .filter((x) => x.left > 0)
    .sort((a, b) => a.batch.createdAt - b.batch.createdAt)
}

/** 某品项最近的库存流水 */
export function movesOf(db: DB, skuId: string, limit = 12) {
  return db.moves.filter((m) => m.skuId === skuId).slice(0, limit)
}

/** 今日入库 / 出库件数（退货算入，调整按正负各归一边） */
export function todayFlow(db: DB) {
  const start = new Date()
  start.setHours(0, 0, 0, 0)
  let inQty = 0
  let outQty = 0
  for (const m of db.moves) {
    if (m.at < start.getTime()) continue
    if (m.qty > 0) inQty += m.qty
    else outQty += -m.qty
  }
  return { inQty, outQty }
}

export function findByCode(db: DB, code: string) {
  const c = code.trim()
  if (!c) return undefined
  return db.skus.find((s) => s.code === c) ?? db.skus.find((s) => s.code.endsWith(c) || c.endsWith(s.code))
}

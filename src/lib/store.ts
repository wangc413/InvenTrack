import { useSyncExternalStore } from 'react'

/** 客户 / 收货方：盒马、快乐猴、菜洋洋……可自行增补 */
export type Customer = {
  id: string
  name: string
  /** 列表里用的短名 */
  short: string
}

export type Sku = {
  id: string
  code: string
  name: string
  /** 归哪个客户 / 渠道 */
  customerId: string
  /** 规格，如 640g(8只)×12袋 */
  spec: string
  /** 箱面大字 */
  shortName: string
  /** 每箱装多少件（袋 / 盒） */
  perBox: number
  /** 外箱三围，毫米 */
  boxL: number
  boxW: number
  boxH: number
  /** 单箱毛重，公斤 */
  boxWeight: number
  /** 箱面牛皮纸底色 */
  boxColor: string
  /** 品牌色块 */
  accentColor: string
  /** 色块上的字色 */
  textColor: string
}

export type Batch = {
  id: string
  skuId: string
  batchNo: string
  /** 入库时的总量，只作记录；实际余量由流水算出 */
  qty: number
  /** 生产日期 YYYY-MM-DD —— 发货时按这个日期选货 */
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

/**
 * 一块拖板：只放一种商品、一个生产日期。
 * 堆码按“层”描述：满层数 × 每层箱数 + 顶层箱数。
 */
export type Pallet = {
  id: string
  no: string
  skuId: string
  prodDate: string
  layers: number
  perLayer: number
  /** 顶层实际放几箱，其余层按 perLayer 放满 */
  topCount: number
  createdAt: number
}

export type Order = {
  id: string
  no: string
  /** 收货地，必填 */
  destination: string
  customerId: string
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
  customers: Customer[]
  skus: Sku[]
  batches: Batch[]
  moves: Move[]
  orders: Order[]
  trucks: Truck[]
  seq: number
}

const KEY = 'inventrack.v1'

const uid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4)

/** 一块拖板折成多少箱 */
export const palletBoxes = (p: Pallet) =>
  Math.max(0, (Math.max(1, p.layers) - 1) * Math.max(1, p.perLayer) + Math.max(0, p.topCount))

/** 默认每层 6 箱、7 层 —— 仓库里最常见的一种码法 */
export const DEFAULT_LAYERS = 7
export const DEFAULT_PER_LAYER = 6

export const CUSTOMER_HM = 'c-hm'
export const CUSTOMER_KLH = 'c-klh'
export const CUSTOMER_CYY = 'c-cyy'

function seed(): DB {
  const now = Date.now()
  const day = (n: number) => {
    const d = new Date()
    d.setDate(d.getDate() - n)
    return d.toISOString().slice(0, 10)
  }

  const customers: Customer[] = [
    { id: CUSTOMER_HM, name: '盒马', short: '盒马' },
    { id: CUSTOMER_KLH, name: '快乐猴', short: '快乐猴' },
    { id: CUSTOMER_CYY, name: '菜洋洋', short: '菜洋洋' },
  ]

  const mk = (s: Partial<Sku> & Pick<Sku, 'id' | 'name' | 'shortName' | 'spec' | 'customerId'>): Sku => ({
    code: '',
    perBox: 12,
    boxL: 500,
    boxW: 340,
    boxH: 200,
    boxWeight: 8,
    boxColor: '#d99a5a',
    accentColor: '#3aa15c',
    textColor: '#ffffff',
    ...s,
  })

  const skus: Sku[] = [
    mk({
      id: 'sku-meat',
      name: '超合算 NB 鲜汁大肉包',
      shortName: '鲜汁大肉包',
      spec: '800克(10只)×8袋',
      customerId: CUSTOMER_HM,
      perBox: 8,
      boxL: 500,
      boxW: 335,
      boxH: 190,
      boxWeight: 7.2,
      accentColor: '#6b2f2a',
    }),
    mk({
      id: 'sku-green',
      name: '超合算 NB 翡翠香菇青菜包',
      shortName: '翡翠香菇青菜包',
      spec: '640克(8只)×12袋',
      customerId: CUSTOMER_HM,
      perBox: 12,
      boxL: 500,
      boxW: 340,
      boxH: 200,
      boxWeight: 8.2,
      accentColor: '#3aa15c',
    }),
    mk({
      id: 'sku-shaomai',
      name: '肉松咸蛋黄松仁 纸皮烧麦',
      shortName: '纸皮烧麦',
      spec: '240克×36盒',
      customerId: CUSTOMER_HM,
      perBox: 36,
      boxL: 465,
      boxW: 410,
      boxH: 235,
      boxWeight: 9.2,
      boxColor: '#f5b183',
      accentColor: '#f08a2a',
      textColor: '#ffffff',
    }),
    mk({
      id: 'sku-green-klh',
      name: '翡翠香菇青菜包（快乐猴）',
      shortName: '翡翠香菇青菜包',
      spec: '640克(8只)×12袋',
      customerId: CUSTOMER_KLH,
      perBox: 12,
      boxWeight: 8.2,
      accentColor: '#3aa15c',
    }),
    mk({
      id: 'sku-meat-cyy',
      name: '鲜汁大肉包（菜洋洋）',
      shortName: '鲜汁大肉包',
      spec: '800克(10只)×8袋',
      customerId: CUSTOMER_CYY,
      perBox: 8,
      boxL: 500,
      boxW: 335,
      boxH: 190,
      boxWeight: 7.2,
      accentColor: '#6b2f2a',
    }),
  ]

  const batches: Batch[] = []
  const moves: Move[] = []

  const stock = (sku: Sku, prodDate: string, qty: number) => {
    const b: Batch = { id: uid(), skuId: sku.id, batchNo: prodDate.replace(/-/g, ''), qty, prodDate, createdAt: now }
    batches.push(b)
    moves.push({ id: uid(), at: now, type: 'in', skuId: sku.id, batchId: b.id, qty, ref: '期初', note: '示例入库' })
  }

  const byId = (id: string) => skus.find((s) => s.id === id)!

  stock(byId('sku-meat'), day(4), 120)
  stock(byId('sku-meat'), day(2), 96)
  stock(byId('sku-meat'), day(1), 240)
  stock(byId('sku-green'), day(8), 144)
  stock(byId('sku-green'), day(3), 180)
  stock(byId('sku-shaomai'), day(4), 216)
  stock(byId('sku-green-klh'), day(2), 96)
  stock(byId('sku-meat-cyy'), day(3), 80)

  return {
    customers,
    skus,
    batches,
    moves,
    orders: [],
    trucks: [{ id: uid(), name: '4.2米厢货', L: 4200, W: 2000, H: 2200, maxWeight: 2000 }],
    seq: 1,
  }
}

type LegacyPallet = { id?: string; no?: string; createdAt?: number; items?: { skuId: string; boxes: number }[] }
type LegacyOrder = Order & { customer?: string; pallets?: LegacyPallet[] }

function migrate(raw: Record<string, unknown>): DB {
  const base = seed()
  const data = raw as Partial<DB> & { orders?: LegacyOrder[] }

  const customers = Array.isArray(data.customers) && data.customers.length ? data.customers : base.customers
  const fallbackCustomer = customers[0]?.id ?? CUSTOMER_HM

  // 品项：补齐新字段（客户、箱面配色、箱面大字）
  const rawSkus = (Array.isArray(data.skus) && data.skus.length ? data.skus : base.skus) as (Sku &
    Partial<Pick<Sku, 'customerId' | 'shortName' | 'boxColor' | 'accentColor' | 'textColor'>>)[]
  const skus: Sku[] = rawSkus.map((s) => ({
    ...s,
    customerId: s.customerId ?? fallbackCustomer,
    shortName: s.shortName ?? s.name,
    boxColor: s.boxColor ?? '#d99a5a',
    accentColor: s.accentColor ?? '#3aa15c',
    textColor: s.textColor ?? '#ffffff',
  }))

  // 批次：丢掉旧的 left 字段，余量一律由流水算
  const rawBatches = (Array.isArray(data.batches) ? data.batches : base.batches) as (Batch & { left?: number })[]
  const batches: Batch[] = rawBatches.map((b) => ({
    id: b.id,
    skuId: b.skuId,
    batchNo: b.batchNo ?? b.prodDate?.replace(/-/g, '') ?? '无批次',
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
        moves.push({ id: uid(), at, type: 'adjust', skuId: b.skuId, batchId: b.id, qty: -used, ref: '期初', note: '历史盘盈' })
      }
    }
  }

  // 单据：旧版一块板上混放多个品项，新版一板一品，按品项拆开
  const srcOrders = (Array.isArray(data.orders) ? data.orders : []) as LegacyOrder[]
  const orders: Order[] = srcOrders.map((o) => {
    const pallets: Pallet[] = []
    for (const p of o.pallets ?? []) {
      if ('skuId' in p && p.skuId) {
        pallets.push(p as Pallet)
        continue
      }
      const legacy = p as LegacyPallet
      for (const it of legacy.items ?? []) {
        const batch = batches.find((b) => b.skuId === it.skuId)
        const boxes = Math.max(1, it.boxes)
        const layers = Math.ceil(boxes / DEFAULT_PER_LAYER)
        pallets.push({
          id: uid(),
          no: '',
          skuId: it.skuId,
          prodDate: batch?.prodDate ?? '',
          layers,
          perLayer: DEFAULT_PER_LAYER,
          topCount: boxes - (layers - 1) * DEFAULT_PER_LAYER,
          createdAt: Number(p.createdAt) || Date.now(),
        })
      }
    }
    return {
      ...o,
      destination: o.destination || o.customer || '未填收货地',
      // 旧版只有一个客户名字段，迁移时统一挂到默认客户上
      customerId: o.customerId || fallbackCustomer,
      pallets: pallets.map((p, i) => ({ ...p, no: `P${i + 1}` })),
    } as Order
  })

  // 车厢：旧数据用厘米，新数据统一用毫米
  const rawTrucks = data.trucks?.length ? data.trucks : base.trucks
  const trucks: Truck[] = rawTrucks.map((t) => ({
    ...t,
    L: t.L < 100 ? t.L * 10 : t.L,
    W: t.W < 100 ? t.W * 10 : t.W,
    H: t.H < 100 ? t.H * 10 : t.H,
  }))

  return {
    customers,
    skus,
    batches,
    moves,
    orders,
    trucks,
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
  // 注意：不能 await，某些浏览器会弹权限提示，会卡住首屏渲染
  void (async () => {
    try {
      if (navigator.storage?.persist) {
        info.persisted = await navigator.storage.persist()
        emitInfo()
      }
    } catch {
      /* 忽略 */
    }
  })()
}

let timer: ReturnType<typeof setTimeout> | null = null
let writing = false
let pendingWrite = false

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
      pendingWrite = true
      return
    }
    writing = true
    info = { ...info, error: '' }
    const ok = await idbSet(IDB_KEY, data)
    writing = false
    if (!ok) {
      info = { ...info, error: '写入失败，请立即去「我的」导出备份' }
      emitInfo()
      return
    }
    info.savedAt = Date.now()
    emitInfo()
    if (pendingWrite) {
      pendingWrite = false
      void persist()
    }
    return
  }

  try {
    localStorage.setItem(KEY, JSON.stringify(data))
    info.savedAt = Date.now()
    info = { ...info, error: '' }
  } catch {
    info = { ...info, error: '存储已满，写入失败，请立即去「我的」导出备份' }
  }
  emitInfo()
}

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

/* ---------- 客户 ---------- */

export function saveCustomer(name: string) {
  const trimmed = name.trim()
  if (!trimmed) return ''
  const id = uid()
  commit({ ...state, customers: [...state.customers, { id, name: trimmed, short: trimmed }] })
  return id
}

export function updateCustomer(id: string, name: string) {
  const trimmed = name.trim()
  if (!trimmed) return false
  commit({
    ...state,
    customers: state.customers.map((c) => (c.id === id ? { ...c, name: trimmed, short: trimmed } : c)),
  })
  return true
}

export function removeCustomer(id: string) {
  if (state.skus.some((s) => s.customerId === id)) return false
  commit({ ...state, customers: state.customers.filter((c) => c.id !== id) })
  return true
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
export function addBatch(input: { skuId: string; qty: number; prodDate: string; batchNo?: string; note?: string }) {
  if (!(input.qty > 0)) return ''
  const batch: Batch = {
    id: uid(),
    skuId: input.skuId,
    batchNo: input.batchNo || input.prodDate.replace(/-/g, '') || '无批次',
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

/* ---------- 车次 ---------- */

export function createOrder(input: { destination: string; customerId: string; remark?: string }) {
  const d = new Date()
  const ymd = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`
  const order: Order = {
    id: uid(),
    no: `FH${ymd}-${String(state.seq).padStart(3, '0')}`,
    destination: input.destination.trim() || '未填收货地',
    customerId: input.customerId,
    remark: input.remark ?? '',
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

export function addPallet(orderId: string, input: Omit<Pallet, 'id' | 'no' | 'createdAt'>) {
  const id = uid()
  commit({
    ...state,
    orders: state.orders.map((o) => {
      if (o.id !== orderId) return o
      const pallet: Pallet = {
        ...input,
        id,
        no: `P${o.pallets.length + 1}`,
        createdAt: Date.now(),
      }
      return { ...o, pallets: [...o.pallets, pallet] }
    }),
  })
  return id
}

/**
 * 按箱数加板：先按满板（默认 7 层 × 6 个 = 42 箱）整板装，余数再按层数 + 顶层码。
 * 返回加入的板数。
 */
export function addPalletsByBoxes(
  orderId: string,
  input: { skuId: string; prodDate: string; boxes: number; perLayer?: number; maxLayers?: number },
) {
  const perLayer = input.perLayer ?? DEFAULT_PER_LAYER
  const maxLayers = input.maxLayers ?? DEFAULT_LAYERS
  const perPallet = perLayer * maxLayers

  const shapes: { layers: number; perLayer: number; topCount: number }[] = []
  const full = Math.floor(input.boxes / perPallet)
  for (let i = 0; i < full; i++) shapes.push({ layers: maxLayers, perLayer, topCount: perLayer })

  const rest = input.boxes - full * perPallet
  if (rest > 0) {
    const layers = Math.max(1, Math.ceil(rest / perLayer))
    shapes.push({ layers, perLayer, topCount: rest - (layers - 1) * perLayer })
  }
  if (shapes.length === 0) return 0

  commit({
    ...state,
    orders: state.orders.map((o) => {
      if (o.id !== orderId) return o
      const now = Date.now()
      const added: Pallet[] = shapes.map((s, i) => ({
        id: uid(),
        no: `P${o.pallets.length + i + 1}`,
        skuId: input.skuId,
        prodDate: input.prodDate,
        layers: s.layers,
        perLayer: s.perLayer,
        topCount: s.topCount,
        createdAt: now,
      }))
      return { ...o, pallets: [...o.pallets, ...added] }
    }),
  })
  return shapes.length
}

export function updatePallet(orderId: string, palletId: string, patch: Partial<Omit<Pallet, 'id'>>) {
  commit({
    ...state,
    orders: state.orders.map((o) => {
      if (o.id !== orderId) return o
      return { ...o, pallets: o.pallets.map((p) => (p.id === palletId ? { ...p, ...patch } : p)) }
    }),
  })
}

export function removePallet(orderId: string, palletId: string) {
  commit({
    ...state,
    orders: state.orders.map((o) => {
      if (o.id !== orderId) return o
      const pallets = o.pallets.filter((p) => p.id !== palletId).map((p, i) => ({ ...p, no: `P${i + 1}` }))
      return { ...o, pallets }
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

/** 这车货每个“品项 + 生产日期”要出多少箱 */
export function needByDate(order: Order) {
  const map = new Map<string, { skuId: string; prodDate: string; boxes: number }>()
  for (const p of order.pallets) {
    const key = `${p.skuId}|${p.prodDate}`
    const cur = map.get(key)
    if (cur) cur.boxes += palletBoxes(p)
    else map.set(key, { skuId: p.skuId, prodDate: p.prodDate, boxes: palletBoxes(p) })
  }
  return [...map.values()]
}

/** 这车货每个品项要出多少箱（不分日期） */
export function needOf(order: Order) {
  const need = new Map<string, number>()
  for (const p of order.pallets) {
    need.set(p.skuId, (need.get(p.skuId) ?? 0) + palletBoxes(p))
  }
  return need
}

/** 发车前对账：某个品项某个日期够不够（按生产日期要货，就不能从别的日期挪） */
export function shortages(db: DB, order: Order) {
  const out: { sku: Sku; prodDate: string; need: number; have: number; short: number }[] = []
  for (const line of needByDate(order)) {
    const sku = db.skus.find((s) => s.id === line.skuId)
    if (!sku) continue
    const need = line.boxes * (sku.perBox || 1)
    const have = stockOfDate(db, line.skuId, line.prodDate)
    if (need > have) out.push({ sku, prodDate: line.prodDate, need, have, short: need - have })
  }
  return out
}

/**
 * 确认发车：按“品项 + 生产日期”汇总箱数，折成件数后从该日期的批次里先进先出扣。
 * 扣减不是改数字，而是给每个被吃到的批次记一笔负数流水。
 */
export function shipOrder(id: string) {
  const order = state.orders.find((o) => o.id === id)
  if (!order || order.status === 'shipped') return

  const newMoves: Move[] = []

  for (const line of needByDate(order)) {
    const sku = state.skus.find((s) => s.id === line.skuId)
    let remain = line.boxes * (sku?.perBox || 1)

    const pool = state.batches
      .filter((b) => b.skuId === line.skuId && b.prodDate === line.prodDate)
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
        skuId: line.skuId,
        batchId: batch.id,
        qty: -take,
        ref: order.no,
        note: `发车出库(${line.prodDate})`,
      })
    }

    // 这个日期的货不够：记一笔无批次的负数流水，把缺口显性化，方便事后补
    if (remain > 0) {
      newMoves.push({
        id: uid(),
        at: Date.now(),
        type: 'out',
        skuId: line.skuId,
        batchId: '',
        qty: -remain,
        ref: order.no,
        note: `库存不足，超发(${line.prodDate})`,
      })
    }
  }

  commit({
    ...state,
    moves: [...newMoves.reverse(), ...state.moves],
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

export function skusOfCustomer(db: DB, customerId: string) {
  return db.skus.filter((s) => s.customerId === customerId)
}

export function customerById(db: DB, id: string) {
  return db.customers.find((c) => c.id === id)
}

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

/** 某品项按生产日期还剩多少，日期从新到旧 */
export function stockByDate(db: DB, skuId: string) {
  const map = new Map<string, number>()
  for (const { batch, left } of batchesOf(db, skuId)) {
    const d = batch.prodDate || '未填日期'
    map.set(d, (map.get(d) ?? 0) + left)
  }
  return [...map.entries()]
    .map(([prodDate, left]) => ({ prodDate, left }))
    .sort((a, b) => b.prodDate.localeCompare(a.prodDate))
}

/** 某品项某个生产日期还剩多少 */
export function stockOfDate(db: DB, skuId: string, prodDate: string) {
  return batchesOf(db, skuId)
    .filter((x) => (x.batch.prodDate || '未填日期') === prodDate)
    .reduce((s, x) => s + x.left, 0)
}

/** 某品项最近的库存流水 */
export function movesOf(db: DB, skuId: string, limit = 12) {
  return db.moves.filter((m) => m.skuId === skuId).slice(0, limit)
}

/** 今日入库 / 出库箱数（退货算入，调整按正负各归一边；已撤销的流水不计） */
export function todayFlow(db: DB) {
  const start = new Date()
  start.setHours(0, 0, 0, 0)
  const perOf = new Map(db.skus.map((s) => [s.id, s.perBox > 0 ? s.perBox : 1]))
  let inBoxes = 0
  let outBoxes = 0
  for (const m of db.moves) {
    if (m.at < start.getTime() || m.voided) continue
    const per = perOf.get(m.skuId) ?? 1
    if (m.qty > 0) inBoxes += m.qty / per
    else outBoxes += -m.qty / per
  }
  return { inBoxes: Math.round(inBoxes * 10) / 10, outBoxes: Math.round(outBoxes * 10) / 10 }
}

export function findByCode(db: DB, code: string) {
  const c = code.trim()
  if (!c) return undefined
  return db.skus.find((s) => s.code === c) ?? db.skus.find((s) => s.code.endsWith(c) || c.endsWith(s.code))
}

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
  qty: number
  left: number
  prodDate: string
  createdAt: number
}

export type OrderLine = { skuId: string; qty: number }

export type Order = {
  id: string
  no: string
  customer: string
  remark: string
  createdAt: number
  status: 'draft' | 'shipped'
  lines: OrderLine[]
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
  orders: Order[]
  trucks: Truck[]
  seq: number
}

const KEY = 'inventrack.v1'

const uid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4)

function seed(): DB {
  const today = new Date().toISOString().slice(0, 10)
  const a: Sku = {
    id: 'demo1', code: '6901234567890', name: '示例·纸箱装A', spec: '500g×12',
    unit: '箱', perBox: 12, boxL: 40, boxW: 30, boxH: 25, boxWeight: 6.5,
  }
  const b: Sku = {
    id: 'demo2', code: '6909876543210', name: '示例·礼盒B', spec: '250g×24',
    unit: '箱', perBox: 24, boxL: 50, boxW: 35, boxH: 30, boxWeight: 9,
  }
  return {
    skus: [a, b],
    batches: [
      { id: uid(), skuId: a.id, batchNo: 'B20261101', qty: 240, left: 240, prodDate: today, createdAt: Date.now() },
      { id: uid(), skuId: b.id, batchNo: 'B20261028', qty: 120, left: 120, prodDate: today, createdAt: Date.now() },
    ],
    orders: [],
    trucks: [{ id: uid(), name: '4.2米厢货', L: 420, W: 200, H: 220, maxWeight: 2000 }],
    seq: 1,
  }
}

function load(): DB {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return seed()
    const parsed = JSON.parse(raw) as DB
    if (!parsed.skus) return seed()
    return { ...seed(), ...parsed }
  } catch {
    return seed()
  }
}

let state: DB = load()
const listeners = new Set<() => void>()

function commit(next: DB) {
  state = next
  try {
    localStorage.setItem(KEY, JSON.stringify(next))
  } catch {
    // 存储满时静默失败，界面仍可用
  }
  listeners.forEach((fn) => fn())
}

export function subscribe(fn: () => void) {
  listeners.add(fn)
  return () => {
    listeners.delete(fn)
  }
}

export const getState = () => state
export const useDB = () => useSyncExternalStore(subscribe, getState, getState)

export function replaceAll(next: DB) {
  commit(next)
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
  })
}

/* ---------- 批次入库 ---------- */

export function addBatch(input: { skuId: string; batchNo: string; qty: number; prodDate: string }) {
  const batch: Batch = {
    id: uid(),
    skuId: input.skuId,
    batchNo: input.batchNo || '无批次',
    qty: input.qty,
    left: input.qty,
    prodDate: input.prodDate,
    createdAt: Date.now(),
  }
  commit({ ...state, batches: [batch, ...state.batches] })
}

export function removeBatch(id: string) {
  commit({ ...state, batches: state.batches.filter((b) => b.id !== id) })
}

/* ---------- 发货单 ---------- */

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
    lines: [],
  }
  commit({ ...state, orders: [order, ...state.orders], seq: state.seq + 1 })
  return order.id
}

export function updateOrder(id: string, patch: Partial<Order>) {
  commit({ ...state, orders: state.orders.map((o) => (o.id === id ? { ...o, ...patch } : o)) })
}

export function bumpLine(orderId: string, skuId: string, delta: number) {
  commit({
    ...state,
    orders: state.orders.map((o) => {
      if (o.id !== orderId) return o
      const lines = [...o.lines]
      const i = lines.findIndex((l) => l.skuId === skuId)
      if (i >= 0) {
        const qty = lines[i].qty + delta
        if (qty <= 0) lines.splice(i, 1)
        else lines[i] = { ...lines[i], qty }
      } else if (delta > 0) {
        lines.push({ skuId, qty: delta })
      }
      return { ...o, lines }
    }),
  })
}

export function setLineQty(orderId: string, skuId: string, qty: number) {
  commit({
    ...state,
    orders: state.orders.map((o) => {
      if (o.id !== orderId) return o
      const lines = o.lines.filter((l) => l.skuId !== skuId)
      if (qty > 0) lines.push({ skuId, qty })
      return { ...o, lines }
    }),
  })
}

export function removeOrder(id: string) {
  commit({ ...state, orders: state.orders.filter((o) => o.id !== id) })
}

/** 确认发货：按先进先出扣减批次库存 */
export function shipOrder(id: string) {
  const order = state.orders.find((o) => o.id === id)
  if (!order || order.status === 'shipped') return
  const batches = state.batches.map((b) => ({ ...b }))
  for (const line of order.lines) {
    let need = line.qty
    const pool = batches
      .filter((b) => b.skuId === line.skuId && b.left > 0)
      .sort((a, b) => a.createdAt - b.createdAt)
    for (const b of pool) {
      if (need <= 0) break
      const take = Math.min(b.left, need)
      b.left -= take
      need -= take
    }
  }
  commit({
    ...state,
    batches,
    orders: state.orders.map((o) => (o.id === id ? { ...o, status: 'shipped' } : o)),
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

export function stockOf(db: DB, skuId: string) {
  return db.batches.filter((b) => b.skuId === skuId).reduce((sum, b) => sum + b.left, 0)
}

export function batchesOf(db: DB, skuId: string) {
  return db.batches.filter((b) => b.skuId === skuId && b.left > 0).sort((a, b) => a.createdAt - b.createdAt)
}

export function findByCode(db: DB, code: string) {
  const c = code.trim()
  if (!c) return undefined
  return db.skus.find((s) => s.code === c) ?? db.skus.find((s) => s.code.endsWith(c) || c.endsWith(s.code))
}

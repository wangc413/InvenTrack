import { useMemo, useState } from 'react'
import {
  addBatch,
  adjustBatch,
  batchesOf,
  removeBatch,
  returnToBatch,
  movesOf,
  stockOf,
  todayFlow,
  useDB,
  type Sku,
} from '../lib/store'
import { boxify } from '../lib/calc'
import { Sheet, toast } from '../components/UI'

type Mode = 'in' | 'return' | 'adjust'

const TYPE_LABEL: Record<string, string> = {
  in: '入库',
  out: '出库',
  return: '回补',
  adjust: '调整',
}

function fmtTime(ts: number) {
  const d = new Date(ts)
  const p = (n: number) => String(n).padStart(2, '0')
  return `${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`
}

export default function Stock() {
  const db = useDB()
  const [q, setQ] = useState('')
  const [openId, setOpenId] = useState<string | null>(null)
  const [sheet, setSheet] = useState<{ mode: Mode; sku: Sku; batchId?: string } | null>(null)

  const [qty, setQty] = useState('')
  const [actual, setActual] = useState('')
  const [batchNo, setBatchNo] = useState('')
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10))

  const list = useMemo(() => {
    const key = q.trim().toLowerCase()
    return db.skus
      .map((s) => ({ sku: s, left: stockOf(db, s.id) }))
      .filter(({ sku }) => !key || sku.name.toLowerCase().includes(key) || sku.code.includes(key))
      .sort((a, b) => b.left - a.left)
  }, [db, q])

  const totalQty = list.reduce((s, x) => s + x.left, 0)
  const flow = todayFlow(db)

  const openSheet = (mode: Mode, sku: Sku, batchId?: string) => {
    setSheet({ mode, sku, batchId })
    setQty('')
    setActual('')
    setBatchNo('')
    if (mode === 'adjust' && batchId) {
      setActual(String(batchesOf(db, sku.id).find((x) => x.batch.id === batchId)?.left ?? 0))
    }
  }

  const closeSheet = () => setSheet(null)

  const submit = () => {
    if (!sheet) return
    const { mode, sku, batchId } = sheet

    if (mode === 'in') {
      const n = Number(qty)
      if (!n || n <= 0) return toast('请输入入库件数')
      addBatch({ skuId: sku.id, batchNo: batchNo.trim(), qty: n, prodDate: date })
      toast(`已入库 ${n} 件`)
    }

    if (mode === 'return') {
      const n = Number(qty)
      if (!batchId) return
      if (!n || n <= 0) return toast('请输入退货件数')
      returnToBatch(batchId, n)
      toast(`已回补 ${n} 件`)
    }

    if (mode === 'adjust') {
      if (!batchId) return
      const n = Number(actual)
      if (!Number.isFinite(n) || n < 0) return toast('请输入实际数量')
      adjustBatch(batchId, n)
      toast('已按实盘调整')
    }

    closeSheet()
  }

  const title = sheet
    ? `${sheet.mode === 'in' ? '入库' : sheet.mode === 'return' ? '退货入库' : '盘点调整'} · ${sheet.sku.name}`
    : ''

  return (
    <>
      <header className="topbar">
        <div style={{ flex: 1 }}>
          <h1>库存</h1>
          <div className="sub">
            共 {db.skus.length} 个品项 · 结存 {totalQty} 件
            {(flow.inQty > 0 || flow.outQty > 0) && ` · 今日 入 ${flow.inQty} / 出 ${flow.outQty}`}
          </div>
        </div>
      </header>

      <main className="page">
        <input
          className="input"
          placeholder="搜品名或条码"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          style={{ marginBottom: 12 }}
        />

        <div className="card">
          {list.length === 0 ? (
            <div className="empty">没有匹配的品项</div>
          ) : (
            list.map(({ sku, left }) => {
              const b = boxify(left, sku.perBox)
              const open = openId === sku.id
              const batches = open ? batchesOf(db, sku.id) : []
              const moves = open ? movesOf(db, sku.id, 6) : []
              return (
                <div key={sku.id}>
                  <div className="row" onClick={() => setOpenId(open ? null : sku.id)}>
                    <div className="grow">
                      <div className="name">{sku.name}</div>
                      <div className="meta">
                        {sku.spec || '无规格'} · 每箱 {sku.perBox} 件
                      </div>
                    </div>
                    <div style={{ textAlign: 'right', flex: '0 0 auto' }}>
                      <div
                        className="num"
                        style={{ fontSize: 17, fontWeight: 600, color: left > 0 ? 'var(--text)' : 'var(--danger)' }}
                      >
                        {left}
                      </div>
                      <div className="meta num">件 / {b.total} 箱</div>
                    </div>
                  </div>

                  {open && (
                    <div className="panel">
                      <div className="sub-label">批次（按入库先后，发车时先进先出）</div>
                      {batches.length === 0 ? (
                        <div style={{ fontSize: 13, color: 'var(--faint)', padding: '4px 0 10px' }}>没有余量批次</div>
                      ) : (
                        batches.map(({ batch, left: bLeft }) => (
                          <div
                            key={batch.id}
                            className="thumb-row"
                            onClick={() => openSheet('adjust', sku, batch.id)}
                          >
                            <div className="tr-main">
                              <div className="tr-line">
                                <span className="tr-title">{batch.batchNo}</span>
                                <span
                                  className="tr-num"
                                  style={{ color: bLeft > 0 ? 'var(--text)' : 'var(--danger)' }}
                                >
                                  {bLeft} 件
                                </span>
                              </div>
                              <div className="tr-meta">
                                生产 {batch.prodDate || '—'} · 入库 {batch.qty} 件
                              </div>
                            </div>
                            <div className="tr-actions">
                              <button
                                className="btn sm"
                                onClick={(e) => {
                                  e.stopPropagation()
                                  openSheet('return', sku, batch.id)
                                }}
                              >
                                退货
                              </button>
                              <button
                                className="btn sm"
                                onClick={(e) => {
                                  e.stopPropagation()
                                  openSheet('adjust', sku, batch.id)
                                }}
                              >
                                盘点
                              </button>
                            </div>
                          </div>
                        ))
                      )}

                      <div className="sub-label" style={{ marginTop: 14 }}>
                        最近流水
                      </div>
                      {moves.length === 0 ? (
                        <div style={{ fontSize: 13, color: 'var(--faint)', padding: '4px 0 2px' }}>还没有流水</div>
                      ) : (
                        moves.map((m) => (
                          <div key={m.id} className="flow-row">
                            <span>{fmtTime(m.at)}</span>
                            <span>{TYPE_LABEL[m.type] ?? m.type}</span>
                            <span className={`flow-qty ${m.qty > 0 ? 'plus' : ''}`}>
                              {m.qty > 0 ? `+${m.qty}` : m.qty}
                            </span>
                            <span className="flow-ref">{m.ref}</span>
                          </div>
                        ))
                      )}

                      <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
                        <button
                          className="btn primary sm"
                          style={{ flex: 1 }}
                          onClick={(e) => {
                            e.stopPropagation()
                            openSheet('in', sku)
                          }}
                        >
                          + 入库
                        </button>
                        <button
                          className="btn sm"
                          style={{ flex: 1 }}
                          onClick={(e) => {
                            e.stopPropagation()
                            const first = batches[0]
                            if (!first) return toast('还没有批次，先入库')
                            openSheet('return', sku, first.batch.id)
                          }}
                        >
                          退货入库
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              )
            })
          )}
        </div>

        <div className="hint">
          库存不是直接改的数字，而是每一笔入库、发车、退货、盘点攒出来的。点开品项能看到账是怎么来的。
        </div>
      </main>

      <Sheet open={sheet !== null} title={title} onClose={closeSheet}>
        {sheet?.mode === 'in' && (
          <>
            <div className="row-2">
              <div className="field" style={{ flex: 1 }}>
                <label>入库件数 *</label>
                <input
                  className="input num"
                  inputMode="numeric"
                  value={qty}
                  onChange={(e) => setQty(e.target.value)}
                  placeholder="0"
                />
              </div>
              <div className="field" style={{ flex: 1 }}>
                <label>批次号</label>
                <input className="input" value={batchNo} onChange={(e) => setBatchNo(e.target.value)} placeholder="B20261105" />
              </div>
            </div>
            <div className="field">
              <label>生产 / 到货日期</label>
              <input className="input" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
            </div>
            {Number(qty) > 0 && (
              <div style={{ fontSize: 13, color: 'var(--sub)', marginBottom: 12 }}>
                = {boxify(Number(qty), sheet.sku.perBox).total} 箱（每箱 {sheet.sku.perBox} 件）
              </div>
            )}
          </>
        )}

        {sheet?.mode === 'return' && (
          <div className="field">
            <label>退回件数 *</label>
            <input
              className="input num"
              inputMode="numeric"
              value={qty}
              onChange={(e) => setQty(e.target.value)}
              placeholder="0"
            />
            <div style={{ fontSize: 12, color: 'var(--sub)', marginTop: 8 }}>
              会加回到这个批次的余量里，也算作一笔入库流水
            </div>
          </div>
        )}

        {sheet?.mode === 'adjust' && (
          <div className="field">
            <label>实际盘点数量 *</label>
            <input
              className="input num"
              inputMode="numeric"
              value={actual}
              onChange={(e) => setActual(e.target.value)}
              placeholder="0"
            />
            <div style={{ fontSize: 12, color: 'var(--sub)', marginTop: 8 }}>
              账面 {sheet.batchId ? batchesOf(db, sheet.sku.id).find((x) => x.batch.id === sheet.batchId)?.left ?? 0 : 0} 件，
              差额会自动记成一笔调整流水
            </div>
          </div>
        )}

        <button className="btn primary" onClick={submit} style={{ marginTop: 6 }}>
          确认
        </button>

        {sheet?.mode === 'adjust' && sheet.batchId && (
          <button
            className="btn danger"
            style={{ marginTop: 10 }}
            onClick={() => {
              const batch = db.batches.find((b) => b.id === sheet.batchId)
              if (!batch) return
              if (confirm(`删除批次 ${batch.batchNo}？这会连同它的所有流水一起删除，不可撤销。`)) {
                removeBatch(batch.id)
                closeSheet()
                toast('批次已删除')
              }
            }}
          >
            删除这个批次
          </button>
        )}
      </Sheet>
    </>
  )
}

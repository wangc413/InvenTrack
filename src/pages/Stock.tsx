import { useMemo, useState } from 'react'
import { addBatch, batchesOf, removeBatch, stockOf, useDB, type Sku } from '../lib/store'
import { boxify } from '../lib/calc'
import { Sheet, toast } from '../components/UI'

export default function Stock() {
  const db = useDB()
  const [q, setQ] = useState('')
  const [openId, setOpenId] = useState<string | null>(null)
  const [inboundFor, setInboundFor] = useState<Sku | null>(null)
  const [qty, setQty] = useState('')
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

  const submitInbound = () => {
    const n = Number(qty)
    if (!inboundFor) return
    if (!n || n <= 0) return toast('请输入入库数量')
    addBatch({ skuId: inboundFor.id, batchNo: batchNo.trim(), qty: n, prodDate: date })
    toast(`已入库 ${n} 件`)
    setInboundFor(null)
    setQty('')
    setBatchNo('')
  }

  return (
    <>
      <header className="topbar">
        <div style={{ flex: 1 }}>
          <h1>库存</h1>
          <div className="sub">
            共 {db.skus.length} 个品项 · 余存 {totalQty} 件
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
              const batches = batchesOf(db, sku.id)
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
                      <div className={`num ${left <= 0 ? '' : ''}`} style={{ fontSize: 17, fontWeight: 600, color: left > 0 ? 'var(--text)' : 'var(--danger)' }}>
                        {left}
                      </div>
                      <div className="meta num">件 / {b.total} 箱</div>
                    </div>
                  </div>

                  {open && (
                    <div style={{ background: '#fafbfc', borderTop: '1px solid var(--line)', padding: '10px 14px 14px' }}>
                      {batches.length === 0 ? (
                        <div style={{ fontSize: 13, color: 'var(--faint)', padding: '6px 0' }}>还没有入库记录</div>
                      ) : (
                        batches.map((bt) => (
                          <div
                            key={bt.id}
                            className="kv"
                            style={{ fontSize: 13, borderBottom: '1px dashed var(--line)' }}
                          >
                            <span style={{ color: 'var(--sub)' }}>
                              {bt.batchNo} · {bt.prodDate}
                            </span>
                            <span className="num" style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                              {bt.left} 件
                              <span
                                style={{ color: 'var(--danger)', fontSize: 12 }}
                                onClick={(e) => {
                                  e.stopPropagation()
                                  if (confirm(`删除批次 ${bt.batchNo}（剩 ${bt.left} 件）？`)) removeBatch(bt.id)
                                }}
                              >
                                删
                              </span>
                            </span>
                          </div>
                        ))
                      )}
                      <button
                        className="btn sm"
                        style={{ marginTop: 12, width: '100%' }}
                        onClick={(e) => {
                          e.stopPropagation()
                          setInboundFor(sku)
                          setQty('')
                          setBatchNo('')
                        }}
                      >
                        + 入库
                      </button>
                    </div>
                  )}
                </div>
              )
            })
          )}
        </div>
      </main>

      <Sheet
        open={inboundFor !== null}
        title={`入库 · ${inboundFor?.name ?? ''}`}
        onClose={() => setInboundFor(null)}
      >
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
        {inboundFor && Number(qty) > 0 && (
          <div style={{ fontSize: 13, color: 'var(--sub)', marginBottom: 12 }}>
            = {boxify(Number(qty), inboundFor.perBox).total} 箱（每箱 {inboundFor.perBox} 件）
          </div>
        )}
        <button className="btn primary" onClick={submitInbound}>
          确认入库
        </button>
      </Sheet>
    </>
  )
}

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
import { boxText, moveText, splitBoxes } from '../lib/calc'
import { Icon, Sheet, toast } from '../components/UI'

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

const digits = (v: string) => v.replace(/\D/g, '').slice(0, 6)

export default function Stock() {
  const db = useDB()
  const [q, setQ] = useState('')
  const [openId, setOpenId] = useState<string | null>(null)
  const [sheet, setSheet] = useState<{ mode: Mode; sku: Sku; batchId?: string } | null>(null)

  /** 统一按箱录入，零头单列一件数输入框，留空就是整箱 */
  const [boxes, setBoxes] = useState('')
  const [tail, setTail] = useState('')
  const [batchNo, setBatchNo] = useState('')
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10))

  /** 展开的客户（两级下拉：第一级按客户分组，第二级展开品的批次/流水） */
  const [openCust, setOpenCust] = useState<Set<string>>(new Set())

  /** 按客户分组后的品项列表。每个客户一组，未归客户的品归到「未分类」。 */
  const groups = useMemo(() => {
    const key = q.trim().toLowerCase()
    const match = (s: Sku) => !key || s.name.toLowerCase().includes(key) || s.code.includes(key)
    const toItem = (s: Sku) => ({ sku: s, left: stockOf(db, s.id), split: splitBoxes(stockOf(db, s.id), s.perBox) })
    const result: { customerId: string; name: string; items: ReturnType<typeof toItem>[] }[] = []
    for (const c of db.customers) {
      const items = db.skus.filter((s) => s.customerId === c.id && match(s)).map(toItem).sort((a, b) => b.left - a.left)
      if (items.length > 0) result.push({ customerId: c.id, name: c.name, items })
    }
    const uncat = db.skus
      .filter((s) => (!s.customerId || !db.customers.some((c) => c.id === s.customerId)) && match(s))
      .map(toItem)
      .sort((a, b) => b.left - a.left)
    if (uncat.length > 0) result.push({ customerId: '', name: '未分类', items: uncat })
    return result
  }, [db, q])

  const allItems = groups.flatMap((g) => g.items)
  const totalBoxes = allItems.reduce((s, x) => s + x.split.boxes, 0)
  const totalTail = allItems.reduce((s, x) => s + x.split.tail, 0)

  /** 是否搜索中（搜索时所有含匹配品的客户都展开） */
  const searching = q.trim().length > 0
  const isOpen = (customerId: string) => searching || openCust.has(customerId)
  const toggleCust = (customerId: string) =>
    setOpenCust((prev) => {
      const next = new Set(prev)
      if (next.has(customerId)) next.delete(customerId)
      else next.add(customerId)
      return next
    })
  const flow = todayFlow(db)
  /** 箱数只在有零头时才带小数，整箱就干脆显示整数 */
  const bx = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(1))

  const openSheet = (mode: Mode, sku: Sku, batchId?: string) => {
    setSheet({ mode, sku, batchId })
    setBoxes('')
    setTail('')
    setBatchNo('')
    if (mode === 'adjust' && batchId) {
      const left = batchesOf(db, sku.id).find((x) => x.batch.id === batchId)?.left ?? 0
      const s = splitBoxes(left, sku.perBox)
      setBoxes(String(s.boxes))
      setTail(s.tail > 0 ? String(s.tail) : '')
    }
  }

  const closeSheet = () => setSheet(null)

  /** 箱数 × 每箱件数 + 零头 = 实际件数 */
  const pieces = (b: string, t: string) => {
    const per = sheet?.sku.perBox && sheet.sku.perBox > 0 ? sheet.sku.perBox : 1
    const n = (Number(b) || 0) * per + (Number(t) || 0)
    return n
  }

  const submit = () => {
    if (!sheet) return
    const { mode, sku, batchId } = sheet
    const n = pieces(boxes, tail)

    if (mode === 'in') {
      if (!n || n <= 0) return toast('请输入入库箱数')
      addBatch({ skuId: sku.id, batchNo: batchNo.trim(), qty: n, prodDate: date })
      toast(`已入库 ${boxText(n, sku.perBox)}`)
    }

    if (mode === 'return') {
      if (!batchId) return
      if (!n || n <= 0) return toast('请输入退回箱数')
      returnToBatch(batchId, n)
      toast(`已回补 ${boxText(n, sku.perBox)}`)
    }

    if (mode === 'adjust') {
      if (!batchId) return
      if ((Number(tail) || 0) >= (sku.perBox || 1)) return toast('零头件不能超过每箱件数')
      adjustBatch(batchId, n)
      toast('已按实盘调整')
    }

    closeSheet()
  }

  const title = sheet
    ? `${sheet.mode === 'in' ? '入库' : sheet.mode === 'return' ? '退货入库' : '盘点调整'} · ${sheet.sku.name}`
    : ''

  const per = sheet?.sku.perBox && sheet.sku.perBox > 0 ? sheet.sku.perBox : 1
  const preview = pieces(boxes, tail)

  return (
    <>
      <header className="topbar">
        <div style={{ flex: 1 }}>
          <h1>库存</h1>
          <div className="sub">
            共 {db.skus.length} 个品项 · 结存 {totalBoxes} 箱
            {totalTail > 0 && ` + ${totalTail} 件`}
            {(flow.inBoxes > 0 || flow.outBoxes > 0) &&
              ` · 今日 入 ${bx(flow.inBoxes)} / 出 ${bx(flow.outBoxes)} 箱`}
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

        {groups.length === 0 ? (
          <div className="card card-pad">
            <div className="empty">没有匹配的品项</div>
          </div>
        ) : (
          groups.map((g) => {
            const open = isOpen(g.customerId)
            return (
              <section key={g.customerId || '__uncat'}>
                <button className="group-toggle" type="button" onClick={() => toggleCust(g.customerId)}>
                  <span className="group-title">{g.name}</span>
                  <span className="group-count">{g.items.length} 个品</span>
                  <Icon name="chevron" size={18} className={`group-arrow ${open ? 'open' : ''}`} />
                </button>
                {open && (
                  <div className="card">
                    {g.items.map(({ sku, left, split }) => {
                      const detailOpen = openId === sku.id
                      const batches = detailOpen ? batchesOf(db, sku.id) : []
                      const moves = detailOpen ? movesOf(db, sku.id, 6) : []
                      return (
                        <div key={sku.id}>
                          <div className="row" onClick={() => setOpenId(detailOpen ? null : sku.id)}>
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
                                {split.boxes}
                              </div>
                              <div className="meta num">
                                箱{split.tail > 0 ? ` + ${split.tail} 件` : ` · ${left} 件`}
                              </div>
                            </div>
                          </div>

                          {detailOpen && (
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
                                          {boxText(bLeft, sku.perBox)}
                                        </span>
                                      </div>
                                      <div className="tr-meta">
                                        生产 {batch.prodDate || '—'} · 入库 {boxText(batch.qty, sku.perBox)}
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
                                      {moveText(m.qty, sku.perBox)}
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
                    })}
                  </div>
                )}
              </section>
            )
          })
        )}

        <div className="hint">
          入库、退货、盘点都按箱填，零头件单独填在右边那一格。库存不是直接改的数字，而是每一笔入库、发车、退货、盘点攒出来的。
        </div>
      </main>

      <Sheet open={sheet !== null} title={title} onClose={closeSheet}>
        {sheet?.mode === 'in' && (
          <>
            <div className="row-2">
              <div className="field" style={{ flex: 1 }}>
                <label>入库箱数 *</label>
                <input
                  className="input num"
                  inputMode="numeric"
                  value={boxes}
                  onChange={(e) => setBoxes(digits(e.target.value))}
                  placeholder="0"
                />
              </div>
              <div className="field" style={{ flex: 1 }}>
                <label>零头件</label>
                <input
                  className="input num"
                  inputMode="numeric"
                  value={tail}
                  onChange={(e) => setTail(digits(e.target.value))}
                  placeholder="0"
                />
              </div>
            </div>
            <div className="field">
              <label>批次号</label>
              <input className="input" value={batchNo} onChange={(e) => setBatchNo(e.target.value)} placeholder="B20261105" />
            </div>
            <div className="field">
              <label>生产 / 到货日期</label>
              <input className="input" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
            </div>
            {preview > 0 && (
              <div style={{ fontSize: 13, color: 'var(--sub)', marginBottom: 12 }}>
                = {preview} 件（每箱 {per} 件）
              </div>
            )}
          </>
        )}

        {sheet?.mode === 'return' && (
          <>
            <div className="row-2">
              <div className="field" style={{ flex: 1 }}>
                <label>退回箱数 *</label>
                <input
                  className="input num"
                  inputMode="numeric"
                  value={boxes}
                  onChange={(e) => setBoxes(digits(e.target.value))}
                  placeholder="0"
                />
              </div>
              <div className="field" style={{ flex: 1 }}>
                <label>零头件</label>
                <input
                  className="input num"
                  inputMode="numeric"
                  value={tail}
                  onChange={(e) => setTail(digits(e.target.value))}
                  placeholder="0"
                />
              </div>
            </div>
            <div style={{ fontSize: 12, color: 'var(--sub)', marginBottom: 12 }}>
              {preview > 0 ? `${preview} 件，` : ''}会加回到这个批次的余量里，也算作一笔入库流水
            </div>
          </>
        )}

        {sheet?.mode === 'adjust' && (
          <>
            <div className="row-2">
              <div className="field" style={{ flex: 1 }}>
                <label>实盘箱数 *</label>
                <input
                  className="input num"
                  inputMode="numeric"
                  value={boxes}
                  onChange={(e) => setBoxes(digits(e.target.value))}
                  placeholder="0"
                />
              </div>
              <div className="field" style={{ flex: 1 }}>
                <label>零头件</label>
                <input
                  className="input num"
                  inputMode="numeric"
                  value={tail}
                  onChange={(e) => setTail(digits(e.target.value))}
                  placeholder="0"
                />
              </div>
            </div>
            <div style={{ fontSize: 12, color: 'var(--sub)', marginBottom: 12 }}>
              账面 {boxText(sheet.batchId ? batchesOf(db, sheet.sku.id).find((x) => x.batch.id === sheet.batchId)?.left ?? 0 : 0, sheet.sku.perBox)}
              ，差额会自动记成一笔调整流水
            </div>
          </>
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

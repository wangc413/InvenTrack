import { useState } from 'react'
import { Icon, toast } from '../components/UI'
import { fmt, fmtDate, fmtTime, summarize } from '../lib/calc'
import { customerById, unshipOrder, useDB } from '../lib/store'
import { Viewer3D } from './Load'

export default function Records() {
  const db = useDB()
  const shipped = db.orders.filter((o) => o.status === 'shipped')
  const drafts = db.orders.filter((o) => o.status === 'draft')
  const [openId, setOpenId] = useState<string | null>(null)
  const open = shipped.find((o) => o.id === openId) ?? null

  const totalBoxes = shipped.reduce((s, o) => s + summarize(db, o).totalBoxes, 0)

  return (
    <>
      <div className="page">
        <header className="topbar">
          <h1>记录</h1>
          <p className="sub">
            已发 {shipped.length} 车 · 共 {totalBoxes} 箱
          </p>
        </header>

        {shipped.length === 0 && drafts.length === 0 && (
          <div className="card card-pad">
            <div className="empty-state">
              <div className="es-icon">
                <Icon name="records" size={38} />
              </div>
              <div className="es-title">还没有发过车</div>
              <div className="es-body">在「装车」建一趟车并发出去，这里会留下记录</div>
            </div>
          </div>
        )}

        {drafts.length > 0 && (
          <div className="notice-inline">
            <Icon name="records" size={16} />
            有 {drafts.length} 趟车还没发车，去「装车」继续
          </div>
        )}

        {shipped.map((o) => {
          const sum = summarize(db, o)
          const customer = customerById(db, o.customerId)
          return (
            <button key={o.id} className="card card-pad rec-card" onClick={() => setOpenId(o.id)}>
              <div className="rec-head">
                <span className="rec-dest">{o.destination}</span>
                <span className="rec-time">{fmtTime(o.createdAt)}</span>
              </div>
              <div className="rec-meta">
                <span className="chip-mini">{customer?.name ?? '—'}</span>
                <span>{sum.totalPallets} 板</span>
                <span>{sum.totalBoxes} 箱</span>
                <span>{fmt(sum.totalVolume, 2)} m³</span>
              </div>
              <div className="rec-lines">
                {sum.lines.slice(0, 3).map((l) => (
                  <span key={`${l.sku.id}-${l.prodDate}`}>
                    {l.sku.shortName}
                    <em>{fmtDate(l.prodDate)}</em>
                  </span>
                ))}
                {sum.lines.length > 3 && <span className="more">+{sum.lines.length - 3}</span>}
              </div>
            </button>
          )
        })}

        <div style={{ height: 12 }} />
      </div>

      <Viewer3D
        open={open !== null}
        order={open}
        onClose={() => setOpenId(null)}
        actions={
          open && (
            <button
              className="btn"
              onClick={() => {
                if (!confirm('撤销发车？扣掉的库存会原路退回，单据变回未发车')) return
                unshipOrder(open.id)
                setOpenId(null)
                toast('已撤销，库存已回补')
              }}
            >
              撤销发车 · 库存回补
            </button>
          )
        }
      />
    </>
  )
}

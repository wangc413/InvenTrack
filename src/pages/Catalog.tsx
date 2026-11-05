import { useState } from 'react'
import { removeSku, stockOf, useDB, type Sku } from '../lib/store'
import SkuForm from '../components/SkuForm'
import { toast } from '../components/UI'

export default function Catalog() {
  const db = useDB()
  const [open, setOpen] = useState(false)
  const [editing, setEditing] = useState<Sku | null>(null)

  const add = () => {
    setEditing(null)
    setOpen(true)
  }

  return (
    <>
      <header className="topbar">
        <div style={{ flex: 1 }}>
          <h1>品项档案</h1>
          <div className="sub">箱规和每箱件数是算箱数的基础</div>
        </div>
        <button className="icon-btn" onClick={add} aria-label="新增">
          ＋
        </button>
      </header>

      <main className="page">
        <div className="card">
          {db.skus.length === 0 ? (
            <div className="empty">
              还没有品项
              <br />
              点右上角 ＋ 建一个
            </div>
          ) : (
            db.skus.map((s) => (
              <div
                className="row"
                key={s.id}
                onClick={() => {
                  setEditing(s)
                  setOpen(true)
                }}
              >
                <div className="grow">
                  <div className="name">{s.name}</div>
                  <div className="meta">
                    {s.spec || '无规格'} · {s.boxL}×{s.boxW}×{s.boxH}cm · {s.boxWeight}kg/箱
                  </div>
                </div>
                <div style={{ textAlign: 'right', flex: '0 0 auto' }}>
                  <div className="tag info">每箱 {s.perBox}</div>
                  <div className="meta num" style={{ marginTop: 4 }}>
                    存 {stockOf(db, s.id)}
                  </div>
                </div>
              </div>
            ))
          )}
        </div>

        <div style={{ fontSize: 12, color: 'var(--faint)', lineHeight: 1.7, marginTop: 14, padding: '0 4px' }}>
          箱规填得越准，装车方案越靠谱。不确定时可以先用卷尺量一箱实际外廓。
        </div>
      </main>

      <SkuForm
        open={open}
        initial={editing}
        onClose={() => setOpen(false)}
        onDelete={
          editing
            ? () => {
                if (confirm(`删除「${editing.name}」及其所有批次？`)) {
                  removeSku(editing.id)
                  setOpen(false)
                  toast('已删除')
                }
              }
            : undefined
        }
      />
    </>
  )
}

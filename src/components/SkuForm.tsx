import { useEffect, useState } from 'react'
import { saveSku, useDB, type Sku } from '../lib/store'
import { Sheet, toast } from './UI'

const BOX_COLORS = [
  { name: '牛皮', value: '#d99a5a' },
  { name: '浅橙', value: '#f5b183' },
  { name: '米白', value: '#ece7dd' },
  { name: '深棕', value: '#a86b3c' },
]

const ACCENTS = [
  { name: '绿', value: '#3aa15c' },
  { name: '玛瑙红', value: '#6b2f2a' },
  { name: '橙', value: '#f08a2a' },
  { name: '蓝', value: '#2f6fb5' },
  { name: '黑', value: '#2b2b2b' },
]

const blank = {
  code: '',
  name: '',
  shortName: '',
  spec: '',
  customerId: '',
  perBox: 12,
  boxL: 500,
  boxW: 340,
  boxH: 200,
  boxWeight: 8,
  boxColor: '#d99a5a',
  accentColor: '#3aa15c',
  textColor: '#ffffff',
}

export default function SkuForm({
  open,
  initial,
  onClose,
  onDelete,
}: {
  open: boolean
  initial?: Sku | null
  onClose: () => void
  onDelete?: () => void
}) {
  const db = useDB()
  const [f, setF] = useState(blank)

  useEffect(() => {
    if (!open) return
    if (initial) {
      const { id: _id, ...rest } = initial
      setF({ ...blank, ...rest })
    } else {
      setF({ ...blank, customerId: db.customers[0]?.id ?? '' })
    }
  }, [open, initial, db.customers])

  const set = <K extends keyof typeof blank>(k: K, v: (typeof blank)[K]) => setF((p) => ({ ...p, [k]: v }))
  const num = (v: string) => (v === '' ? 0 : Number(v))

  const submit = () => {
    if (!f.name.trim()) return toast('请填写品名')
    if (!f.customerId) return toast('先选一个客户')
    if (f.perBox <= 0) return toast('每箱件数要大于 0')
    saveSku({
      ...f,
      id: initial?.id,
      name: f.name.trim(),
      shortName: f.shortName.trim() || f.name.trim(),
      code: f.code.trim(),
    })
    toast(initial ? '已保存' : '已新增品项')
    onClose()
  }

  return (
    <Sheet open={open} title={initial ? '编辑品项' : '新增品项'} onClose={onClose}>
      <label className="field-label">归哪个客户</label>
      <div className="chips">
        {db.customers.map((c) => (
          <button
            key={c.id}
            className={`chip ${f.customerId === c.id ? 'on' : ''}`}
            onClick={() => set('customerId', c.id)}
          >
            {c.name}
          </button>
        ))}
      </div>

      <div className="field" style={{ marginTop: 16 }}>
        <label>品名 *</label>
        <input
          className="input"
          value={f.name}
          onChange={(e) => set('name', e.target.value)}
          placeholder="例如：超合算 NB 鲜汁大肉包"
        />
      </div>

      <div className="row-2">
        <div className="field" style={{ flex: 1 }}>
          <label>箱面大字</label>
          <input
            className="input"
            value={f.shortName}
            onChange={(e) => set('shortName', e.target.value)}
            placeholder="鲜汁大肉包"
          />
        </div>
        <div className="field" style={{ flex: 1 }}>
          <label>规格</label>
          <input className="input" value={f.spec} onChange={(e) => set('spec', e.target.value)} placeholder="800克(10只)×8袋" />
        </div>
      </div>

      <div className="row-2">
        <div className="field" style={{ flex: 1 }}>
          <label>每箱件数 *</label>
          <input
            className="input num"
            inputMode="numeric"
            value={f.perBox || ''}
            onChange={(e) => set('perBox', num(e.target.value))}
            placeholder="8"
          />
        </div>
        <div className="field" style={{ flex: 1 }}>
          <label>单箱毛重 (kg)</label>
          <input
            className="input num"
            inputMode="decimal"
            value={f.boxWeight || ''}
            onChange={(e) => set('boxWeight', num(e.target.value))}
            placeholder="7.2"
          />
        </div>
      </div>

      <div className="field">
        <label>外箱 长 × 宽 × 高 (mm)</label>
        <div className="row-2">
          <input className="input num" inputMode="numeric" value={f.boxL || ''} onChange={(e) => set('boxL', num(e.target.value))} placeholder="长" />
          <input className="input num" inputMode="numeric" value={f.boxW || ''} onChange={(e) => set('boxW', num(e.target.value))} placeholder="宽" />
          <input className="input num" inputMode="numeric" value={f.boxH || ''} onChange={(e) => set('boxH', num(e.target.value))} placeholder="高" />
        </div>
        <div className="hint" style={{ margin: '6px 2px 0' }}>
          照外箱稿上的「长*宽*高（外径）」填，3D 装箱图按这个尺寸画
        </div>
      </div>

      <label className="field-label">箱面底色</label>
      <div className="swatches">
        {BOX_COLORS.map((c) => (
          <button
            key={c.value}
            className={`swatch ${f.boxColor === c.value ? 'on' : ''}`}
            style={{ background: c.value }}
            onClick={() => set('boxColor', c.value)}
            aria-label={c.name}
          />
        ))}
      </div>

      <label className="field-label" style={{ marginTop: 14 }}>
        品牌色块
      </label>
      <div className="swatches">
        {ACCENTS.map((c) => (
          <button
            key={c.value}
            className={`swatch ${f.accentColor === c.value ? 'on' : ''}`}
            style={{ background: c.value }}
            onClick={() => set('accentColor', c.value)}
            aria-label={c.name}
          />
        ))}
      </div>

      <div className="sheet-actions">
        <button className="btn primary" onClick={submit}>
          保存
        </button>
        {onDelete && (
          <button className="btn danger" style={{ marginTop: 10 }} onClick={onDelete}>
            删除这个品项
          </button>
        )}
      </div>
    </Sheet>
  )
}

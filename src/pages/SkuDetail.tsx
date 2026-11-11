import type { Sku } from '../lib/store'
import { stockByDate, stockOf, useDB } from '../lib/store'
import { boxText, boxVolume, fmt, fmtDate } from '../lib/calc'
import { Icon } from '../components/UI'
import Box3D from '../components/Box3D'

/**
 * 品项档案详情（只读）。
 * 点开某个品，只看它的外包装 —— 不编辑、不删除，就是给现场对着箱子核对用的。
 * 信息区：品名 / 规格 / 单箱毛重 / 体积（由外箱三围自动算出）+ 当前库存。
 * 3D 只摆一箱，转着看箱面到底印成什么样（隐藏托盘、放大占满画面）。
 */
export default function SkuDetail({ sku, onClose }: { sku: Sku; onClose: () => void }) {
  const db = useDB()
  const volume = boxVolume(sku)
  const stockQty = stockOf(db, sku.id)
  const byDate = stockByDate(db, sku.id)

  const rows: { k: string; v: string }[] = [
    { k: '品名', v: sku.name },
    { k: '规格', v: sku.spec || '—' },
    { k: '单箱毛重', v: `${fmt(sku.boxWeight, 2)} kg` },
    { k: '体积', v: `${fmt(volume, 4)} m³（${sku.boxL}×${sku.boxW}×${sku.boxH} mm）` },
  ]

  return (
    <div className="viewer">
      <div className="viewer-top">
        <button className="icon-btn" onClick={onClose} aria-label="返回">
          <Icon name="back" size={20} />
        </button>
        <div className="viewer-title">
          <b>{sku.shortName || sku.name}</b>
          <em>{sku.spec || '品项档案'}</em>
        </div>
      </div>

      {/* 3D：只摆一箱，转着看箱面（隐藏托盘、放大占满画面） */}
      <Box3D hidePallet zoom={2.4} pallets={[{ no: '单箱', sku, layers: 1, perLayer: 1, topCount: 1 }]} />

      <div className="viewer-info">
        <div className="card">
          <div className="card-pad" style={{ padding: '4px 0' }}>
            {rows.map((r) => (
              <div className="kv sku-kv" key={r.k}>
                <span className="k">{r.k}</span>
                <span className="v" style={{ textAlign: 'right', fontWeight: 500 }}>{r.v}</span>
              </div>
            ))}
          </div>
        </div>

        {/* 库存：当前结存 + 按生产日期的批次余量 */}
        <div className="card" style={{ marginTop: 10 }}>
          <div className="card-pad" style={{ padding: '4px 0' }}>
            <div className="kv">
              <span className="k">当前库存</span>
              <span className="v" style={{ textAlign: 'right', fontWeight: 600, color: 'var(--primary)' }}>
                {boxText(stockQty, sku.perBox)}
                <em className="stock-sub">{fmt(stockQty, 0)} 件</em>
              </span>
            </div>
            {byDate.length > 0 ? (
              byDate.map(({ prodDate, left }) => (
                <div className="kv" key={prodDate}>
                  <span className="k" style={{ paddingLeft: 12 }}>· {fmtDate(prodDate)}</span>
                  <span className="v" style={{ textAlign: 'right', fontWeight: 500 }}>
                    {boxText(left, sku.perBox)}
                  </span>
                </div>
              ))
            ) : (
              <div className="kv">
                <span className="k" style={{ color: 'var(--faint)' }}>暂无在库批次</span>
                <span className="v" style={{ textAlign: 'right', color: 'var(--faint)' }}>—</span>
              </div>
            )}
          </div>
        </div>

        <div className="hint" style={{ margin: '12px 4px 0' }}>
          拖动旋转 · 双指缩放查看外箱。体积按外箱「长×宽×高」外径自动计算。
        </div>
      </div>
    </div>
  )
}

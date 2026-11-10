import { useEffect, useRef, useState } from 'react'
import QRCode from 'qrcode'
import { getState, importInbound, useDB, useStorageInfo } from '../lib/store'
import { boxVolume, fmtDate } from '../lib/calc'
import { Icon, toast } from '../components/UI'
import { buildShipLines, exportLoadingRecord, exportOutboundLedger, parseWorkbook, toInboundRows, type ShipLine } from '../lib/xlsx'

type LedgerKey = 'out' | 'load' | 'inbound'

export default function Me() {
  const db = useDB()
  const info = useStorageInfo()
  const [qr, setQr] = useState('')
  const [quota, setQuota] = useState({ usage: 0, quota: 0 })
  const xlsxRef = useRef<HTMLInputElement>(null)
  /** 当前打开的表页面，null 表示在数据中心首页列表 */
  const [view, setView] = useState<LedgerKey | null>(null)
  /** 「台账」分组是否展开（下拉展示子表） */
  const [ledgerOpen, setLedgerOpen] = useState(false)
  const [importing, setImporting] = useState(false)
  const url = typeof window !== 'undefined' ? window.location.href.split('?')[0].split('#')[0] : ''

  useEffect(() => {
    if (!url) return
    QRCode.toDataURL(url, { width: 420, margin: 1, errorCorrectionLevel: 'M' })
      .then(setQr)
      .catch(() => setQr(''))
  }, [url])

  useEffect(() => {
    let alive = true
    try {
      const p = navigator.storage?.estimate?.()
      p?.then((e) => {
        if (alive) setQuota({ usage: e.usage ?? 0, quota: e.quota ?? 0 })
      }).catch(() => undefined)
    } catch {
      /* 忽略 */
    }
    return () => {
      alive = false
    }
  }, [info.chars, info.savedAt])

  const importXlsx = async (file: File) => {
    setImporting(true)
    try {
      const buf = await file.arrayBuffer()
      const parsed = await parseWorkbook(buf)
      const rows = toInboundRows(parsed.kind, parsed.rows)
      if (rows.length === 0) {
        toast('没读到有效数据，请确认表里有「品名 + 生产日期 + 数量」这几列')
        return
      }
      const kindLabel = parsed.kind === 'inbound' ? '入库登记表' : parsed.kind === 'outbound' ? '出库台账' : '装车记录'
      if (parsed.kind !== 'inbound') {
        // 出库/装车表也当入库数据加库存（件=箱），因为用户说三份表本质是同一份数据
        if (!confirm(`识别为「${kindLabel}」，将按「件=箱」把 ${rows.length} 行加入库存。继续？`)) return
      } else {
        if (!confirm(`识别为「${kindLabel}」，将把 ${rows.length} 行加入库存。继续？`)) return
      }
      const r = importInbound(
        rows.map((x) => ({ name: x.name, spec: x.spec, qty: x.qty, prodDate: x.prodDate, date: x.date })),
        { fileName: file.name },
      )
      toast(`已入库 ${r.added} 行${r.skusCreated > 0 ? `，新建 ${r.skusCreated} 个品项` : ''}${r.skipped > 0 ? `，跳过 ${r.skipped} 行` : ''}`)
    } catch (e) {
      toast('解析失败，请确认是 .xlsx 文件')
    } finally {
      setImporting(false)
    }
  }

  // —— 台账数据：从已发货订单派生 ——
  const shipLines: ShipLine[] = buildShipLines(db as unknown as Parameters<typeof buildShipLines>[0])
  // 出库台账：按「发货日期 + 品名 + 生产日期」聚合（贴合 Excel 逐日流水形式）
  const outAgg = (() => {
    const agg = new Map<string, ShipLine & { total: number }>()
    for (const l of shipLines) {
      const key = `${l.date}|${l.product}|${l.prodDate}`
      const e = agg.get(key)
      if (e) {
        e.total += l.boxes
        // 同一天多次发同一品：库存数量/结存取最后一次发车后的值
        e.before = l.before
        e.after = l.after
      } else {
        agg.set(key, { ...l, total: l.boxes })
      }
    }
    return [...agg.values()]
  })()

  const dateStr = new Date().toISOString().slice(0, 10)

  const dataSize = new Blob([JSON.stringify(getState())]).size
  const pallets = db.orders.reduce((n, o) => n + o.pallets.length, 0)
  const perOrder = db.orders.length ? dataSize / db.orders.length : 1400
  const remain = quota.quota > 0 ? Math.max(0, quota.quota - quota.usage) : 0
  const remainOrders = quota.quota > 0 ? Math.floor(remain / perOrder) : 0
  const pct = quota.quota > 0 ? Math.min(100, (quota.usage / quota.quota) * 100) : 0
  const fmt = (n: number) => n.toLocaleString('zh-CN')
  const mb = (n: number) => (n >= 1024 ** 3 ? `${(n / 1024 ** 3).toFixed(1)} GB` : `${(n / 1024 ** 2).toFixed(0)} MB`)

  // —— 子页面视图：打开某张表时，进入独立页面 ——
  if (view === 'out') {
    return (
      <>
        <header className="topbar back-mode">
          <button className="icon-btn" onClick={() => setView(null)} aria-label="返回">
            <Icon name="back" size={20} />
          </button>
          <div style={{ flex: 1 }}>
            <h1>出库台账</h1>
            <div className="sub">按品名 + 生产日期累计出库</div>
          </div>
          <button
            className="topbar-export"
            onClick={() => exportOutboundLedger(shipLines, `出库台账-${dateStr}.xlsx`)}
            disabled={shipLines.length === 0}
            aria-label="导出"
          >
            <Icon name="export" size={18} />
            导出
          </button>
        </header>
        <main className="page">
          {shipLines.length === 0 ? (
            <div className="empty" style={{ padding: '32px 8px' }}>
              还没有已发车的记录。
              <br />
              装车页「确认发车」后，这里会自动生成台账。
            </div>
          ) : (
            <div className="ledger-table ledger-table-page">
              <table>
                <thead>
                  <tr>
                    <th>发货日期</th>
                    <th>生产日期</th>
                    <th>品名</th>
                    <th>规格</th>
                    <th style={{ textAlign: 'right' }}>库存数量</th>
                    <th style={{ textAlign: 'right' }}>当日出库</th>
                    <th style={{ textAlign: 'right' }}>结存</th>
                    <th>备注</th>
                  </tr>
                </thead>
                <tbody>
                  {outAgg.map((e, i) => (
                    <tr key={i}>
                      <td>{fmtDate(e.date)}</td>
                      <td>{fmtDate(e.prodDate)}</td>
                      <td>{e.product}</td>
                      <td>{e.spec}</td>
                      <td style={{ textAlign: 'right' }}>{e.before}</td>
                      <td style={{ textAlign: 'right' }}>{e.total}</td>
                      <td style={{ textAlign: 'right' }}>{e.after}</td>
                      <td></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </main>
      </>
    )
  }

  if (view === 'load') {
    return (
      <>
        <header className="topbar back-mode">
          <button className="icon-btn" onClick={() => setView(null)} aria-label="返回">
            <Icon name="back" size={20} />
          </button>
          <div style={{ flex: 1 }}>
            <h1>装车记录</h1>
            <div className="sub">每车装了什么、装了多少</div>
          </div>
          <button
            className="topbar-export"
            onClick={() => exportLoadingRecord(shipLines, `装车记录-${dateStr}.xlsx`)}
            disabled={shipLines.length === 0}
            aria-label="导出"
          >
            <Icon name="export" size={18} />
            导出
          </button>
        </header>
        <main className="page">
          {shipLines.length === 0 ? (
            <div className="empty" style={{ padding: '32px 8px' }}>
              还没有已发车的记录。
              <br />
              装车页「确认发车」后，这里会自动生成装车记录。
            </div>
          ) : (
            <div className="ledger-table ledger-table-page">
              <table>
                <thead>
                  <tr>
                    <th>日期</th>
                    <th>客户名称</th>
                    <th>产品名称</th>
                    <th>规格</th>
                    <th>生产日期</th>
                    <th style={{ textAlign: 'right' }}>装车数量</th>
                    <th>销售电话</th>
                    <th>车辆卫生情况</th>
                    <th>保质期</th>
                    <th>车牌号</th>
                    <th>装车温度</th>
                  </tr>
                </thead>
                <tbody>
                  {shipLines.map((e, i) => (
                    <tr key={i}>
                      <td>{fmtDate(e.date)}</td>
                      <td>{e.customer}</td>
                      <td>{e.product}</td>
                      <td>{e.spec}</td>
                      <td>{fmtDate(e.prodDate)}</td>
                      <td style={{ textAlign: 'right' }}>{e.boxes}</td>
                      <td></td>
                      <td></td>
                      <td></td>
                      <td></td>
                      <td></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </main>
      </>
    )
  }

  if (view === 'inbound') {
    return (
      <>
        <header className="topbar back-mode">
          <button className="icon-btn" onClick={() => setView(null)} aria-label="返回">
            <Icon name="back" size={20} />
          </button>
          <div style={{ flex: 1 }}>
            <h1>入库登记表</h1>
            <div className="sub">上传 Excel 写入库存</div>
          </div>
        </header>
        <main className="page">
          <div className="card">
            <div className="row" onClick={() => !importing && xlsxRef.current?.click()}>
              <div className="grow">
                <div className="name">{importing ? '正在解析…' : '上传 Excel 文件'}</div>
                <div className="meta">支持「入库登记表 / 出库台账 / 装车记录」，按品名匹配，没有就自动新建</div>
              </div>
              <Icon name="upload" size={20} className="row-arrow" />
            </div>
          </div>
          <div className="ledger-hint">
            导入后，库存会按「品名 + 生产日期」累加，并记一条入库流水
          </div>

          <div className="upload-guide">
            <div className="guide-title">微信里的文件怎么传进来？</div>
            <div className="guide-step">
              <span className="guide-num">1</span>
              <span>在微信里点开那个 Excel 文件</span>
            </div>
            <div className="guide-step">
              <span className="guide-num">2</span>
              <span>右上角「…」→「用其他应用打开」</span>
            </div>
            <div className="guide-step">
              <span className="guide-num">3</span>
              <span>iPhone 选「存储到文件」；安卓选「保存到手机」</span>
            </div>
            <div className="guide-step">
              <span className="guide-num">4</span>
              <span>回到这里点「上传」，在文件里找到它即可</span>
            </div>
          </div>

          <input
            ref={xlsxRef}
            type="file"
            accept=".xlsx,.xls"
            style={{ display: 'none' }}
            onChange={(e) => {
              const f = e.target.files?.[0]
              if (f) importXlsx(f)
              e.target.value = ''
            }}
          />

          {/* —— 已录入的登记表留档 —— */}
          <div className="sec-title">已录入记录</div>
          {db.inboundRecords.length === 0 ? (
            <div className="empty" style={{ padding: '24px 8px' }}>
              还没有录入过登记表。
              <br />
              上传后会自动留档在这里。
            </div>
          ) : (
            <div className="card">
              {db.inboundRecords.map((rec) => (
                <div className="row" key={rec.id}>
                  <div className="grow">
                    <div className="name">{rec.fileName}</div>
                    <div className="meta">
                      {new Date(rec.at).toLocaleString('zh-CN')} · {rec.rows} 行
                      {rec.skusCreated > 0 ? ` · 新建 ${rec.skusCreated} 品项` : ''}
                    </div>
                  </div>
                  <span className="tag">{rec.rows} 行</span>
                </div>
              ))}
            </div>
          )}
        </main>
      </>
    )
  }

  return (
    <>
      <header className="topbar">
        <div style={{ flex: 1 }}>
          <h1>数据中心</h1>
          <div className="sub">台账 · 导入导出</div>
        </div>
      </header>

      <main className="page">
        {/* —— 台账（点击标题下拉展开子表列表）—— */}
        <button className="group-toggle" onClick={() => setLedgerOpen((v) => !v)}>
          <span className="group-title">台账</span>
          <Icon name="chevron" size={18} className={`group-arrow ${ledgerOpen ? 'open' : ''}`} />
        </button>
        {ledgerOpen && (
          <div className="card">
            <div className="row" onClick={() => setView('out')}>
              <div className="grow">
                <div className="name">出库台账</div>
                <div className="meta">按品名 + 生产日期累计出库</div>
              </div>
              <span className="tag">{outAgg.length > 0 ? `${outAgg.length} 项` : '暂无'}</span>
            </div>
            <div className="row" onClick={() => setView('load')}>
              <div className="grow">
                <div className="name">装车记录</div>
                <div className="meta">每车装了什么、装了多少</div>
              </div>
              <span className="tag">{shipLines.length > 0 ? `${shipLines.length} 条` : '暂无'}</span>
            </div>
            <div className="row" onClick={() => setView('inbound')}>
              <div className="grow">
                <div className="name">入库登记表</div>
                <div className="meta">上传 Excel 写入库存</div>
              </div>
              <span className="tag">{db.inboundRecords.length > 0 ? `${db.inboundRecords.length} 份` : '暂无'}</span>
            </div>
          </div>
        )}

        {/* —— 二维码试用 —— */}
        <div className="sec-title">分享</div>
        <div className="card card-pad" style={{ textAlign: 'center' }}>
          <div style={{ fontSize: 16, fontWeight: 600, letterSpacing: '-0.3px', marginBottom: 5 }}>扫这个码，别人就能试用</div>
          <div style={{ fontSize: 13, color: 'var(--sub)', marginBottom: 16 }}>
            打开后点「添加到主屏幕」，和 App 一样用
          </div>
          {qr ? (
            <img src={qr} alt="试用二维码" style={{ width: 176, height: 176, display: 'block', margin: '0 auto', borderRadius: 6 }} />
          ) : (
            <div className="empty" style={{ padding: 20 }}>
              二维码生成中
            </div>
          )}
          <div
            className="num"
            style={{ fontSize: 12, color: 'var(--faint)', marginTop: 14, wordBreak: 'break-all', lineHeight: 1.6 }}
          >
            {url}
          </div>
        </div>

        {/* —— 容量 —— */}
        <div className="sec-title">容量</div>
        <div className="card card-pad">
          <div className="cap-head">
            <div className="cap-main">
              <div className="cap-title">已用 {(dataSize / 1024).toFixed(0)} KB</div>
              <div className="cap-sub">
                {info.mode === 'idb' ? '浏览器数据库' : '浏览器缓存（老模式）'}
                {quota.quota > 0 ? ` · 上限约 ${mb(quota.quota)}` : ' · 上限读取中'}
              </div>
            </div>
            <span className={`tag ${pct > 70 ? 'warn' : 'ok'}`}>{pct > 70 ? '偏满' : '充足'}</span>
          </div>

          <div className="bar">
            <i
              className={pct > 85 ? 'bad' : pct > 70 ? 'warn' : ''}
              style={{ width: `${pct > 0 ? Math.max(pct, 1.5) : 0}%` }}
            />
          </div>

          <div className="stat3">
            <div>
              <b>{fmt(db.orders.length)}</b>
              <span>车次</span>
            </div>
            <div>
              <b>{fmt(pallets)}</b>
              <span>块拖板</span>
            </div>
            <div>
              <b>{fmt(db.skus.length)}</b>
              <span>品项</span>
            </div>
          </div>

          <div className="cap-sub" style={{ marginTop: 10 }}>
            一车 8 块板约 1.3 KB
            {quota.quota > 0 ? `，按剩余空间还能再记约 ${fmt(remainOrders)} 车` : ''}。
            {info.mode === 'idb'
              ? '数据存在浏览器数据库里，容量按手机剩余空间分配，不再是 5 MB 上限。'
              : '当前是缓存模式，上限约 5 MB，容量偏紧，请多导出备份。'}
          </div>
        </div>
      </main>
    </>
  )
}

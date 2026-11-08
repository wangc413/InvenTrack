import { useEffect, useRef, useState } from 'react'
import type { PalletSpec, SceneHandle } from '../lib/box3d'

/**
 * 3D 装载预览：单指拖动旋转，双指捏合缩放。three.js 按需加载，不拖慢首屏。
 * 场景只挂一次，层数、箱数变化时只重排箱子，所以拖着改层数是连续变化的，不会闪。
 */
export default function Box3D({
  pallets,
  compact = false,
  emptyPallet = false,
  selected = -1,
  onPick,
}: {
  pallets: PalletSpec[]
  compact?: boolean
  /** 没有货时也画一块空托盘，告诉用户货往哪儿放 */
  emptyPallet?: boolean
  /** 高亮的板索引（-1 无） */
  selected?: number
  /** 点中某块板时回调 */
  onPick?: (index: number) => void
}) {
  const holder = useRef<HTMLDivElement>(null)
  const scene = useRef<SceneHandle | null>(null)
  const [failed, setFailed] = useState(false)
  /** 场景是异步加载的，加载期间数据可能已经变了，这里始终拿最新的 */
  const latest = useRef(pallets)
  latest.current = pallets
  const onPickRef = useRef(onPick)
  onPickRef.current = onPick

  const sig = pallets.map((p) => `${p.sku.id}:${p.layers}:${p.perLayer}:${p.topCount}`).join('|')

  useEffect(() => {
    const el = holder.current
    if (!el) return
    let cancelled = false
    setFailed(false)

    void (async () => {
      try {
        const { mountBoxes } = await import('../lib/box3d')
        if (cancelled || !holder.current) return
        scene.current = mountBoxes(holder.current, latest.current, {
          emptyPallet,
          onPick: (i) => onPickRef.current?.(i),
        })
      } catch {
        if (!cancelled) setFailed(true)
      }
    })()

    return () => {
      cancelled = true
      scene.current?.dispose()
      scene.current = null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    if (sig === '' && !emptyPallet) return
    scene.current?.setPallets(latest.current)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sig])

  // 选中高亮跟着父组件走
  useEffect(() => {
    scene.current?.select(selected)
  }, [selected, sig])

  return (
    <div className={`box3d ${compact ? 'compact' : ''}`}>
      <div ref={holder} className="box3d-stage" />
      {failed && <div className="box3d-fail">这台设备无法显示 3D 预览</div>}
      {!failed && (
        <>
          <button className="box3d-reset" onClick={() => scene.current?.resetView()} aria-label="重置视角">
            重置视角
          </button>
          <div className="box3d-hint">拖动旋转 · 双指缩放 · 点板看明细</div>
        </>
      )}
    </div>
  )
}

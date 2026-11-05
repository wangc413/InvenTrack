import { useEffect, useRef, useState } from 'react'
import type { PalletSpec, SceneHandle } from '../lib/box3d'

/** 3D 装载预览：单指拖动旋转，双指捏合缩放。three.js 按需加载，不拖慢首屏 */
export default function Box3D({ pallets, compact = false }: { pallets: PalletSpec[]; compact?: boolean }) {
  const holder = useRef<HTMLDivElement>(null)
  const scene = useRef<SceneHandle | null>(null)
  const [failed, setFailed] = useState(false)

  const sig = pallets.map((p) => `${p.sku.id}:${p.layers}:${p.perLayer}:${p.topCount}`).join('|')

  useEffect(() => {
    const el = holder.current
    if (!el || pallets.length === 0) return
    let cancelled = false
    let handle: SceneHandle | null = null
    setFailed(false)

    void (async () => {
      try {
        const { mountBoxes } = await import('../lib/box3d')
        if (cancelled || !holder.current) return
        handle = mountBoxes(holder.current, pallets)
        scene.current = handle
      } catch {
        if (!cancelled) setFailed(true)
      }
    })()

    return () => {
      cancelled = true
      handle?.dispose()
      scene.current = null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sig, pallets.length])

  return (
    <div className={`box3d ${compact ? 'compact' : ''}`}>
      <div ref={holder} className="box3d-stage" />
      {failed && <div className="box3d-fail">这台设备无法显示 3D 预览</div>}
      {!failed && pallets.length > 0 && (
        <>
          <button className="box3d-reset" onClick={() => scene.current?.resetView()} aria-label="重置视角">
            重置视角
          </button>
          <div className="box3d-hint">拖动旋转 · 双指缩放</div>
        </>
      )}
    </div>
  )
}

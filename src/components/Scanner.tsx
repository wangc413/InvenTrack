import { useEffect, useRef, useState } from 'react'
import { BrowserMultiFormatReader } from '@zxing/browser'

type Props = {
  onResult: (code: string) => void
  onClose: () => void
  /** 连续扫码模式下显示已扫数量 */
  count?: number
}

export default function Scanner({ onResult, onClose, count = 0 }: Props) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const [error, setError] = useState('')
  const [manual, setManual] = useState('')
  const stopRef = useRef<(() => void) | null>(null)
  const resultRef = useRef(onResult)
  resultRef.current = onResult

  useEffect(() => {
    const reader = new BrowserMultiFormatReader()
    let last = 0
    let lastText = ''
    let stopped = false

    const start = async () => {
      if (!videoRef.current) return
      try {
        const controls = await reader.decodeFromVideoDevice(undefined, videoRef.current, (result) => {
          if (!result || stopped) return
          const text = result.getText()
          const now = Date.now()
          if (text === lastText && now - last < 1500) return
          last = now
          lastText = text
          navigator.vibrate?.(35)
          resultRef.current(text)
        })
        stopRef.current = () => {
          stopped = true
          controls.stop()
        }
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e)
        setError(
          /NotAllowed|Permission/i.test(msg)
            ? '没有相机权限。点地址栏的锁图标允许相机，或在下方手动输入条码。'
            : /NotFound|Overconstrained/i.test(msg)
              ? '没找到可用的摄像头，请在下方手动输入条码。'
              : '摄像头启动失败，请在下方手动输入条码。',
        )
      }
    }

    start()
    return () => {
      stopRef.current?.()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return (
    <div className="scanner">
      <video ref={videoRef} muted playsInline />
      <div className="frame" />
      <div className="hint">{error || (count > 0 ? `已扫 ${count} 次，继续扫下一件` : '把条码放进框内')}</div>
      <button className="close" onClick={onClose} aria-label="关闭">
        ✕
      </button>
      <div className="bottom">
        <input
          className="input"
          placeholder="手动输入条码"
          inputMode="numeric"
          value={manual}
          onChange={(e) => setManual(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && manual.trim()) {
              onResult(manual.trim())
              setManual('')
            }
          }}
        />
        <button
          className="btn"
          style={{ width: 96, flex: '0 0 auto' }}
          onClick={() => {
            if (manual.trim()) {
              onResult(manual.trim())
              setManual('')
            } else onClose()
          }}
        >
          {manual.trim() ? '确定' : '完成'}
        </button>
      </div>
    </div>
  )
}

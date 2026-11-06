import * as THREE from 'three'
import { OrbitControls } from 'three/addons/controls/OrbitControls.js'
import { PALLET_L, PALLET_W, stackLayout } from './calc'
import type { Sku } from './store'

/** 全部按毫米建模，最后统一缩成米 */
const MM = 0.001

/** 托盘面高度（含顶板），箱子从这里往上堆 */
const PALLET_H = 145
const PALLET_MARGIN = 40
/** 箱子比格子略小一点，堆起来才看得出是一箱一箱 */
const BOX_SHRINK = 0.985

export type PalletSpec = {
  no: string
  sku: Sku
  layers: number
  perLayer: number
  topCount: number
}

export type SceneHandle = {
  /** 换一批板 / 改层数，只重排箱子，不重建 WebGL 场景 */
  setPallets: (pallets: PalletSpec[]) => void
  resetView: () => void
  dispose: () => void
}

const VIEW_DIR = new THREE.Vector3(0.26, 0.62, 0.74).normalize()

/* ---------- 箱面纹理：照着外箱稿画一遍 ---------- */

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath()
  ctx.moveTo(x + r, y)
  ctx.arcTo(x + w, y, x + w, y + h, r)
  ctx.arcTo(x + w, y + h, x, y + h, r)
  ctx.arcTo(x, y + h, x, y, r)
  ctx.arcTo(x, y, x + w, y, r)
  ctx.closePath()
}

function faceTexture(sku: Sku) {
  const W = 1024
  const ratio = sku.boxH / Math.max(1, sku.boxL)
  const H = Math.max(180, Math.round(W * ratio))
  const cv = document.createElement('canvas')
  cv.width = W
  cv.height = H
  const ctx = cv.getContext('2d')!

  ctx.fillStyle = sku.boxColor
  ctx.fillRect(0, 0, W, H)

  // 封箱胶带：竖向一条略亮的带子
  ctx.fillStyle = 'rgba(255,255,255,0.16)'
  ctx.fillRect(W * 0.42, 0, W * 0.16, H)

  // 下半部分品牌色块
  const blockTop = H * 0.46
  ctx.fillStyle = sku.accentColor
  ctx.fillRect(0, blockTop, W, H - blockTop)

  // 色块顶部描一条细亮线，做出印刷层次
  ctx.fillStyle = 'rgba(255,255,255,0.22)'
  ctx.fillRect(0, blockTop, W, Math.max(2, H * 0.012))

  // 品名
  const nameSize = Math.min(H * 0.2, W * 0.105)
  ctx.fillStyle = sku.textColor
  ctx.font = `700 ${nameSize}px -apple-system, "PingFang SC", "Microsoft YaHei", sans-serif`
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  const nameY = blockTop + (H - blockTop) * 0.42
  ctx.fillText(sku.shortName, W / 2, nameY, W * 0.86)

  // 规格
  const specSize = Math.min(H * 0.1, W * 0.045)
  ctx.font = `500 ${specSize}px -apple-system, "PingFang SC", sans-serif`
  ctx.globalAlpha = 0.88
  ctx.fillText(sku.spec, W / 2, nameY + nameSize * 0.95, W * 0.78)
  ctx.globalAlpha = 1

  // 上半部分：左上角小标签
  const tagH = H * 0.17
  const tagW = Math.min(W * 0.2, tagH * 1.9)
  ctx.fillStyle = 'rgba(255,255,255,0.9)'
  roundRect(ctx, W * 0.06, H * 0.12, tagW, tagH, tagH * 0.18)
  ctx.fill()
  ctx.fillStyle = '#2b2b2b'
  ctx.font = `700 ${tagH * 0.52}px -apple-system, sans-serif`
  ctx.fillText('NB', W * 0.06 + tagW / 2, H * 0.12 + tagH * 0.52)

  const tex = new THREE.CanvasTexture(cv)
  tex.colorSpace = THREE.SRGBColorSpace
  tex.anisotropy = 4
  return tex
}

/** 顶面：牛皮底 + 封箱带 + 角标 */
function topTexture(sku: Sku) {
  const S = 256
  const cv = document.createElement('canvas')
  cv.width = S
  cv.height = S
  const ctx = cv.getContext('2d')!

  ctx.fillStyle = sku.boxColor
  ctx.fillRect(0, 0, S, S)

  ctx.fillStyle = 'rgba(255,255,255,0.2)'
  ctx.fillRect(S * 0.44, 0, S * 0.12, S)

  ctx.fillStyle = sku.accentColor
  ctx.fillRect(S * 0.05, S * 0.05, S * 0.15, S * 0.085)
  ctx.fillStyle = sku.textColor
  ctx.font = `700 ${S * 0.05}px -apple-system, sans-serif`
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillText('NB', S * 0.125, S * 0.093)

  const tex = new THREE.CanvasTexture(cv)
  tex.colorSpace = THREE.SRGBColorSpace
  tex.anisotropy = 4
  return tex
}

/* ---------- 托盘 ---------- */

type Sink = { dispose: () => void }[]

function makePalletMesh(palletL: number, palletW: number, wood: THREE.Material, woodDark: THREE.Material, sink: Sink) {
  const group = new THREE.Group()

  // 单位统一用米：底板 0~30，纵梁 30~115，顶板 115~145
  const boardGeo = new THREE.BoxGeometry(palletL, 0.03, palletW)
  const beamGeo = new THREE.BoxGeometry(palletL, 0.085, 0.09)
  sink.push(boardGeo, beamGeo)

  const bottom = new THREE.Mesh(boardGeo, woodDark)
  bottom.position.y = 0.015
  bottom.receiveShadow = true
  group.add(bottom)

  for (const z of [-(palletW / 2 - 0.055), 0, palletW / 2 - 0.055]) {
    const beam = new THREE.Mesh(beamGeo, woodDark)
    beam.position.set(0, 0.0725, z)
    beam.castShadow = true
    group.add(beam)
  }

  const top = new THREE.Mesh(boardGeo, wood)
  top.position.y = 0.13
  top.castShadow = true
  top.receiveShadow = true
  group.add(top)

  return group
}

/* ---------- 场景 ---------- */

/**
 * 挂一个 3D 场景。pallets 可以随时用 setPallets 换掉：
 * 只清掉箱子重排，renderer / 相机 / 灯光都不重建，所以拖层数时是连续变形的。
 */
export function mountBoxes(
  container: HTMLElement,
  pallets: PalletSpec[],
  opts: { emptyPallet?: boolean } = {},
): SceneHandle {
  const scene = new THREE.Scene()

  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'high-performance' })
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2))
  renderer.shadowMap.enabled = true
  renderer.shadowMap.type = THREE.PCFSoftShadowMap
  renderer.domElement.style.display = 'block'
  renderer.domElement.style.width = '100%'
  renderer.domElement.style.height = '100%'
  renderer.domElement.style.touchAction = 'none'
  container.appendChild(renderer.domElement)

  const camera = new THREE.PerspectiveCamera(34, 1, 0.02, 200)
  camera.position.set(1.6, 1.9, 2.1)
  const controls = new OrbitControls(camera, renderer.domElement)
  controls.enableDamping = true
  controls.dampingFactor = 0.09
  controls.rotateSpeed = 0.75
  controls.zoomSpeed = 0.9
  controls.minDistance = 0.35
  controls.maxDistance = 18
  controls.maxPolarAngle = Math.PI / 2.04
  controls.enablePan = false

  scene.add(new THREE.HemisphereLight(0xffffff, 0xb9bfc9, 1.35))
  const key = new THREE.DirectionalLight(0xffffff, 2.1)
  key.position.set(2.6, 5, 3.2)
  key.castShadow = true
  key.shadow.mapSize.set(1024, 1024)
  key.shadow.bias = -0.0012
  key.shadow.normalBias = 0.02
  const sc = key.shadow.camera as THREE.OrthographicCamera
  sc.left = -6
  sc.right = 6
  sc.top = 6
  sc.bottom = -6
  sc.near = 0.5
  sc.far = 24
  sc.updateProjectionMatrix()
  scene.add(key)

  const fill = new THREE.DirectionalLight(0xffffff, 0.55)
  fill.position.set(-3.4, 2.4, -2.6)
  scene.add(fill)

  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(80, 80),
    new THREE.ShadowMaterial({ opacity: 0.15 }),
  )
  ground.rotation.x = -Math.PI / 2
  ground.receiveShadow = true
  scene.add(ground)

  const root = new THREE.Group()
  scene.add(root)

  const wood = new THREE.MeshStandardMaterial({ color: 0xc7a97e, roughness: 0.94, metalness: 0 })
  const woodDark = new THREE.MeshStandardMaterial({ color: 0xb08f63, roughness: 0.96, metalness: 0 })

  // 每种箱规只生成一次纹理与几何，多块板、多次重排共用
  const cache = new Map<string, { geo: THREE.BoxGeometry; matSide: THREE.MeshStandardMaterial; matTop: THREE.MeshStandardMaterial }>()
  const disposables: { dispose: () => void }[] = []
  /** 每次重排都会新建的几何（托盘），重排前要先释放 */
  let transient: Sink = []

  function assetFor(sku: Sku) {
    const hit = cache.get(sku.id)
    if (hit) return hit
    const bl = Math.max(50, sku.boxL) * MM * BOX_SHRINK
    const bw = Math.max(50, sku.boxW) * MM * BOX_SHRINK
    const bh = Math.max(50, sku.boxH) * MM * BOX_SHRINK

    const geo = new THREE.BoxGeometry(bl, bh, bw)
    // 六个面重排成两组：侧面贴版面，顶面/底面用素色，一个箱子两次绘制
    geo.clearGroups()
    geo.addGroup(0, 12, 1) // +x -x
    geo.addGroup(12, 6, 0) // +y 顶
    geo.addGroup(18, 6, 1) // -y 底
    geo.addGroup(24, 12, 1) // +z -z

    const tex = faceTexture(sku)
    const topTex = topTexture(sku)
    const matSide = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.86, metalness: 0 })
    const matTop = new THREE.MeshStandardMaterial({ map: topTex, roughness: 0.9 })

    disposables.push(geo, matSide, matTop, tex, topTex)
    const asset = { geo, matSide, matTop }
    cache.set(sku.id, asset)
    return asset
  }

  /* ---------- 取景 ---------- */

  const center = new THREE.Vector3(0, 0.5, 0)
  /** 整垛的包围盒尺寸，取景按这个算比包围球准得多 */
  const size = new THREE.Vector3(1, 1, 1)
  /** 相机相对目标的朝向，跟着用户旋转走，改层数时不会把视角拽回去 */
  const camDir = VIEW_DIR.clone()

  function fit() {
    const vFov = (camera.fov * Math.PI) / 180
    const hFov = 2 * Math.atan(Math.tan(vFov / 2) * camera.aspect)
    // 绕竖轴转的时候，横向占用最多也就是长边；纵向就是堆高
    const halfH = Math.max(size.x, size.z) / 2
    const halfV = size.y / 2
    const dist = Math.max(halfV / Math.tan(vFov / 2), halfH / Math.tan(hFov / 2)) * 1.16
    camera.position.copy(center).addScaledVector(camDir, Math.max(0.3, dist))
    controls.target.copy(center)
    controls.update()
  }

  /* ---------- 摆箱子 ---------- */

  function clearRoot() {
    for (const d of transient) d.dispose()
    transient = []
    root.clear()
  }

  function build(list: PalletSpec[]) {
    clearRoot()

    if (list.length === 0) {
      if (opts.emptyPallet) {
        const g = new THREE.Group()
        g.add(
          makePalletMesh(
            (PALLET_L + PALLET_MARGIN * 2) * MM,
            (PALLET_W + PALLET_MARGIN * 2) * MM,
            wood,
            woodDark,
            transient,
          ),
        )
        root.add(g)
      }
      const bbox = new THREE.Box3().setFromObject(root)
      if (!bbox.isEmpty()) {
        bbox.getCenter(center)
        bbox.getSize(size)
      }
      return
    }

    // 先把每块板的占地算出来，才能横向排开
    const plans = list.map((p) => {
      const { cols, rows, L, W } = stackLayout(p.sku, p.perLayer)
      return {
        ...p,
        cols,
        rows,
        palletL: (L + PALLET_MARGIN * 2) * MM,
        palletW: (W + PALLET_MARGIN * 2) * MM,
      }
    })

    const gap = 0.38
    const totalW = plans.reduce((s, p) => s + p.palletL, 0) + gap * Math.max(0, plans.length - 1)
    let cursor = -totalW / 2

    for (const p of plans) {
      const group = new THREE.Group()
      group.position.x = cursor + p.palletL / 2
      cursor += p.palletL + gap
      root.add(group)

      group.add(makePalletMesh(p.palletL, p.palletW, wood, woodDark, transient))

      const { geo, matSide, matTop } = assetFor(p.sku)
      const stepL = p.sku.boxL * MM
      const stepW = p.sku.boxW * MM
      const stepH = p.sku.boxH * MM
      const halfL = (p.cols * p.sku.boxL * MM) / 2
      const halfW = (p.rows * p.sku.boxW * MM) / 2
      const baseY = PALLET_H * MM
      const top = Math.min(p.topCount, p.perLayer)

      for (let layer = 0; layer < p.layers; layer++) {
        const isTop = layer === p.layers - 1
        const count = isTop ? top : p.perLayer
        for (let i = 0; i < count; i++) {
          const col = i % p.cols
          const row = Math.floor(i / p.cols)
          // 箱子长边一律顺着托盘长度方向摆
          const box = new THREE.Mesh(geo, [matTop, matSide])
          box.position.set(
            col * stepL + stepL / 2 - halfL,
            baseY + layer * stepH + stepH / 2,
            row * stepW + stepW / 2 - halfW,
          )
          box.castShadow = true
          box.receiveShadow = true
          group.add(box)
        }
      }
    }

    // 相机按实际包围盒 + 当前画布比例取景，保证整垛（不管几层）都在画面里
    const bbox = new THREE.Box3().setFromObject(root)
    if (!bbox.isEmpty()) {
      bbox.getCenter(center)
      bbox.getSize(size)
    }
  }

  function resize() {
    const w = container.clientWidth || 1
    const h = container.clientHeight || 1
    renderer.setSize(w, h, false)
    camera.aspect = w / h
    camera.updateProjectionMatrix()
    fit()
  }

  build(pallets)
  key.target.position.copy(center)
  scene.add(key.target)
  resize()

  const ro = new ResizeObserver(resize)
  ro.observe(container)

  let raf = 0
  let stopped = false
  const loop = () => {
    if (stopped) return
    controls.update()
    // 记下用户当前视角，重排时照着这个方向重新取景
    if (controls.target.distanceTo(camera.position) > 0.001) {
      camDir.copy(camera.position).sub(controls.target).normalize()
    }
    renderer.render(scene, camera)
    raf = requestAnimationFrame(loop)
  }
  loop()

  return {
    setPallets(next) {
      build(next)
      key.target.position.copy(center)
      fit()
    },
    resetView() {
      camDir.copy(VIEW_DIR)
      fit()
    },
    dispose() {
      stopped = true
      cancelAnimationFrame(raf)
      ro.disconnect()
      controls.dispose()
      clearRoot()
      scene.traverse((obj) => {
        const mesh = obj as THREE.Mesh
        if (mesh.isMesh && mesh.material) {
          const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material]
          for (const m of mats) m.dispose()
        }
      })
      for (const d of disposables) d.dispose()
      wood.dispose()
      woodDark.dispose()
      ground.geometry.dispose()
      ;(ground.material as THREE.Material).dispose()
      renderer.dispose()
      if (renderer.domElement.parentElement === container) container.removeChild(renderer.domElement)
    },
  }
}

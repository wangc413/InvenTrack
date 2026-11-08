import * as THREE from 'three'
import { OrbitControls } from 'three/addons/controls/OrbitControls.js'
import { PALLET_L, PALLET_W, layerPlan, layerSlots } from './calc'
import type { Sku } from './store'

import meatFront from '../assets/pack/klh-meat-front.webp'
import meatSide from '../assets/pack/klh-meat-side.webp'
import meatTop from '../assets/pack/klh-meat-top.webp'
import greenFront from '../assets/pack/klh-green-front.webp'
import greenSide from '../assets/pack/klh-green-side.webp'
import greenTop from '../assets/pack/klh-green-top.webp'
import caiFront from '../assets/pack/klh-cai-front.webp'
import caiSide from '../assets/pack/klh-cai-side.webp'
import caiTop from '../assets/pack/klh-cai-top.webp'
import jiaoFront from '../assets/pack/klh-jiao-front.webp'
import jiaoSide from '../assets/pack/klh-jiao-side.webp'
import jiaoTop from '../assets/pack/klh-jiao-top.webp'
import nuoFront from '../assets/pack/klh-nuo-front.webp'
import nuoSide from '../assets/pack/klh-nuo-side.webp'
import nuoTop from '../assets/pack/klh-nuo-top.webp'
import hmMeatFront from '../assets/pack/hm-meat-front.webp'
import hmMeatSide from '../assets/pack/hm-meat-side.webp'
import hmMeatTop from '../assets/pack/hm-meat-top.webp'
import hmGreenFront from '../assets/pack/hm-green-front.webp'
import hmGreenSide from '../assets/pack/hm-green-side.webp'
import hmGreenTop from '../assets/pack/hm-green-top.webp'
import hmShaoFront from '../assets/pack/hm-shao-front.webp'
import hmShaoSide from '../assets/pack/hm-shao-side.webp'
import hmShaoTop from '../assets/pack/hm-shao-top.webp'

/**
 * 有外箱稿的品：直接用设计稿裁出来的三张贴图（正面 / 侧面 / 顶面），箱子就是印出来的样子。
 * 没列在这里的品（比如菜洋洋、自己新建的）仍然走下面代码画出来的示意箱面。
 */
const PACK_ART: Record<string, { front: string; side: string; top: string }> = {
  // 盒马
  'sku-meat': { front: hmMeatFront, side: hmMeatSide, top: hmMeatTop },
  'sku-green': { front: hmGreenFront, side: hmGreenSide, top: hmGreenTop },
  'sku-shaomai': { front: hmShaoFront, side: hmShaoSide, top: hmShaoTop },
  // 快乐猴
  'sku-meat-klh': { front: meatFront, side: meatSide, top: meatTop },
  'sku-green-klh': { front: greenFront, side: greenSide, top: greenTop },
  'sku-caitianzi-klh': { front: caiFront, side: caiSide, top: caiTop },
  'sku-jiaozi-klh': { front: jiaoFront, side: jiaoSide, top: jiaoTop },
  'sku-nuomiji-klh': { front: nuoFront, side: nuoSide, top: nuoTop },
}

/** 全部按毫米建模，最后统一缩成米 */
const MM = 0.001

/** 托盘面高度（含顶板），箱子从这里往上堆 */
const PALLET_H = 145
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
  /** 选中高亮某块板（-1 取消）；只改视觉，不影响数据 */
  select: (index: number) => void
  dispose: () => void
}

const VIEW_DIR = new THREE.Vector3(0.26, 0.62, 0.74).normalize()

const texLoader = new THREE.TextureLoader()

/**
 * 设计稿按 sRGB 采样，开各向异性：斜看箱面时字不会糊成一片。
 * webp 加载失败（老浏览器不支持 / 缓存坏 / 网络拦截）时走 onError 回退，
 * 换成代码画的示意箱面，箱子永远有颜色、不会整块变黑。
 */
function artTexture(url: string, onError: (tex: THREE.Texture) => void) {
  const t = texLoader.load(
    url,
    undefined,
    undefined,
    () => onError(t),
  )
  t.colorSpace = THREE.SRGBColorSpace
  t.anisotropy = 8
  t.minFilter = THREE.LinearMipmapLinearFilter
  return t
}

/* ---------- 箱面纹理：没有外箱稿的品，按箱规画一套印刷箱面 ---------- */

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath()
  ctx.moveTo(x + r, y)
  ctx.arcTo(x + w, y, x + w, y + h, r)
  ctx.arcTo(x + w, y + h, x, y + h, r)
  ctx.arcTo(x, y + h, x, y, r)
  ctx.arcTo(x, y, x + w, y, r)
  ctx.closePath()
}

/** #rrggbb 调亮 / 调暗，k > 1 变亮、k < 1 变暗 */
function shade(hex: string, k: number) {
  const h = hex.replace('#', '')
  const n = parseInt(h.length === 3 ? h.replace(/(.)/g, '$1$1') : h, 16)
  const ch = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) =>
    Math.max(0, Math.min(255, Math.round(k >= 1 ? v + (255 - v) * (k - 1) : v * k))),
  )
  return `rgb(${ch[0]},${ch[1]},${ch[2]})`
}

/** 牛皮纸底：底色 + 极淡纤维，远看是纸，近看不是一块死色 */
function paper(ctx: CanvasRenderingContext2D, w: number, h: number, color: string) {
  ctx.fillStyle = color
  ctx.fillRect(0, 0, w, h)
  let seed = 20261106
  const rnd = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648
  ctx.strokeStyle = 'rgba(0,0,0,0.028)'
  ctx.lineWidth = 1
  const n = Math.min(900, Math.round((w * h) / 2600))
  for (let i = 0; i < n; i++) {
    const x = rnd() * w
    const y = rnd() * h
    const len = 5 + rnd() * 16
    ctx.beginPath()
    ctx.moveTo(x, y)
    ctx.lineTo(x + len, y + (rnd() - 0.5) * 1.8)
    ctx.stroke()
  }
}

/** 条码：宽度随机的一排竖条，远看就是条码 */
function barcode(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number) {
  let seed = 77
  const rnd = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648
  ctx.fillStyle = 'rgba(0,0,0,0.72)'
  let cursor = x
  while (cursor < x + w) {
    const bw = Math.max(1, Math.round(w * (0.012 + rnd() * 0.03)))
    if (rnd() > 0.42) ctx.fillRect(cursor, y, bw, h)
    cursor += bw + Math.max(1, Math.round(w * 0.012))
  }
}

/** 小字假文：挤成一团灰线，远看就是印刷的配料表 */
function textLines(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, rows: number, size: number) {
  ctx.fillStyle = 'rgba(0,0,0,0.34)'
  let seed = 19
  const rnd = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648
  for (let r = 0; r < rows; r++) {
    let cx = x
    const lineW = w * (0.62 + rnd() * 0.36)
    while (cx < x + lineW) {
      const seg = size * (1.4 + rnd() * 2.6)
      ctx.fillRect(cx, y + r * size * 1.75, Math.min(seg, x + lineW - cx), size * 0.62)
      cx += seg + size * 0.5
    }
  }
}

const FONT = '-apple-system, "PingFang SC", "Microsoft YaHei", sans-serif'

/**
 * 正面（长 × 高）：牛皮底 + 底部品牌色带 + 品名大字 + 规格。
 * 排版按箱面的长宽比缩放，换箱规不会溢出。
 */
function faceTexture(sku: Sku) {
  const W = 1024
  const ratio = sku.boxH / Math.max(1, sku.boxL)
  const H = Math.max(180, Math.round(W * ratio))
  const cv = document.createElement('canvas')
  cv.width = W
  cv.height = H
  const ctx = cv.getContext('2d')!
  const ink = shade(sku.accentColor, 0.5)

  paper(ctx, W, H, sku.boxColor)

  // 底部品牌色带，占 22%，跟外箱稿的比例接近
  const bandH = Math.round(H * 0.22)
  const bandTop = H - bandH
  ctx.fillStyle = sku.accentColor
  ctx.fillRect(0, bandTop, W, bandH)
  ctx.fillStyle = 'rgba(255,255,255,0.16)'
  ctx.fillRect(0, bandTop, W, Math.max(1.5, H * 0.008))

  // 品名：顶到色带上方，够大才像"印上去的"
  const nameSize = Math.min(bandTop * 0.42, W * 0.115)
  ctx.fillStyle = ink
  ctx.font = `700 ${nameSize}px ${FONT}`
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillText(sku.shortName, W / 2, bandTop * 0.52, W * 0.84)

  // 品名下一行规格
  const specSize = Math.min(nameSize * 0.38, W * 0.032)
  ctx.font = `500 ${specSize}px ${FONT}`
  ctx.fillStyle = 'rgba(0,0,0,0.55)'
  ctx.fillText(sku.spec, W / 2, bandTop * 0.52 + nameSize * 0.78, W * 0.76)

  // 色带里：左边"速冻食品"，右边储存条件
  const bandText = Math.min(bandH * 0.34, W * 0.03)
  ctx.font = `600 ${bandText}px ${FONT}`
  ctx.fillStyle = sku.textColor
  ctx.textAlign = 'left'
  ctx.fillText('速冻面米制品', W * 0.035, bandTop + bandH * 0.5)
  ctx.textAlign = 'right'
  ctx.fillText('-18℃ 冷藏', W - W * 0.035, bandTop + bandH * 0.5)

  const tex = new THREE.CanvasTexture(cv)
  tex.colorSpace = THREE.SRGBColorSpace
  tex.anisotropy = 4
  return tex
}

/**
 * 侧面（宽 × 高）：品名缩小 + 一块"配料表"小字 + 条码 + 储存条件。
 * 正面是名字，侧面是信息，跟真箱一样一面一功能。
 */
function sideTexture(sku: Sku) {
  const W = 512
  const ratio = sku.boxH / Math.max(1, sku.boxW)
  const H = Math.max(150, Math.round(W * ratio))
  const cv = document.createElement('canvas')
  cv.width = W
  cv.height = H
  const ctx = cv.getContext('2d')!
  const ink = shade(sku.accentColor, 0.5)

  paper(ctx, W, H, sku.boxColor)

  // 底部细色条，跟正面呼应
  const bandH = Math.round(H * 0.12)
  ctx.fillStyle = sku.accentColor
  ctx.fillRect(0, H - bandH, W, bandH)

  // 左上角：小 logo 块
  const tagH = H * 0.16
  const tagW = Math.min(W * 0.42, tagH * 2.6)
  ctx.fillStyle = sku.accentColor
  roundRect(ctx, W * 0.05, H * 0.07, tagW, tagH, tagH * 0.16)
  ctx.fill()
  ctx.fillStyle = sku.textColor
  ctx.font = `700 ${tagH * 0.55}px ${FONT}`
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillText('速冻', W * 0.05 + tagW / 2, H * 0.07 + tagH * 0.54)

  // 条码贴着底部色带站，先把它和配料的边界定下来，小字才不会写过头
  const bcH = Math.max(10, H * 0.16)
  const bcTop = H - bandH - bcH - H * 0.05

  // 品名（比正面小一号），压在 logo 块下面
  const nameSize = Math.min(H * 0.14, W * 0.13)
  const nameY = H * 0.33
  ctx.fillStyle = ink
  ctx.font = `700 ${nameSize}px ${FONT}`
  ctx.textAlign = 'left'
  ctx.textBaseline = 'middle'
  ctx.fillText(sku.shortName, W * 0.05, nameY, W * 0.9)

  // 配料表小字：只填品名和条码之间那段，行数按实际高度算
  const lineSize = Math.max(4, H * 0.028)
  const linesTop = nameY + nameSize * 0.75
  const rows = Math.max(2, Math.floor((bcTop - linesTop - H * 0.03) / (lineSize * 1.75)))
  textLines(ctx, W * 0.05, linesTop, W * 0.9, rows, lineSize)

  // 条码 + 规格
  barcode(ctx, W * 0.05, bcTop, W * 0.4, bcH)
  ctx.font = `500 ${Math.max(5, H * 0.032)}px ${FONT}`
  ctx.fillStyle = 'rgba(0,0,0,0.5)'
  ctx.textAlign = 'right'
  ctx.textBaseline = 'middle'
  ctx.fillText(sku.spec, W * 0.95, bcTop + bcH * 0.4, W * 0.46)

  const tex = new THREE.CanvasTexture(cv)
  tex.colorSpace = THREE.SRGBColorSpace
  tex.anisotropy = 4
  return tex
}

/**
 * 顶面（长 × 宽）：牛皮底 + 中缝（两个摇盖合上的痕迹）+ 品名。
 * 不用正方形画，免得贴到 1.2 : 0.8 的箱顶被拉长。
 */
function topTexture(sku: Sku) {
  const W = 512
  const H = Math.max(200, Math.round(W * (sku.boxW / Math.max(1, sku.boxL))))
  const cv = document.createElement('canvas')
  cv.width = W
  cv.height = H
  const ctx = cv.getContext('2d')!
  const ink = shade(sku.accentColor, 0.5)

  paper(ctx, W, H, sku.boxColor)

  // 中缝：两块摇盖合上的那条线，两侧各描一道浅影
  ctx.fillStyle = 'rgba(0,0,0,0.10)'
  ctx.fillRect(0, H / 2 - 1.5, W, 3)
  ctx.fillStyle = 'rgba(255,255,255,0.28)'
  ctx.fillRect(0, H / 2 + 1.5, W, 1.5)

  const nameSize = Math.min(H * 0.22, W * 0.11)
  ctx.fillStyle = ink
  ctx.font = `700 ${nameSize}px ${FONT}`
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillText(sku.shortName, W / 2, H * 0.3, W * 0.82)
  ctx.font = `500 ${nameSize * 0.42}px ${FONT}`
  ctx.fillStyle = 'rgba(0,0,0,0.45)'
  ctx.fillText(sku.spec, W / 2, H * 0.3 + nameSize * 0.8, W * 0.7)

  // 下半张：一句"此面朝上"，真箱上都有
  ctx.fillStyle = sku.accentColor
  roundRect(ctx, W / 2 - W * 0.1, H * 0.64, W * 0.2, H * 0.13, H * 0.022)
  ctx.fill()
  ctx.fillStyle = sku.textColor
  ctx.font = `600 ${Math.min(H * 0.075, W * 0.042)}px ${FONT}`
  ctx.fillText('此面朝上', W / 2, H * 0.64 + H * 0.066)

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
  opts: { emptyPallet?: boolean; onPick?: (index: number) => void } = {},
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

  /** 每种箱规只生成一次纹理与几何，多块板、多次重排共用 */
  const cache = new Map<
    string,
    { geo: THREE.BoxGeometry; mats: THREE.Material[] }
  >()
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
    // 四个面各贴一张：±x 侧面、+y 顶面、-y 底面、±z 正面/背面
    geo.clearGroups()
    geo.addGroup(0, 12, 0)
    geo.addGroup(12, 6, 1)
    geo.addGroup(18, 6, 2)
    geo.addGroup(24, 12, 3)

    const art = PACK_ART[sku.id]
    const papery = { roughness: 0.86, metalness: 0 }

    let matSide: THREE.Material
    let matFront: THREE.Material
    let matTop: THREE.Material

    if (art) {
      // 设计稿：正面 / 侧面 / 顶面各一张，比例跟真实箱面一致，箱子就是印出来的样子。
      // 同时各画一份示意箱面兜底：webp 加载失败时立刻换上，避免箱子黑成一块。
      const face = faceTexture(sku)
      const flank = sideTexture(sku)
      const top = topTexture(sku)
      matFront = new THREE.MeshStandardMaterial({
        map: artTexture(art.front, () => { matFront.map = face; matFront.needsUpdate = true }),
        ...papery,
      })
      matSide = new THREE.MeshStandardMaterial({
        map: artTexture(art.side, () => { matSide.map = flank; matSide.needsUpdate = true }),
        ...papery,
      })
      matTop = new THREE.MeshStandardMaterial({
        map: artTexture(art.top, () => { matTop.map = top; matTop.needsUpdate = true }),
        roughness: 0.9,
      })
      disposables.push(face, flank, top)
    } else {
      // 自己画：正面是品名，侧面是配料表 + 条码，各贴各的
      const face = faceTexture(sku)
      const flank = sideTexture(sku)
      matFront = new THREE.MeshStandardMaterial({ map: face, ...papery })
      matSide = new THREE.MeshStandardMaterial({ map: flank, ...papery })
      matTop = new THREE.MeshStandardMaterial({ map: topTexture(sku), roughness: 0.9 })
      disposables.push(face, flank)
    }

    // 底面看不到，给个素色省一张贴图
    const matBottom = new THREE.MeshStandardMaterial({ color: sku.boxColor, roughness: 0.92 })
    const mats = [matSide, matTop, matBottom, matFront]

    disposables.push(geo, matBottom, matTop, matFront)
    if (matSide !== matFront) disposables.push(matSide)
    for (const m of mats) {
      const map = (m as THREE.MeshStandardMaterial).map
      if (map) disposables.push(map)
    }

    const asset = { geo, mats }
    cache.set(sku.id, asset)
    return asset
  }

  /* ---------- 取景 ---------- */

  const center = new THREE.Vector3(0, 0.5, 0)
  /** 整垛的包围盒尺寸，取景按这个算比包围球准得多 */
  const size = new THREE.Vector3(1, 1, 1)
  /** 相机相对目标的朝向，跟着用户旋转走，改层数时不会把视角拽回去 */
  const camDir = VIEW_DIR.clone()

  const fitUp = new THREE.Vector3(0, 1, 0)

  /**
   * 取景：按包围盒 8 个角在当前视角下的投影算需要多远，
   * 比「高度 ÷ tan(fov/2)」准 —— 斜着看时堆高和进深会叠在一起，那样算会切到板边。
   */
  function fit() {
    const tanV = Math.tan((camera.fov * Math.PI) / 360)
    const tanH = tanV * camera.aspect
    const right = new THREE.Vector3().crossVectors(fitUp, camDir).normalize()
    const up = new THREE.Vector3().crossVectors(camDir, right).normalize()
    const h = size.clone().multiplyScalar(0.5)
    let dist = 0.3
    for (let i = 0; i < 8; i++) {
      const p = new THREE.Vector3(
        (i & 1 ? h.x : -h.x),
        (i & 2 ? h.y : -h.y),
        (i & 4 ? h.z : -h.z),
      )
      const depth = p.dot(camDir)
      dist = Math.max(dist, Math.abs(p.dot(right)) / tanH + depth, Math.abs(p.dot(up)) / tanV + depth)
    }
    dist *= 1.16
    camera.position.copy(center).addScaledVector(camDir, Math.max(0.3, dist))
    controls.target.copy(center)
    controls.update()
  }

  /* ---------- 摆箱子 ---------- */

  /** 每块板的 group，按索引对应；点击拾取和选中高亮都靠它 */
  const palletGroups: THREE.Group[] = []
  /** 每块板的高亮外壳（半透明罩，选中时才显示） */
  const highlights: THREE.Mesh[] = []
  let selectedIdx = -1

  function clearRoot() {
    for (const d of transient) d.dispose()
    transient = []
    root.clear()
    palletGroups.length = 0
    highlights.length = 0
    selectedIdx = -1
  }

  function build(list: PalletSpec[]) {
    clearRoot()

    if (list.length === 0) {
      if (opts.emptyPallet) {
        const g = new THREE.Group()
        g.add(makePalletMesh(PALLET_L * MM, PALLET_W * MM, wood, woodDark, transient))
        root.add(g)
      }
      const bbox = new THREE.Box3().setFromObject(root)
      if (!bbox.isEmpty()) {
        bbox.getCenter(center)
        bbox.getSize(size)
        frameBounds()
      }
      return
    }

    // 托盘就是 1.2 m × 1 m。多块板按网格排：每行最多 3 块，排满换行，观感紧凑不拉成长条
    const palletL = PALLET_L * MM
    const palletW = PALLET_W * MM
    const gap = 0.34
    const perRow = 3
    const rows = Math.ceil(list.length / perRow)
    const totalW = Math.min(list.length, perRow) * palletL + gap * Math.max(0, Math.min(list.length, perRow) - 1)
    const totalD = rows * palletW + gap * Math.max(0, rows - 1)
    let idx = 0

    for (const p of list) {
      const col = idx % perRow
      const row = Math.floor(idx / perRow)
      idx++

      const group = new THREE.Group()
      group.userData.palletIndex = idx - 1
      group.position.x = -totalW / 2 + col * (palletL + gap) + palletL / 2
      group.position.z = -totalD / 2 + row * (palletW + gap) + palletW / 2
      root.add(group)

      group.add(makePalletMesh(palletL, palletW, wood, woodDark, transient))

      const { geo, mats } = assetFor(p.sku)
      // 位置完全照这个品的固定码法来：箱子怎么转、摆在哪，都是写好的
      const plan = layerPlan(p.sku)
      const full = Math.min(Math.max(1, p.perLayer), plan.slots.length)
      const stepH = p.sku.boxH * MM
      const baseY = PALLET_H * MM
      const top = Math.min(p.topCount, full)

      for (let layer = 0; layer < p.layers; layer++) {
        // 单数层整体调头 180°，缝错开压住
        const slots = layerSlots(plan, layer)
        const count = layer === p.layers - 1 ? top : full
        for (let i = 0; i < count; i++) {
          const slot = slots[i]
          const box = new THREE.Mesh(geo, mats)
          box.position.set(slot.x * MM, baseY + layer * stepH + stepH / 2, slot.z * MM)
          // 横的那几个转 90°，长边改顺着 1 m 那边
          if (slot.turn) box.rotation.y = Math.PI / 2
          box.castShadow = true
          box.receiveShadow = true
          group.add(box)
        }
      }

      // 选中高亮：一块柔和的橙色光斑贴在地面（放 root 层，不随板抬高），选中时亮起
      const hlGeo = new THREE.CircleGeometry(Math.max(palletL, palletW) * 0.58, 40)
      const hlMat = new THREE.MeshBasicMaterial({
        color: 0xff9f43,
        transparent: true,
        opacity: 0.5,
        depthWrite: false,
      })
      const hl = new THREE.Mesh(hlGeo, hlMat)
      hl.rotation.x = -Math.PI / 2
      hl.position.set(group.position.x, 0.005, group.position.z)
      hl.visible = false
      hl.renderOrder = 10
      root.add(hl)
      transient.push(hlGeo, hlMat)
      highlights.push(hl)
      palletGroups.push(group)
    }

    // 相机按实际包围盒 + 当前画布比例取景，保证整垛（不管几层）都在画面里
    const bbox = new THREE.Box3().setFromObject(root)
    if (!bbox.isEmpty()) {
      bbox.getCenter(center)
      bbox.getSize(size)
      frameBounds()
    }
  }

  /** 取景尺寸至少留一块托盘，不然只码一层时相机贴得太近，板边都被切掉 */
  function frameBounds() {
    size.x = Math.max(size.x, PALLET_L * MM)
    size.z = Math.max(size.z, PALLET_W * MM)
    size.y = Math.max(size.y, 0.42)
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

  /** 选中高亮某块板，-1 取消：选中的板整体抬高 + 底部光斑亮起，一眼认出是哪块 */
  function select(index: number) {
    selectedIdx = index
    highlights.forEach((hl, i) => {
      hl.visible = i === index
    })
    palletGroups.forEach((g, i) => {
      // 平滑抬高：选中 0.06 米，其余落回 0
      g.position.y = i === index ? 0.06 : 0
    })
  }

  /* ---------- 点击拾取：点某块板 → 回调选中 ---------- */

  if (opts.onPick) {
    const raycaster = new THREE.Raycaster()
    const ndc = new THREE.Vector2()
    let downX = 0
    let downY = 0
    let downTime = 0

    const onPointerDown = (e: PointerEvent) => {
      downX = e.clientX
      downY = e.clientY
      downTime = performance.now()
    }
    const onPointerUp = (e: PointerEvent) => {
      // 位移大 = 在拖动旋转；时间久 = 长按；都不是，才算是「点一下」
      const dx = e.clientX - downX
      const dy = e.clientY - downY
      if (Math.hypot(dx, dy) > 6 || performance.now() - downTime > 400) return

      const rect = renderer.domElement.getBoundingClientRect()
      ndc.set(((e.clientX - rect.left) / rect.width) * 2 - 1, -((e.clientY - rect.top) / rect.height) * 2 + 1)
      raycaster.setFromCamera(ndc, camera)
      const hits = raycaster.intersectObjects(palletGroups, true)
      if (hits.length > 0) {
        // 命中的是箱子/托盘，往上找属于哪块板（group 上挂了 palletIndex）
        let obj: THREE.Object3D | null = hits[0].object
        let gi: number | undefined
        while (obj) {
          const idx = (obj as THREE.Group).userData.palletIndex
          if (typeof idx === 'number') {
            gi = idx
            break
          }
          obj = obj.parent
        }
        if (gi !== undefined) opts.onPick!(gi)
      }
    }

    renderer.domElement.addEventListener('pointerdown', onPointerDown)
    renderer.domElement.addEventListener('pointerup', onPointerUp)
    disposables.push({
      dispose: () => {
        renderer.domElement.removeEventListener('pointerdown', onPointerDown)
        renderer.domElement.removeEventListener('pointerup', onPointerUp)
      },
    })
  }

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
    select,
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

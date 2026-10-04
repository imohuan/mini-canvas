<script setup lang="ts">
/**
 * CursorEffectOverlay —— 光标特效的**全页面**渲染层。
 *
 * 三件事：
 * 1. **藏原生指针**：给 <html> 挂 `mc-cursor-hidden` 类（全局 CSS 把光标换成透明图）——
 *    不是只藏在画布里，而是整个 document 都生效；
 * 2. **跟随元素**：一个**零延迟**跟着鼠标的元素（图标/GIF 都可）——光标必须实时贴手，不做平滑；
 * 3. **特效 canvas**：跟随拖尾 + 点击特效共用一层画布（拖尾才有动画），粒子用预渲染精灵绘制、设上限。
 *
 * 为什么整块 Teleport 到 body、且 z-index 极高：
 * - 覆盖层原来住在画布容器里（`.csurface-overlay` 带 overflow:hidden 与低 z-index）——
 *   一开下拉/弹窗（z-index 100000）就被盖住、且靠近边缘会被裁。搬到 body + fixed + 顶层 z-index 后，
 *   光标始终在所有浮层之上（它就是鼠标）；canvas 与跟随元素 pointer-events:none，不挡任何点击。
 *
 * 坐标：因为搬到了 body 且 fixed，直接用 clientX/clientY，不再做容器矩形换算。
 * 配置从内核 settings 读（键见 catalog.ts），改动实时生效；插件热卸由组件卸载顺带清干净。
 */
import { onBeforeUnmount, ref, watch } from 'vue'
import { useCanvasRender } from '@mini-canvas/canvas-render'
import {
  cursorById, cursorEffectConfigFrom, DEFAULTS,
  CUSTOM_CURSOR_ID,
  type CursorEffectConfig, type EffectId, type FollowId,
} from './catalog'
import {
  TRANSPARENT_CURSOR, dataUri, svgIcon, spawnSpec, pushWithin,
  stepParticles, stepRings, type Particle, type Ring,
} from './engine'
import { COLOR_ASSETS } from './colorAssets'
import { loadCustomCursors, CUSTOM_CHANGED_EVENT, type CustomCursor } from './customCursors'

const { ctx } = useCanvasRender()

/** <html> 上挂这个类 = 原生光标被藏掉（全局 CSS 见文件末尾非 scoped 样式） */
const HIDE_CLASS = 'mc-cursor-hidden'

const rootEl = ref<HTMLElement | null>(null)
const canvasEl = ref<HTMLCanvasElement | null>(null)
const followerEl = ref<HTMLElement | null>(null)
const offsetEl = ref<HTMLElement | null>(null)
const innerEl = ref<HTMLElement | null>(null)
const frameEl = ref<HTMLImageElement | null>(null)

/** 自定义光标（上传的图片 / SVG / 帧序列）：从 localStorage 读，随设置里选中的 id 取用 */
let customCursors: CustomCursor[] = []
let frameTimer = 0
function getActiveCustom(): CustomCursor | undefined {
  if (cfg.value.cursorFxCursor !== CUSTOM_CURSOR_ID) return undefined
  const id = cfg.value.cursorFxCustomId
  // 选中了自定义、但一条素材都没有（比如存储被禁用）：返回 undefined → 回落默认光标，绝不空白
  return customCursors.find((c) => c.id === id) ?? customCursors[0] ?? undefined
}
function stopFrameLoop(): void { if (frameTimer) { clearInterval(frameTimer); frameTimer = 0 } }

/** 内核 settings 的最小订阅面 */
interface SettingsLike {
  get(key: string): unknown
  onChange(cb: (key: string, value: unknown) => void): { dispose(): void }
}

// ==================== 配置 ====================
const cfg = ref<CursorEffectConfig>(DEFAULTS)
function readCfg(): void { cfg.value = cursorEffectConfigFrom(ctx) }
readCfg()
customCursors = loadCustomCursors()
let settingsOff: { dispose(): void } | undefined
const settings = ctx.tryGet<SettingsLike>('settings')
settingsOff = settings?.onChange(() => readCfg())

// ==================== 画布与坐标 ====================
let ctx2d: CanvasRenderingContext2D | null = null
let dpr = 1
let mx = -999, my = -999
let hoverFlag = false

const parts: Particle[] = []
const rings: Ring[] = []
const dots: Array<{ x: number; y: number; h: number; life: number }> = []
const ghosts: Array<{ x: number; y: number; life: number; size: number; rot: number }> = []
const bubbles: Array<{ x: number; y: number; r: number; life: number; wob: number; vy: number }> = []
const ants: Array<{ x: number; y: number }> = []
let hueT = 0
let lastSpawn = 0

// ==================== 预渲染精灵（性能关键：替代每帧 shadowBlur） ====================
const glowSprites: Record<number, HTMLCanvasElement> = {}
let whiteSprite: HTMLCanvasElement | null = null
const iconSprites: Record<string, HTMLCanvasElement> = {}
const makeCanvas = (size: number): HTMLCanvasElement => { const c = document.createElement('canvas'); c.width = c.height = size; return c }

function glowSprite(hue: number): HTMLCanvasElement {
  const key = ((Math.round(hue) % 36) + 36) % 36
  if (glowSprites[key]) return glowSprites[key]
  const s = 48, c = makeCanvas(s), g = c.getContext('2d')!
  const grd = g.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2)
   grd.addColorStop(0, 'hsla(' + key * 10 + ',100%,90%,1)') // 主题色白名单: 光斑渐变按色相环动态生成，非 UI 主题色
   grd.addColorStop(0.3, 'hsla(' + key * 10 + ',100%,66%,1)') // 主题色白名单: 同上，动态色相
   grd.addColorStop(0.62, 'hsla(' + key * 10 + ',100%,58%,.4)') // 主题色白名单: 同上，动态色相
   grd.addColorStop(1, 'hsla(' + key * 10 + ',100%,55%,0)') // 主题色白名单: 同上，动态色相淡出
  g.fillStyle = grd; g.fillRect(0, 0, s, s)
  glowSprites[key] = c; return c
}
function whiteGlow(): HTMLCanvasElement {
  if (whiteSprite) return whiteSprite
  const s = 48, c = makeCanvas(s), g = c.getContext('2d')!
  const grd = g.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2)
   grd.addColorStop(0, 'rgba(255,255,255,1)'); grd.addColorStop(0.5, 'rgba(255,255,255,.55)'); grd.addColorStop(1, 'rgba(255,255,255,0)') // 主题色白名单: 白色高光渐隐，与主题无关
  g.fillStyle = grd; g.fillRect(0, 0, s, s)
  whiteSprite = c; return c
}
function iconSprite(name: string, color?: string): HTMLCanvasElement {
  const key = name + '|' + (color ?? '')
  if (iconSprites[key]) return iconSprites[key]
  const s = 64, c = makeCanvas(s)
  const img = new Image()
  img.onload = () => { const g = c.getContext('2d'); if (g) g.drawImage(img, 0, 0, s, s) }
  const colored = COLOR_ASSETS[name]
  if (colored) {
    // 彩色素材（Noto Emoji，含自带颜色）：直接用原色，不做 currentColor 替换，只补尺寸
    img.src = dataUri(colored.replace(/\s*width="[^"]*"/, '').replace(/\s*height="[^"]*"/, '').replace('<svg ', '<svg width="' + s + '" height="' + s + '" '))
  } else {
    img.src = dataUri(svgIcon(name, s, color))
  }
  iconSprites[key] = c; return c
}
function blit(img: HTMLCanvasElement, x: number, y: number, size: number, alpha: number, rot?: number): void {
  if (!ctx2d) return
  ctx2d.globalAlpha = alpha
  if (rot) { ctx2d.save(); ctx2d.translate(x, y); ctx2d.rotate(rot); ctx2d.drawImage(img, -size / 2, -size / 2, size, size); ctx2d.restore() }
  else ctx2d.drawImage(img, x - size / 2, y - size / 2, size, size)
}
// 预载真实彩色素材（点下去就有图、不闪空）
for (const n of [
  'leaf', 'maple', 'blossom', 'hibiscus', 'sunflower', 'star', 'glow-star', 'dizzy',
  'sparkles', 'sparkle', 'heart', 'heart-pink', 'snow', 'confetti', 'boom', 'moon',
  'rainbow', 'music', 'comet', 'planet', 'butterfly', 'paw', 'gem', 'bubble', 'balloon', 'candy',
]) iconSprite(n)

// ==================== 跟随发射（只有这些是"动画"） ====================
const rnd = (a: number, b: number) => a + Math.random() * (b - a)
const PICK: Array<[string, string]> = [['heart', '#ff6b9d'], ['star', '#ffd166'], ['sparkle', '#7ee7ff'], ['moon', '#c4b5fd'], ['leaf', '#86efac']] // 主题色白名单: 粒子贴图固定装饰配色（粉/黄/蓝/紫/绿），刻意不随主题
function pushP(p: Particle): void { pushWithin(parts, [p], Math.max(1, cfg.value.cursorFxParticleCap)) }

const rnd2 = (a: number, b: number) => a + Math.random() * (b - a)
/** 抛一个真实素材拖尾粒子（彩色素材自带颜色，col 只给单色图标用） */
function trailIcon(name: string, x: number, y: number, sizeK: number, col?: string): void {
  const size = Math.max(6, cfg.value.cursorFxTrailSize * sizeK)
  pushP({ k: 'ic', n: name, x, y, vx: rnd2(-.6, .6), vy: rnd2(-.2, .8), g: .012, life: 1, dec: rnd2(.006, .014), size: size * rnd2(.85, 1.15), rot: rnd2(0, 6.28), vr: rnd2(-.06, .06), col })
}

function emit(x: number, y: number, now: number): void {
  const f = cfg.value.cursorFxFollow as FollowId
  if (f === 'none') return
  const gap = (base: number) => now - lastSpawn > base
  if (f === 'rainbow') {
    if (gap(12)) { lastSpawn = now; dots.push({ x, y, h: (hueT++) % 360, life: 1 }); if (dots.length > 40) dots.shift() }
  } else if (f === 'fairy') {
    if (gap(20)) { lastSpawn = now; trailIcon('sparkles', x + rnd2(-5, 5), y + rnd2(-5, 5), 0.9); trailIcon('dizzy', x + rnd2(-3, 3), y + rnd2(-3, 3), 0.7) }
  } else if (f === 'sparkle') {
    if (gap(46)) { lastSpawn = now; trailIcon(Math.random() < .5 ? 'glow-star' : 'star', x + rnd2(-6, 6), y + rnd2(-5, 5), 1.0) }
  } else if (f === 'leaves') {
    if (gap(46)) { lastSpawn = now; const kinds = ['leaf', 'maple', 'leaf', 'blossom']; trailIcon(kinds[Math.floor(Math.random() * kinds.length)], x + rnd2(-7, 7), y + rnd2(-5, 5), 1.05) }
  } else if (f === 'hearts') {
    if (gap(42)) { lastSpawn = now; trailIcon(Math.random() < .5 ? 'heart' : 'heart-pink', x + rnd2(-6, 6), y + rnd2(-5, 5), 0.95) }
  } else if (f === 'snow') {
    if (gap(40)) { lastSpawn = now; trailIcon('snow', x + rnd2(-7, 7), y + rnd2(-5, 5), 0.95) }
  } else if (f === 'music') {
    if (gap(52)) { lastSpawn = now; trailIcon('music', x + rnd2(-6, 6), y + rnd2(-5, 5), 1.0) }
  } else if (f === 'butterfly') {
    if (gap(60)) { lastSpawn = now; trailIcon('butterfly', x + rnd2(-8, 8), y + rnd2(-6, 6), 1.05) }
  } else if (f === 'moon') {
    if (gap(44)) { lastSpawn = now; trailIcon('moon', x + rnd2(-6, 6), y + rnd2(-5, 5), 0.9); if (Math.random() < .4) trailIcon('dizzy', x + rnd2(-6, 6), y + rnd2(-6, 6), 0.6) }
  } else if (f === 'bubble') {
    if (gap(70)) { lastSpawn = now; bubbles.push({ x: x + rnd2(-10, 10), y: y + rnd2(-6, 6), r: rnd2(3, 8), life: 1, wob: rnd2(0, 6.28), vy: rnd2(.2, .6) }) }
  } else if (f === 'ghost') {
    if (gap(60)) { lastSpawn = now; trailIcon('cloud', x + rnd2(-6, 6), y + rnd2(-5, 5), 0.9, '#dbeafe') } // 主题色白名单: 云朵贴图固定淡蓝，装饰用色
  }
}

// ==================== 每帧（只推进特效；指针在 pointermove 里即时跟） ====================
let raf = 0
let lastT = 0

function stepAll(dt: number): void {
  stepParticles(parts, dt)
  stepRings(rings, dt)
  for (let i = dots.length - 1; i >= 0; i--) { dots[i].life -= 0.02 * dt; if (dots[i].life <= 0) dots.splice(i, 1) }
  for (let i = ghosts.length - 1; i >= 0; i--) { ghosts[i].life -= 0.022 * dt; ghosts[i].rot += 0.012 * dt; if (ghosts[i].life <= 0) ghosts.splice(i, 1) }
  for (let i = bubbles.length - 1; i >= 0; i--) { const b = bubbles[i]; b.life -= 0.006 * dt; b.wob += 0.08 * dt; b.x += Math.sin(b.wob) * 0.6 * dt; b.y -= b.vy * dt; if (b.life <= 0) bubbles.splice(i, 1) }
  if (cfg.value.cursorFxFollow === 'ants') {
    while (ants.length < 15) ants.push({ x: mx, y: my })
    let tx = mx, ty = my
    for (const a of ants) { a.x += (tx - a.x) * 0.3 * dt; a.y += (ty - a.y) * 0.3 * dt; tx = a.x; ty = a.y }
  } else if (ants.length) ants.length = 0
}

function draw(): void {
  if (!ctx2d || !canvasEl.value) return
  const w = canvasEl.value.width / dpr, h = canvasEl.value.height / dpr
  ctx2d.clearRect(0, 0, w, h)
  ctx2d.globalCompositeOperation = 'lighter'
  if (dots.length > 1) {
    for (let i = 1; i < dots.length; i++) {
      const d0 = dots[i - 1], d1 = dots[i]
      ctx2d.globalAlpha = d1.life * 0.8
      ctx2d.strokeStyle = 'hsl(' + d1.h + ',95%,62%)' // 主题色白名单: 拖尾按指针色相动态生成
      ctx2d.lineWidth = (5 * d1.life * cfg.value.cursorFxPower) / 90
      ctx2d.lineCap = 'round'
      ctx2d.beginPath(); ctx2d.moveTo(d0.x, d0.y); ctx2d.lineTo(d1.x, d1.y); ctx2d.stroke()
    }
    ctx2d.globalAlpha = 1
  }
  for (const gh of ghosts) blit(whiteGlow(), gh.x, gh.y, gh.size * gh.life, gh.life * 0.5, gh.rot)
  for (const bb of bubbles) {
    const rr = bb.r * (0.4 + bb.life * 1.2)
    ctx2d.globalAlpha = bb.life * 0.6
    ctx2d.strokeStyle = 'rgba(180,240,255,.95)'; ctx2d.lineWidth = 1.4 // 主题色白名单: 气泡拖尾固定冰蓝描边
    ctx2d.beginPath(); ctx2d.arc(bb.x, bb.y, rr, 0, 6.283); ctx2d.stroke()
    ctx2d.fillStyle = 'rgba(120,220,255,.12)'; ctx2d.fill() // 主题色白名单: 气泡拖尾固定冰蓝填充
  }
  ctx2d.globalAlpha = 1
  if (cfg.value.cursorFxFollow === 'ants') {
    for (let i = 0; i < ants.length; i++) {
      const a = ants[i], t = 1 - i / ants.length
      blit(iconSprite('paw'), a.x, a.y, (8 + t * 10) * (cfg.value.cursorFxTrailSize / 22), 0.4 + 0.6 * t)
    }
  }
  if (cfg.value.cursorFxFollow === 'dot') {
    drawFollowDot(cfg.value.cursorFxTrailSize)
  }
  for (const rg of rings) {
    if (rg.delay > 0) continue
    ctx2d.globalAlpha = rg.a
    ctx2d.strokeStyle = 'hsl(' + rg.hue + ',100%,68%)'; ctx2d.lineWidth = rg.w // 主题色白名单: 涟漪按随机色相动态生成
    ctx2d.beginPath(); ctx2d.arc(rg.x, rg.y, rg.r, 0, 6.283); ctx2d.stroke()
  }
  ctx2d.globalAlpha = 1
  for (const p of parts) {
    const al = Math.max(0, p.life)
    if (p.k === 'sp') blit(glowSprite(p.hue ?? 0), p.x, p.y, p.size * (0.6 + al * 0.8), al)
    else if (p.k === 'ic') blit(iconSprite(p.n ?? 'star', p.col), p.x, p.y, p.size * (0.5 + al * 0.7), al, p.rot)
    else if (p.k === 'txt' && ctx2d) {
      ctx2d.globalAlpha = al; ctx2d.fillStyle = 'hsl(' + (p.hue ?? 0) + ',90%,72%)' // 主题色白名单: 粒子按各自色相动态生成
      ctx2d.save(); ctx2d.translate(p.x, p.y); ctx2d.rotate(p.rot ?? 0)
      ctx2d.font = p.size + 'px system-ui,serif'; ctx2d.textAlign = 'center'; ctx2d.textBaseline = 'middle'
      ctx2d.fillText(p.n ?? '', 0, 0); ctx2d.restore(); ctx2d.globalAlpha = 1
    }
  }
  ctx2d.globalCompositeOperation = 'source-over'
}

function frame(now: number): void {
  raf = requestAnimationFrame(frame)
  const dt = lastT ? Math.min(3, (now - lastT) / 16.67) : 1
  lastT = now
  const busy = cfg.value.cursorFxFollow !== 'none' || parts.length || rings.length || dots.length || ghosts.length || bubbles.length || ants.length
  if (busy) { stepAll(dt); draw() }
  else if (ctx2d && canvasEl.value) ctx2d.clearRect(0, 0, canvasEl.value.width / dpr, canvasEl.value.height / dpr)
}

// ==================== 光标跟随元素：零延迟 ====================
/** 立即把跟随元素挪到鼠标处（无平滑、无补间 —— 光标必须实时贴手） */
function moveFollower(): void {
  const f = followerEl.value
  if (f) f.style.transform = 'translate3d(' + mx + 'px,' + my + 'px,0)'
}
/**
 * 画跟随指针。
 *
 * 关键（修"动画不播"）：**热点偏移写在外层 `offsetEl` 的 transform，idle 动画（pulse/spin）留给内层 `innerEl`**——
 * 之前两者都内联在同一个元素上，内联 transform 把动画的 transform 覆盖掉，所以永远不动。
 * 现在 `offsetEl` 与 `innerEl` 各管一个 transform，互不打架。
 */
function paintFollower(): void {
  const el = innerEl.value
  const off = offsetEl.value
  const img = frameEl.value
  if (!el || !off) return
  stopFrameLoop()
  const size = cfg.value.cursorFxSize
  const cust = getActiveCustom()
  let showing = false
  let hx = 0, hy = 0, anim = ''

  if (cust && cfg.value.cursorFxEnabled) {
    // 自定义上传（图片 / SVG / 帧序列）
    showing = true; hx = cust.hx; hy = cust.hy
    el.className = 'ce-inner'
    el.innerHTML = ''
    el.style.display = 'none'
    if (img) {
      // 关键：**先**写死尺寸（同时进 width/height 属性与行内样式）**再**显示。
      // 若先 display:none 下挂载、又指望量出来的宽高，会在 flex 容器里量到 0 ——
      // 成品的表现就是"图片在 DOM 里但宽度 0、画布上什么都不显示"（本次真机抓到的根因）。
      const px = size + 'px'
      img.width = size; img.height = size
      img.style.width = px; img.style.height = px
      img.style.maxWidth = 'none'
      img.draggable = false
      const frames = cust.frames
      let i = 0
      const set = () => { if (img && frames[i]) img.src = frames[i] }
      set()
      img.style.display = 'block'
      img.style.visibility = 'visible'
      // 用**这条素材自己的帧率**（每帧序列可各自设置），没有才回落配置默认
      const fps = Math.max(2, cust.fps || cfg.value.cursorFxCustomFps || 12)
      if (frames.length > 1) frameTimer = window.setInterval(() => { i = (i + 1) % frames.length; set() }, Math.round(1000 / fps))
    }
  } else {
    if (img) { img.style.display = 'none'; img.removeAttribute('src') }
    // 自定义缺失 → 回落默认光标（不留空白）；其余按 id 查表（本身已有兜底）
    const c = cursorById(cfg.value.cursorFxCursor === CUSTOM_CURSOR_ID ? 'arrow' : cfg.value.cursorFxCursor)
    showing = cfg.value.cursorFxEnabled && c.kind === 'dom'
    hx = c.hx; hy = c.hy; anim = c.anim ?? ''
    if (showing) {
      el.style.display = ''
      el.className = 'ce-inner' + (anim ? ' ' + anim : '')
      el.innerHTML = svgIcon(c.icon, size)
      const svg = el.querySelector('svg')
      if (svg) {
        svg.setAttribute('width', String(size)); svg.setAttribute('height', String(size)); svg.style.display = 'block'
        if (c.src === 'mono') {
          // 单色指针：白填充 + 深色描边，落在任何底色上都看得清
           svg.style.fill = '#fff' // 主题色白名单: 贴图白色填充保证任意背景可读
           svg.style.stroke = 'rgba(0,0,0,.82)' // 主题色白名单: 深色描边保证可读性
          svg.style.strokeWidth = '1.1'
          svg.style.paintOrder = 'stroke'
        }
      }
    } else { el.innerHTML = ''; el.style.display = 'none' }
  }

  if (followerEl.value) followerEl.value.style.display = showing ? '' : 'none'
  off.style.transform = 'translate(' + (-hx * size).toFixed(1) + 'px,' + (-hy * size).toFixed(1) + 'px)'
}

// ==================== 原生光标隐藏（全 document） ====================
function applyCursorSkin(): void {
  const html = document.documentElement
  const enabled = cfg.value.cursorFxEnabled
  // 自定义上传：用透明光标藏原生指针（绘图交给跟随层的 <img>）
  if (enabled && cfg.value.cursorFxCursor === CUSTOM_CURSOR_ID) {
    html.style.setProperty('--mc-cursor', TRANSPARENT_CURSOR)
    html.classList.add(HIDE_CLASS)
    return
  }
  const c = cursorById(cfg.value.cursorFxCursor)
  if (!enabled || c.kind === 'native') {
    html.classList.remove(HIDE_CLASS)
    html.style.removeProperty('--mc-cursor')
    return
  }
  html.style.setProperty('--mc-cursor', c.kind === 'img'
    ? 'url("' + dataUri(svgIcon(c.icon, 40, c.color)) + '") ' + Math.round(c.hx * 40) + ' ' + Math.round(c.hy * 40) + ', auto'
    : TRANSPARENT_CURSOR)
  html.classList.add(HIDE_CLASS)
}

// ==================== DOM 事件（挂 document，全页面生效） ====================
function onMove(e: PointerEvent): void {
  mx = e.clientX; my = e.clientY
  moveFollower()
  const f = followerEl.value
  if (f && f.style.opacity === '0') f.style.opacity = '1'
  const t = e.target as HTMLElement | null
  hoverFlag = !!(cfg.value.cursorFxHoverScale && t && t.closest && (t.closest('.vue-flow__node') || t.closest('button') || t.closest('[role="button"]')))
  if (f) f.classList.toggle('is-hot', hoverFlag)
  emit(mx, my, performance.now())
}
function onLeave(e: PointerEvent): void {
  if (e.relatedTarget) return
  const f = followerEl.value
  if (f) f.style.opacity = '0'
}
function boom(type: EffectId, x: number, y: number, big: boolean): void {
  const pw = (cfg.value.cursorFxPower / 90) * (big ? 1.6 : 1)
  const spec = spawnSpec(type, x, y, pw, { size: cfg.value.cursorFxTrailSize })
  pushWithin(parts, spec.particles, Math.max(1, cfg.value.cursorFxParticleCap))
  for (const r of spec.rings) rings.push(r)
}
function onDown(e: PointerEvent): void {
  if (e.button !== 0) return
  const eff = cfg.value.cursorFxEffect as EffectId
  if (cfg.value.cursorFxEnabled && eff !== 'none') boom(eff, e.clientX, e.clientY, false)
  if (cfg.value.cursorFxClickPunch && followerEl.value) {
    const f = followerEl.value
    f.classList.remove('is-punch'); void f.offsetWidth; f.classList.add('is-punch')
  }
}
function onDblClick(e: MouseEvent): void {
  if (!cfg.value.cursorFxEnabled) return
  boom('fireworks', e.clientX, e.clientY, true)
}

/** 跟随特效的圆点：用真实彩色小球素材 */
function drawFollowDot(size: number): void {
  const d = Math.max(10, size * 0.85)
  blit(iconSprite('planet'), mx, my, d, 1)
  blit(iconSprite('glow-star'), mx, my, d * 0.7, 1)
}

let attached = false
function attach(): void {
  if (attached) return
  attached = true
  document.addEventListener('pointermove', onMove, { passive: true, capture: true })
  document.addEventListener('pointerdown', onDown, { passive: true, capture: true })
  document.addEventListener('dblclick', onDblClick, { capture: true })
  document.addEventListener('pointerout', onLeave, { passive: true, capture: true })
}
function detach(): void {
  if (!attached) return
  attached = false
  document.removeEventListener('pointermove', onMove, { capture: true } as EventListenerOptions)
  document.removeEventListener('pointerdown', onDown, { capture: true } as EventListenerOptions)
  document.removeEventListener('dblclick', onDblClick, { capture: true } as EventListenerOptions)
  document.removeEventListener('pointerout', onLeave, { capture: true } as EventListenerOptions)
}

// ==================== 尺寸（ResizeObserver 驱动：容器/窗口变化都跟上） ====================
let ro: ResizeObserver | null = null
function resize(): void {
  const cv = canvasEl.value
  if (!cv || !ctx2d) return
  dpr = Math.min(2, window.devicePixelRatio || 1)
  const w = Math.max(1, window.innerWidth), h = Math.max(1, window.innerHeight)
  cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr)
  cv.style.width = w + 'px'; cv.style.height = h + 'px'
  ctx2d.setTransform(dpr, 0, 0, dpr, 0, 0)
  moveFollower()
}
function onWinResize(): void { resize() }

// ==================== 生效 ====================
function applyAll(): void { applyCursorSkin(); paintFollower(); moveFollower() }
watch(cfg, applyAll, { deep: true })

// 设置页上传/删除自定义素材后广播事件 → 重读并重画（立即生效）
function onCustomChanged(): void { customCursors = loadCustomCursors(); applyAll() }
window.addEventListener(CUSTOM_CHANGED_EVENT, onCustomChanged)

function ensureInit(): void {
  const cv = canvasEl.value
  if (!cv) return
  if (!ctx2d) ctx2d = cv.getContext('2d')
  resize()
  attach()
  applyAll()
  if (!raf) { lastT = 0; raf = requestAnimationFrame(frame) }
}
watch([canvasEl, rootEl], () => ensureInit(), { immediate: true, flush: 'post' })
window.addEventListener('resize', onWinResize)

onBeforeUnmount(() => {
  cancelAnimationFrame(raf)
  stopFrameLoop()
  window.removeEventListener('resize', onWinResize)
  window.removeEventListener(CUSTOM_CHANGED_EVENT, onCustomChanged)
  settingsOff?.dispose()
  detach()
  if (ro) { ro.disconnect(); ro = null }
  const html = document.documentElement
  html.classList.remove(HIDE_CLASS)
  html.style.removeProperty('--mc-cursor')
  parts.length = 0; rings.length = 0; dots.length = 0; ghosts.length = 0; bubbles.length = 0; ants.length = 0
})
</script>

<template>
  <!-- 搬到 body：脱离画布容器的裁剪与层叠，光标才能覆盖整个页面、并压在所有浮层（下拉/弹窗）之上 -->
  <Teleport to="body">
    <div ref="rootEl" class="ce-root" aria-hidden="true">
      <canvas ref="canvasEl" class="ce-canvas"></canvas>
      <div ref="followerEl" class="ce-follower">
        <div class="ce-hover"><div class="ce-press"><div ref="offsetEl" class="ce-offset">
          <div ref="innerEl" class="ce-inner"></div>
          <img ref="frameEl" class="ce-frame" alt="" style="display:none"
            @error="($event.target as HTMLImageElement).style.visibility = 'hidden'"
            @load="($event.target as HTMLImageElement).style.visibility = 'visible'" />
        </div></div></div>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
.ce-root { position: fixed; inset: 0; z-index: 2147483000; pointer-events: none; overflow: hidden; }
.ce-canvas { position: absolute; inset: 0; pointer-events: none; }
.ce-follower {
  position: absolute; left: 0; top: 0; width: 0; height: 0; z-index: 3; pointer-events: none;
  will-change: transform; transition: opacity 0.12s ease;
}
.ce-hover { transform-origin: center; transition: transform 0.16s cubic-bezier(0.34, 1.4, 0.64, 1); }
.ce-follower.is-hot .ce-hover { transform: scale(1.16); }
.ce-press { transform-origin: center; }
.ce-follower.is-punch .ce-press { animation: ce-punch 0.28s ease-out; }
@keyframes ce-punch { 0% { transform: scale(0.8) } 60% { transform: scale(1.04) } 100% { transform: none } }
.ce-inner {
  /* 主题色白名单: 贴图白色 + 投影黑色，保证任意背景下可读，与主题无关 */
  position: absolute; color: #fff; transform-origin: center;
  /* 主题色白名单: 投影黑色保证可读性 */
  filter: drop-shadow(0 1px 2px rgba(0, 0, 0, 0.65)) drop-shadow(0 0 1px rgba(0, 0, 0, 0.9));
}
.ce-offset { position: absolute; left: 0; top: 0; }
.ce-frame {
  position: absolute; left: 0; top: 0; display: block; pointer-events: none;
  /* 主题色白名单: 投影用黑色保证任意背景可读 */
  image-rendering: auto; filter: drop-shadow(0 1px 2px rgba(0, 0, 0, 0.55));
}
.ce-inner svg { display: block; }
/* 主题色白名单: 热点高亮已用 var(--ui-accent)，第二个投影是黑色可读性阴影 */
.ce-follower.is-hot .ce-inner { filter: drop-shadow(0 0 6px var(--ui-accent, #0891b2)) drop-shadow(0 1px 2px rgba(0, 0, 0, 0.55)); }
.ce-inner.pulse { animation: ce-pulse 1.4s ease-in-out infinite; }
.ce-inner.spin { animation: ce-spin 2.6s linear infinite; }
@keyframes ce-pulse { 0%, 100% { transform: scale(0.86); opacity: 0.8 } 50% { transform: scale(1.12); opacity: 1 } }
@keyframes ce-spin { to { transform: rotate(360deg) } }
@media (prefers-reduced-motion: reduce) { .ce-inner, .ce-hover { animation: none !important } }
</style>

<style>
/* 非 scoped：把**整个 document** 的原生光标换成透明图。挂在 <html> 上，所以画布/设置面板/下拉/弹窗里都生效 */
html.mc-cursor-hidden, html.mc-cursor-hidden * { cursor: var(--mc-cursor, none) !important; }
</style>

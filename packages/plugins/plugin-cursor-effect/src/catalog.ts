/**
 * catalog —— 光标特效插件的**单一事实源**：光标/跟随特效/点击特效清单 + 内核 Config schema。
 *
 * **素材策略（本地文件，不联网）**：本目录下的真实 SVG 全部由 script 从 Iconify 批量下载到
 *   - `icons.ts`        —— 单色线框图标（Lucide / Solar / Phosphor / MingCute / Tabler，MIT 或 Apache）；
 *   - `colorAssets.ts`  —— **真实彩色**图标（Noto Emoji，Apache-2.0）。
 * 运行时不联网：素材是打包进插件的字符串常量。光标/粒子里凡"该有颜色"的一律用 colorAssets（不再是代码画的方块）。
 *
 * Config 说明（内核 P4 约定，见 docs/plugin-dev/05-config.md）：
 * - 键名全局平面命名，跨插件不能重名 → 全部加 cursorFx 前缀；
 * - 分组用一个**扁平分组** `光标`：设置面板把它当一个一级页渲染，整页由本插件自绘。
 */
import type { ConfigSchema, InferConfig } from '@mini-canvas/canvas-base'

/** 设置页一级导航名（= Config 的扁平分组名，也是 settingsGroup/<此名> 的槽键） */
export const CURSOR_NAV_ID = '光标'

// ==================== 光标指针 ====================
export type CursorKind = 'dom' | 'native' | 'img'
/** 素材来源：mono = 单色线框（可染成白/黑）；color = 真实彩色素材（自带颜色） */
export type CursorSrc = 'mono' | 'color'

export interface CursorItem {
  id: string
  name: string
  kind: CursorKind
  /** 素材键：src=mono 查 icons.ts；src=color 查 colorAssets.ts */
  icon: string
  src: CursorSrc
  /** 热点占图标边长的比例（0~1）：指针尖落在哪 */
  hx: number
  hy: number
  /** kind=native 的 CSS cursor 关键字 */
  native?: string
  /** kind=img 的染色（把 mono 图标染成该色再喂 cursor:url） */
  color?: string
  /** idle 动画类：'' | 'pulse' | 'spin' */
  anim?: string
}

/** 指针类（单色、像真鼠标指针；白填充 + 描边，任何底色都看得清） */
export const CURSORS_POINTER: CursorItem[] = [
  { id: 'arrow', name: '箭头', kind: 'dom', icon: 'pointer-arrow', src: 'mono', hx: .12, hy: .06 },
  { id: 'triangle', name: '三角', kind: 'dom', icon: 'pointer-triangle', src: 'mono', hx: .14, hy: .06 },
  { id: 'pencil', name: '铅笔', kind: 'dom', icon: 'pointer-arrow-2', src: 'mono', hx: .12, hy: .08 },
  { id: 'hand', name: '手型', kind: 'dom', icon: 'hand-point', src: 'mono', hx: .28, hy: .1 },
  { id: 'click', name: '点击手', kind: 'dom', icon: 'click-tap', src: 'mono', hx: .22, hy: .1 },
  { id: 'crosshair', name: '准星', kind: 'dom', icon: 'crosshair', src: 'mono', hx: .5, hy: .5 },
  { id: 'text', name: '文本', kind: 'dom', icon: 'text-i', src: 'mono', hx: .5, hy: .5 },
  { id: 'move', name: '移动', kind: 'dom', icon: 'move', src: 'mono', hx: .5, hy: .5 },
  { id: 'wait', name: '等待', kind: 'dom', icon: 'wait', src: 'mono', hx: .5, hy: .5, anim: 'spin' },
  { id: 'help', name: '帮助', kind: 'dom', icon: 'help', src: 'mono', hx: .5, hy: .5 },
  { id: 'target', name: '靶心', kind: 'dom', icon: 'target', src: 'mono', hx: .5, hy: .5, anim: 'pulse' },
  { id: 'wand', name: '魔杖', kind: 'dom', icon: 'wand', src: 'mono', hx: .16, hy: .16 },
]

/** 彩色类（真实彩色素材当光标；跟随元素直接显示原色） */
export const CURSORS_COLOR: CursorItem[] = [
  { id: 'c-star', name: '星星', kind: 'dom', icon: 'star', src: 'color', hx: .5, hy: .5 },
  { id: 'c-heart', name: '爱心', kind: 'dom', icon: 'heart', src: 'color', hx: .5, hy: .5, anim: 'pulse' },
  { id: 'c-leaf', name: '落叶', kind: 'dom', icon: 'leaf', src: 'color', hx: .5, hy: .5 },
  { id: 'c-blossom', name: '樱花', kind: 'dom', icon: 'blossom', src: 'color', hx: .5, hy: .5 },
  { id: 'c-sunflower', name: '向日葵', kind: 'dom', icon: 'sunflower', src: 'color', hx: .5, hy: .5 },
  { id: 'c-comet', name: '彗星', kind: 'dom', icon: 'comet', src: 'color', hx: .7, hy: .5, anim: 'spin' },
  { id: 'c-planet', name: '星球', kind: 'dom', icon: 'planet', src: 'color', hx: .5, hy: .5, anim: 'spin' },
  { id: 'c-butterfly', name: '蝴蝶', kind: 'dom', icon: 'butterfly', src: 'color', hx: .5, hy: .5, anim: 'pulse' },
  { id: 'c-cat', name: '猫爪', kind: 'dom', icon: 'paw', src: 'color', hx: .5, hy: .5 },
  { id: 'c-catface', name: '猫脸', kind: 'dom', icon: 'cat', src: 'color', hx: .5, hy: .5 },
  { id: 'c-gem', name: '宝石', kind: 'dom', icon: 'gem', src: 'color', hx: .5, hy: .5 },
  { id: 'c-moon', name: '月亮', kind: 'dom', icon: 'moon', src: 'color', hx: .5, hy: .5 },
  { id: 'c-rainbow', name: '彩虹', kind: 'dom', icon: 'rainbow', src: 'color', hx: .5, hy: .5 },
  { id: 'c-fire', name: '火焰', kind: 'dom', icon: 'fire', src: 'color', hx: .5, hy: .6, anim: 'pulse' },
  { id: 'c-bubble', name: '泡泡', kind: 'dom', icon: 'bubble', src: 'color', hx: .5, hy: .5 },
  { id: 'c-balloon', name: '气球', kind: 'dom', icon: 'balloon', src: 'color', hx: .5, hy: .6 },
  { id: 'c-candy', name: '糖果', kind: 'dom', icon: 'candy', src: 'color', hx: .5, hy: .5 },
  { id: 'c-sparkle', name: '闪光', kind: 'dom', icon: 'sparkles', src: 'color', hx: .5, hy: .5, anim: 'pulse' },
  { id: 'c-music', name: '音符', kind: 'dom', icon: 'music', src: 'color', hx: .5, hy: .5 },
  { id: 'c-dizzy', name: '眩晕', kind: 'dom', icon: 'dizzy', src: 'color', hx: .5, hy: .5, anim: 'spin' },
]

/** 系统类（浏览器内置静态光标） */
export const CURSORS_NATIVE: CursorItem[] = [
  { id: 'sys-default', name: '默认', kind: 'native', icon: 'pointer-arrow', src: 'mono', hx: .12, hy: .06, native: 'default' },
  { id: 'sys-pointer', name: '手型', kind: 'native', icon: 'hand-point', src: 'mono', hx: .28, hy: .1, native: 'pointer' },
  { id: 'sys-crosshair', name: '准星', kind: 'native', icon: 'crosshair', src: 'mono', hx: .5, hy: .5, native: 'crosshair' },
  { id: 'sys-text', name: '文本', kind: 'native', icon: 'text-i', src: 'mono', hx: .5, hy: .5, native: 'text' },
  { id: 'sys-move', name: '移动', kind: 'native', icon: 'move', src: 'mono', hx: .5, hy: .5, native: 'move' },
  { id: 'sys-grab', name: '抓取', kind: 'native', icon: 'hand-point', src: 'mono', hx: .28, hy: .1, native: 'grab' },
  { id: 'sys-wait', name: '等待', kind: 'native', icon: 'wait', src: 'mono', hx: .5, hy: .5, native: 'wait' },
  { id: 'sys-help', name: '帮助', kind: 'native', icon: 'help', src: 'mono', hx: .5, hy: .5, native: 'help' },
]

/** 图片类（把 mono 图标染成指定色，真正喂给 CSS cursor:url —— 演示"图片当光标"，静态） */
export const CURSORS_IMG: CursorItem[] = [
  { id: 'img-white', name: '白箭头', kind: 'img', icon: 'pointer-arrow', src: 'mono', hx: .12, hy: .06, color: '#ffffff' }, // 主题色白名单: 光标贴图用户可选配色变体，非 UI 主题色
  { id: 'img-dark', name: '深箭头', kind: 'img', icon: 'pointer-arrow', src: 'mono', hx: .12, hy: .06, color: '#111827' }, // 主题色白名单: 同上
  { id: 'img-cyan', name: '青圆点', kind: 'img', icon: 'circle', src: 'mono', hx: .5, hy: .5, color: '#22d3ee' }, // 主题色白名单: 同上
  { id: 'img-pink', name: '粉星星', kind: 'img', icon: 'star', src: 'mono', hx: .5, hy: .5, color: '#f472b6' }, // 主题色白名单: 同上
]

export const CURSORS: CursorItem[] = [...CURSORS_POINTER, ...CURSORS_COLOR, ...CURSORS_NATIVE, ...CURSORS_IMG]

/** 自定义上传的哨兵 id（Config 的 select 需要一个合法值；真实自定义 id 由设置页直接写进 cursorFxCursor） */
export const CUSTOM_CURSOR_ID = '__custom__'

/** 光标分类页签 */
export const CURSOR_GROUPS: Array<{ key: string; label: string; items: CursorItem[] }> = [
  { key: 'pointer', label: '指针', items: CURSORS_POINTER },
  { key: 'color', label: '彩色', items: CURSORS_COLOR },
  { key: 'native', label: '系统', items: CURSORS_NATIVE },
  { key: 'img', label: '图片', items: CURSORS_IMG },
]

// ==================== 跟随特效（会动的光标） ====================
export type FollowId =
  | 'none' | 'dot' | 'rainbow' | 'fairy' | 'sparkle' | 'snow' | 'leaves'
  | 'hearts' | 'music' | 'bubble' | 'ghost' | 'moon' | 'butterfly' | 'ants'

export interface FollowItem {
  id: FollowId
  name: string
  /** 设置页缩略图（mono 键或 color 键） */
  icon: string
  src: CursorSrc
}

export const FOLLOWS: FollowItem[] = [
  { id: 'none', name: '无', icon: 'circle', src: 'mono' },
  { id: 'dot', name: '跟随圆点', icon: 'circle', src: 'mono' },
  { id: 'rainbow', name: '彩虹拖尾', icon: 'rainbow', src: 'color' },
  { id: 'fairy', name: '仙女尘', icon: 'sparkles', src: 'color' },
  { id: 'sparkle', name: '星光', icon: 'glow-star', src: 'color' },
  { id: 'leaves', name: '落叶', icon: 'leaf', src: 'color' },
  { id: 'hearts', name: '爱心', icon: 'heart', src: 'color' },
  { id: 'snow', name: '雪花', icon: 'snow', src: 'color' },
  { id: 'music', name: '音符', icon: 'music', src: 'color' },
  { id: 'butterfly', name: '蝴蝶', icon: 'butterfly', src: 'color' },
  { id: 'bubble', name: '气泡', icon: 'bubble', src: 'color' },
  { id: 'moon', name: '月光', icon: 'moon', src: 'color' },
  { id: 'ghost', name: '幽灵拖尾', icon: 'cloud', src: 'mono' },
  { id: 'ants', name: '猫爪队列', icon: 'paw', src: 'color' },
]

// ==================== 点击特效 ====================
export type EffectId = 'none' | 'fireworks' | 'sparkle' | 'ripple' | 'confetti' | 'hearts' | 'flowers' | 'snowburst' | 'shockwave' | 'music'

export interface EffectItem {
  id: EffectId
  name: string
  icon: string
  src: CursorSrc
}

export const EFFECTS: EffectItem[] = [
  { id: 'fireworks', name: '烟花', icon: 'sparkles', src: 'color' },
  { id: 'sparkle', name: '星芒', icon: 'glow-star', src: 'color' },
  { id: 'confetti', name: '彩纸', icon: 'confetti', src: 'color' },
  { id: 'hearts', name: '爱心', icon: 'heart', src: 'color' },
  { id: 'flowers', name: '花瓣', icon: 'blossom', src: 'color' },
  { id: 'snowburst', name: '雪爆', icon: 'snow', src: 'color' },
  { id: 'music', name: '音符', icon: 'music', src: 'color' },
  { id: 'ripple', name: '涟漪', icon: 'circle', src: 'mono' },
  { id: 'shockwave', name: '冲击波', icon: 'bolt', src: 'mono' },
  { id: 'none', name: '无', icon: 'circle', src: 'mono' },
]

// ==================== Config（内核 schema；设置页以它为唯一默认来源） ====================
export const Config = {
  cursorFxEnabled: {
    type: 'boolean', default: true, label: '启用光标特效', group: CURSOR_NAV_ID,
    description: '总开关。关闭 = 完全不动画布光标（用回系统指针、不画任何特效）。',
  },
  cursorFxCursor: {
    type: 'select', default: 'arrow', label: '光标指针', group: CURSOR_NAV_ID,
    options: [...CURSORS.map((c) => ({ value: c.id, label: c.name })), { value: CUSTOM_CURSOR_ID, label: '自定义上传' }],
    description: '指针本身。指针款是单色真鼠标形状；彩色款是真实彩色素材；系统款是浏览器内置光标；图片款是 CSS 图片光标。',
  },
  cursorFxCustomId: {
    type: 'string', default: '', label: '自定义光标', group: CURSOR_NAV_ID,
    description: '当前选中的自定义素材 id（在本页「自定义」里上传图片/SVG 或帧序列后选它）。',
  },
  cursorFxCustomFps: {
    type: 'number', default: 12, min: 2, max: 30, step: 1, label: '新上传帧率默认值', group: CURSOR_NAV_ID,
    description: '新上传的帧序列默认用这个速率（张/秒）。传完之后可在该条目上单独调它的帧率。',
  },
  cursorFxFollow: {
    type: 'select', default: 'rainbow', label: '跟随特效', group: CURSOR_NAV_ID,
    options: FOLLOWS.map((f) => ({ value: f.id, label: f.name })),
    description: '鼠标划过时的拖尾动画——这才是"会动的光标"。',
  },
  cursorFxEffect: {
    type: 'select', default: 'fireworks', label: '点击特效', group: CURSOR_NAV_ID,
    options: EFFECTS.map((e) => ({ value: e.id, label: e.name })),
    description: '点击画布时炸开的粒子。',
  },
  cursorFxSize: { type: 'number', default: 30, min: 14, max: 96, step: 1, label: '指针大小', group: CURSOR_NAV_ID },
  cursorFxTrailSize: { type: 'number', default: 22, min: 8, max: 64, step: 1, label: '特效大小', group: CURSOR_NAV_ID },
  cursorFxPower: { type: 'number', default: 90, min: 20, max: 200, step: 5, label: '特效强度', group: CURSOR_NAV_ID },
  cursorFxParticleCap: {
    type: 'number', default: 600, min: 200, max: 1600, step: 100, label: '粒子上限', group: CURSOR_NAV_ID,
    description: '护帧率：场上粒子超过这个数就丢弃最老的。',
  },
  cursorFxHoverScale: { type: 'boolean', default: true, label: '悬停放大', group: CURSOR_NAV_ID },
  cursorFxClickPunch: { type: 'boolean', default: true, label: '点击回弹', group: CURSOR_NAV_ID },
} satisfies ConfigSchema

export type CursorEffectConfig = InferConfig<typeof Config>

export interface SettingsLike {
  get(key: string): unknown
  onChange(cb: (key: string, value: unknown) => void): { dispose(): void }
}

export const DEFAULTS: CursorEffectConfig = Object.fromEntries(
  Object.entries(Config).map(([k, f]) => [k, f.default]),
) as CursorEffectConfig

export function cursorEffectConfigFrom(ctx: { tryGet<T = unknown>(name: string): T | undefined }): CursorEffectConfig {
  const settings = ctx.tryGet<SettingsLike>('settings')
  const read = <T extends string | number | boolean>(key: string, fallback: T): T => {
    if (!settings) return fallback
    const v = settings.get(key)
    return (v === undefined || v === null ? fallback : v) as T
  }
  return {
    cursorFxEnabled: read('cursorFxEnabled', DEFAULTS.cursorFxEnabled),
    cursorFxCursor: read('cursorFxCursor', DEFAULTS.cursorFxCursor),
    cursorFxCustomId: read('cursorFxCustomId', DEFAULTS.cursorFxCustomId),
    cursorFxCustomFps: read('cursorFxCustomFps', DEFAULTS.cursorFxCustomFps),
    cursorFxFollow: read('cursorFxFollow', DEFAULTS.cursorFxFollow),
    cursorFxEffect: read('cursorFxEffect', DEFAULTS.cursorFxEffect),
    cursorFxSize: read('cursorFxSize', DEFAULTS.cursorFxSize),
    cursorFxTrailSize: read('cursorFxTrailSize', DEFAULTS.cursorFxTrailSize),
    cursorFxPower: read('cursorFxPower', DEFAULTS.cursorFxPower),
    cursorFxParticleCap: read('cursorFxParticleCap', DEFAULTS.cursorFxParticleCap),
    cursorFxHoverScale: read('cursorFxHoverScale', DEFAULTS.cursorFxHoverScale),
    cursorFxClickPunch: read('cursorFxClickPunch', DEFAULTS.cursorFxClickPunch),
  }
}

export function cursorById(id: string): CursorItem {
  return CURSORS.find((c) => c.id === id) ?? CURSORS[0]
}
export function isAnimatedCursor(id: string): boolean {
  return cursorById(id).kind === 'dom'
}

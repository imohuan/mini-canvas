/**
 * plugin-style-library —— 前端半：把「本地素材库」（风格库 + 特效库）做成画布里的一个插件。
 *
 * ## 分层（数据与组件 UI 分开，组件可替换）
 *
 * ```
 * src/index.ts            插件入口：注册 UI 目录 + 槽 + 两个服务 + 命令（不 import 具体 UI 语义）
 * src/data/*              数据层（types / api / store）—— 取数 / 分页 / 筛选 / 设置读写
 * src/components/*        默认 UI（可替换）—— 广场 / 卡片 / 详情 / 两个外壳
 * src/server.ts           后台半（打成 dist/server.js，由 cloud-server 跑，两个库共用一套逻辑）
 * ```
 *
 * ## 两套库、一套 UI、一套数据层
 *
 * 用户口径：**风格库与特效库的数据结构、UI 都通用，只是目录不同、点击效果不同**。
 * 所以：
 * - **数据层**：`createLibraryService(kind, …)` 一套逻辑，建两个实例 →
 *   注入成两个服务名 `style-library`（风格）/ `effect-library`（特效）。
 * - **后台**：两个路由前缀 `/api/style-library` / `/api/effect-library`，同一套处理逻辑。
 * - **UI**：广场/卡片**同一件**（按名取）；外壳分两件（标题与点击行为不同）——
 *   风格外壳点卡片开详情；特效外壳点卡片开全屏预览（没有详情页）。
 *
 * ## 可替换性（本插件的设计要点）
 *
 * 所有 UI 件都注册进内核的 **ui 目录**（`registryOf('ui')`），消费方**按名取**：
 *
 * | 名字 | 默认件 | 换法 |
 * | --- | --- | --- |
 * | `styleLibraryOverlay`  | 风格库外壳 | 另注册同名件、order 更小 |
 * | `effectLibraryOverlay` | 特效库外壳 | 同上 |
 * | `styleLibraryGallery`  | 广场（两库共用） | 同上 |
 * | `styleLibraryCard`     | 一张卡（两库共用） | 同上 |
 * | `styleLibraryDetail`   | 详情浮层（只风格库用） | 同上 |
 * | `effectLibraryViewer`  | 特效全屏预览兜底壳 | 同上 |
 *
 * 数据一律经服务（`ctx.get('style-library')` / `ctx.get('effect-library')`）拿，UI 只管画。
 *
 * ## 怎么打开
 *
 * 命令 `style-library:open` / `effect-library:open`；服务也有 `open()/close()/toggle()`。
 */
import { markRaw } from 'vue'
import type { Context, PluginModule, ConfigSchema } from '@mini-canvas/canvas-base'
import {
  createLibraryService,
  DEFAULT_ROOT,
  DEFAULT_EFFECT_ROOT,
  PAGE_SIZE,
} from './data/store'
import StyleLibraryOverlay from './components/StyleLibraryOverlay.vue'
import EffectLibraryOverlay from './components/EffectLibraryOverlay.vue'
import StyleGalleryView from './components/StyleGalleryView.vue'
import StyleCardView from './components/StyleCardView.vue'
import StyleDetailView from './components/StyleDetailView.vue'
import {
  UI_OVERLAY, UI_GALLERY, UI_CARD, UI_DETAIL, UI_EFFECT_OVERLAY,
} from './names'

export const name = 'style-library'
/** 不写死依赖：设置服务 / 云端客户端都做可选探测（缺了也能跑，地址解析回落同源） */
export const inject = [] as string[]

export { UI_OVERLAY, UI_GALLERY, UI_CARD, UI_DETAIL, UI_EFFECT_OVERLAY } from './names'

/** 画布 UI 槽名（宿主 CanvasSurface 的 overlay 槽里按 order 渲染） */
export const OVERLAY_SLOT = 'overlay'

/**
 * 设置项：都挂在**「常规」导航下的「风格库」分组**（不单开一级导航 —— 东西太少）。
 *
 * ⚠️ 分组名必须写成二级形式 `常规/风格库`：面板按 `/` 切分（前段=一级导航，后段=分组标题）。
 * 只写 `常规` 会变成扁平分组，界面上就成了「常规 → 常规」两层同名（实测踩到）。
 *
 * 两个目录项**改完会自动推给后台半**（见 apply 里的订阅）：前后端形态下"目录在哪"是
 * **服务端**要知道的事，光存在前端设置里后台读不到。
 */
export const Config: ConfigSchema = {
  styleLibraryRoot: {
    type: 'string',
    default: DEFAULT_ROOT,
    label: '风格库资源目录',
    group: '常规/风格库',
    description: '磁盘上存放风格素材的目录绝对路径（含 index.json，或直接放图片/视频）。改完自动同步给后台并重扫。',
  },
  effectLibraryRoot: {
    type: 'string',
    default: DEFAULT_EFFECT_ROOT,
    label: '特效库资源目录',
    group: '常规/风格库',
    description: '磁盘上存放特效素材的目录绝对路径（含 index.json；目录里有同名 .mp4 时，全屏预览会放视频）。改完自动同步给后台并重扫。',
  },
  styleLibraryPageSize: {
    type: 'number',
    default: PAGE_SIZE,
    min: 12,
    max: 200,
    step: 12,
    label: '每页条数',
    group: '常规/风格库',
    description: '一次加载多少条（滚到底自动加载下一批）；两个库共用这个值。',
  },
}

export interface StyleLibraryConfig {
  styleLibraryRoot?: string
  effectLibraryRoot?: string
  styleLibraryPageSize?: number
}

export function apply(ctx: Context, config?: StyleLibraryConfig): void {
  const pageSize = config?.styleLibraryPageSize ?? PAGE_SIZE

  // —— 两个数据服务（一套逻辑，两个实例；组件只读 state、只调方法）——
  const styleSvc = createLibraryService('style', {
    ctx: ctx as unknown as { tryGet(name: string): unknown },
    defaultRoot: config?.styleLibraryRoot ?? DEFAULT_ROOT,
    pageSize,
  })
  const effectSvc = createLibraryService('effect', {
    ctx: ctx as unknown as { tryGet(name: string): unknown },
    defaultRoot: config?.effectLibraryRoot ?? DEFAULT_EFFECT_ROOT,
    pageSize,
  })
  // 直接注入服务：响应式由 data 层自己的 reactive(state) 负责（见 store.ts 说明）。
  ctx.inject('style-library', styleSvc)
  ctx.inject('effect-library', effectSvc)

  // —— 默认 UI 件登记进 ui 目录（按名取；默认件 order 0，换皮给更小的 order）——
  const ui = ctx.registryOf<unknown>('ui')
  ui.add(UI_OVERLAY, markRaw(StyleLibraryOverlay), { id: 'default', order: 0 })
  ui.add(UI_EFFECT_OVERLAY, markRaw(EffectLibraryOverlay), { id: 'default', order: 0 })
  ui.add(UI_GALLERY, markRaw(StyleGalleryView), { id: 'default', order: 0 })
  ui.add(UI_CARD, markRaw(StyleCardView), { id: 'default', order: 0 })
  ui.add(UI_DETAIL, markRaw(StyleDetailView), { id: 'default', order: 0 })

  // —— 两个外壳挂到画布 overlay 槽（各自按服务 state.open 判显隐）——
  ctx.slots.register(OVERLAY_SLOT, {
    id: 'style-library/overlay',
    order: 46,
    component: markRaw(StyleLibraryOverlay),
    meta: { title: '风格库' },
  })
  ctx.slots.register(OVERLAY_SLOT, {
    id: 'effect-library/overlay',
    order: 47,
    component: markRaw(EffectLibraryOverlay),
    meta: { title: '特效库' },
  })

  // —— 命令：开合两个库（宿主统一分发键位；素材库菜单项执行它们）——
  ctx.commands.register({
    id: 'style-library:open',
    title: '打开风格库',
    order: 46,
    run: () => (styleSvc.state.open ? styleSvc.close() : styleSvc.open()),
  })
  ctx.commands.register({
    id: 'effect-library:open',
    title: '打开特效库',
    order: 47,
    run: () => (effectSvc.state.open ? effectSvc.close() : effectSvc.open()),
  })

  // —— 设置项一改 → 立即生效 ——
  // 「资源目录」：推给后台并重扫（两个库各自的目录）。「每页条数」：重置分页重拉首屏。
  //
  // ⚠️ 必须用**能力段** ctx.settings.onChange(scope, cb)。ctx.tryGet('settings') 拿的是**原始**
  //    SettingsStore，它的签名是 onChange(cb, opts) —— 两者参数顺序相反，传错会静默失效（实测）。
  if (typeof ctx.settings?.onChange === 'function') {
    const off = ctx.settings.onChange(name, (key, value) => {
      if (key === 'styleLibraryRoot') {
        if (typeof value !== 'string' || !value.trim()) return
        void styleSvc.saveRoot(value.trim()).catch(() => { /* 后台不可达：静默，下次改会再同步 */ })
      } else if (key === 'effectLibraryRoot') {
        if (typeof value !== 'string' || !value.trim()) return
        void effectSvc.saveRoot(value.trim()).catch(() => { /* 同上 */ })
      } else if (key === 'styleLibraryPageSize') {
        if (typeof value !== 'number') return
        void styleSvc.setPageSize(value)
        void effectSvc.setPageSize(value)
      }
    })
    ctx.effect(() => () => off.dispose())
  }
}

export const styleLibraryPlugin: PluginModule = { name, inject, Config, apply }

export type { StyleCard, StyleMeta, StylePage, StyleSort } from './data/types'
export { createLibraryService, createStyleLibraryService, PAGE_SIZE, DEFAULT_ROOT, DEFAULT_EFFECT_ROOT } from './data/store'
export type { LibraryKind } from './data/api'
export { StyleLibraryOverlay, EffectLibraryOverlay, StyleGalleryView, StyleCardView, StyleDetailView }

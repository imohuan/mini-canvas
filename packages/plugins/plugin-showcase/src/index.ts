/**
 * plugin-showcase —— 前端半：在线测试台 + 在线文档 二合一面板。
 *
 * 面板布局（附录 B）：五区块 ——
 * ① 前端自测（三盏灯）② 后台名片（meta）③ 在线测试台（endpoints 索引驱动）
 * ④ 在线注册演示（slots 注册场的实时增删）⑤ 生命周期说明。
 *
 * 铁律：**不写死任何端点** —— 分组与端点全部来自 GET /api/showcase/endpoints。
 */
import { markRaw } from 'vue'
import type { Context, PluginModule } from '@mini-canvas/canvas-base'
import type { ConfigSchema } from '@mini-canvas/kernel'
import ShowcaseNav from './components/ShowcaseNav.vue'
import ShowcasePage from './components/ShowcasePage.vue'

export const name = 'showcase'
export const inject = [] as string[]

/** 面板 API 基址：与画布同源（cloud-server 托管界面时天然同源） */
export const API_BASE = ''

/**
 * 设置页的一级导航 id **必须同名于一个 Config 分组**，否则右侧内容区为空
 * （主题皮的 sections 从 settings.groups() 推导；只注册 settingsNav 不产生分组）。
 * 所以这里声明一个"占位分组"，面板正文仍由 settingsGroup/showcase-page 整组接管。
 */
export const Config: ConfigSchema = {
  showcasePanelHint: { type: 'string', default: '', label: '展示面板', group: '插件展示' },
}

/** 导航 id 必须 === Config 的分组名（见上） */
const NAV_ID = '插件展示'

export function apply(ctx: Context): void {
  // 设置面板：左导航「插件展示」项 + 整页正文（自绘，与光标特效插件同机制）
  ctx.slots.register('settingsNav', {
    id: NAV_ID,
    order: 8,
    component: markRaw(ShowcaseNav),
    meta: { title: '插件展示' },
  })
  ctx.slots.register('settingsGroup/' + NAV_ID, {
    id: 'showcase-page',
    order: 8,
    component: markRaw(ShowcasePage),
    meta: { mode: 'replace' },
  })
}

export const showcasePlugin: PluginModule = { name, inject, Config, apply }

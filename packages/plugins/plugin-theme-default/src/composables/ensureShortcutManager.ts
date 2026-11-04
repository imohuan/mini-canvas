/**
 * 设置页「快捷键」面板要用的管理器：从宿主命令表现建一套。
 *
 * 成品应用不冷启动 plugin-shortcut-manager（命令分发与底部帮助浮层由外壳自带），
 * 因此不能只靠那个插件 apply() 里的 setShortcutManager —— 否则设置页里的
 * RemapPanel / 导入导出拿到的是 undefined，页面能画但所有按钮都没反应。
 *
 * 命令表从 ctx 取（设置面板本身不在画布渲染子树里，所以由调用方把 ctx 传进来）。
 * 拿不到就返回 undefined：面板照常渲染，只是按钮暂无反应（与没装管理器时同款降级）。
 */
import {
  createShortcutRemapEngine,
  createV2ShortcutManager,
  installShortcutManager,
  type V2ShortcutManager,
} from '@mini-canvas/plugin-shortcut-manager'
import type {
  RemapSaveService,
  RemapableCommandRegistry,
} from '@mini-canvas/plugin-shortcut-manager/shortcutRemapEngine.ts'
import type { V2CommandSource } from '@mini-canvas/plugin-shortcut-manager/v2ShortcutManager.ts'

/** 只需两个服务：命令表 + 存档（存档缺失时重映射不落盘，其余照常） */
export interface ShortcutHostCtx {
  tryGet?<T>(name: string): T | undefined
}

let manager: V2ShortcutManager | undefined
let remapEngine: ReturnType<typeof createShortcutRemapEngine> | undefined

/** 已建过就复用：设置页多次进出不该重复恢复键位。 */
export function ensureShortcutManager(ctx: ShortcutHostCtx | undefined): V2ShortcutManager | undefined {
  if (manager) return manager
  if (!ctx) return undefined
  const command = ctx.tryGet?.<RemapableCommandRegistry & V2CommandSource>(NAME_COMMAND)
  if (!command) return undefined
  const save = ctx.tryGet?.<RemapSaveService>(NAME_SAVE)
  remapEngine = createShortcutRemapEngine(command, save)
  void remapEngine.restore()
  manager = createV2ShortcutManager(command, {
    remap: (id, keys) => remapEngine!.remap(id, keys),
    reset: (id) => remapEngine!.reset(id),
    snapshot: () => remapEngine!.snapshot(),
  })
  installShortcutManager(manager)
  return manager
}

const NAME_COMMAND = 'command'
const NAME_SAVE = 'save'

/** 设置面板把宿主 ctx 下发给自绘页（快捷键配置页要用命令表） */
export const SETTINGS_SHORTCUT_HOST = 'miniCanvasSettingsHostCtx'

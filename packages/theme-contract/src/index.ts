/**
 * @mini-canvas/theme-contract —— 主题的**纯数据 / 纯函数**契约层。
 *
 * 为什么单独成包：默认主题拆成 plugin-theme-components（通用组件）与
 * plugin-theme-canvas（画布外观）两个互不 import 的插件包，但两边都要用同一份
 * 「配置键 → 默认值」表、同一套外观桥接变量、同一张设置导航图标表。放进任何一边，
 * 另一边就得反过来 import 它；复制两份则会漂移（同一设置键出现两个真相）。
 * 所以这些**不带 .vue、不带 DOM** 的东西统一住在这里。
 *
 * 约束：本包只导出纯 TS（类型、常量表、纯函数），不 import 任何 .vue，
 * 也不认识插件的 apply。依赖只有 canvas-base（类型）+ 组件库（选项表/桥接）。
 * 这样它不会把 canvas-render 拉进依赖链，避免插件包之间再长出新的环。
 */
export * from "./themeDefaults";
export { AppearanceConfig } from "./appearanceConfig";
export { CanvasConfig } from "./canvasConfig";
export * from "./themeBridge";
export * from "./multiRadio";
export * from "./navIcon";
export * from "./edgeGeometry";
export * from "./nodeLoadingTier";
export { createNotifyService } from "./notifyService";

import type { ConfigSchema } from "@mini-canvas/canvas-base";
import { AppearanceConfig } from "./appearanceConfig";
import { CanvasConfig } from "./canvasConfig";

/**
 * 两个插件 Config 的并集：同一个键两份表里只能出现一次。
 *
 * 为什么需要它：canvas-render 与宿主只认"全局一张设置表"，键名先声明者独占。
 * 拆包后如果把两边的 schema 合起来用（例如工作台预览、旧存档迁移），
 * 必须确保没有重复声明 —— 重复会在内核里被静默跳过，表现为"某一项设置点了不动"。
 */
export const Config: ConfigSchema = { ...CanvasConfig, ...AppearanceConfig };

/**
 * 断言两份 schema 的键集合互不相交（测试用，也是给读者的说明）。
 * 返回重复的键；正常情况下应为空数组。
 */
export function findDuplicateConfigKeys(): string[] {
  const canvasKeys = new Set(Object.keys(CanvasConfig));
  return Object.keys(AppearanceConfig).filter((key) => canvasKeys.has(key));
}

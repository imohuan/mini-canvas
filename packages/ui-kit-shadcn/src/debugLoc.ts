/**
 * 组件库使用标记：读取 Vite 开发期写进模板的定位属性。
 *
 * 生产构建没有这些属性；关闭调试开关时调试层根本不会挂载。
 */

/** 使用点属性：`相对路径:行号:列号` */
export const UI_KIT_DEBUG_ATTR = 'data-ui-kit-debug'
/** 组件名属性（模板里的本地名，如 Button / SelectTrigger） */
export const UI_KIT_DEBUG_COMPONENT_ATTR = 'data-ui-kit-component'

/** 可读的定位信息 */
export interface UiKitUsageLoc {
  /** 组件名（模板里写的本地名） */
  component: string
  /** 相对仓库根的路径 + 行号 + 列号 */
  file: string
  line: number
  column: number
}

/** 解析属性值；不是本套标记时返回 null */
export function parseDebugLoc(
  loc: string | undefined,
  component: string | undefined,
): UiKitUsageLoc | null {
  if (!loc) return null
  const match = /^(.*?):(\d+):(\d+)$/.exec(loc)
  if (!match) return null
  return {
    component: component || '未知组件',
    file: match[1] ?? loc,
    line: Number(match[2]),
    column: Number(match[3]),
  }
}

/** 从元素读标记 */
export function usageLocOf(el: Element): UiKitUsageLoc | null {
  return parseDebugLoc(
    el.getAttribute(UI_KIT_DEBUG_ATTR) ?? undefined,
    el.getAttribute(UI_KIT_DEBUG_COMPONENT_ATTR) ?? undefined,
  )
}

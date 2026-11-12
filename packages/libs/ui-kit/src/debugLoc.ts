/**
 * 组件库使用标记：读取 Vite 开发期写进模板的定位属性。
 *
 * 生产构建没有这些属性；关闭调试开关时调试层根本不会挂载。
 */
import { defineComponent, h, type Component } from 'vue'

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
  // 只给文件、不给行列也认（按名登记的组件没有"模板使用点"，只有登记文件）。
  // 但必须长得像路径：`<html data-ui-kit-debug="on">` 这种开关值不能被当成使用点。
  if (!match) {
    if (!/[\\/]|\.(vue|tsx?|jsx?)$/.test(loc)) return null
    return { component: component || '未知组件', file: loc, line: 0, column: 0 }
  }
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

/**
 * 给「按名字登记进 ui 目录」的组件包一层透明的调试标记。
 *
 * 为什么需要它：模板里直接写 `<Button />` 时，Vite 开发期插件能把真实使用点
 * 写进标签；但 `<component :is="按名取到的组件" />` 编译期看不到最终是谁，
 * 拿不到使用点。默认主题把 shadcn 原始组件登记进 `registryOf('ui')`，
 * 就在这里补上「来自哪个登记项」的标记。
 *
 * 这一层是**完全透明**的：attrs（含 class / onXxx）、slots（含作用域插槽）、
 * props 原样转发，不新增 DOM、不改事件，和直接使用原组件等价。
 *
 * @param component 原始组件
 * @param loc 登记点（`文件:行:列`；解析规则与模板注入一致）
 * @param name 气泡里显示的名字（用原组件名，如 `Button`）
 */
export function withUiKitDebugMark(
  component: Component,
  loc: string,
  name: string,
): Component {
  return defineComponent({
    name: `UiKitDebugMark(${name})`,
    inheritAttrs: false,
    setup(_, { attrs, slots }) {
      return () =>
        h(
          component,
          {
            ...attrs,
            [UI_KIT_DEBUG_ATTR]: loc,
            [UI_KIT_DEBUG_COMPONENT_ATTR]: name,
          },
          slots,
        )
    },
  })
}

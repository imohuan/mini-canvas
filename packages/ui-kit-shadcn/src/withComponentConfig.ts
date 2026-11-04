/**
 * 组件配置薄层：把全局默认值注入到**声明了 `size` prop** 的组件上。
 *
 * 为什么用薄层而不是改组件：
 * - 调用点有几百处，逐个传 size 改不完；
 * - 组件自己的 size 词表不统一（Button 8 档、Select 2 档、Input 根本没有），
 *   在组件内部统一会造出第二套尺寸体系。
 * 薄层只在“按名从 ui 目录取件”这条路上做一次默认值补全，组件内部一行不改。
 *
 * 规则：
 * - 组件没声明 `size` → **原样返回**，多包一层都不包（输入框、卡片这类不该被影响）；
 * - 调用点显式传了 `size` → 用它；
 * - 没传 → 用 `componentConfig.size`。
 *
 * 薄层是透明的：attrs / slots / 事件原样透传，不新增 DOM。
 */
import { defineComponent, h, type Component } from 'vue'
import { componentConfig, type ComponentSize } from './componentConfig'

/**
 * 各组件的 size 词表（**唯一真源在这里**，不要在组件里再抄一份）。
 *
 * 为什么必须有这张表（2026-11-04 实测踩到）：全局档位是 sm / default / lg 三档，
 * 但不少组件只声明了其中两档（Switch、SelectTrigger 只有 sm/default；Card 只有 default/sm）。
 * 直接把 `lg` 注入进去，组件里 `data-[size=default]:h-5 data-[size=sm]:h-4` 一条都不命中，
 * 开关就**塌成一个点**，看起来像坏了。
 *
 * 这里的约定：
 * - 表里写了组件 → 只允许表里的档；不支持的档回落到组件自己的默认档；
 * - 表里没写组件 → 认为它支持全部三档（Button / Input 这类）。
 */
const SUPPORTED_SIZES: Record<string, readonly string[]> = {
  Switch: ['sm', 'default', 'lg'],
  SelectTrigger: ['sm', 'default', 'lg'],
  Card: ['sm', 'default'],
  AlertDialogContent: ['sm', 'default'],
  InputGroupButton: ['xs', 'sm', 'icon-xs', 'icon-sm'],
}

/** 组件能显示的档位：表里没登记就当作三档全支持。 */
export function supportedSizes(name: string): readonly string[] {
  return SUPPORTED_SIZES[name] ?? ['sm', 'default', 'lg']
}

/**
 * 把全局档位收敛成组件真的支持的档位。
 *
 * 例：全局 `lg` + Card（只支持 sm/default）→ `default`。
 * 不做这一步，组件会因为「有 data-size 属性但没有任何匹配规则」而塌掉。
 */
export function resolveSizeFor(component: string, wanted: ComponentSize): string {
  const allowed = supportedSizes(component)
  if (allowed.includes(wanted)) return wanted
  // 回落到该组件自己的默认档（大多数是 default；InputGroupButton 是 xs）
  return allowed.includes('default') ? 'default' : allowed[0]!
}

/** 组件是否声明了 `size` prop（props 可能是数组或对象两种写法） */
export function declaresSizeProp(component: Component): boolean {
  const props = (component as { props?: unknown }).props
  if (Array.isArray(props)) return props.includes('size')
  if (props && typeof props === 'object') return Object.keys(props).includes('size')
  return false
}

/**
 * 包一层“默认 size 注入”。
 *
 * 只对声明了 size 的组件生效；其余组件原样返回，保证不会凭空多一层包装。
 */
export function withComponentConfig(component: Component, name = ''): Component {
  if (!declaresSizeProp(component)) return component

  return defineComponent({
    name: `ComponentConfig(${name})`,
    inheritAttrs: false,
    setup(_, { attrs, slots }) {
      return () => {
        const explicit = (attrs as { size?: unknown }).size
        return h(
          component,
          {
            ...attrs,
            // 调用点优先；没写时用全局默认档
            // 没写时先按组件词表收敛，避免注入了组件不认识的档位而塌掉
            size:
              explicit ??
              (name ? resolveSizeFor(name, componentConfig.size) : componentConfig.size),
          },
          slots,
        )
      }
    },
  })
}

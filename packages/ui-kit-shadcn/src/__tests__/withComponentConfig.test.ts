/**
 * 注册薄层契约：只给**声明了 size prop** 的组件注入默认档，其余组件原样不动。
 *
 * 这层是「全局尺寸设置」与几百处调用点之间的唯一接缝：
 * 组件内部不写一行、调用点不改一处，靠它补默认值。
 */
import { describe, expect, it, beforeEach } from 'vitest'
import { h, defineComponent } from 'vue'
import { renderToString } from 'vue/server-renderer'
import { readFileSync } from 'node:fs'
import { componentConfig, resetComponentConfig, setComponentConfig } from '../componentConfig'
import {
  declaresSizeProp,
  resolveSizeFor,
  supportedSizes,
  withComponentConfig,
} from '../withComponentConfig'
import { Button } from '../components/ui/button'
import { Input } from '../components/ui/input'

beforeEach(() => resetComponentConfig())

describe('declaresSizeProp', () => {
  it('Button / Select 这类声明了 size 的组件 → true', () => {
    expect(declaresSizeProp(Button)).toBe(true)
  })

  it('Input 没有 size prop → false（薄层必须原样放行）', () => {
    expect(declaresSizeProp(Input)).toBe(false)
  })
})

describe('withComponentConfig', () => {
  it('没有 size prop 的组件原样返回（连包装都不加）', () => {
    expect(withComponentConfig(Input, 'Input')).toBe(Input)
  })

  it('调用点显式传 size 时以调用点为准', async () => {
    setComponentConfig({ size: 'sm' })
    const Probe = defineComponent({
      props: { size: { type: String, default: 'default' } },
      setup: (props) => () => h('div', String(props.size)),
    })
    const Wrapped = withComponentConfig(Probe, 'Probe')
    const html = await renderToString(h(Wrapped as never, { size: 'lg' }))
    expect(html).toContain('>lg<')
  })

  it('调用点没传时用全局默认档，且改配置后立刻生效', async () => {
    setComponentConfig({ size: 'sm' })
    const Probe = defineComponent({
      props: { size: { type: String, default: 'default' } },
      setup: (props) => () => h('div', String(props.size)),
    })
    const Wrapped = withComponentConfig(Probe, 'Probe')
    expect(await renderToString(h(Wrapped as never))).toContain('>sm<')
    setComponentConfig({ size: 'lg' })
    expect(await renderToString(h(Wrapped as never))).toContain('>lg<')
  })
})

/**
 * 档位收敛：全局三档 vs 组件自己的词表。
 *
 * 用户口径 2026-11-04：把「控件尺寸」选到「大」，开关**塌成一个点**。
 * 原因是 Switch 只声明了 sm/default，注入 lg 之后组件里没有一条高度规则命中。
 * 这里同时守住三件事：
 * 1. 不支持 lg 的组件会被收敛成 default，而不是塞进去一个不认识的值；
 * 2. 组件表里登记过的组件，词表必须是它真的实现了的；
 * 3. 组件侧确实补上了 lg 的样式（否则收敛回 default 只是掩盖问题）。
 */
describe('size 档位收敛', () => {
  it('SelectTrigger 支持三档；Switch / Card 只到 default', () => {
    // Switch 原组件只有 sm / default 两档，不额外加 lg（用户口径 2026-11-04）
    expect(supportedSizes('Switch')).toEqual(['sm', 'default'])
    expect(supportedSizes('SelectTrigger')).toEqual(['sm', 'default', 'lg'])
    expect(supportedSizes('Card')).toEqual(['sm', 'default'])
  })

  it('全局“大” + 只支持两档的组件 → 收敛成 default（不再注入 lg）', () => {
    expect(resolveSizeFor('Switch', 'lg')).toBe('default')
    expect(resolveSizeFor('Card', 'lg')).toBe('default')
    expect(resolveSizeFor('AlertDialogContent', 'lg')).toBe('default')
  })

  it('未登记的组件原样透传三档', () => {
    expect(resolveSizeFor('Button', 'lg')).toBe('lg')
    expect(resolveSizeFor('Button', 'sm')).toBe('sm')
  })

  it('带家族前缀的名字也能查到表（previewKit 传的是 Switch.Switch）', () => {
    // 之前只按全名查表，`Switch.Switch` 查不到 → 放行 lg → 开关塌成 4×4
    expect(resolveSizeFor('Switch.Switch', 'lg')).toBe('default')
    expect(supportedSizes('Card.Card')).toEqual(['sm', 'default'])
    expect(supportedSizes('SelectTrigger.SelectTrigger')).toEqual(['sm', 'default', 'lg'])
  })

  it('薄层注入时也走收敛：Card 在全局 lg 下拿到 default', async () => {
    setComponentConfig({ size: 'lg' })
    const Probe = defineComponent({
      props: { size: { type: String, default: 'default' } },
      setup: (props) => () => h('div', String(props.size)),
    })
    // 用 Card 这个名字让薄层查表
    const Wrapped = withComponentConfig(Probe, 'Card')
    expect(await renderToString(h(Wrapped as never))).toContain('>default<')
  })

  it('Switch 源码里只有 sm / default 两档，没有自创的 lg', () => {
    const src = readFileSync(
      new URL('../components/ui/switch/Switch.vue', import.meta.url),
      'utf-8',
    )
    expect(src).toMatch(/data-\[size=default\]:h-5/)
    expect(src).toMatch(/data-\[size=sm\]:h-4/)
    // 这两条守住「不要自己加档位」：原组件模板里没有 lg 规则
    expect(src).not.toMatch(/data-\[size=lg\]/)
    expect(src).not.toMatch(/group-data-\[size=lg\]\/switch/)
  })

  it('RadioGroupItem 声明了 size prop 并有三档尺寸', () => {
    const src = readFileSync(
      new URL('../components/ui/radio-group/RadioGroupItem.vue', import.meta.url),
      'utf-8',
    )
    expect(src).toMatch(/size\?:\s*'sm'\s*\|\s*'default'\s*\|\s*'lg'/)
    expect(src).toMatch(/data-\[size=sm\]:size-/)
    expect(src).toMatch(/data-\[size=lg\]:size-/)
  })

  it('Tabs 选中胶囊有亮暗都能看见的底色（不能再写死白色半透明）', () => {
    const src = readFileSync(
      new URL('../components/ui/tabs/TabsList.vue', import.meta.url),
      'utf-8',
    )
    const style = src.slice(src.indexOf('.cn-tabs-capsule'))
    const rule = style.slice(0, style.indexOf('}'))
    expect(rule).toContain('--ui-tab-capsule')
    expect(rule).toMatch(/color-mix\(in oklab, var\(--foreground\)/)
    // 写死白色半透明会让亮色主题下完全看不见
    expect(rule).not.toMatch(/background:\s*rgb\(255 255 255/)
  })
})

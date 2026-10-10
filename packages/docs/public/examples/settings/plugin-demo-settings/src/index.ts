// 文件：packages/docs/public/examples/settings/plugin-demo-settings/src/index.ts
// 格式：TypeScript 模块（插件入口：导出 name / Config / apply）
// 位置：一个可安装插件包的源码入口

import { h, ref } from 'vue'
import { F, type ConfigSchema, type InferConfig, type Context, type PluginModule } from '@mini-canvas/canvas-base'
import DemoHaloOverlay from './DemoHaloOverlay.vue'

export const name = 'demo-settings'

// ① 配置声明：key 加 demo 前缀 —— settings 的 key 是一张全局平铺表，
//    通用名字（如 size）会和别的插件抢号；先声明者独占。
export const Config = {
  demoHaloEnabled: {
    type: 'boolean',
    default: true,
    label: '显示光环',
    group: '配置演示',                 // 设置面板里的一级分组
    description: '关掉它，画布中央的光环立刻消失。',
  },
  demoHaloSize: {
    type: 'number',
    default: 160,
    min: 40,
    max: 640,
    step: 10,
    label: '光环大小',
    group: '配置演示',
    description: '光环的直径（像素）。拖滑块实时变化。',
  },
} satisfies ConfigSchema

/** apply 收到的 config 类型（与 schema 对齐） */
export type DemoSettingsConfig = InferConfig<typeof Config>

export function apply(ctx: Context, config?: DemoSettingsConfig): void {
  // ② 用响应式引用承接"当前的配置值"：初始值来自内核校验后的 config
  const enabled = ref(config?.demoHaloEnabled ?? true)
  const size = ref(config?.demoHaloSize ?? 160)

  // ③ 订阅配置变化。ctx.settings.onChange(scope, cb) 的 scope = 本插件名：
  //    只听"自己声明的配置"的变化，别的插件改自己的不会触发这里。
  ctx.settings.onChange(name, (key, value) => {
    if (key === 'demoHaloEnabled') enabled.value = value === true
    if (key === 'demoHaloSize') size.value = Number(value)
  })

  // ④ 往 overlay 槽挂一个组件，用 render 函数把两个响应式值喂进去。
  //    值一变，Vue 自动重渲染 —— 这就是"窄更新"，不重建整张画布。
  ctx.slots.register('overlay', {
    id: 'demo-halo',
    order: 30,
    component: () => h(DemoHaloOverlay, { enabled: enabled.value, size: size.value }),
    meta: { title: '配置演示光环' },
  })
}

/** 兼容旧装配的 PluginModule 出口 */
export const demoSettingsPlugin: PluginModule = { name, Config, apply }


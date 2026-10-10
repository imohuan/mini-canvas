// 文件：packages/docs/public/examples/kernel/plugin-config-demo/src/index.ts
// 格式：TypeScript 模块（插件入口：导出 name / Config / apply）
// 位置：一个可安装插件包的源码入口
import { F, type ConfigSchema, type InferConfig, type Context, type PluginModule } from '@mini-canvas/kernel'

export const name = 'config-demo'

// ① 配置声明：key 带插件前缀 —— settings 的 key 是全局一张表，通用名（size/enabled）会和别人抢号
export const Config = {
  configDemoEnabled: {
    type: 'boolean',
    default: true,
    label: '启用演示',
    group: '配置演示',              // 设置面板里的一级分组
    description: '关掉它，下面的行为全部静默。',
  },
  configDemoWidth: {
    type: 'number',
    default: 4,
    min: 1,
    max: 12,
    step: 1,                        // 数字类给 step，面板滑块才顺滑
    label: '演示宽度',
    group: '配置演示',
    description: '装配时给越界值会直接让插件进 failed（响亮报错）。',
  },
  configDemoMode: F.select('a', [
    { value: 'a', label: '模式 A' },
    { value: 'b', label: '模式 B' },
  ]),
  // ② array / object 不登记进设置面板，但同样会被校验 + 补默认（结构化配置）
  configDemoTargets: F.array([], F.string('')),
  configDemoLayout: F.object({}, { gap: F.number(8) }),
} satisfies ConfigSchema

/** apply 收到的 config 类型 */
export type ConfigDemoConfig = InferConfig<typeof Config>

/** settings 段的窄接口（演示用：不依赖画布包也能写出类型） */
type SettingsLike = {
  get(key: string): unknown
  onChange(cb: (key: string, value: unknown) => void, opts?: { scope?: string }): { dispose(): void }
}

export function apply(ctx: Context, config: ConfigDemoConfig): void {
  // ③ config 一定完整：没传的字段已补默认、类型已经校验过
  console.log('[config-demo] 生效配置：', config)

  // ④ 订阅自己这份配置的变化。
  //    注意：ctx.settings 是「画布能力层」提供的段 —— 画布插件里直接写
  //    ctx.settings.onChange(name, cb) 就行；这里用 tryGet 探测，
  //    让同一份代码在「纯内核」里也能跑（纯内核没有 settings 段）。
  const settings = ctx.tryGet<SettingsLike>('settings')
  settings?.onChange((key, value) => {
    console.log('[config-demo] 配置变了：', key, '→', value)
  }, { scope: name })

  ctx.on('ctx:ready', () => {
    // ⑤ 从单一数据源读「现在的值」（和 config 快照不同：这里读的是最新值）
    console.log('[config-demo] settings 里的宽度：', settings?.get('configDemoWidth'))
  })
}

export const configDemoPlugin: PluginModule = { name, Config, apply }


/**
 * 插件配置（默认值 + 从 settings 读现值）。
 *
 * key 一律带 cloudClient 前缀：settings 的 key 是**全局平面命名**、先声明者独占，
 * 叫 baseUrl 这种通用名会和别的插件抢同一个键（撞名会被静默跳过）。
 */

/** 本插件可配置项（内核装配时校验 + 补默认 + 登记进设置面板） */
export const Config = {
  cloudClientBaseUrl: {
    type: 'string',
    default: '',
    label: '服务地址',
    group: '常规/云端客户端',
    description: 'cloud-server 的根地址。留空 = 与画布同源（由 cloud-server 托管界面时就是这样）。',
  },
  cloudClientPollMs: {
    type: 'number',
    default: 8000,
    min: 2000,
    max: 60000,
    step: 1000,
    label: '清单兜底轮询 (ms)',
    group: '常规/云端客户端',
    description:
      '后台平台清单多久兜底问一次。正常情况下靠实时通道推送（秒级），轮询只是保底 —— 通道断了也不会永远看不到新平台。',
  },
} as const

export interface CloudClientConfig {
  baseUrl: string
  pollMs: number
}

/** 读一面 settings（缺省 / 未就绪都回落默认值） */
export interface SettingsLike {
  get(key: string): unknown
}

export function configFrom(settings: SettingsLike | undefined): CloudClientConfig {
  const read = <T extends string | number>(key: string, fallback: T): T => {
    const v = settings?.get(key)
    return (v === undefined || v === null || v === '' ? fallback : v) as T
  }
  return {
    baseUrl: read('cloudClientBaseUrl', ''),
    pollMs: read('cloudClientPollMs', 8000),
  }
}

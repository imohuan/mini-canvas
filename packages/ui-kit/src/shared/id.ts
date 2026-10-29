let sequence = 0

/** 生成组件内唯一的 DOM id，SSR 与客户端各自独立，但同一实例稳定。 */
export function useId(prefix: string): string {
  sequence += 1
  return `${prefix}-${sequence}`
}

/**
 * imageRefs —— 读 image 节点「有没有图」的两个来源字段（本插件自己的窄拷贝）。
 *
 * 为什么不 import plugin-node-image 的同名文件：插件之间不互相 import 是硬规则；
 * 这两个字段名（resourceId / imageUrl）是节点数据契约，抄字段名不抄代码。
 */
export interface ImageSourceFields {
  /** 持久资源引用（目标形态） */
  resourceId: string
  /** 显示地址（迁移期兼容字段） */
  legacyUrl: string
}

/** 读节点上的资源引用与旧地址；都不是字符串时给空串 */
export function readImageSourceFields(data: Record<string, unknown> | undefined): ImageSourceFields {
  const resourceId = typeof data?.resourceId === 'string' ? data.resourceId : ''
  const legacyUrl = typeof data?.imageUrl === 'string' ? data.imageUrl : ''
  return { resourceId, legacyUrl }
}

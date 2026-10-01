/**
 * imageRun —— image 写入器复用的「写回」函数（纯逻辑，node 可单测）。
 *
 * 历史说明：本文件原覆盖 runImageGeneration + writeGeneratedImage 两段；
 * runImageGeneration（组装 + 调工具 + 写回全流程）随 ImageGeneratePanel 搬进 plugin-bottom-bar
 * （动作的 run + image 写入器），流程断言由 bottom-bar 的 taskRuntime.test.ts 覆盖。
 * 这里只保留 writeGeneratedImage。
 */
import { cardSizePatch, type ImageFitLimits } from './imageFit'

/** 写回要用到的外部能力（写入器注入真实现，测试注入假实现） */
export interface ImageRunDeps {
  /** 读本节点当前 data（写回时要把其它字段一起带上） */
  readData(nodeId: string): Record<string, unknown> | undefined
  /**
   * 写回节点 data（务必走 graph：可撤销 + 落盘）。
   * @param size 传了就同时写内核正式尺寸字段 node.size —— 必须与 data 同一个 patch，
   *   否则"换成新图 + 调成新尺寸"会记两条撤销记录（一次撤销只退半步）。
   */
  writeData(nodeId: string, data: Record<string, unknown>, size?: { w: number; h: number }): void
  /** 量图片真实像素（拿不到返回 null —— 那就只写地址，不猜尺寸） */
  measure(url: string): Promise<{ width: number; height: number } | null>
  /** 图片预览上限（配置 imageFitMaxWidth/imageFitMaxHeight）；不注入则回落 420×300 */
  fitLimits?(): ImageFitLimits
}

/**
 * 把生成结果写回节点：一次写完（地址 + 尺寸 + 清掉旧描述字段）。
 *
 * 为什么一次写完、且先量尺寸再写：每调一次 graph.updateNode 就记一条撤销记录。
 * 拆成"先写地址、再补尺寸"会让用户按一次撤销只退半步。
 *
 * 旧图的 imageName / imageSize 描述的是被换掉的那张图，必须清掉 —— 否则状态栏显示"新图 + 旧文件名"。
 * 尺寸量不到就一并清空（宁可状态栏不显示，也不显示错的）。
 */
export async function writeGeneratedImage(nodeId: string, url: string, deps: ImageRunDeps, resourceId?: string): Promise<void> {
  const size = await deps.measure(url)
  // 卡片尺寸跟新图一致（等比 + 封顶）；量不到尺寸就没有尺寸补丁，只写地址并清空旧尺寸
  const sizes = cardSizePatch(size?.width, size?.height, deps.fitLimits?.())
  const data: Record<string, unknown> = {
    ...(deps.readData(nodeId) ?? {}),
    imageUrl: url,
    ...(resourceId ? { resourceId } : {}),
    imageName: undefined,
    imageSize: undefined,
    imageWidth: size?.width,
    imageHeight: size?.height,
  }
  deps.writeData(nodeId, data, sizes?.size)
}

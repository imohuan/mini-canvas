/**
 * imageRun —— 点「发送」之后发生的事（纯逻辑，node 可单测）。
 *
 * 流程本身很短：组装输入 → 调工具 → 把结果写进节点。但每一步都有必须守住的规矩：
 * - 调之前先挡掉必然失败的请求（没工具 / 没提示词也没素材）→ 不浪费一次外部调用；
 * - 调之后**只有拿到图片地址才算成功**（"200 但没有产物"必须如实说失败，不能假装成功）；
 * - 写回要一次写完（地址 + 量到的尺寸 + 清掉旧的描述字段），且必须走 graph 唯一写入口
 *   （自动进历史、可撤销、自动落盘）；
 * - 失败文案只交给 UI，**不写进节点 data**（写下去就会落盘、刷新后变成幽灵报错）。
 *
 * 所有外部依赖都从参数注入（工具调用、写回、量尺寸），所以这些规矩能在 node 里直接验，
 * 不用起浏览器。
 */
import type { ToolDef, ToolInput, ToolProgress, ToolResult } from '@mini-canvas/kernel'
import { buildToolInput, type UpstreamMaterial } from './panelSource'
import { cardSizePatch, type ImageFitLimits } from './imageFit'

/** 本流程要用到的外部能力（组件注入真实现，测试注入假实现） */
export interface ImageRunDeps {
  /** 调工具（= ctx.tools.invoke 的薄包装；nodeId 会作为运行上下文透传给外部） */
  invokeTool(
    name: string,
    input: ToolInput,
    options: { nodeId: string; onProgress: (p: ToolProgress) => void },
  ): Promise<ToolResult>
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

/** 一次生成的结果（给 UI 看的那一句话） */
export interface ImageRunResult {
  ok: boolean
  /** 成功时的图片地址 */
  url?: string
  /** 失败时给用户看的文案 */
  error?: string
}

/** 生成前的本地校验（不能调工具的两种情况） */
export interface ImageRunArgs {
  nodeId: string
  prompt: string
  /** 当前选中的工具（可能还没选上） */
  def: ToolDef | undefined
  materials: ReadonlyArray<UpstreamMaterial>
  params: Record<string, unknown>
  onProgress?: (p: ToolProgress) => void
}

/**
 * 执行一次生成并把结果落到节点上。
 * @returns 结果（ok=false 时 error 是**给用户看的文案**，调用方直接显示，不必再包装）
 */
export async function runImageGeneration(args: ImageRunArgs, deps: ImageRunDeps): Promise<ImageRunResult> {
  const { nodeId, def, materials, params } = args
  if (!def) return { ok: false, error: '没有可用的生成工具，请先安装提供图片生成能力的工具插件' }

  const input = buildToolInput(args.prompt, def, materials, params)
  // 空提示词且没连素材：后端必然拒，先在本地说清楚（省一次外部调用，也避免"点了没反应"）
  if (!input.prompt && (input.resources?.length ?? 0) === 0) {
    return { ok: false, error: '请先描述你想要的画面，或连一个素材进来' }
  }

  let result: ToolResult
  try {
    result = await deps.invokeTool(def.name, input, {
      nodeId,
      onProgress: (p) => args.onProgress?.(p),
    })
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : '生成失败，请重试' }
  }

  if (!result.ok) return { ok: false, error: result.error || '生成失败，请重试' }

  const url = result.urls?.[0]
  if (!url) return { ok: false, error: '生成完成了，但没有拿到图片' }

  await writeGeneratedImage(nodeId, url, deps)
  return { ok: true, url }
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
export async function writeGeneratedImage(nodeId: string, url: string, deps: ImageRunDeps): Promise<void> {
  const size = await deps.measure(url)
  // 卡片尺寸跟新图一致（等比 + 封顶）；量不到尺寸就没有尺寸补丁，只写地址并清空旧尺寸
  const sizes = cardSizePatch(size?.width, size?.height, deps.fitLimits?.())
  const data: Record<string, unknown> = {
    ...(deps.readData(nodeId) ?? {}),
    imageUrl: url,
    imageName: undefined,
    imageSize: undefined,
    imageWidth: size?.width,
    imageHeight: size?.height,
    ...(sizes ? { cardWidth: sizes.cardWidth, cardHeight: sizes.cardHeight } : {}),
  }
  deps.writeData(nodeId, data, sizes?.size)
}

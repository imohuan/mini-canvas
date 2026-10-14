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
  /**
   * 把一个**还不属于本画布**的地址收进资源库，返回可写进节点的引用。
   *
   * 覆盖三种：内嵌字节（dataURL / blobURL）、**外部 http(s) 地址**、以及别的相对地址。
   * 不注入或转换失败时返回 undefined —— 那就按原样写地址
   *（保住图是底线：宁可留个外链，也不要让用户看到空白）。
   */
  persistImage?(url: string): Promise<{ url: string; resourceId: string } | undefined>
  /**
   * 本地资源库**引用**（`res-<n>`）→ 当前可显示地址。
   *
   * 引用不是显示地址（`<img src="res-7">` 浏览器根本解析不出来）——写进 imageUrl 前
   * 必须换一次。不注入 / 换不出来时返回 undefined —— 调用方放弃这次写回
   *（把引用当地址写进去只会得到一张打不开的破图，保留原图反而更好）。
   */
  resolveRef?(ref: string): Promise<string | undefined>
}

/**
 * 这个地址**本身就是可显示的画布资源地址**吗（是的话不必再落一次）。
 *
 * 只认云端形态：`/api/canvases/<画布>/resources/<哈希>` —— 它跨会话 / 跨机器可取。
 *
 * 2026-10-13 修复：**不能**把 `res-<n>` 引用也算成"已经落地"——那是资源库的**引用**、
 * 不是显示地址（写进 imageUrl 谁都打不开）。引用走 isResourceRef，先 resolve 再写。
 */
export function isCanvasResourceUrl(url: string): boolean {
  return /^\/api\/canvases\/[^/]+\/resources\//.test(url)
}

/** 本地资源库的引用（`res-<n>`）：字节已在库里，但写进节点前要先 resolve 成显示地址 */
export function isResourceRef(url: string): boolean {
  return /^res-/.test(url)
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
  // 把「还不属于本画布」的地址统一收进资源库，节点里只留本画布地址。
  //
  // 覆盖三类（2026-10-12 用户实测报的问题）：
  //   · dataURL / blobURL —— 别让 base64 进画布 JSON；
  //   · **外部 http(s) 地址** —— 生成产物常先以 provider 的外链形式回来
  //     （如 http://localhost:8033/...），那是另一个服务的地址，换机器/换端口就取不到；
  //   · 别的相对地址。
  //
  // 之前这里只认 data:/blob:，于是**外链被原样写进节点**：换台机器打不开，
  // 而且会把后台刚落地好的本画布地址盖掉（后台的 taskManager 是下了字节的）。
  //
  // 2026-10-13 再修一处：本地引用（res-…）**不是显示地址**，不能像早先那样当"已落地"
  // 直接写进 imageUrl —— 先 resolve 成当前可用地址再写，引用本身写进 resourceId
  //（刷新后由资源库按引用重建；与上传链路的规矩一致）。
  let finalUrl = url
  let finalResourceId = resourceId
  if (isResourceRef(url)) {
    // 本地引用：字节已在资源库，只差 resolve 成当前可用地址。
    // 取不出来（资源已不在 / 资源库不可用 / 解析抛错）→ **什么都不写**、保留原图：
    // 引用本身不是显示地址，写进去只会变成一张打不开的破图。
    // try/catch 与 persistImage 的「失败即 undefined」口径对齐：写回不该整体炸掉
    //（生产里 applier 是 void 调用，抛出去就是未捕获的 rejection）。
    let resolved: string | undefined
    try {
      resolved = await deps.resolveRef?.(url)
    } catch {
      resolved = undefined
    }
    // 二次防御：resolve 结果本身仍是引用形态（资源后端实现异常的原样回显）也不写 ——
    // 「引用绝不进 imageUrl」在这里收成硬不变量，任何一类后端实现都翻不了案。
    if (!resolved || isResourceRef(resolved)) return
    finalUrl = resolved
    finalResourceId = finalResourceId ?? url
  } else if (!finalResourceId && !!deps.persistImage && !isCanvasResourceUrl(url)) {
    // 还没落地（dataURL / blobURL / 外链 / 别的相对地址）：先收进资源库再写
    const persisted = await deps.persistImage(url)
    if (persisted) {
      finalUrl = persisted.url
      finalResourceId = persisted.resourceId
    }
  }
  const size = await deps.measure(finalUrl)
  // 卡片尺寸跟新图一致（等比 + 封顶）；量不到尺寸就没有尺寸补丁，只写地址并清空旧尺寸
  const sizes = cardSizePatch(size?.width, size?.height, deps.fitLimits?.())
  const data: Record<string, unknown> = {
    ...(deps.readData(nodeId) ?? {}),
    imageUrl: finalUrl,
    ...(finalResourceId ? { resourceId: finalResourceId } : {}),
    imageName: undefined,
    imageSize: undefined,
    imageWidth: size?.width,
    imageHeight: size?.height,
  }
  deps.writeData(nodeId, data, sizes?.size)
}

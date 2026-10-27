/**
 * textureLifecycle —— 3D 贴图「该不该显示」的纯判定（零 Vue / 零 three / 零 DOM）。
 *
 * 为什么单独有它：画面里那张贴图是异步加载的（TextureLoader），而按钮/数据/上游连线
 * 可能在加载完成前就变了。如果只靠 `hasTexture` 一个布尔，就会出现：
 *   - 上游撤掉 → url 变空 → **先把旧图画回去**（map 没清）→ 再被当成"有图"；
 *   - 新图加载失败 → 旧图还挂在材质上，空态永远不出现。
 * 这类 bug 在 Reactivity 之外（three 的对象不吃 Vue），只能靠一个明确的判定函数收口。
 *
 * 规则只有一条：**当前有非空贴图地址，且已成功加载**，才算有画面；其余一律显示空状态。
 */
export interface TextureDisplayInput {
  /** 当前想显示的贴图地址（空串 = 没有图） */
  url: string
  /** 加载器是否已回调成功 */
  loaded: boolean
  /** 渲染器是否创建失败（WebGL 不可用） */
  error: string
}

/** 画面此刻是否应该显示 3D 内容（false = 显示空状态） */
export function shouldShowTexture(input: TextureDisplayInput): boolean {
  if (input.error.trim() !== '') return false
  return input.url.trim() !== '' && input.loaded
}

/** 贴图地址变空时是否要卸掉旧纹理（否则旧图会"装作还在"） */
export function shouldClearTexture(previousUrl: string, nextUrl: string): boolean {
  return previousUrl.trim() !== '' && nextUrl.trim() === ''
}

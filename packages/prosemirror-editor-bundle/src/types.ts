import type { VNode } from 'vue'

export interface ResourceItem {
  id: string
  name: string
  category: string
  icon?: string
  /**
   * 引用标记信息（技能 / MCP / 节点）。
   *
   * 给了它，标签在正文里就序列化成 `@[kind:name](value)`（见 referenceMarkup.ts），
   * 而不是退化成 `@名字` —— 发消息时后端据此认出「引用了哪一种、引用了谁」。
   * 不给则维持旧的 `@名字`（图片 / 视频素材这类只作展示的标签）。
   */
  /**
   * 引用标记信息（技能 / MCP / 节点 / 资产）。
   *
   * 资产专用两个字段（见 referenceMarkup.ts）：`ext` = 扩展名（点标签预览时挑预览器），
   * `folderId` = 资产库文件夹 id（点文件夹标签时定位到资产管理的那一层）。
   */
  ref?: { kind: string; name: string; value?: string; ext?: string; folderId?: string }
  renderItem?: (item: ResourceItem) => VNode   // MentionMenu 下拉菜单渲染
  renderEditor?: (item: ResourceItem) => [string, Record<string, any>, ...any[]] | HTMLElement  // 输入框内 DOM 渲染；数组=DOMOutputSpec（ProseMirror 创建），HTMLElement=直接返回
  /**
   * 这是一个**动作项**（命令），不是可插入的标签。
   *
   * 给了它，@ 菜单里选中这条**不会**往正文里插东西 —— 只调它一次（如「压缩」把上下文压成摘要）。
   * 为什么要有这条通道：@ 菜单是用户已经熟悉的"命令入口"，往里放**不产出标签**的操作
   * （压缩、清屏这类）时，缺了它就只能插一个假标签，正文里会多出脏文本。
   */
  onPick?: () => void
  /**
   * 「替换素材」交互（用户 2026-10-29）：
   * 参考标签 hover 时，缩略图/图标变成替换图标；点击后调用方展开替换菜单。
   * 载荷 = 当前这颗标签（id / 名称 / 类型 / url），调用方据此列出画布上的候选。
   * 不给 = 该标签没有替换交互（技能 / MCP / 资产引用等）。
   */
  onReplaceClick?: (item: ResourceItem) => void
  /**
   * 「点左侧图标」交互（用户 2026-10-29 定案）：
   * 标签分左右两半 —— 点右侧文字 = 默认行为（0.5s 后光标落到标签后）；
   * 点左侧图标 = 交给调用方（底栏在**外部**用 Dropdown 弹菜单）。
   * 菜单本身不放进编辑器：标签是外部声明的，编辑器只负责「告诉你点了哪个图标」。
   * 载荷带触发元素的屏幕矩形，调用方据此定位浮层。
   */
  onIconClick?: (
    item: ResourceItem,
    anchor: { left: number; top: number; right: number; bottom: number; width: number; height: number },
  ) => void
  // 编辑器内交互事件（不传 → 无默认行为）
  onClick?: (item: ResourceItem) => void       // 点击资源节点
  onMouseEnter?: (item: ResourceItem) => void  // 鼠标进入资源节点（默认：悬停预览）
  onMouseLeave?: (item: ResourceItem) => void  // 鼠标离开资源节点
  url?: string
  thumbnail_url?: string
  mediaType?: 'image' | 'video' | 'audio'
  value?: string
  /**
   * 「换绑」用：这颗标签原本绑的是谁（旧标签 id）。
   *
   * 替换插槽内容时调用方传它，编辑器会把正文里那颗旧标签**整颗换成新身份**
   * （id / 名字 / 缩略图一起换），而不是只改显示名 —— 否则下次刷新又会按旧节点拉回名字。
   */
  previousId?: string
  /**
   * 参考标签要显示的类型图标（用户口径 2026-10-28）。
   *
   * - 有值：标签已绑定到画布节点，按节点真实类型画图标与缩略图；
   * - 没值：标签还没绑定（手打的 @名字 / 空插槽），统一画「资源」图标，不猜类型。
   */
  chipKind?: 'image' | 'video' | 'audio' | 'text'
  /**
   * 绑定已失效：标签指向的节点被删除或连线已断开。
   * 显示灰掉/失效样式；**禁止发送**由底栏按这份标记判断。
   */
  invalid?: boolean
  /**
   * 悬停预览用哪个地址（可选）。
   *
   * 为什么不直接用 url：有些素材的 `url` 只是**小尺寸缩略图**（比如视频的 50px 帧图），
   * 放大到 400px 会糊成一团。插件可以在这里给一个更清晰的来源（例如视频的原始尺寸帧），
   * 编辑器 hover 预览优先用它；不给就退回 url。
   */
  hoverPreview?: () => string | undefined | Promise<string | undefined>
}

export interface MenuPosition {
  left: string;
  top: string;
  origin?: string; // 动画原点，如 "top left", "bottom right"
  side?: 'top' | 'bottom'; // 菜单显示在触发点的上方还是下方
  /**
   * 触发点（光标）的视口坐标。给了它，菜单就能用**自己真实测量的尺寸**决定上下翻转，
   * 而不是拿写死的高度估算 —— 估大了会把明明放得下的菜单顶到屏幕上方（实测 bug）。
   * 自定义 mention-menu 插槽可以忽略这两个字段。
   */
  anchorTop?: number;
  anchorBottom?: number;
}

export interface PreviewPosition {
  left: string;
  top: string;
  transform?: string;
}

/**
 * 任务（Job）与历史记录的形状。
 *
 * 一句话分工：
 * - **Job** 是"这件事在跑"，活在内存里（服务重启后由节点上的 runState 兜底）；
 * - **HistoryEntry** 是"这件事跑完了"，落在画布文件夹里（账本，只增不减）。
 *
 * 唯一事实来源：进度与终态都写到**节点自己的 runState** 上。
 * 前端读的就是它 —— 所以"关掉页面任务照跑、回来一看进度还在"是天然成立的。
 */

export type JobStatus = 'running' | 'done' | 'error'

/** 一个正在跑（或刚跑完）的任务 */
export interface Job {
  /** jobId —— 节点 runState.taskId 存的就是它（刷新续查 / 取消都打这个） */
  id: string
  canvasId: string
  nodeId: string
  actionId: string
  /** 哪个 provider 领的单（取消 / 续查要路由回它） */
  providerId: string
  /** provider 自己的任务号（后台内部用，前端不关心） */
  providerTaskId?: string
  status: JobStatus
  progress?: number
  message?: string
  /** 终态产物 */
  result?: { ok: boolean; urls?: string[]; text?: string; error?: string; taskId?: string }
  /**
   * 下单时的原始请求快照（提示词 / 参数 / 参考素材）。
   *
   * 存**原始引用**而不是 resolveInput 之后的数据地址：后者是 provider 用的内嵌字节，
   * 塞进历史会把账本撑爆（一条视频参考动辄几十 MB）。这里只留画布内地址与文本值，
   * 详情弹窗据此还原"当时用了什么"。
   */
  request?: {
    prompt?: string
    values?: Record<string, unknown>
    resources?: Array<{ kind: string; url?: string; value?: string }>
  }
  createdAt: number
  finishedAt?: number
}

/** 历史里的一笔（= 一次生成） */
export interface HistoryEntry {
  id: string
  jobId: string
  canvasId: string
  nodeId: string
  actionId: string
  /** 展示名（动作标题，如「豆包 Seedream 4.5」） */
  title: string
  /** 生成物类型 —— 前端按它分组 / 计数 */
  kind: 'image' | 'video' | 'audio' | 'other'
  status: 'done' | 'error'
  /**
   * 评级。目前是**占位**（还没有人工审核流程）：归档时统一写 'passed'，
   * 这样前端那个"所有评级 / 已通过 / 待审核 / 已拒绝"下拉不是死控件，
   * 等真有审核流程再往里写其它值。
   */
  rating: 'passed' | 'pending' | 'rejected'
  urls?: string[]
  text?: string
  /** 用户当时的提示词（生成参数的一部分） */
  prompt?: string
  /** 用户当时选的参数（比例 / 时长 / 模型档位…，键 = 动作声明的 ActionParam.key） */
  values?: Record<string, unknown>
  /**
   * 参考素材（连进节点 / @ 引用的图、视频、文本）。
   *
   * url 是**画布内地址**（/api/canvases/.../resources/...），详情弹窗可直接显示缩略图；
   * 参考文本放 value。
   */
  resources?: Array<{ kind: string; url?: string; value?: string }>
  /** 产物媒体元数据（尺寸 / 时长 / 字节数）：卡片用它画比例与角标，不必等媒体加载完 */
  media?: {
    width?: number
    height?: number
    /** 视频 / 音频时长（毫秒） */
    durationMs?: number
    /** 产物字节数（文件大小） */
    bytes?: number
  }
  createdAt: number
  finishedAt: number
  error?: string
}

/** 历史查询的筛选条件 */
export interface HistoryQuery {
  page?: number
  pageSize?: number
  /** 生成物类型筛选 */
  kind?: string
  /** 状态筛选（done / error） */
  status?: string
  /** 评级筛选（all / passed / pending / rejected） */
  rating?: string
  /** 时间排序（默认 desc = 最新在前） */
  order?: 'asc' | 'desc'
  /** 按画布筛（省略 = 全部画布） */
  canvasId?: string
}

/** 历史查询结果（分页 + 汇总一起给） */
export interface HistoryPage {
  items: HistoryEntry[]
  total: number
  page: number
  pageSize: number
  /** 汇总：一共生成过多少，按类型分 */
  summary: { total: number; byKind: Record<string, number> }
}

/**
 * imageModels —— 图片生成模型的**能力声明表**（纯数据，零依赖，可 JSON 序列化）。
 *
 * 来源：v1 的 packages/canvas-core/src/nodes/image/imageModels.ts（LOCAL_MODELS）。
 * model id 原样保留（它是后台查找键，也是工具名 image.generate:<modelId> 的后半段），
 * 改了就对不上后台。ratio / resolution / supportsInput / description / mcpTool / mcpModel 同样照搬。
 *
 * 与 v1 的关系：v1 这张表在"前端供应商层"，还要兼管模板与 mock 生成；本包只取其中"模型能力"这一半，
 * 且只用于**生成工具声明**（比例/分辨率下拉、可接受输入），不含任何假图逻辑。
 * 后台的权威副本在 packages/mcp-server/src/models/ModelRegistry.ts（PRESET_IMAGE_MODELS）；
 * "以后加模型只改后台"由 registerFromBackend 负责（拉 GET /api/models 再注册），本文件的 5 条是离线兜底。
 */

/** 上游可接受的资源类型（与 ToolResourceKind 的媒体部分同词表） */
export type ImageGenerationInputType = 'image' | 'audio' | 'video'

/** 单个模型的能力声明（结构对齐 v1 ImageModelCapability，只留本包需要的字段） */
export interface ImageModelCapability {
  /** 模型唯一 id（后台查找键；工具名 = image.generate:<model>） */
  model: string
  /** 展示名（工具 title） */
  label?: string
  /** 支持的比例；缺省/空 = 不提供比例选择 */
  ratio?: string[]
  /** 支持的分辨率；缺省/空 = 不提供分辨率选择 */
  resolution?: string[]
  /** 接受的资源输入类型；缺省/空 = 全接受 */
  supportsInput?: ImageGenerationInputType[]
  description?: string
  /** 该模型对应的后台生成平台/工具标识（透传后台，非 UI 展示用） */
  mcpTool?: string
  /** 调用平台工具时传入的模型名（平台要求原样字符串） */
  mcpModel?: string
}

/**
 * 当前对接的 5 个图片生成模型（= v1 LOCAL_MODELS，id 与能力一字不改）。
 * ratio/resolution 与各平台 schema 对齐；分辨率档位只有 APIMart 一家暴露。
 */
export const IMAGE_MODELS: ImageModelCapability[] = [
  {
    model: 'apimart-gpt-image-2',
    label: 'GPT Image 2（APIMart）',
    ratio: ['1:1', '3:2', '2:3', '4:3', '3:4', '5:4', '4:5', '16:9', '9:16', '2:1', '1:2', '3:1', '1:3', '21:9', '9:21'],
    resolution: ['1k', '2k', '4k'],
    supportsInput: ['image'],
    description: 'APIMart GPT Image 2，支持比例 + 分辨率档位，可带参考图',
    mcpTool: 'apimart/generate-image',
  },
  {
    model: 'chatgpt-gpt-image-2',
    label: 'GPT Image 2（ChatGPT）',
    ratio: ['1:1', '2:3', '3:4', '4:3', '9:16', '16:9'],
    supportsInput: ['image'],
    description: 'ChatGPT 账号版 GPT Image 2，无分辨率档位，可带参考图',
    mcpTool: 'chatgpt/generate-image',
  },
  {
    model: 'doubao-seedream-5lite',
    label: 'Seedream 5.0 Lite（豆包）',
    ratio: ['auto', '1:1', '2:3', '3:4', '4:3', '9:16', '16:9'],
    supportsInput: ['image'],
    description: '豆包 Seedream 5.0 Lite，智能升级、细节丰富',
    mcpTool: 'doubao/generate-image-chat',
    mcpModel: 'Seedream 5.0 Lite',
  },
  {
    model: 'doubao-seedream-45',
    label: 'Seedream 4.5（豆包）',
    ratio: ['auto', '1:1', '2:3', '3:4', '4:3', '9:16', '16:9'],
    supportsInput: ['image'],
    description: '豆包 Seedream 4.5，多图参考、人像自然',
    mcpTool: 'doubao/generate-image-chat',
    mcpModel: 'Seedream 4.5',
  },
  {
    model: 'doubao-seedream-40',
    label: 'Seedream 4.0（豆包）',
    ratio: ['auto', '1:1', '2:3', '3:4', '4:3', '9:16', '16:9'],
    supportsInput: ['image'],
    description: '豆包 Seedream 4.0，精准编辑、特征保持',
    mcpTool: 'doubao/generate-image-chat',
    mcpModel: 'Seedream 4.0',
  },
]

/** 默认后台地址（与 mcp-server 本地 HTTP 服务端口一致） */
export const DEFAULT_BASE_URL = 'http://127.0.0.1:8765'

/**
 * 预设提示词模板（用户要求的"模板提示词"下拉的数据来源）。
 *
 * 为什么放这里而不是节点面板里写死：模板和"这个模型擅长什么"强相关，
 * 由提供模型的工具声明最合适 —— 面板只负责列出与填入（选中即把 prompt 填进输入框），
 * 以后加模板不用改任何节点代码。词条沿用 v1 imageModels.ts 的 LOCAL_TEMPLATES，不另造。
 */
export const IMAGE_TEMPLATES: ReadonlyArray<{
  id: string
  name: string
  prompt: string
  description?: string
  forTools?: string[]
}> = [
  { id: 'clear', name: '通用·高清写实', prompt: '高清写实风格，主体突出，细节丰富，自然光照' },
  { id: 'blank', name: '留白极简', prompt: '极简留白构图，大面积纯色背景，主体居中' },
  { id: 'poster', name: '海报感', prompt: '电影海报构图，戏剧化光影，居中主体，两侧留白放文字' },
]

/**
 * 选项值 → 展示文案。value 保持英文原值传给后台，只把 label 换成中文（同 v1 VALUE_LABELS）。
 * 没有映射的值直接显示原样（如 '16:9' / '2k'）。
 */
export const VALUE_LABELS: Record<string, string> = {
  auto: '自动',
}

/** 单个值 → 中文展示文案 */
export function valueLabel(value: string): string {
  return VALUE_LABELS[value] ?? value
}

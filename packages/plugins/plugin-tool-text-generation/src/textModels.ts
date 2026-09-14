/**
 * textModels —— 文本生成模型的能力声明（内置默认表）。
 *
 * 与图片侧同思路：这里只描述"有哪些模型、各支持什么参数"，**不含任何 UI**。
 * 节点面板读工具声明自动长出下拉，所以加模型/加参数不用改节点代码。
 *
 * 说明：v1 只有图片模型（没有文本生成），因此本表是本项目自建的默认集；
 * 参数取"文本生成最常见的两个旋钮"——思考程度（thinking）与回复长度（length），
 * 它们都通过内核 ToolParamDef 声明，面板不认识这两个概念。
 * 真实模型名/参数以后可由后台 GET /api/models 覆盖（见 registerFromBackend）。
 */
import type { ToolParamDef } from '@mini-canvas/kernel'

/** 默认生成后台地址（与图片工具插件一致，都是本地 mcp-server） */
export const DEFAULT_BASE_URL = 'http://127.0.0.1:8765'

/** 文本生成模型的能力声明 */
export interface TextModelCapability {
  /** 模型唯一 id（下拉 value，也是后台查找键） */
  model: string
  /** 下拉展示名 */
  label?: string
  description?: string
  /** 支持的思考程度档位；缺省/空 = 该模型不提供这个参数 */
  thinking?: string[]
  /** 支持的回复长度档位；缺省/空 = 不提供 */
  length?: string[]
  /** 接受的输入资源类型（文本恒可，图片=多模态读图） */
  supportsInput?: Array<'image' | 'video' | 'audio'>
  /** [对接提示] 后台执行时用的模型名（与 modelId 不同时由它指定） */
  mcpModel?: string
}

/**
 * 预设提示词模板 —— 用户要的"模板提示词"下拉的数据来源。
 * 由工具声明（不是面板写死）：加模板只改这里，两个节点面板都不用动。
 */
export const TEXT_TEMPLATES: ReadonlyArray<{
  id: string
  name: string
  prompt: string
  description?: string
}> = [
  {
    id: 'polish',
    name: '润色改写',
    prompt: '把下面的内容润色得更通顺自然，保持原意与信息量，输出正文即可：\n',
    description: '语气更顺、用词更准，不改变原意',
  },
  {
    id: 'summarize',
    name: '总结要点',
    prompt: '把下面的内容总结成要点，分条列出，每条不超过一行：\n',
    description: '压缩成长度可控的条目',
  },
  {
    id: 'ask',
    name: '追问提问',
    prompt: '针对下面这段内容，提出三个能引出关键信息的问题：\n',
    description: '用提问继续挖内容',
  },
  {
    id: 'translate',
    name: '翻译成英文',
    prompt: '把下面的内容翻译成地道的英文，只输出译文：\n',
  },
]

/** 档位值 → 中文显示名（面板按声明渲染，这里只做显示友好） */
export const VALUE_LABELS: Record<string, string> = {
  low: '低',
  medium: '中',
  high: '高',
  auto: '自动',
  short: '短',
  normal: '适中',
  long: '长',
}

/** 取档位的显示名（没有映射就用原值） */
export function valueLabel(v: string): string {
  return VALUE_LABELS[v] ?? v
}

/**
 * 内置文本模型。
 *
 * 之所以给三个而不是一个：让"思考程度"这个参数的差异真的看得见（有的模型支持、有的不支持），
 * 也顺带验证面板"按声明长下拉"的能力 —— 声明里有就显示，没有就整块不显示。
 */
export const TEXT_MODELS: TextModelCapability[] = [
  {
    model: 'gpt-text-reasoning',
    label: 'GPT 文本（深度思考）',
    description: '支持思考程度与长度调节，适合需要推理与长文输出的场景',
    thinking: ['low', 'medium', 'high'],
    length: ['short', 'normal', 'long'],
    supportsInput: ['image'],
  },
  {
    model: 'gpt-text-fast',
    label: 'GPT 文本（快速）',
    description: '低延迟直出，不提供思考程度；适合润色、翻译这类即时任务',
    length: ['short', 'normal'],
  },
  {
    model: 'doubao-text',
    label: '豆包文本',
    description: '支持思考程度，中文表达自然；长度固定为模型默认',
    thinking: ['auto', 'low', 'high'],
    mcpModel: 'Doubao Text',
  },
]

/** 由能力声明生成参数 schema：声明了 thinking/length 才给对应下拉（缺失则面板整块不渲染） */
export function paramsOf(cap: TextModelCapability): ToolParamDef[] {
  const params: ToolParamDef[] = []
  if (cap.thinking?.length) {
    params.push({
      key: 'thinking',
      label: '思考程度',
      description: '模型推理投入的程度：越高越慢但更稳，越低越快。',
      type: 'select',
      default: cap.thinking.includes('medium') ? 'medium' : cap.thinking[0],
      options: cap.thinking.map((v) => ({ label: valueLabel(v), value: v })),
    })
  }
  if (cap.length?.length) {
    params.push({
      key: 'length',
      label: '回复长度',
      description: '期望的输出长度档位。',
      type: 'select',
      default: cap.length.includes('normal') ? 'normal' : cap.length[0],
      options: cap.length.map((v) => ({ label: valueLabel(v), value: v })),
    })
  }
  return params
}

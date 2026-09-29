/**
 * presets —— **预置配置表**（本插件唯一的数据源，服务端不可用也能照常渲染 UI）。
 *
 * 为什么写死在本地而不是运行期问 `tools/list`：
 * 1. 用户明确要求「在这个新插件里把配置写下来（不是运行时去问服务端）」；
 * 2. 底栏要在**服务没起**的时候也能把 UI 画出来（否则选中节点是一片空白）；
 * 3. 参数的**语义类型**（kind）是服务端 schema 表达不出来的 —— 那边只有 type:enum/number，
 *    哪一个是"比例"、哪一个是"时长"、哪几个平台支持哪几档，都是本层的知识。
 *
 * 数据来源：web2api 的 `tools/list` 实测（2026-09-29，与各平台 meta.ts 一致）。
 * 参数一律用 **kind** 声明语义（UI 按 kind 挑预设组件），并**只声明该平台真支持的参数** ——
 * 这就是用户要的「按能力显隐」：dola 视频时长只有 5/10 两档、豆包到 10s、豆包生图多一个风格。
 */
import type { ToolParamDef, ToolResourceKind } from '@mini-canvas/kernel'

/** 图片类节点的动作产出物（写入器据此选 kind） */
export type Web2ApiNodeType = 'image' | 'video' | 'audio'

/** chat-auto 的中转模式：媒体参数要拼进 prompt 前缀指令（服务端不支持单独参数） */
export type PromptMode = 'chat-auto' | 'plain'

/** 一条动作的预置声明 */
export interface Web2ApiPreset {
  /** 动作 id（底栏里唯一） */
  id: string
  /** web2api 工具名 `{platform}/{operation}` */
  tool: string
  /** 平台显示名 */
  platform: string
  /** 操作显示名 */
  operation: string
  /** 服务哪个节点类型（一次只一个：写入器按类型分） */
  nodeType: Web2ApiNodeType
  /** 底栏标题（= 模型/能力名） */
  title: string
  /** 一句话说明（tooltip） */
  description: string
  /** 分组（底栏动作归类） */
  group: string
  /** chat-auto = 把参数拼进 prompt 前缀；plain = 参数直接当工具参数传 */
  promptMode: PromptMode
  /** chat-auto 时的媒体模式（决定 /image 还是 /video 前缀） */
  mediaMode?: 'image' | 'video'
  /** 声明式参数（kind 决定 UI 用哪个预设件；只放本平台真支持的） */
  fields: ToolParamDef[]
  /** 该工具需要的资源类型（上游素材） */
  accepts?: ToolResourceKind[]
  /** 排序（底栏里靠前的先显示） */
  order: number
  /** 是否异步（web2api 有 waitEngine 的操作：返回 taskId，要轮询 system/get-task） */
  async: boolean
}

/** 比例候选（各平台枚举不同，按平台如实列） */
const RATIO_IMAGE_DOUBAO: ToolParamDef = {
  key: 'ratio',
  kind: 'ratio',
  label: '比例',
  type: 'select',
  default: '1:1',
  options: [
    { label: '1:1', value: '1:1' },
    { label: '2:3', value: '2:3' },
    { label: '3:4', value: '3:4' },
    { label: '4:3', value: '4:3' },
    { label: '9:16', value: '9:16' },
    { label: '16:9', value: '16:9' },
  ],
}

const RATIO_IMAGE_CHAT_DOUBAO: ToolParamDef = {
  key: 'ratio',
  kind: 'ratio',
  label: '比例',
  type: 'select',
  default: '16:9',
  options: [
    { label: '1:1', value: '1:1' },
    { label: '3:4', value: '3:4' },
    { label: '4:3', value: '4:3' },
    { label: '9:16', value: '9:16' },
    { label: '16:9', value: '16:9' },
    { label: '3:2', value: '3:2' },
  ],
}

const RATIO_IMAGE_DOLA: ToolParamDef = {
  key: 'ratio',
  kind: 'ratio',
  label: '比例',
  type: 'select',
  default: '1:1',
  options: [
    { label: '1:1', value: '1:1' },
    { label: '2:3', value: '2:3' },
    { label: '3:4', value: '3:4' },
    { label: '4:3', value: '4:3' },
    { label: '9:16', value: '9:16' },
    { label: '16:9', value: '16:9' },
  ],
}

const RATIO_VIDEO_DOUBAO: ToolParamDef = {
  key: 'ratio',
  kind: 'ratio',
  label: '比例',
  type: 'select',
  default: '16:9',
  options: [
    { label: '1:1', value: '1:1' },
    { label: '3:4', value: '3:4' },
    { label: '4:3', value: '4:3' },
    { label: '9:16', value: '9:16' },
    { label: '16:9', value: '16:9' },
    { label: '21:9', value: '21:9' },
  ],
}

const RATIO_VIDEO_DOLA: ToolParamDef = {
  key: 'ratio',
  kind: 'ratio',
  label: '比例',
  type: 'select',
  default: '16:9',
  options: [
    { label: '1:1', value: '1:1' },
    { label: '3:4', value: '3:4' },
    { label: '4:3', value: '4:3' },
    { label: '9:16', value: '9:16' },
    { label: '16:9', value: '16:9' },
    { label: '21:9', value: '21:9' },
  ],
}

const MODEL_IMAGE_DOUBAO: ToolParamDef = {
  key: 'model',
  kind: 'model',
  label: '模型',
  type: 'select',
  default: 'Seedream 4.5',
  options: [
    { label: 'Seedream 5.0 Pro', value: 'Seedream 5.0 Pro' },
    { label: 'Seedream 5.0 Lite', value: 'Seedream 5.0 Lite' },
    { label: 'Seedream 4.5', value: 'Seedream 4.5' },
    { label: 'Seedream 4.0', value: 'Seedream 4.0' },
  ],
}

const MODEL_IMAGE_CHAT_DOUBAO: ToolParamDef = {
  key: 'model',
  kind: 'model',
  label: '模型',
  type: 'select',
  default: 'Seedream 4.5',
  options: [
    { label: 'Seedream 5.0 Lite', value: 'Seedream 5.0 Lite' },
    { label: 'Seedream 4.5', value: 'Seedream 4.5' },
    { label: 'Seedream 4.0', value: 'Seedream 4.0' },
  ],
}

const MODEL_IMAGE_DOLA: ToolParamDef = {
  key: 'model',
  kind: 'model',
  label: '模型',
  type: 'select',
  default: 'Seedream 4.5',
  options: [
    { label: 'Seedream 5.0 Pro', value: 'Seedream 5.0 Pro' },
    { label: 'Seedream 4.5', value: 'Seedream 4.5' },
  ],
}

const MODEL_VIDEO_DOUBAO: ToolParamDef = {
  key: 'model',
  kind: 'model',
  label: '模型',
  type: 'select',
  default: 'Seedance 2.0 Fast',
  options: [
    { label: 'Seedance 2.0 Fast', value: 'Seedance 2.0 Fast' },
    { label: 'Seedance 2.0 Mini', value: 'Seedance 2.0 Mini' },
  ],
}

const MODEL_VIDEO_DOLA: ToolParamDef = {
  key: 'model',
  kind: 'model',
  label: '模型',
  type: 'select',
  default: 'Seedance 2.0',
  options: [
    { label: 'Seedance 2.5', value: 'Seedance 2.5' },
    { label: 'Seedance 2.0', value: 'Seedance 2.0' },
    { label: 'Seedance 1.0', value: 'Seedance 1.0' },
  ],
}

/** 时长（滑块）：豆包 auto 模式 4-10s */
const DURATION_DOUBAO_AUTO: ToolParamDef = {
  key: 'durationSec',
  kind: 'duration',
  label: '时长',
  type: 'number',
  min: 4,
  max: 10,
  step: 1,
  default: 5,
  unit: '秒',
}

/** 时长（按钮网格）：dola 只有 5 / 10 两档 —— 两档铺成按钮比滑块一眼可见 */
const DURATION_DOLA_AUTO: ToolParamDef = {
  key: 'durationSec',
  kind: 'duration',
  label: '时长',
  type: 'number',
  default: 5,
  options: [
    { label: '5秒', value: '5' },
    { label: '10秒', value: '10' },
  ],
}

const STYLE_DOUBAO_IMAGE: ToolParamDef = {
  key: 'style',
  kind: 'style',
  label: '风格',
  type: 'select',
  options: [
    { label: '人像摄影', value: 'skill_image_styles_portrait' },
    { label: '电影写真', value: 'skill_image_styles_film' },
    { label: '中国风', value: 'skill_image_styles_chinese' },
    { label: '动漫', value: 'skill_image_styles_japanese_anime' },
    { label: '3D渲染', value: 'skill_image_styles_3d' },
    { label: '赛博朋克', value: 'image_gen_style_cyberpunk' },
    { label: 'CG 动画', value: 'skill_image_styles_cg' },
    { label: '水墨画', value: 'skill_image_styles_ink_wash_painting' },
    { label: '油画', value: 'skill_image_styles_oil_painting' },
    { label: '古典', value: 'skill_image_styles_classic' },
    { label: '水彩画', value: 'skill_image_styles_watercolor' },
    { label: '卡通', value: 'skill_image_styles_cartoon' },
    { label: '平面插画', value: 'skill_image_styles_flat_illustration' },
    { label: '风景', value: 'skill_image_styles_landscape' },
    { label: '港风动漫', value: 'skill_image_styles_hongkong_anime' },
    { label: '像素风格', value: 'skill_image_styles_pixel_style' },
    { label: '荧光绘画', value: 'skill_image_styles_fluorescence' },
    { label: '彩铅画', value: 'skill_image_styles_colored_pencil' },
    { label: '手办', value: 'skill_image_styles_figure' },
    { label: '儿童绘画', value: 'skill_image_styles_children_illustration' },
    { label: '抽象', value: 'skill_image_styles_abstract' },
    { label: '锐笔插画', value: 'skill_image_styles_sharp_illustration' },
    { label: '二次元', value: 'skill_image_styles_acg' },
    { label: '油墨印刷', value: 'skill_image_styles_ink_print' },
    { label: '版画', value: 'skill_image_styles_bnw_printing' },
    { label: '莫奈', value: 'skill_image_styles_monet' },
    { label: '毕加索', value: 'skill_image_styles_picasso' },
    { label: '伦勃朗', value: 'skill_image_styles_rembrandt' },
    { label: '马蒂斯', value: 'skill_image_styles_matisse' },
    { label: '巴洛克', value: 'skill_image_styles_baroque' },
    { label: '复古动漫', value: 'skill_image_styles_oldschool' },
    { label: '绘本', value: 'skill_image_styles_picturebook' },
  ],
}

const SPEAKER_DOUBAO_TTS: ToolParamDef = {
  key: 'speaker',
  kind: 'speaker',
  label: '音色',
  type: 'select',
  default: 'zh_female_xiaohe_conversation_wvae_bigtts',
  options: [
    { label: '阳光甜妹（升级版）', value: 'zh_female_wenroutaozi_v2_mars_bigtts' },
    { label: '磁性俊宇（升级版）', value: 'zh_male_nuanxinshizhe_mars_bigtts' },
    { label: '知性小棠', value: 'zh_female_wenroutaozi_mars_bigtts' },
    { label: '邻家女孩', value: 'zh_female_xiaohe_conversation_wvae_bigtts' },
    { label: '邻家男孩', value: 'zh_male_linjiananhai_moon_bigtts' },
    { label: '温暖阿虎', value: 'zh_male_ahu_conversation_wvae_bigtts' },
    { label: '少年梓辛', value: 'zh_male_m286_conversation_wvae_bigtts' },
    { label: '阳光阿辰', value: 'zh_male_qingyiyuxuan_mars_bigtts' },
    { label: '傲娇霸总', value: 'zh_male_aojiaobazong_wvae_bigtts' },
    { label: '温柔子言', value: 'zh_male_cheng_mars_bigtts' },
    { label: '率性阿哲', value: 'zh_male_litiebanzi_mars_bigtts' },
    { label: '深夜播客', value: 'zh_male_shenyeboke_wvae_bigtts' },
    { label: '东方浩然', value: 'zh_male_dongfanghaoran_moon_bigtts' },
    { label: '阳光少年', value: 'BV154_streaming' },
    { label: '文静毛毛', value: 'zh_female_maomao_conversation_wvae_bigtts' },
    { label: '北京大妞', value: 'zh_female_beijingdaniu_mars_bigtts' },
    { label: '雷霆女神', value: 'zh_female_leidian' },
    { label: '奶芙波波', value: 'BV428_streaming' },
    { label: '星鼠仔', value: 'zh_male_milaoshu' },
    { label: '麦小鸭', value: 'zh_male_tanglaoya' },
    { label: '光头憨憨', value: 'zh_male_nezha' },
    { label: '智慧小羊', value: 'BV223_streaming' },
    { label: '高冷御姐', value: 'zh_female_xudong_conversation_wvae_bigtts' },
    { label: '甜心小美', value: 'zh_female_meilinvyou_wvae_bigtts' },
    { label: '川渝小伙', value: 'zh_male_sichuanskn' },
    { label: '南音阳仔', value: 'zh_male_nanchangygn' },
    { label: '清新女声', value: 'zh_female_qingxin_clone2' },
    { label: '小甜妹', value: 'zh_female_taozi_conversation_v4_wvae_bigtts' },
    { label: '温柔姐姐', value: 'zh_female_xiaonan_lv_clone2' },
    { label: '内敛才俊', value: 'zh_male_renmao_mars_bigtts' },
  ],
}

const MODEL_VOLC_AUDIO: ToolParamDef = {
  key: 'model',
  kind: 'model',
  label: '模型',
  type: 'select',
  default: 'seed-audio-1.0',
  options: [{ label: 'seed-audio-1.0', value: 'seed-audio-1.0' }],
}

const FORMAT_VOLC_AUDIO: ToolParamDef = {
  key: 'format',
  kind: 'format',
  label: '格式',
  type: 'select',
  default: 'wav',
  options: [
    { label: 'WAV', value: 'wav' },
    { label: 'MP3', value: 'mp3' },
    { label: 'OGG Opus', value: 'ogg_opus' },
  ],
}

const SPEED_VOLC_AUDIO: ToolParamDef = {
  key: 'speechRate',
  kind: 'speed',
  label: '语速',
  type: 'number',
  min: -50,
  max: 100,
  step: 5,
  default: 0,
}

const PITCH_VOLC_AUDIO: ToolParamDef = {
  key: 'pitchRate',
  kind: 'speed',
  label: '音调',
  type: 'number',
  min: -12,
  max: 12,
  step: 1,
  default: 0,
}

const LOUDNESS_VOLC_AUDIO: ToolParamDef = {
  key: 'loudnessRate',
  kind: 'speed',
  label: '音量',
  type: 'number',
  min: -50,
  max: 100,
  step: 5,
  default: 0,
}

const CAMERA_DOUBAO_VIDEO: ToolParamDef = {
  key: 'cameraMovement',
  kind: 'camera',
  label: '运镜',
  type: 'select',
  options: [
    { label: '固定镜头', value: '固定镜头' },
    { label: '镜头环绕', value: '镜头环绕${subject}拍摄' },
    { label: '镜头移动', value: '镜头往${direction}移动' },
    { label: '镜头聚焦', value: '镜头聚焦在${subject}' },
  ],
}

const MODEL_VIDEO_DOUBAO_API: ToolParamDef = {
  key: 'model',
  kind: 'model',
  label: '模型',
  type: 'select',
  default: 'seedance_v2.0',
  options: [
    { label: 'Seedance 2.0 Mini', value: 'seedance_v2.0_mini' },
    { label: 'Seedance 2.0 Fast', value: 'seedance_v2.0' },
  ],
}

const MODEL_VIDEO_SEEDANCE: ToolParamDef = {
  key: 'model',
  kind: 'model',
  label: '模型',
  type: 'select',
  default: 'fast',
  options: [
    { label: 'Fast (5积分/秒)', value: 'fast' },
    { label: '2.0 (8积分/秒)', value: '2.0' },
  ],
}

const RATIO_VIDEO_SEEDANCE: ToolParamDef = {
  key: 'ratio',
  kind: 'ratio',
  label: '比例',
  type: 'select',
  default: '16:9',
  options: [
    { label: '16:9', value: '16:9' },
    { label: '9:16', value: '9:16' },
  ],
}

const DURATION_SEEDANCE: ToolParamDef = {
  key: 'duration',
  kind: 'duration',
  label: '时长',
  type: 'number',
  min: 4,
  max: 180,
  step: 1,
  default: 5,
  unit: '秒',
}

const DURATION_DOUBAO_API: ToolParamDef = {
  key: 'duration',
  kind: 'duration',
  label: '时长',
  type: 'number',
  min: 4,
  max: 15,
  step: 1,
  default: 10,
  unit: '秒',
}

const IMAGE_REF = 'image' as const

/**
 * 全部预置动作。**顺序即底栏显示顺序**（order 小的在前）。
 *
 * 用户点名：图片与视频要优先走 dola / 豆包的 **auto 模式**（UI 自动化），所以那四条排最前。
 */
export const WEB2API_PRESETS: Web2ApiPreset[] = [
  {
    id: 'web2api:doubao-image-auto',
    tool: 'doubao/chat-auto',
    platform: '豆包',
    operation: '图像生成（auto）',
    nodeType: 'image',
    title: '豆包·图像 auto',
    description: '走豆包网页 UI 自动化生成图片（/image 前缀指令），支持模型与比例',
    group: 'web2api · 图片',
    promptMode: 'chat-auto',
    mediaMode: 'image',
    fields: [MODEL_IMAGE_CHAT_DOUBAO, RATIO_IMAGE_CHAT_DOUBAO],
    accepts: [IMAGE_REF],
    order: 10,
    async: true,
  },
  {
    id: 'web2api:dola-image-auto',
    tool: 'dola/chat-auto',
    platform: 'Dola',
    operation: '图像生成（auto）',
    nodeType: 'image',
    title: 'Dola·图像 auto',
    description: '走 Dola 网页 UI 自动化生成图片（/image 前缀指令）；需海外网络',
    group: 'web2api · 图片',
    promptMode: 'chat-auto',
    mediaMode: 'image',
    fields: [MODEL_IMAGE_DOLA, RATIO_IMAGE_DOLA],
    accepts: [IMAGE_REF],
    order: 11,
    async: true,
  },
  {
    id: 'web2api:doubao-image',
    tool: 'doubao/generate-image',
    platform: '豆包',
    operation: '生图',
    nodeType: 'image',
    title: '豆包·生图',
    description: '豆包 AI 绘画接口：比例 / 风格 / 模型都可选',
    group: 'web2api · 图片',
    promptMode: 'plain',
    fields: [MODEL_IMAGE_DOUBAO, RATIO_IMAGE_DOUBAO, STYLE_DOUBAO_IMAGE],
    accepts: [IMAGE_REF],
    order: 12,
    async: false,
  },
  {
    id: 'web2api:doubao-video-auto',
    tool: 'doubao/chat-auto',
    platform: '豆包',
    operation: '视频生成（auto）',
    nodeType: 'video',
    title: '豆包·视频 auto',
    description: '走豆包网页 UI 自动化生成视频（/video 前缀指令），时长 4-10 秒',
    group: 'web2api · 视频',
    promptMode: 'chat-auto',
    mediaMode: 'video',
    fields: [MODEL_VIDEO_DOUBAO, RATIO_VIDEO_DOUBAO, DURATION_DOUBAO_AUTO],
    accepts: [IMAGE_REF],
    order: 10,
    async: true,
  },
  {
    id: 'web2api:dola-video-auto',
    tool: 'dola/chat-auto',
    platform: 'Dola',
    operation: '视频生成（auto）',
    nodeType: 'video',
    title: 'Dola·视频 auto',
    description: '走 Dola 网页 UI 自动化生成视频；时长只有 5 / 10 秒两档；需海外网络',
    group: 'web2api · 视频',
    promptMode: 'chat-auto',
    mediaMode: 'video',
    fields: [MODEL_VIDEO_DOLA, RATIO_VIDEO_DOLA, DURATION_DOLA_AUTO],
    accepts: [IMAGE_REF],
    order: 11,
    async: true,
  },
  {
    id: 'web2api:doubao-video',
    tool: 'doubao/generate-video',
    platform: '豆包',
    operation: '文生视频',
    nodeType: 'video',
    title: '豆包·文生视频',
    description: '豆包 Seedance 2.0 接口式文生视频（异步轮询）：比例 / 时长 / 运镜',
    group: 'web2api · 视频',
    promptMode: 'plain',
    fields: [MODEL_VIDEO_DOUBAO_API, RATIO_VIDEO_DOUBAO, DURATION_DOUBAO_API, CAMERA_DOUBAO_VIDEO],
    accepts: [IMAGE_REF],
    order: 12,
    async: true,
  },
  {
    id: 'web2api:seedance-video',
    tool: 'seedance/generate-video',
    platform: 'Seedance',
    operation: '文生视频',
    nodeType: 'video',
    title: 'Seedance·文生视频',
    description: 'Seedance 2.0 接口式文生视频（异步轮询）：时长最长 180 秒',
    group: 'web2api · 视频',
    promptMode: 'plain',
    fields: [MODEL_VIDEO_SEEDANCE, RATIO_VIDEO_SEEDANCE, DURATION_SEEDANCE],
    accepts: [IMAGE_REF],
    order: 13,
    async: true,
  },
  {
    id: 'web2api:doubao-tts',
    tool: 'doubao/tts',
    platform: '豆包',
    operation: '语音合成',
    nodeType: 'audio',
    title: '豆包·语音合成',
    description: '文本转语音（不开浏览器，不耗视频积分）：选音色即可',
    group: 'web2api · 音频',
    promptMode: 'plain',
    fields: [SPEAKER_DOUBAO_TTS],
    order: 10,
    async: false,
  },
  {
    id: 'web2api:volcengine-audio',
    tool: 'volcengine/generate-audio',
    platform: '火山引擎',
    operation: '音频生成',
    nodeType: 'audio',
    title: '火山引擎·音频生成',
    description: 'seed-audio 音频生成：格式 / 语速 / 音量 / 音调可调',
    group: 'web2api · 音频',
    promptMode: 'plain',
    fields: [MODEL_VOLC_AUDIO, FORMAT_VOLC_AUDIO, SPEED_VOLC_AUDIO, PITCH_VOLC_AUDIO, LOUDNESS_VOLC_AUDIO],
    order: 11,
    async: false,
  },
]

/** 按节点类型取预设（底栏注册时按类型分组） */
export function presetsFor(nodeType: Web2ApiNodeType): Web2ApiPreset[] {
  return WEB2API_PRESETS.filter((p) => p.nodeType === nodeType).sort((a, b) => a.order - b.order)
}

/** 动作 id 集合（测试用：唯一性） */
export function presetIds(): string[] {
  return WEB2API_PRESETS.map((p) => p.id)
}

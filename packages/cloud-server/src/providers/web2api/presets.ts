/**
 * web2api 的动作预置表（内置 provider 的"菜单"）。
 *
 * 数据来源：web2api 的 `tools/list` 实测 + 各平台 meta。
 * 参数一律声明**语义类型**（kind：ratio / duration / speaker…），前端据此挑控件。
 * 只声明该平台**真支持**的参数 —— 这就是"按能力显隐"。
 *
 * 一个模型 = 一条动作：`title` 就是模型名（前端第一个下拉列的就是它），
 * 参数区只留比例 / 时长这类，不再有"模型下拉"。
 */
import type { ActionDef, ActionParam } from '../types.js'

/** 常用比例（各平台枚举不同，按平台如实列） */
function ratio(defaultValue: string, values: string[]): ActionParam {
  return {
    key: 'ratio',
    kind: 'ratio',
    label: '比例',
    type: 'select',
    default: defaultValue,
    options: values.map((v) => ({ label: v, value: v })),
  }
}

const RATIO_IMAGE_DOUBAO = ratio('16:9', ['1:1', '3:4', '4:3', '9:16', '16:9', '3:2'])
const RATIO_IMAGE_DOLA = ratio('1:1', ['1:1', '2:3', '3:4', '4:3', '9:16', '16:9'])
const RATIO_IMAGE_CHATGPT = ratio('1:1', ['1:1', '2:3', '3:4', '4:3', '9:16', '16:9'])
const RATIO_IMAGE_APIMART = ratio('1:1', [
  '1:1', '3:2', '2:3', '4:3', '3:4', '5:4', '4:5', '16:9', '9:16', '2:1', '1:2', '3:1', '1:3', '21:9', '9:21',
])
const RATIO_VIDEO_DOUBAO = ratio('16:9', ['1:1', '3:4', '4:3', '9:16', '16:9', '21:9'])
const RATIO_VIDEO_DOLA = ratio('16:9', ['1:1', '3:4', '4:3', '9:16', '16:9', '21:9'])
const RATIO_VIDEO_SEEDANCE = ratio('16:9', ['16:9', '9:16'])

/** 时长（滑块）：豆包 auto 模式 4-10s */
const DURATION_DOUBAO_AUTO: ActionParam = {
  key: 'durationSec', kind: 'duration', label: '时长', type: 'number', min: 4, max: 10, step: 1, default: 5, unit: '秒',
}
/** 时长（按钮网格）：dola 只有 5 / 10 两档 */
const DURATION_DOLA_AUTO: ActionParam = {
  key: 'durationSec', kind: 'duration', label: '时长', type: 'number', default: 5,
  options: [{ label: '5秒', value: '5' }, { label: '10秒', value: '10' }],
}
const DURATION_DOUBAO_API: ActionParam = {
  key: 'duration', kind: 'duration', label: '时长', type: 'number', min: 4, max: 15, step: 1, default: 10, unit: '秒',
}
const DURATION_SEEDANCE: ActionParam = {
  key: 'duration', kind: 'duration', label: '时长', type: 'number', min: 4, max: 180, step: 1, default: 5, unit: '秒',
}

const RESOLUTION_APIMART: ActionParam = {
  key: 'resolution', kind: 'resolution', label: '分辨率', type: 'select', default: '1k',
  options: [{ label: '1K (标清)', value: '1k' }, { label: '2K (高清)', value: '2k' }, { label: '4K (超清)', value: '4k' }],
}
const COUNT_APIMART: ActionParam = {
  key: 'n', kind: 'count', label: '数量', type: 'number', default: 1, min: 1, max: 10, step: 1,
}
const CAMERA_DOUBAO: ActionParam = {
  key: 'cameraMovement', kind: 'camera', label: '运镜', type: 'select',
  options: [
    { label: '固定镜头', value: '固定镜头' },
    { label: '镜头环绕', value: '镜头环绕拍摄' },
    { label: '镜头移动', value: '镜头移动' },
    { label: '镜头聚焦', value: '镜头聚焦' },
  ],
}
const FORMAT_VOLC: ActionParam = {
  key: 'format', kind: 'format', label: '格式', type: 'select', default: 'wav',
  options: [{ label: 'WAV', value: 'wav' }, { label: 'MP3', value: 'mp3' }, { label: 'OGG Opus', value: 'ogg_opus' }],
}
function speed(key: string, label: string, min: number, max: number, def: number): ActionParam {
  return { key, kind: 'speed', label, type: 'number', min, max, step: 5, default: def }
}

/** 音色（豆包 TTS）：与 web2api 的 voices 表必须一致，否则"照名字选、出来另一个人" */
const SPEAKER_DOUBAO: ActionParam = {
  key: 'speaker', kind: 'speaker', label: '音色', type: 'select',
  default: 'zh_female_xiaohe_conversation_wvae_bigtts',
  options: [
    { label: '温柔桃子（升级版）', value: 'zh_female_wenroutaozi_v2_mars_bigtts' },
    { label: '磁性俊宇（升级版）', value: 'zh_male_nuanxinshizhe_mars_bigtts' },
    { label: '阳光甜妹（升级版）', value: 'zh_female_xiaohe_conversation_wvae_bigtts' },
    { label: '知性小棠', value: 'zh_female_wenroutaozi_mars_bigtts' },
    { label: '邻家女孩', value: 'zh_female_f261_conversation_wvae_bigtts' },
    { label: '魅力苏菲', value: 'zh_female_sophie_conversation_wvae_bigtts' },
    { label: '邻家男孩', value: 'zh_male_linjiananhai_moon_bigtts' },
    { label: '温暖阿虎', value: 'zh_male_ahu_conversation_wvae_bigtts' },
    { label: '腹黑霸总', value: 'ICL_c021bc19bf92' },
    { label: '高冷御姐', value: 'zh_female_leidian_conversation_wvae_bigtts' },
    { label: '沉稳皓轩', value: 'ICL_5a413fbc14fc' },
    { label: '甜美小雪', value: 'ICL_6acf86286e24' },
  ],
}

/**
 * 全部预置动作。**顺序即前端下拉顺序**（order 小的在前）。
 * 图片与视频优先走 dola / 豆包的 UI 自动化（auto）模式。
 */
export const WEB2API_ACTIONS: ActionDef[] = [
  // ==================== 图片 ====================
  {
    id: 'web2api:doubao-image-seedream45', tool: 'doubao/chat-auto', model: 'Seedream 4.5',
    title: '豆包 Seedream 4.5', description: '豆包网页 UI 自动化生图（Seedream 4.5）：比例可选；风格写在提示词里',
    group: 'web2api · 图片', nodeTypes: ['image'], needsPrompt: true,
    promptMode: 'chat-auto', mediaMode: 'image', fields: [RATIO_IMAGE_DOUBAO], order: 10,
  },
  {
    id: 'web2api:doubao-image-seedream50lite', tool: 'doubao/chat-auto', model: 'Seedream 5.0 Lite',
    title: '豆包 Seedream 5.0 Lite', description: '豆包网页 UI 自动化生图（Seedream 5.0 Lite）：比例可选',
    group: 'web2api · 图片', nodeTypes: ['image'], needsPrompt: true,
    promptMode: 'chat-auto', mediaMode: 'image', fields: [RATIO_IMAGE_DOUBAO], order: 11,
  },
  {
    id: 'web2api:dola-image-seedream50pro', tool: 'dola/chat-auto', model: 'Seedream 5.0 Pro',
    title: 'Dola Seedream 5.0 Pro', description: 'Dola 网页 UI 自动化生图（Seedream 5.0 Pro）；需海外网络',
    group: 'web2api · 图片', nodeTypes: ['image'], needsPrompt: true,
    promptMode: 'chat-auto', mediaMode: 'image', fields: [RATIO_IMAGE_DOLA], order: 12,
  },
  {
    id: 'web2api:chatgpt-image', tool: 'chatgpt/generate-image',
    title: 'ChatGPT 官方', description: 'ChatGPT 官方渠道（image_gen，需登录态）：比例可选',
    group: 'web2api · 图片', nodeTypes: ['image'], needsPrompt: true,
    promptMode: 'plain', fields: [RATIO_IMAGE_CHATGPT], order: 13,
  },
  {
    id: 'web2api:apimart-image', tool: 'apimart/generate-image',
    title: 'GPT Image 2（API）', description: 'APIMart 中转（GPT Image 2）：比例 / 分辨率 / 张数可选',
    group: 'web2api · 图片', nodeTypes: ['image'], needsPrompt: true,
    promptMode: 'plain', fields: [RATIO_IMAGE_APIMART, RESOLUTION_APIMART, COUNT_APIMART], order: 14,
  },

  // ==================== 视频 ====================
  {
    id: 'web2api:doubao-video-fast', tool: 'doubao/chat-auto', model: 'Seedance 2.0 Fast',
    title: '豆包 Seedance 2.0 Fast', description: '豆包网页 UI 自动化生视频：比例 / 时长 4-10 秒',
    group: 'web2api · 视频', nodeTypes: ['video'], needsPrompt: true,
    promptMode: 'chat-auto', mediaMode: 'video', fields: [RATIO_VIDEO_DOUBAO, DURATION_DOUBAO_AUTO], order: 10,
  },
  {
    id: 'web2api:dola-video-seedance25', tool: 'dola/chat-auto', model: 'Seedance 2.5',
    title: 'Dola Seedance 2.5', description: 'Dola 网页 UI 自动化生视频：时长只有 5 / 10 秒；需海外网络',
    group: 'web2api · 视频', nodeTypes: ['video'], needsPrompt: true,
    promptMode: 'chat-auto', mediaMode: 'video', fields: [RATIO_VIDEO_DOLA, DURATION_DOLA_AUTO], order: 11,
  },
  {
    id: 'web2api:doubao-video-api-mini', tool: 'doubao/generate-video', model: 'seedance_v2.0_mini',
    title: '豆包 Seedance 2.0 Mini（接口）', description: '豆包接口式文生视频（异步轮询）：比例 / 时长 / 运镜',
    group: 'web2api · 视频', nodeTypes: ['video'], needsPrompt: true,
    promptMode: 'plain', fields: [RATIO_VIDEO_DOUBAO, DURATION_DOUBAO_API, CAMERA_DOUBAO], order: 12,
  },
  {
    id: 'web2api:seedance-video-fast', tool: 'seedance/generate-video', model: 'fast',
    title: 'Seedance Fast', description: 'Seedance 平台接口式文生视频（异步轮询）：时长最长 180 秒',
    group: 'web2api · 视频', nodeTypes: ['video'], needsPrompt: true,
    promptMode: 'plain', fields: [RATIO_VIDEO_SEEDANCE, DURATION_SEEDANCE], order: 13,
  },

  // ==================== 音频 ====================
  {
    id: 'web2api:doubao-tts', tool: 'doubao/tts',
    title: '豆包·语音合成', description: '文本转语音（不开浏览器，不耗视频积分）：选音色即可',
    group: 'web2api · 音频', nodeTypes: ['audio'], needsPrompt: true,
    promptMode: 'plain', fields: [SPEAKER_DOUBAO], order: 10,
  },
  {
    id: 'web2api:volcengine-audio', tool: 'volcengine/generate-audio',
    title: '火山引擎·音频生成', description: 'seed-audio 音频生成：格式 / 语速 / 音量 / 音调可调',
    group: 'web2api · 音频', nodeTypes: ['audio'], needsPrompt: true,
    promptMode: 'plain',
    fields: [FORMAT_VOLC, speed('speechRate', '语速', -50, 100, 0), speed('pitchRate', '音调', -12, 12, 0), speed('loudnessRate', '音量', -50, 100, 0)],
    order: 11,
  },
]

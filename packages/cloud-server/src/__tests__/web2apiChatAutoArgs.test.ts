/**
 * chat-auto 的参数拼装 —— 锁住一个真出过的坑（2026-10-14 用户实测）。
 *
 * 现场：从云端下单豆包 / dola 的自动生成（chat-auto）时，比例、时长、模型全都没生效，
 * 生成的画面是平台默认值。用户原话：「它的提示词开头是这样写的
 * /video({model:"Seedance 2.0", ratio:"9:16", durationSec:10})，而你完全是以文本的形式来写，这是错误的」。
 *
 * 根因：cloud-server 把参数拼成了**空格分隔的纯文本**
 * （`/video Seedance 2.0 Fast 9:16 10s`），而 web2api 的解析器
 * （`server/src/platforms/_shared/chat-auto/prefix.ts` 的 parsePrompt）只认
 * **圆括号里的键值对**：`/video({model:"…", ratio:"…", durationSec:10}) 正文`。
 * 纯文本形式解析出来的 params 是空的，模型/比例/时长全被当成正文发给了平台。
 *
 * 契约（与 web2api 解析器逐条对齐）：前缀必须长成
 *   /<image|video>(<key>:<字面量>, …) <正文>
 * 其中字符串值加引号、数字不加引号；没值的键不写；正文为空时不留尾部空格。
 * 前端那份（plugin-web2api-tools 的 chatAutoPrompt）本来就是对的，这里补齐云端那份。
 */
import { describe, it, expect } from 'vitest'
import { buildToolArgs, WEB2API_ACTIONS } from '../providers/web2api/index'
import type { ActionDef, JobInput } from '../providers/types'

/** 从动作表里取一条（动作 id 是稳定契约） */
function action(id: string): ActionDef {
  const a = WEB2API_ACTIONS.find((x) => x.id === id)
  if (!a) throw new Error('动作不存在: ' + id)
  return a
}

/** 组一次参数（不传 client：参考图逻辑不参与本文件的断言） */
function argsOf(id: string, input: Partial<JobInput>): Promise<Record<string, unknown>> {
  return buildToolArgs(action(id), { canvasId: 'c1', nodeId: 'n1', actionId: id, ...input })
}

describe('chat-auto 前缀必须是 web2api 认的括号参数形式', () => {
  it('视频：模型 / 比例 / 时长进括号（数字不加引号），正文跟在后面', async () => {
    const args = await argsOf('web2api:doubao-video-fast', {
      prompt: '一只猫在跑',
      values: { ratio: '9:16', durationSec: 10 },
    })
    expect(args.prompt).toBe('/video(model:"Seedance 2.0 Fast", ratio:"9:16", durationSec:10) 一只猫在跑')
  })

  it('图片：模型 / 比例进括号', async () => {
    const args = await argsOf('web2api:doubao-image-seedream45', {
      prompt: '夕阳下的城市',
      values: { ratio: '16:9' },
    })
    expect(args.prompt).toBe('/image(model:"Seedream 4.5", ratio:"16:9") 夕阳下的城市')
  })

  it('媒体参数不能散落在工具参数里（chat-auto 只有 prompt 与 referenceImages 两个入参位）', async () => {
    const args = await argsOf('web2api:doubao-video-fast', {
      prompt: '一只猫在跑',
      values: { ratio: '9:16', durationSec: 10 },
    })
    expect(args.ratio).toBeUndefined()
    expect(args.durationSec).toBeUndefined()
    expect(args.model).toBeUndefined()
  })

  it('没值的键不写进前缀（让平台走自己的默认）', async () => {
    const args = await argsOf('web2api:doubao-image-seedream45', {
      prompt: '画画',
      values: { ratio: '' },
    })
    expect(args.prompt).toBe('/image(model:"Seedream 4.5") 画画')
  })

  it('正文为空时只发前缀，不留尾部空格', async () => {
    const args = await argsOf('web2api:doubao-video-fast', {
      prompt: '   ',
      values: { ratio: '16:9', durationSec: 5 },
    })
    expect(args.prompt).toBe('/video(model:"Seedance 2.0 Fast", ratio:"16:9", durationSec:5)')
  })

  it('上游文本素材并进正文（服务端没有文本附件入参位）', async () => {
    const args = await argsOf('web2api:doubao-video-fast', {
      prompt: '一只猫在跑',
      values: { ratio: '16:9', durationSec: 5 },
      resources: [{ kind: 'text', value: '补充说明' }],
    })
    expect(args.prompt).toBe('/video(model:"Seedance 2.0 Fast", ratio:"16:9", durationSec:5) 一只猫在跑\n补充说明')
  })

  it('时长写字符串也拼成数字（dola 的按钮档位给的就是字符串）', async () => {
    const args = await argsOf('web2api:dola-video-seedance25', {
      prompt: '一只猫在跑',
      values: { ratio: '9:16', durationSec: '10' },
    })
    expect(args.prompt).toBe('/video(model:"Seedance 2.5", ratio:"9:16", durationSec:10) 一只猫在跑')
  })
})

describe('全部 chat-auto 动作都产出可解析的前缀（不是空格分隔的纯文本）', () => {
  const chatAuto = WEB2API_ACTIONS.filter((a) => a.promptMode === 'chat-auto')

  it('至少要有图片与视频两类动作（覆盖齐全才有意义）', () => {
    expect(chatAuto.some((a) => a.mediaMode === 'video')).toBe(true)
    expect(chatAuto.some((a) => a.mediaMode === 'image')).toBe(true)
  })

  it('每条都长成 /image(…) 或 /video(…)，且模型作为 key:value 进括号', async () => {
    for (const a of chatAuto) {
      const values: Record<string, unknown> = {}
      for (const f of a.fields ?? []) values[f.key] = f.default
      const args = await argsOf(a.id, { prompt: '正文', values })
      const head = String(args.prompt)
      const wantHead = a.mediaMode === 'video' ? '/video(' : '/image('
      expect(head.startsWith(wantHead), a.id + ' 的前缀开头不对: ' + head).toBe(true)
      // 模型名必须作为括号里的键值出现（这正是用户指出的"以文本形式写"的错误形态）
      if (a.model) {
        expect(head, a.id).toContain('model:"' + a.model + '"')
      }
      // 正文必须还在（没有被吃掉）
      expect(head.endsWith('正文'), a.id + ' 的正文丢了: ' + head).toBe(true)
    }
  })
})

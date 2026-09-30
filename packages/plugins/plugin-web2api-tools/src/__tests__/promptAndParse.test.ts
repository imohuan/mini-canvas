/**
 * chat-auto 前缀拼装 + MCP 响应解析（纯函数，node 环境）。
 *
 * 这两段是"执行方式"的核心：拼错前缀 = 参数根本没生效（服务端只认这四种键）；
 * 解错响应 = 资源地址丢 origin（相对地址直接塞进 <img> 会被当同源路径 404）。
 */
import { describe, it, expect } from 'vitest'
import { buildChatAutoPrompt, normalizeDurationSec } from '../chatAutoPrompt'
import { absolutize, resultFromCall, urlsFromContent, urlsFromTask, isTaskDone } from '../mcpParse'

describe('buildChatAutoPrompt', () => {
  it('图片：model + ratio 进括号，正文跟在后面', () => {
    expect(buildChatAutoPrompt({ mode: 'image', model: 'Seedream 4.5', ratio: '16:9' }, '夕阳下的城市')).toBe(
      '/image(model:"Seedream 4.5", ratio:"16:9") 夕阳下的城市',
    )
  })

  it('视频：含数字时长（数字不加引号）', () => {
    expect(
      buildChatAutoPrompt({ mode: 'video', model: 'Seedance 2.0 Fast', ratio: '9:16', durationSec: 10 }, '一只猫在跑'),
    ).toBe('/video(model:"Seedance 2.0 Fast", ratio:"9:16", durationSec:10) 一只猫在跑')
  })

  it('只写服务端认得的四个键（别的参数不进前缀，免得没人读）', () => {
    const out = buildChatAutoPrompt({ mode: 'video', ratio: '16:9' }, 'x')
    expect(out).not.toContain('cameraMovement')
  })

  it('空值被跳过（没选就不写，让服务端走自己的默认）', () => {
    expect(buildChatAutoPrompt({ mode: 'image', model: '', ratio: '1:1' }, 'x')).toBe('/image(ratio:"1:1") x')
  })

  it('正文为空时只发前缀指令（不产生尾部空格）', () => {
    expect(buildChatAutoPrompt({ mode: 'video', ratio: '16:9' }, '   ')).toBe('/video(ratio:"16:9")')
  })

  it('一个参数都没有时就是裸前缀', () => {
    expect(buildChatAutoPrompt({ mode: 'image' }, '画画')).toBe('/image 画画')
  })

  it('正文里的双引号不会破坏前缀语法（值两侧引号是拼接用的）', () => {
    expect(buildChatAutoPrompt({ mode: 'image', ratio: '1:1' }, 'say "hi"')).toBe('/image(ratio:"1:1") say "hi"')
  })

  it('normalizeDurationSec 与服务端的取整口径一致（>=8 → 10，否则 5）', () => {
    expect(normalizeDurationSec(4)).toBe(5)
    expect(normalizeDurationSec(7)).toBe(5)
    expect(normalizeDurationSec(8)).toBe(10)
    expect(normalizeDurationSec(30)).toBe(10)
    expect(normalizeDurationSec(undefined)).toBeUndefined()
  })
})

describe('absolutize', () => {
  it('相对地址补服务端 origin', () => {
    expect(absolutize('/api/mcp/resources/videos/doubao/a.mp4', 'http://localhost:8033')).toBe(
      'http://localhost:8033/api/mcp/resources/videos/doubao/a.mp4',
    )
  })

  it('origin 末尾有斜杠也不会拼出双斜杠', () => {
    expect(absolutize('/api/x', 'http://localhost:8033/')).toBe('http://localhost:8033/api/x')
  })

  it('已是绝对地址的原样返回（data: / blob: / http）', () => {
    expect(absolutize('https://cdn.example.com/a.png', 'http://localhost:8033')).toBe('https://cdn.example.com/a.png')
    expect(absolutize('data:image/png;base64,AAA')).toBe('data:image/png;base64,AAA')
    expect(absolutize('blob:http://localhost/x')).toBe('blob:http://localhost/x')
  })
})

describe('resultFromCall', () => {
  it('resource 类型：相对 uri 补成绝对地址', () => {
    const out = resultFromCall(
      { content: [{ type: 'resource', resource: { uri: '/api/mcp/resources/images/doubao/a.png' } }] },
      'http://localhost:8033',
    )
    expect(out).toEqual({ ok: true, urls: ['http://localhost:8033/api/mcp/resources/images/doubao/a.png'], taskId: undefined, text: undefined })
  })

  it('异步：只回 taskId 时给 {ok:true, taskId}（还没资源）', () => {
    const out = resultFromCall(
      { content: [{ type: 'text', text: '任务已创建' }], structuredContent: { taskId: 'task-1' } },
      'http://localhost:8033',
    )
    expect(out.ok).toBe(true)
    expect(out.taskId).toBe('task-1')
    expect(out.urls).toBeUndefined()
  })

  it('isError：把服务端的"错误：xxx"前缀去掉后透传', () => {
    const out = resultFromCall({ content: [{ type: 'text', text: '错误：平台不存在: nope' }], isError: true })
    expect(out).toEqual({ ok: false, error: '平台不存在: nope' })
  })

  it('没有任何内容 → 明确失败（不返回空 ok）', () => {
    expect(resultFromCall({ content: [] }).ok).toBe(false)
  })
})

describe('urlsFromContent / urlsFromTask', () => {
  it('多个 resource 去重', () => {
    const urls = urlsFromContent(
      [
        { type: 'resource', resource: { uri: '/a.png' } },
        { type: 'resource', resource: { uri: '/a.png' } },
      ],
      'http://x',
    )
    expect(urls).toEqual(['http://x/a.png'])
  })

  it('文本里是 ResourceItem JSON（服务端漏分支时）也能取到地址', () => {
    const urls = urlsFromContent(
      [
        {
          type: 'text',
          text: '{"type":"audio","url":"/api/resources/audios/doubao/tts-ca5cb002.ogg","name":"x.ogg"}',
        },
      ],
      'http://localhost:8033',
    )
    expect(urls).toEqual(['http://localhost:8033/api/resources/audios/doubao/tts-ca5cb002.ogg'])
  })

  it('普通对话文本（不是 JSON）不会被误当成产物', () => {
    expect(urlsFromContent([{ type: 'text', text: '你好呀，有什么可以帮你？' }])).toEqual([])
  })

  it('文本里直接写 URL 也认（含非 mcp 前缀的资源路由）', () => {
    expect(urlsFromContent([{ type: 'text', text: '生成好了：/api/resources/audios/doubao/x.ogg' }], 'http://x')).toEqual([
      'http://x/api/resources/audios/doubao/x.ogg',
    ])
  })

  it('task 详情的 resources[].downloadUrl 会被补全', () => {
    expect(urlsFromTask({ resources: [{ downloadUrl: '/api/mcp/resources/videos/dola/v.mp4' }] }, 'http://x')).toEqual([
      'http://x/api/mcp/resources/videos/dola/v.mp4',
    ])
  })

  it('终态判定（completed / failed / cancelled）', () => {
    expect(isTaskDone('completed')).toBe(true)
    expect(isTaskDone('failed')).toBe(true)
    expect(isTaskDone('cancelled')).toBe(true)
    expect(isTaskDone('processing')).toBe(false)
    expect(isTaskDone(undefined)).toBe(false)
  })
})

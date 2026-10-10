/**
 * toolViews 单测 —— 按真实工具输出结构锁卡片数据（用例数据取自真机会话转录）。
 *
 * 用户口径（2026-10-07）：画布工具 = 自定义卡片（chips/media/rows/images/progress），
 * 收起行给人话摘要；fallback = 输入/输出直出（没有第二层原始 JSON）。
 *
 * 用户口径（2026-10-08 定稿）：卡片紧凑两行 —— 大数字瓦片没了（改成计数胶囊），
 * 图片节点/文件预览用 media 单行（40px 缩略图），资源列表只铺图、音频视频折成一句统计。
 */
import { describe, it, expect } from 'vitest'
import { toolFamily, toolView, toolBrief } from '../toolViews'

describe('toolBrief：折叠行后面那截「执行内容」（用户口径 2026-10-11）', () => {
  it('exec_command ⇒ 给**命令本身**（不是输出、也不是工具名）', () => {
    const args = JSON.stringify({ description: '列目录', cmd: 'Get-ChildItem -Path "D:\\x" -Recurse -File' })
    expect(toolBrief('exec_command', args)).toBe('Get-ChildItem -Path "D:\\x" -Recurse -File')
  })

  it('命令为空时退回 description（至少说明它要干什么）', () => {
    expect(toolBrief('exec_command', JSON.stringify({ description: '查找文件位置' }))).toBe('查找文件位置')
  })

  it('命令过长 ⇒ 截断加省略号（收起行只有一行）', () => {
    const long = 'echo ' + 'a'.repeat(200)
    const out = toolBrief('exec_command', JSON.stringify({ cmd: long }))
    expect(out.length).toBeLessThanOrEqual(61)
    expect(out.endsWith('…')).toBe(true)
  })

  it('read_file ⇒ 给文件名（全路径太长）', () => {
    expect(toolBrief('read_file', JSON.stringify({ file_path: 'D:\\a\\b\\pic.png' }))).toBe('pic.png')
  })

  it('入参坏了 / 认不出 ⇒ 返回空串（调用方回退，不编内容）', () => {
    expect(toolBrief('exec_command', 'not json')).toBe('')
    expect(toolBrief('mcp__other__whatever', JSON.stringify({ x: 1 }))).toBe('')
  })
})

describe('toolFamily', () => {
  it('按前缀分族（带 mcp__canvas__ 前缀）', () => {
    expect(toolFamily('mcp__canvas__canvas_get')).toBe('canvas')
    expect(toolFamily('mcp__canvas__resource_list')).toBe('resource')
    expect(toolFamily('mcp__canvas__generation_create')).toBe('generation')
    expect(toolFamily('read_file')).toBe('file')
    expect(toolFamily('mcp__other__whatever')).toBe('fallback')
  })
})

describe('toolView · 画布卡片', () => {
  it('canvas_overview：计数胶囊（节点/连线/类型分布一行）', () => {
    const v = toolView(
      'mcp__canvas__canvas_overview', '{}',
      JSON.stringify({ ok: true, nodeCount: 25, edgeCount: 11, types: { image: 17, audio: 4 } }),
    )
    expect(v.family).toBe('canvas')
    expect(v.heading).toBe('画布概览')
    const chips = v.blocks.find((x) => x.kind === 'chips')
    expect(chips && chips.kind === 'chips' && chips.items.map((i) => i.text + ':' + i.count)).toEqual([
      '节点:25', '连线:11', 'image:17', 'audio:4',
    ])
    expect(v.summary).toBe('25 节点 · 11 连线')
  })

  it('canvas_list_canvases：带图标行 + 当前徽标 + 数量徽章', () => {
    const v = toolView(
      'mcp__canvas__canvas_list_canvases', '{"canvasId":"c1"}',
      JSON.stringify({ ok: true, canvases: [{ id: 'c1', name: '我的画布' }, { id: 'c2', name: '另一个' }] }),
    )
    expect(v.badge).toBe('2 张')
    const rows = v.blocks.find((x) => x.kind === 'rows')
    expect(rows && rows.kind === 'rows' && rows.items[0]).toMatchObject({ title: '我的画布', icon: 'canvas', tag: '当前' })
    expect(v.summary).toBe('2 张画布')
  })

  it('canvas_get（单节点带图）：媒体单行（40px 缩略图 + 尺寸/坐标 + 相邻数）', () => {
    const v = toolView(
      'mcp__canvas__canvas_get', '{"canvasId":"c1","nodeId":"35"}',
      JSON.stringify({
        ok: true,
        node: { id: '35', type: 'image', position: { x: 1, y: 2 }, data: { label: '花海特写', nodeType: 'image', imageUrl: '/api/canvases/c1/resources/abc.jpeg' } },
        neighbors: [{ id: '12', type: 'image', data: { label: '图片 4' } }],
      }),
    )
    const media = v.blocks.find((x) => x.kind === 'media')
    expect(media && media.kind === 'media' && media.thumb).toBe('/api/canvases/c1/resources/abc.jpeg')
    expect(media && media.kind === 'media' && media.sub).toBe('相邻节点 1 个')
    // 标记（徽章）给「人话名字 · #id」；icoc 随节点类型
    expect(v.badge).toBe('花海特写 · #35')
    expect(v.icon).toBe('image')
    expect(v.summary).toBe('花海特写')
  })

  it('canvas_batch_nodes：新增/更新/删除瓦片 + 错误提示行', () => {
    const v = toolView(
      'mcp__canvas__canvas_batch_nodes', '{}',
      JSON.stringify({ ok: true, added: ['a', 'b'], deleted: [], updated: ['c'], errors: [{ message: '节点 9 不存在' }] }),
    )
    const chips = v.blocks.find((x) => x.kind === 'chips')
    expect(chips && chips.kind === 'chips' && chips.items.map((i) => i.text + ':' + i.count)).toEqual([
      '新增:2', '更新:1', '删除:0',
    ])
    expect(v.blocks.some((x) => x.kind === 'note' && x.tone === 'error' && x.text.includes('节点 9'))).toBe(true)
    expect(v.summary).toBe('+2 ~1 -0')
  })

  it('失败输出：卡片头「执行失败」+ 红字提示，摘要人话', () => {
    const v = toolView('mcp__canvas__canvas_get', '{}', '{"ok":false,"error":"节点不存在: 999"}')
    expect(v.heading).toBe('执行失败')
    expect(v.blocks[0]).toMatchObject({ kind: 'note', tone: 'error' })
    expect(v.summary).toBe('失败：节点不存在: 999')
  })
})

describe('toolView · 资源 / 生成卡片', () => {
  it('resource_list：缩略图网格 + 数量徽章', () => {
    const v = toolView(
      'mcp__canvas__resource_list', '{"canvasId":"c1"}',
      JSON.stringify({ ok: true, count: 2, resources: ['abc.jpeg', '3efb981add0e9e17'] }),
    )
    const imgs = v.blocks.find((x) => x.kind === 'images')
    expect(imgs && imgs.kind === 'images' && imgs.items).toHaveLength(2)
    expect(imgs && imgs.kind === 'images' && imgs.items[0].label).toBe('abc.jpeg')
    expect(v.badge).toBe('2 个')
  })

  it('generation_status：任务行 + 进度条 + 产物缩略图', () => {
    const v = toolView(
      'mcp__canvas__generation_status', '{"jobId":"j1","canvasId":"c1"}',
      JSON.stringify({ ok: true, job: { id: 'j1', status: 'running', progress: 40, canvasId: 'c1', result: { urls: ['/api/canvases/c1/resources/out.jpeg'] } } }),
    )
    const prog = v.blocks.find((x) => x.kind === 'progress')
    expect(prog && prog.kind === 'progress' && prog.value).toBe(40)
    const imgs = v.blocks.find((x) => x.kind === 'images')
    expect(imgs && imgs.kind === 'images' && imgs.items[0].src.includes('out.jpeg')).toBe(true)
    expect(v.summary).toBe('running 40%')
  })

  it('generation_actions：动作胶囊', () => {
    const v = toolView(
      'mcp__canvas__generation_actions', '{}',
      JSON.stringify({ ok: true, actions: [{ id: 'web2api:doubao-image-seedream45', title: 'seedream45' }] }),
    )
    const chips = v.blocks.find((x) => x.kind === 'chips')
    expect(chips && chips.kind === 'chips' && chips.items[0].text).toBe('seedream45')
    expect(v.badge).toBe('1 个')
  })
})

describe('toolView · fallback', () => {
  it('不认识的工具：fallback 原文 + 不产出卡片块', () => {
    const v = toolView('mcp__other__x', '{}', 'not json at all')
    expect(v.family).toBe('fallback')
    expect(v.raw).toBe('not json at all')
    expect(v.blocks).toHaveLength(0)
  })

  it('画布族但输出解析不了：回退 fallback（不崩）', () => {
    const v = toolView('mcp__canvas__canvas_get', '{}', 'garbage')
    expect(v.family).toBe('fallback')
    expect(v.raw).toBe('garbage')
  })

  it('MCP content 包装层：剥掉后照样走卡片（canvas_list_canvases）', () => {
    const inner = { ok: true, canvases: [{ id: 'c1', name: '演示画布' }] }
    const wrapped = JSON.stringify({ content: [{ type: 'text', text: JSON.stringify(inner) }] })
    const v = toolView('mcp__canvas__canvas_list_canvases', '{}', wrapped)
    expect(v.family).toBe('canvas')
    expect(v.heading).toBe('画布列表')
  })

  it('file 图片：能映射到服务端资源路由时给媒体单行（缩略图 + 读数徽章）', () => {
    // 用真实形态的路径（画布资源目录）—— 只有这种服务端才取得到字节
    const p = 'D:/x/.mini-canvas/canvases/c1/resources/pic.jpeg'
    const v = toolView('read_file', JSON.stringify({ file_path: p, canvasId: 'c1' }), 'image/png, 4.0 MB')
    const media = v.blocks.find((x) => x.kind === 'media')
    expect(media && media.kind === 'media' && media.thumb).toBe('/api/canvases/c1/resources/pic.jpeg')
    expect(v.badge).toBe('4.0 MB')
    expect(v.summary).toBe('pic.jpeg')
  })

  it('file 图片：路径映射不到服务端资源 → 退化成文件名行（不给必然裂图的 <img>）', () => {
    const v = toolView('read_file', JSON.stringify({ file_path: 'D:/x/pic.jpeg' }), 'image/png, 4.0 MB')
    const media = v.blocks.find((x) => x.kind === 'media')
    expect(media && media.kind === 'media' && media.thumb).toBeUndefined()
    expect(media && media.kind === 'media' && media.title).toBe('pic.jpeg')
    expect(v.summary).toBe('pic.jpeg')
  })
})

describe('卡片 vs 默认工具的分流（组件按 family 判断）', () => {
  it('画布 MCP 工具有卡片（family != fallback）→ 直接展示', () => {
    const v = toolView('mcp__canvas__canvas_overview', '{}', JSON.stringify({ ok: true, nodeCount: 1, edgeCount: 0, types: {} }))
    expect(v.family).not.toBe('fallback')
  })

  it('默认工具（exec_command 等）无卡片 → 保持折叠行', () => {
    const v = toolView('exec_command', '{"cmd":"ls"}', 'file1\nfile2')
    expect(v.family).toBe('fallback')
  })
})
describe('toolView · read_file 的图片预览地址（用户实测报的裂图）', () => {
  /**
   * 事故：read_file 传的是**本机绝对路径**，早先这里拼了 `/api/agent/file?path=…` ——
   * 那个路由服务端从来不存在，静态兜底把 index.html 返回给 <img>（HTML 当图片 = 永远裂图）。
   * 服务端真正能出字节的只有两条资源路由，所以这里钉：能映射就映射，映射不到就不给 <img>。
   */
  it('assets/files 下的绝对路径 → /api/assets/files/<hash>', () => {
    const p = 'D:\\Code\\Git\\mini-canvas\\packages\\cloud-server\\.mini-canvas\\assets\\files\\faaca433dafb2b75.jpeg'
    const v = toolView('read_file', JSON.stringify({ file_path: p }), 'image/jpeg, 3.7 MB')
    const media = v.blocks.find((b) => b.kind === 'media')
    expect(media && media.kind === 'media' && media.thumb).toBe('/api/assets/files/faaca433dafb2b75.jpeg')
    // 读数（大小）进徽章（用户口径 2026-10-08：卡片紧凑两行，标记贴右上）
    expect(v.badge).toBe('3.7 MB')
  })

  it('画布 resources 下的绝对路径 → /api/canvases/<canvasId>/resources/<hash>', () => {
    const p = 'D:\\x\\.mini-canvas\\canvases\\430c8f1f00bd4aba\\resources\\abc123.jpeg'
    const v = toolView('read_file', JSON.stringify({ file_path: p, canvasId: '430c8f1f00bd4aba' }), 'image/jpeg, 20 KB')
    const media = v.blocks.find((b) => b.kind === 'media')
    expect(media && media.kind === 'media' && media.thumb).toBe('/api/canvases/430c8f1f00bd4aba/resources/abc123.jpeg')
  })

  /**
   * 真缺陷（用户实测 2026-10-10，截图：读图片只显示一行文件名、看不到图）：
   * read_file 的入参**只有 file_path、没有 canvasId** —— 早先画布 id 只从入参取，
   * 于是恒为空 ⇒ 永远拼不出地址 ⇒ 永远退化成纯文本（图片永远出不来）。
   * 而画布资源的真实路径里**写着画布 id**（…/canvases/<id>/resources/<hash>）。
   */
  it('入参里没有 canvasId 时，从**路径**里认出画布 id（否则图片永远不显示）', () => {
    const p = 'D:\\Code\\Git\\mini-canvas\\packages\\cloud-server\\.mini-canvas\\canvases\\e5860e437dd04d51\\resources\\fd389505047498e5.png'
    const v = toolView('read_file', JSON.stringify({ file_path: p }), 'image/png, 2.1 MB')
    const media = v.blocks.find((b) => b.kind === 'media')
    expect(media && media.kind === 'media' && media.thumb).toBe(
      '/api/canvases/e5860e437dd04d51/resources/fd389505047498e5.png',
    )
  })

  it('映射不到（磁盘别处的图）→ **不给** 缩略图，只显示文件名（宁可不预览也不给裂图）', () => {
    const v = toolView('read_file', JSON.stringify({ file_path: 'C:\\Users\\me\\Desktop\\pic.png' }), 'image/png, 12 KB')
    const media = v.blocks.find((b) => b.kind === 'media')
    expect(media && media.kind === 'media' && media.thumb).toBeUndefined()
    expect(media && media.kind === 'media' && media.title).toBe('pic.png')
  })

  /** 别处的 /resources/（如 node_modules）不能被误认成画布资源、拼出一张必然 404 的图 */
  it('路径里的 /resources/ 不挨着 /canvases/ ⇒ 不认（不给裂图）', () => {
    const p = 'D:\\proj\\node_modules\\some-pkg\\resources\\logo.png'
    const v = toolView('read_file', JSON.stringify({ file_path: p }), 'image/png, 8 KB')
    const media = v.blocks.find((b) => b.kind === 'media')
    expect(media && media.kind === 'media' && media.thumb).toBeUndefined()
  })

  it('再也不出现已废弃的 /api/agent/file 地址', () => {
    const p = 'D:\\Code\\Git\\mini-canvas\\packages\\cloud-server\\.mini-canvas\\assets\\files\\faaca433dafb2b75.jpeg'
    const v = toolView('read_file', JSON.stringify({ file_path: p }), 'image/jpeg, 3.7 MB')
    expect(JSON.stringify(v)).not.toContain('/api/agent/file')
  })
})

describe('toolView · 展示地址与资源形态（用户 2026-10-08 报的「图片经常裂图」）', () => {
  /**
   * 事故：节点 50 的 imageUrl 是**资产地址** /api/assets/files/<hash>.jpeg，
   * 早先 resUrl 无视它直接拼 /api/canvases/<id>/resources/ + 它 → 双拼 404 裂图（真机复现）。
   * 契约：已是完整地址（http/https/data:/ 开头）→ 原样用；裸文件名 → 画布资源路由。
   */
  it('canvas_get 单节点：imageUrl 是资产地址 → src 原样（不再双拼）', () => {
    const v = toolView(
      'mcp__canvas__canvas_get', '{"canvasId":"c1","nodeId":"50"}',
      JSON.stringify({ ok: true, node: { id: '50', type: 'image', data: { nodeType: 'image', imageUrl: '/api/assets/files/ec96ba4464cbf531.jpeg' } } }),
    )
    const media = v.blocks.find((b) => b.kind === 'media')
    expect(media && media.kind === 'media' && media.thumb).toBe('/api/assets/files/ec96ba4464cbf531.jpeg')
  })

  it('canvas_get 视频 / 音频节点：不再把 videoUrl / audioUrl 塞进 <img>（必然裂图）', () => {
    const video = toolView(
      'mcp__canvas__canvas_get', '{"canvasId":"c1"}',
      JSON.stringify({ ok: true, node: { id: '7', type: 'video', data: { nodeType: 'video', videoUrl: '/api/canvases/c1/resources/clip.mp4' } } }),
    )
    const vm = video.blocks.find((b) => b.kind === 'media')
    expect(vm && vm.kind === 'media' && vm.thumb).toBeUndefined()
    const audio = toolView(
      'mcp__canvas__canvas_get', '{"canvasId":"c1"}',
      JSON.stringify({ ok: true, node: { id: '8', type: 'audio', data: { nodeType: 'audio', audioUrl: '/api/canvases/c1/resources/song.ogg' } } }),
    )
    const am = audio.blocks.find((b) => b.kind === 'media')
    expect(am && am.kind === 'media' && am.thumb).toBeUndefined()
  })

  it('generation_status：产物 url 是完整地址 → 原样；是文件名 → 拼画布资源地址', () => {
    const v = toolView(
      'mcp__canvas__generation_status', '{"jobId":"j1","canvasId":"c1"}',
      JSON.stringify({ ok: true, job: { id: 'j1', status: 'succeeded', progress: 100, canvasId: 'c1', result: { urls: ['/api/assets/files/out.jpeg', 'out2.jpeg'] } } }),
    )
    const imgs = v.blocks.find((b) => b.kind === 'images')
    expect(imgs && imgs.kind === 'images' && imgs.items.map((i) => i.src)).toEqual([
      '/api/assets/files/out.jpeg',
      '/api/canvases/c1/resources/out2.jpeg',
    ])
  })

  it('resource_list 富形态：图进缩略图条（用给定 url）、音频视频折成一句类型统计（用户口径 2026-10-08）', () => {
    const v = toolView(
      'mcp__canvas__resource_list', '{"canvasId":"c1"}',
      JSON.stringify({ ok: true, count: 3, resources: [
        { name: 'a.png', mime: 'image/png', kind: 'image', url: '/api/assets/files/a.png' },
        { name: 'x', mime: 'audio/ogg', kind: 'audio', url: '/api/canvases/c1/resources/x' },
        { name: 'v.mp4', mime: 'video/mp4', kind: 'video', url: '/api/canvases/c1/resources/v.mp4' },
      ] }),
    )
    const imgs = v.blocks.find((b) => b.kind === 'images')
    expect(imgs && imgs.kind === 'images' && imgs.items).toEqual([{ src: '/api/assets/files/a.png', label: 'a.png' }])
    // 非图**不再逐个成行**：折成一句类型统计，跟在缩略图条右侧
    expect(imgs && imgs.kind === 'images' && imgs.summary).toBe('1 图 · 1 音频 · 1 视频')
    expect(v.blocks.some((b) => b.kind === 'rows')).toBe(false)
    expect(v.badge).toBe('3 个')
    expect(v.summary).toBe('3 个资源')
  })

  it('resource_list 老形态（字符串数组）：仍全部进图片网格（原行为不回归）', () => {
    const v = toolView(
      'mcp__canvas__resource_list', '{"canvasId":"c1"}',
      JSON.stringify({ ok: true, count: 3, resources: ['a.png', 'b.jpeg', 'c.webp'] }),
    )
    const imgs = v.blocks.find((b) => b.kind === 'images')
    expect(imgs && imgs.kind === 'images' && imgs.items.map((i) => i.src)).toEqual([
      '/api/canvases/c1/resources/a.png',
      '/api/canvases/c1/resources/b.jpeg',
      '/api/canvases/c1/resources/c.webp',
    ])
    expect(v.blocks.some((b) => b.kind === 'rows')).toBe(false)
    expect(v.badge).toBe('3 个')
  })
})

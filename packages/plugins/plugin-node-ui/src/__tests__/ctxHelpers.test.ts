/**
 * ctx.file / ctx.save / ctx.temp —— 脚本侧的三个助手（2026-10-13 用户点名要的）。
 *
 * 钉的是「脚本不该自己拼地址」这件事：
 * 以前每个脚本都要写 `baseUrl + '/api/canvases/' + canvasId + '/resources?slot=' + nodeId + '&name=…'`，
 * 三处都容易漏（扩展名、content-type、encodeURIComponent）；用户的 video-grid.mjs 为此
 * 专门写了一段"推数据根 + 算内容哈希落盘"的绕路。
 *
 * 这里分两层测：**纯逻辑**（resolve.ts 的路径翻译）与 **bootstrap 代码形状**
 * （子进程里没有模块系统，那段代码是拼出来的字符串，只能断言形状 + 真机验行为）。
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { resolveLocalFile } from '../task/resolve'
import { BOOTSTRAP } from '../task/runner'
import { normalizeManualValues } from '../uiValues'

let root = ''
let workspace = ''
let dir = ''

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'mc-resolve-'))
  workspace = path.join(root, 'ws')
  dir = path.join(root, 'task-scripts')
  await fs.mkdir(path.join(root, 'canvases', 'default', 'resources'), { recursive: true })
  await fs.mkdir(path.join(root, 'assets', 'files'), { recursive: true })
  await fs.mkdir(workspace, { recursive: true })
  await fs.mkdir(dir, { recursive: true })
})
afterEach(async () => {
  await fs.rm(root, { recursive: true, force: true })
})

const env = () => ({ dataRoot: root, workspace, dir })

describe('resolveLocalFile —— 地址翻成磁盘路径（ctx.file 的核心）', () => {
  it('画布资源地址 → 本地文件', async () => {
    const f = path.join(root, 'canvases', 'default', 'resources', 'abcdef0123456789.mp4')
    await fs.writeFile(f, 'x')
    expect(resolveLocalFile('/api/canvases/default/resources/abcdef0123456789.mp4', env())).toBe(f)
  })

  it('★ 带 ?v=时间戳 也要认得（产物地址常带它，那是给浏览器刷缓存的，与文件无关）', async () => {
    const f = path.join(root, 'canvases', 'default', 'resources', 'slot-grid1.png')
    await fs.writeFile(f, 'x')
    expect(resolveLocalFile('/api/canvases/default/resources/slot-grid1.png?v=1791870000000', env())).toBe(f)
  })

  it('绝对地址（带 origin）也认', async () => {
    const f = path.join(root, 'canvases', 'default', 'resources', 'abcdef0123456789.mp4')
    await fs.writeFile(f, 'x')
    expect(
      resolveLocalFile('http://127.0.0.1:8865/api/canvases/default/resources/abcdef0123456789.mp4', env()),
    ).toBe(f)
  })

  it('上传资产地址 → 本地文件', async () => {
    const f = path.join(root, 'assets', 'files', 'abc123.jpeg')
    await fs.writeFile(f, 'x')
    expect(resolveLocalFile('/api/assets/files/abc123.jpeg', env())).toBe(f)
  })

  it('裸文件名：在工作目录里找得到就用', async () => {
    const f = path.join(workspace, 'in.mp4')
    await fs.writeFile(f, 'x')
    expect(resolveLocalFile('in.mp4', env())).toBe(f)
  })

  it('认不出 / 文件不存在 → undefined（返回原地址由调用方决定，不编一个假路径）', () => {
    expect(resolveLocalFile('/api/canvases/default/resources/不存在.mp4', env())).toBeUndefined()
    expect(resolveLocalFile('/api/assets/files/没有这个.png', env())).toBeUndefined()
    expect(resolveLocalFile('', env())).toBeUndefined()
  })

  it('路径穿越（../）被挡住', () => {
    expect(resolveLocalFile('../../../etc/passwd', env())).toBeUndefined()
  })
})

describe('Bootstrap 里的三个助手（拼出来的代码，只能断言形状）', () => {
  const code = BOOTSTRAP

  it('三个助手都挂上 ctx 了', () => {
    expect(code).toContain('save: async (data, name, opts)')
    expect(code).toContain('file: (raw) => resolveLocalFile(')
    expect(code).toContain('temp: (name) => resolvePath(')
  })

  it('save：默认落到**本节点自己的槽位**（不传 opts.slot 时用 nodeId）', () => {
    expect(code).toContain('const slot = (opts && opts.slot) ? String(opts.slot) : info.ctx.nodeId')
    expect(code).toContain('/resources?slot=')
  })

  it('save：字符串直接给也认（文本不用自己转字节）', () => {
    expect(code).toContain('typeof data === "string" ? new TextEncoder().encode(data)')
  })

  it('save：扩展名从文件名取、MIME 查表（认不出回落 octet-stream）', () => {
    expect(code).toContain('const ext = dot >= 0 ? fileName.slice(dot) : ""')
    expect(code).toContain('|| "application/octet-stream"')
    // 四种类型都在表里：图片 / 视频 / 音频 / 文本
    expect(code).toContain('".png": "image/png"')
    expect(code).toContain('".mp4": "video/mp4"')
    expect(code).toContain('".mp3": "audio/mpeg"')
    expect(code).toContain('".txt": "text/plain"')
  })

  it('save：拿不到后台地址时**明确报错**，不静默失败', () => {
    expect(code).toContain('"拿不到后台地址（ctx.baseUrl 为空），无法保存产物"')
  })

  /**
   * 产物回写节点字段 —— 让下游（底栏 / 图片对比）认得出类型。
   *
   * 走**增量口**而不是让宿主代写：并发交产物有后台那把写锁串着，且非默认画布也写得进去
   * （宿主直连的那份 doc 只管默认画布）。
   */
  describe('save → 写节点字段', () => {
    it('默认落本节点槽位时，四种类型映射到四个字段名', () => {
      expect(code).toContain('? "videoUrl"')
      expect(code).toContain('? "audioUrl"')
      expect(code).toContain('? "text" : "imageUrl"')
      expect(code).toContain('uiOutputUrl: j.url')
    })

    /**
     * 文本那一支给的是**正文**，不是地址。
     *
     * 下游（底栏 collectUpstreamMaterials / 文本节点）读的 `data.text` 一直是**内容**，
     * 不是 URL。以前打包进 imageUrl 的地址算错，把地址当正文更错。
     */
    it('★ text 字段写正文（不是地址）', () => {
      expect(code).toContain('if (field === "text") patch.text = typeof data === "string" ? data : new TextDecoder().decode(bytes)')
      expect(code).toContain('else patch[field] = versioned')
    })

    it('走增量口（写锁在后台那一侧，非默认画布也写得到）', () => {
      expect(code).toContain('/nodes\", {')
      expect(code).toContain('update: [{ id: info.ctx.nodeId, data: patch }]')
      // 写节点字段失败不该把这次调用判失败：产物已经存好了，只往日志说一声
      expect(code).toContain('产物已存，但写节点字段没成功')
    })

    it('★ 显式存到**别的槽位**时不动节点字段（那不是本节点的产物）', () => {
      expect(code).toContain('if (!(opts && opts.slot) || opts.slot === info.ctx.nodeId) {')
    })
  })

  it('file：认不出时**返回原值**（让 ffmpeg 走地址，而不是拿到一个假路径）', () => {
    expect(code).toContain('resolveLocalFile(String(raw), info.ctx) || String(raw)')
  })

  /**
   * 参数归一（normalizeManualValues）—— 数组 / 对象**要留着**。
   * 为什么改：界面 setInputs 交上来的笔迹就是数组。以前只收标量，那些会被丢掉 ——
   * 等于交上去了、自己在页面里读不到（用户口径：没有状态，它就是参数）。
   */
  describe('normalizeManualValues —— 参数归一', () => {
    it('标量 / 数组 / 对象都收；函数这类丢掉', () => {
      expect(normalizeManualValues({ a: 1, b: [1], c: { x: 2 }, d: () => 1 })).toEqual({
        a: 1, b: [1], c: { x: 2 },
      })
    })
    it('非对象 → 空', () => {
      expect(normalizeManualValues(null)).toEqual({})
      expect(normalizeManualValues([1, 2])).toEqual({})
    })
  })
})


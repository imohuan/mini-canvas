import { describe, it, expect } from 'vitest'
import {
  buildSrcdoc,
  buildUiPrompt,
  extractHtml,
  normalizeInputKey,
  normalizeInputs,
  normalizeUpstream,
  removeInputAt,
  serializeForScript,
  toCloneableState,
  upsertInput,
} from '../uiData'

/**
 * 交给 postMessage 之前必须「去代理」（2026-10-13 真机定位）。
 *
 * 节点 data 经 VueFlow 到组件 props 是 Vue 的响应式**代理**，而 postMessage 的
 * 结构化克隆遇到代理对象会抛 DataCloneError，且是同步抛 —— 被外层空 catch 吞掉后，
 * 表现就是「宿主以为发了、页面一条没收到、也没有任何报错」，
 * 后果是刷新后笔迹回不来、还顺手把槽位图覆盖成空白的。
 */
describe('状态去代理（postMessage 之前）', () => {
  it('把对象往返成普通对象（不再是原引用）', () => {
    const src = { v: 1, strokes: [{ t: 'pen', c: '#e0342b', s: 12, p: [[0.1, 0.2]] }] }
    const out = toCloneableState(src)
    expect(out).toEqual(src)
    expect(out).not.toBe(src)
  })

  it('嵌套的数组/对象也换新（浅拷贝不够：笔画里的点数组也得换）', () => {
    const src = { strokes: [{ p: [[0, 0], [1, 1]] }] }
    const out = toCloneableState(src)
    expect(out.strokes).not.toBe(src.strokes)
    expect(out.strokes[0].p).not.toBe(src.strokes[0].p)
  })

  it('代理对象也能落成普通对象', () => {
    const prox = new Proxy({ strokes: [] as unknown[] }, {})
    expect(toCloneableState(prox)).toEqual({ strokes: [] })
  })

  it('原始值原样返回', () => {
    expect(toCloneableState(undefined)).toBeUndefined()
    expect(toCloneableState(7)).toBe(7)
    expect(toCloneableState('x')).toBe('x')
  })
})

describe('输入参数声明（AI 靠这张表理解数据）', () => {
  it('有合法 key + type 才算一条，其余丢掉', () => {
    const out = normalizeInputs([
      { key: 'sales', type: 'table' },
      { key: 'title', type: 'text', note: '标题' },
      { key: '', type: 'text' },
      { key: 'x', type: '不存在的类型' },
      null,
      'nope',
      { type: 'text' },
    ])
    expect(out).toEqual([
      { key: 'sales', type: 'table' },
      { key: 'title', type: 'text', note: '标题' },
    ])
  })

  it('同 key 重复只留一条（后到的覆盖）', () => {
    const out = normalizeInputs([
      { key: 'a', type: 'text' },
      { key: 'a', type: 'number' },
    ])
    expect(out).toEqual([{ key: 'a', type: 'number' }])
  })

  it('键里的空白与引号被去掉（生成的 HTML 要能直接索引它）', () => {
    expect(normalizeInputKey(" sales 'total' ")).toBe('salestotal')
    expect(normalizeInputKey('a.b(c)')).toBe('a_b_c_')
  })

  it('upsert：同 key 覆盖、新 key 追加', () => {
    let list = normalizeInputs([{ key: 'a', type: 'text' }])
    list = upsertInput(list, { key: 'a', type: 'number' })
    expect(list).toEqual([{ key: 'a', type: 'number' }])
    list = upsertInput(list, { key: 'b', type: 'text' })
    expect(list.map((d) => d.key)).toEqual(['a', 'b'])
  })

  it('删除越界不抛、原样返回', () => {
    const list = normalizeInputs([{ key: 'a', type: 'text' }])
    expect(removeInputAt(list, 5)).toEqual(list)
    expect(removeInputAt(list, -1)).toEqual(list)
    expect(removeInputAt(list, 0)).toEqual([])
  })
})

describe('上游素材归一', () => {
  it('既没地址又没内容的空素材丢掉', () => {
    const out = normalizeUpstream([
      { refName: '图片1', kind: 'image', url: '/a.png' },
      { refName: '空的', kind: 'text' },
      { kind: 'text', value: '正文' },
      'nope',
    ])
    expect(out).toEqual([
      { refName: '图片1', kind: 'image', url: '/a.png' },
      // 名字缺省时按 kind 各自编号（与底栏 collectUpstreamMaterials 同一套口径）
      { refName: '文本1', kind: 'text', value: '正文' },
    ])
  })

  it('不是数组 = 空（不抛）', () => {
    expect(normalizeUpstream(undefined)).toEqual([])
    expect(normalizeUpstream({ a: 1 })).toEqual([])
  })

  it('★ 只有 resourceId 的素材也要保留（新节点只写引用，地址现取）', () => {
    const out = normalizeUpstream([
      { refName: '图片1', kind: 'image', resourceId: 'default/abc.png' },
      { kind: 'video', resourceId: 'res-7' },
    ])
    expect(out).toEqual([
      { refName: '图片1', kind: 'image', resourceId: 'default/abc.png' },
      { refName: '视频1', kind: 'video', resourceId: 'res-7' },
    ])
  })
})

describe('提示词（把数据契约讲清楚）', () => {
  const req = {
    prompt: '画成柱状图',
    inputs: [
      { key: 'sales', type: 'table' as const, note: '每月销量' },
      { key: 'cover', type: 'image' as const },
    ],
    upstream: [{ refName: '图片1', kind: 'image', url: '/api/x.png' }],
  }

  it('带上硬性约束与数据来源', () => {
    const p = buildUiPrompt(req)
    expect(p).toContain('不要** markdown 代码块')
    expect(p).toContain('不许外链')
    expect(p).toContain('绝对地址')
    expect(p).toContain('window.__CANVAS_INPUTS__')
    expect(p).toContain('window.__CANVAS_UPSTREAM__')
  })

  it('给了后台地址就教 AI 怎么调接口（能真的操作画布）', () => {
    const p = buildUiPrompt({ ...req, baseUrl: 'http://localhost:8865', canvasId: 'c1', nodeId: '7' })
    expect(p).toContain('base = http://localhost:8865')
    expect(p).toContain('canvasId = c1')
    expect(p).toContain('本节点 id = 7')
    expect(p).toContain('/api/canvases/')
    expect(p).toContain('PUT')
  })

  it('没有后台地址时明确要求只能纯展示', () => {
    const p = buildUiPrompt(req)
    expect(p).toContain('不要**尝试发任何网络请求')
    expect(p).not.toContain('## 你可以操作画布')
  })

  it('上游素材带上节点 id（操作画布时要按 id 找到它）', () => {
    const p = buildUiPrompt({ ...req, upstream: [{ refName: '图片1', kind: 'image', url: '/a.png', nodeId: '9' }] })
    expect(p).toContain('节点 id 9')
  })

  it('把声明的键与类型念给 AI 听', () => {
    const p = buildUiPrompt(req)
    expect(p).toContain('sales')
    expect(p).toContain('表格')
    expect(p).toContain('每月销量')
    expect(p).toContain('cover')
    expect(p).toContain('图片地址')
  })

  it('上游素材带上地址与引用名', () => {
    const p = buildUiPrompt(req)
    expect(p).toContain('图片1')
    expect(p).toContain('/api/x.png')
  })

  it('没声明参数时明确说明，而不是留一片空白', () => {
    const p = buildUiPrompt({ prompt: '', inputs: [], upstream: [] })
    expect(p).toContain('还没声明任何参数')
    expect(p).toContain('没有连任何素材')
  })

  it('改了第二次时把上一次的实现带上（在它基础上改）', () => {
    const p = buildUiPrompt({ ...req, previousHtml: '<div>旧界面</div>' })
    expect(p).toContain('现有实现')
    expect(p).toContain('<div>旧界面</div>')
  })
})

describe('抠 HTML（模型爱包壳）', () => {
  it('剥掉 markdown 代码块', () => {
    expect(extractHtml('~~~html\n<div>hi</div>\n~~~'.split('~~~').join('```'))).toBe('<div>hi</div>')
  })

  it('剥掉开场白，从第一个标签开始', () => {
    expect(extractHtml('好的，我为你生成了下面的界面：\n<div>hi</div>')).toBe('<div>hi</div>')
  })

  it('完整文档原样保留', () => {
    const doc = '<!DOCTYPE html><html><body>x</body></html>'
    expect(extractHtml(doc)).toBe(doc)
  })

  it('不是字符串 = 空串', () => {
    expect(extractHtml(undefined)).toBe('')
    expect(extractHtml(42)).toBe('')
  })
})

describe('注入脚本的安全性（这是唯一可能被生成物利用的地方）', () => {
  it('内容里的 </script> 被转义，拼不出结束标签', () => {
    const s = serializeForScript({ v: '</script><img onerror=alert(1)>' })
    expect(s).not.toContain('</script>')
    expect(s).toContain('\\u003c')
    // 转义后仍是合法 JSON，语义不变
    expect(JSON.parse(s)).toEqual({ v: '</script><img onerror=alert(1)>' })
  })

  it('行分隔符 U+2028/U+2029 被转掉（否则脚本会语法错）', () => {
    const s = serializeForScript({ v: 'a\u2028b\u2029c' })
    expect(s).toContain('\\u2028')
    expect(s).toContain('\\u2029')
  })

  it('循环引用不抛，退化成 null', () => {
    const o: Record<string, unknown> = {}
    o.self = o
    expect(serializeForScript(o)).toBe('null')
  })
})

describe('组装渲染文档', () => {
  const inputs = { sales: [1, 2, 3] }
  const upstream = [{ refName: '图片1', kind: 'image' as const, url: '/a.png' }]

  it('片段被包成完整文档，且带上数据与 CSP', () => {
    const doc = buildSrcdoc('<div>hi</div>', inputs, upstream, { theme: 'dark', nodeId: '3' })
    expect(doc).toContain('<!DOCTYPE html>')
    expect(doc).toContain('data-theme="dark"')
    expect(doc).toContain('content="default-src')
    expect(doc).toContain('connect-src')
    expect(doc).toContain('<div>hi</div>')
    // 数据真的在里面，而且是可解析的 JSON 字面量
    expect(doc).toContain('__CANVAS_INPUTS__')
    expect(doc).toContain('__CANVAS_UPSTREAM__')
    expect(doc).toContain('__CANVAS_UI__')
    expect(doc).toContain('"sales":[1,2,3]')
  })

  it('完整文档：引导脚本插进 head，模型自己的内容不被包壳丢下', () => {
    const html = '<!DOCTYPE html><html><head><title>t</title></head><body><b>keep</b></body></html>'
    const doc = buildSrcdoc(html, inputs, upstream)
    expect(doc).toContain('__CANVAS_INPUTS__')
    expect(doc).toContain('<b>keep</b>')
    expect(doc).toContain('<title>t</title>')
    // 只插一次：不该出现两遍数据引导（这个全局名只在引导脚本里出现一次）
    expect(doc.split('__CANVAS_INPUTS__').length - 1).toBe(1)
  })

  it('默认（纯展示）：CSP 把联网彻底关掉', () => {
    const doc = buildSrcdoc('<div>x</div>', inputs, upstream)
    expect(doc).toContain('connect-src \'none\'')
  })

  it('允许联网时：CSP 只放行后台，别的源仍然连不上', () => {
    const doc = buildSrcdoc('<div>x</div>', inputs, upstream, {
      baseUrl: 'http://localhost:8865',
      allowNetwork: true,
    })
    // 放行后台自己的源
    expect(doc).toContain('connect-src')
    expect(doc).toContain('http://localhost:8865')
    // WebSocket 形态也放行（调试 SDK 从沙箱里连后台 ws）
    expect(doc).toContain('ws://localhost:8865')
    const docHttps = buildSrcdoc('<div>x</div>', inputs, upstream, {
      baseUrl: 'https://mc.example.com',
      allowNetwork: true,
    })
    expect(docHttps).toContain('wss://mc.example.com')
    // 但仍然不是"敞开"：default-src 'none' 还在
    expect(doc).toContain("default-src 'none'")
  })

  it('允许联网时注入 base 标签：相对路径也能落到后台（srcdoc 里相对路径本来解析不出来）', () => {
    const doc = buildSrcdoc('<div>x</div>', inputs, upstream, {
      baseUrl: 'http://localhost:8865',
      allowNetwork: true,
    })
    expect(doc).toContain('<base href="http://localhost:8865/">')
  })

  it('base 与联网是两件事：不开联网也会给 base（相对图片地址仍要能解析），但 fetch 仍被 CSP 拦', () => {
    const doc = buildSrcdoc('<div>x</div>', inputs, upstream, { baseUrl: 'http://localhost:8865' })
    // base 管"相对地址解析成什么"，CSP 管"允不允许发出去"——两件事分开
    expect(doc).toContain('<base href="http://localhost:8865/">')
    expect(doc).toContain("connect-src 'none'")
  })

  it('__CANVAS_UI__ 里带上后台地址与画布 id（生成的界面自查/拼请求要用）', () => {
    const doc = buildSrcdoc('<div>x</div>', inputs, upstream, {
      baseUrl: 'http://localhost:8865',
      canvasId: 'c9',
      nodeId: '5',
      allowNetwork: true,
    })
    expect(doc).toContain('"baseUrl":"http://localhost:8865"')
    expect(doc).toContain('"canvasId":"c9"')
    expect(doc).toContain('"nodeId":"5"')
  })

  it('主题缺省是 light', () => {
    expect(buildSrcdoc('<div>x</div>', {}, [])).toContain('data-theme="light"')
  })

  it('纯函数：同样的输入必须产出一模一样的字符串（否则 iframe 每帧重载）', () => {
    // 为什么单锁这条：srcdoc 是上游 computed 的值，computed 一变 Vue 就去更新属性，
    // 浏览器随即整页重载 iframe。2026-10-12 用户实测「拖节点时里面一直在刷新」，
    // 根因就是这里塞过 Date.now() —— 每次重算都产出新字符串，于是每帧重载一次。
    const a = buildSrcdoc('<div>x</div>', { k: 1 }, upstream, { theme: 'dark', nodeId: '3' })
    const b = buildSrcdoc('<div>x</div>', { k: 1 }, upstream, { theme: 'dark', nodeId: '3' })
    expect(a).toBe(b)
  })

  it('纯函数：不含任何每次都变的值（时间戳 / 随机数）', () => {
    const one = buildSrcdoc('<div>x</div>', {}, [])
    const two = buildSrcdoc('<div>x</div>', {}, [])
    expect(one).toBe(two)
    // 明确挡掉"悄悄又加回来"
    expect(one).not.toContain('updatedAt')
  })
})


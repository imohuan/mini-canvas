/**
 * uiDebug —— 调试副本的契约。
 *
 * 用户 2026-10-15 报的问题：「无法操作这个节点，也无法进行调试。」
 * 根因是沙箱本身（不给 allow-same-origin），所以解法是**另开一份同源副本**。
 * 这里钉住三件事：
 *   1. 副本与沙箱那份**数据一致**（否则调试看的不是画布上跑的）；
 *   2. 副本**不带 CSP**（它是开发工具，不是发布物）；
 *   3. 副本的桥代码是**合法 JS**（拼字符串最容易写错，且真机上只会白屏）。
 */
import { describe, it, expect } from 'vitest'
import { buildDebugDoc, buildDebugBridge } from '../uiDebug'
import { BRIDGE_GLOBAL, UI_GLOBAL } from '../uiData'

const INPUT = {
  html: '<div>hi</div>',
  nodeId: '7',
  canvasId: 'c1',
  baseUrl: 'http://127.0.0.1:8865',
  theme: 'light' as const,
  upstream: [{ refName: '图片1', kind: 'image', url: '/a.png' }],
  inputs: { n: 1 },
  palette: { light: { accent: '#000' }, dark: { accent: '#fff' } },
}

describe('调试副本：与沙箱那份数据一致', () => {
  it('注入了同一份上游 / 参数 / UI 信息（否则调试看的不是画布上跑的）', () => {
    const doc = buildDebugDoc(INPUT)
    expect(doc).toContain('__CANVAS_INPUTS__')
    expect(doc).toContain('__CANVAS_UPSTREAM__')
    expect(doc).toContain('图片1')
    expect(doc).toContain('/a.png')
    expect(doc).toContain('http://127.0.0.1:8865')
  })

  it('标了 debug: true（生成物能给自己加角标，免得改错对象）', () => {
    const doc = buildDebugDoc(INPUT)
    expect(doc).toContain('debug')
  })

  it('带 <base href>（副本在 about:blank 里，没有它相对地址全废）', () => {
    const doc = buildDebugDoc(INPUT)
    expect(doc).toContain('<base href="http://127.0.0.1:8865/">')
  })

  it('带上画布主题色板（与沙箱那份同一份）', () => {
    const doc = buildDebugDoc(INPUT)
    expect(doc).toContain('palette')
    expect(doc).toContain('accent')
  })

  it('深浅色都认（跟着画布主题走）', () => {
    expect(buildDebugDoc({ ...INPUT, theme: 'dark' })).toContain('data-theme="dark"')
    expect(buildDebugDoc({ ...INPUT, theme: 'light' })).toContain('data-theme="light"')
  })

  it('片段与完整文档两种形态都包得起来（与 buildSrcdoc 同一套判据）', () => {
    expect(buildDebugDoc(INPUT)).toContain('<!DOCTYPE html>')
    const full = buildDebugDoc({ ...INPUT, html: '<html><head></head><body>x</body></html>' })
    // 完整文档：外壳插进 head 之后，不另套骨架
    expect(full).toContain('<head>')
    expect(full).not.toContain('<!DOCTYPE html>')
    expect(full.indexOf('__CANVAS_INPUTS__')).toBeGreaterThan(full.indexOf('<head>'))
  })

  /**
   * 内容里出现 </script> 会把脚本标签提前闭合（AI 生成的 HTML 完全可能带这个字符串）。
   * 序列化那一步必须把 < 转成 \u003c。
   */
  it('注入的数据里 < 被转义（否则 </script> 会提前闭合脚本标签）', () => {
    const doc = buildDebugDoc({ ...INPUT, inputs: { evil: '</script><h1>x</h1>' } })
    // 字面量 </script> 只应出现在我们自己的结束标签处，不出现在数据里
    const scriptEnds = doc.split('</script>').length - 1
    // 副本有：bootstrap(1) + 桥(1) = 2 个结束标签；数据里那个不算
    expect(scriptEnds).toBe(2)
  })
})

describe('调试副本：**不带** CSP（它是开发工具，不是发布物）', () => {
  it('没有 Content-Security-Policy', () => {
    const doc = buildDebugDoc(INPUT)
    expect(doc).not.toContain('Content-Security-Policy')
    expect(doc).not.toContain('connect-src')
  })

  /**
   * 沙箱那份（buildSrcdoc）是有 CSP 的 —— 那是它唯一的安全边界。
   * 这条对照测试钉住「两边确实不同」：哪天有人给副本也加了一道网，
   * 调试手段（看响应 / 打断点）又会失效，而症状只是「调试又不好用了」。
   */
  it('对照：沙箱那份确实有 CSP（安全边界没被这次改动碰坏）', async () => {
    const { buildSrcdoc } = await import('../uiData')
    const sd = buildSrcdoc('<div>hi</div>', {}, [], { baseUrl: 'http://x:1', allowNetwork: true })
    expect(sd).toContain('Content-Security-Policy')
  })
})

describe('调试副本的桥（window.CanvasUI）', () => {
  const js = buildDebugBridge()

  it('注入了这个全局对象（生成物不必为「在副本里跑」改代码）', () => {
    expect(js).toContain('window[' + JSON.stringify(BRIDGE_GLOBAL) + ']')
    expect(js).toContain('window[' + JSON.stringify(UI_GLOBAL) + ']')
  })

  it('五个方法都在（与沙箱那份同一套形状）', () => {
    expect(js).toContain('setInputs:')
    expect(js).toContain('onChange:')
    expect(js).toContain('save:')
    expect(js).toContain('task:')
    expect(js).toContain('cancel:')
  })

  /**
   * ★ 副本是**另一份运行实例**。它的 save 若自己 fetch 上传，就会：
   *   · 覆盖画布上那个节点的槽位图；
   *   · 绕过 updateNode，撤销栈 / 落盘 / 云端同步全不认这笔写入。
   * 所以副本的 save **只往宿主报**，由宿主决定落不落。
   */
  it('★ save 只往宿主报（__canvasUiDebug 标记），不自己 fetch 上传', () => {
    expect(js).toContain('__canvasUiDebug: 1')
    expect(js).toContain("type: 'output'")
    // 副本的 save 里不该出现 resources?slot= 那种上传地址
    expect(js).not.toContain('/resources?slot=')
  })

  it('字符串与二进制都交得出去（文本传正文，二进制传 base64）', () => {
    expect(js).toContain('btoa(bin)')
    expect(js).toContain('fr.readAsArrayBuffer(data)')
  })

  it('等宿主回执（__canvasUiDebugResult）—— 否则副本不知道该算成功还是失败', () => {
    expect(js).toContain('__canvasUiDebugResult')
    expect(js).toContain('if (d.ok) resolve(d.url)')
  })

  it('只认来自 parent 的指令（不认别人的消息）', () => {
    expect(js).toContain('e.source !== parent')
    expect(js).toContain('__canvasUiCmd')
  })

  it('页面一跑起来就主动报到（宿主靠它决定什么时候送状态）', () => {
    expect(js).toContain("type: 'ready'")
    expect(js).toContain('ready();')
    expect(js).toContain('DOMContentLoaded')
  })

  it('叫后台干活自己就能调（副本同源 + 手册要求写绝对地址）', () => {
    expect(js).toContain("type: 'call'")
    expect(js).toContain('canvasId: U.canvasId, nodeId: U.nodeId')
  })

  it('★ 生成的桥代码是**合法 JS**（拼字符串最容易写出语法错，真机上只会白屏）', () => {
    const body = js.replace(/^<script>\n?/, '').replace(/<\/script>$/, '')
    expect(() => new Function(body)).not.toThrow()
  })
})

/**
 * 整份副本文档也必须是合法 HTML/JS：
 * 只验桥那一小段不够 —— bootstrap 与外壳是拼在一起的，
 * 任一处转义错了，真机上表现就是白屏，而单测看不出来。
 */
describe('调试副本：整份文档', () => {
  it('★ 整份文档能跑起来（不抛语法错）', () => {
    const doc = buildDebugDoc({
      ...INPUT,
      html: '<div id="a">x</div><script>var s = 1;</script>',
      inputs: { k: 'v' },
    })
    // 把文档里所有 <script> 体抽出来交给 Function —— 语法错会在这里抛
    const bodies = [...doc.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => m[1] ?? '')
    expect(bodies.length).toBeGreaterThan(0)
    for (const b of bodies) expect(() => new Function(b)).not.toThrow()
  })
})


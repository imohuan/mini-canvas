import { describe, it, expect } from 'vitest'
import {
  UI_DEBUG_INVITE_KEY,
  DEBUG_CREDENTIAL_KEY,
  newSessionId,
  readInvite,
  isAcceptMatching,
  isCredential,
  readCredential,
  writeCredential,
  clearCredential,
  buildSdkScriptBody,
  appendSdkScript,
} from '../debugSession'

describe('调试连接 · 纯逻辑（邀请 / 凭据 / SDK 脚本）', () => {
  it('readInvite：认得合法邀请，形状不对一律 undefined（不猜）', () => {
    expect(readInvite({ [UI_DEBUG_INVITE_KEY]: { session: 's1', at: 5 } })).toEqual({ session: 's1', at: 5 })
    expect(readInvite(undefined)).toBeUndefined()
    expect(readInvite({})).toBeUndefined()
    expect(readInvite({ [UI_DEBUG_INVITE_KEY]: 'no' })).toBeUndefined()
    expect(readInvite({ [UI_DEBUG_INVITE_KEY]: { at: 5 } })).toBeUndefined() // 缺 session
  })

  it('isAcceptMatching：session / nodeId / canvasId 全对上才算（多标签页宁可重弹，不可接错页）', () => {
    const inv = { session: 's1', at: 5 }
    const good = { session: 's1', nodeId: '7', canvasId: 'c1' }
    expect(isAcceptMatching(inv, good)).toBe(true)
    expect(isAcceptMatching(inv, { ...good, session: 's2' })).toBe(false)
    expect(isAcceptMatching(undefined, good)).toBe(false)
    expect(isAcceptMatching(inv, undefined)).toBe(false)
    expect(isAcceptMatching(inv, { session: 's1', nodeId: '', canvasId: 'c1' })).toBe(false)
  })

  it('凭据读写清：round-trip 一致；坏 JSON / 异常都按「没有凭据」处理', () => {
    const store = new Map<string, string>()
    const fake = {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, v),
      removeItem: (k: string) => void store.delete(k),
    }
    expect(readCredential(fake)).toBeUndefined() // 空
    const cred = { session: 's1', nodeId: '7', canvasId: 'c1', at: 9 }
    writeCredential(fake, cred)
    expect(readCredential(fake)).toEqual(cred)
    clearCredential(fake)
    expect(readCredential(fake)).toBeUndefined()
    // 形状不对的值 = 没凭据
    store.set(DEBUG_CREDENTIAL_KEY, '{bad json')
    expect(readCredential(fake)).toBeUndefined()
    store.set(DEBUG_CREDENTIAL_KEY, JSON.stringify({ session: 'x' }))
    expect(readCredential(fake)).toBeUndefined()
    expect(isCredential({ session: 'x', nodeId: '7', canvasId: 'c1' })).toBe(true)
  })

  it('newSessionId：带随机尾巴，两次生成不同', () => {
    expect(newSessionId(1000)).not.toBe(newSessionId(1000))
  })

  it('buildSdkScriptBody：是合法 JS、上下行都走宿主的 __uiDebugCmd / __uiDebugReply', () => {
    const body = buildSdkScriptBody({ baseUrl: 'http://x', session: 's1', canvasId: 'c1', nodeId: '7' })
    // 2026-10-20：SDK 自己不碰网络，上行回包/下行轮询都交给宿主代发
    expect(body).toContain('__uiDebugCmd')
    expect(body).toContain('__uiDebugReply')
    expect(body).toContain('ask("poll"')
    expect(body).toContain('ask("result"')
    expect(body).toContain('reqId')
    expect(body).not.toContain('fetch(')
    expect(body).not.toContain('/api/node-ui/debug-poll')
    expect(body).not.toContain('/api/node-ui/debug-result')
    expect(body).toContain('"s1"')
    // 语法合法（Function 构造器会抛 SyntaxError 如果不是）
    expect(() => new Function(body)).not.toThrow()
  })

  it('收到 stop 仍然 post __uiDebugEvt disconnected（宿主靠它清凭据、摘刷新拦截）', () => {
    const body = buildSdkScriptBody({ baseUrl: 'http://x', session: 's1', canvasId: 'c1', nodeId: '7' })
    expect(body).toContain('__uiDebugEvt: { kind: "disconnected" }')
    expect(body).toContain('stopped = true')
  })

  it('appendSdkScript：挂到 </body> 前；没有 body 就追加文末；脚本内容转义 </', () => {
    const doc = '<html><body><div>x</div></body></html>'
    const out = appendSdkScript(doc, 'var a = 1;')
    expect(out).toContain('<script>var a = 1;</script></body>')
    expect(appendSdkScript('<div>x</div>', 'var b = 2;')).toContain('<div>x</div><script>var b = 2;</script>')
    // 防提前闭合：脚本里的 </ 序列必须被转义
    const evil = appendSdkScript(doc, 'var s = "</div>";')
    expect(evil).toContain('<\\/div>')
  })
})

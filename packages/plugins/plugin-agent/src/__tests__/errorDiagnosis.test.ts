/**
 * 错误标题要说清「在哪出错」（用户口径 2026-11-07）。
 *
 * 这张表就是判定契约：400 / 504 / EPERM / Failed to fetch / 前端堆栈，
 * 每一类都要落到正确的层与标题，不能统统显示成一句「Failed:」。
 */
import { describe, expect, it } from 'vitest'
import { diagnoseError, httpStatusOf, layerLabel } from '../model/errorDiagnosis'

describe('httpStatusOf', () => {
  it('认常见写法', () => {
    expect(httpStatusOf('POST /api/tasks → HTTP 504')).toBe(504)
    expect(httpStatusOf('status: 400')).toBe(400)
    expect(httpStatusOf('statusCode=422')).toBe(422)
    expect(httpStatusOf('504 Gateway Timeout')).toBe(504)
    expect(httpStatusOf('the server responded with a status of 502')).toBe(502)
  })

  it('正文里的普通数字不算状态码', () => {
    expect(httpStatusOf('跑了 504 次')).toBeUndefined()
    expect(httpStatusOf('端口 5288')).toBeUndefined()
    expect(httpStatusOf('HTTP 200')).toBeUndefined()
  })
})

describe('diagnoseError：层级与标题', () => {
  it('504 → 后台接口超时（上游），不是前端错', () => {
    const d = diagnoseError('POST /api/tasks 失败：HTTP 504 Gateway Timeout')
    expect(d.layer).toBe('server')
    expect(d.status).toBe(504)
    expect(d.headline).toContain('504')
    expect(d.headline).toContain('上游')
    expect(d.where).toContain('/api/tasks')
  })

  it('502 / 503 也归「上游 / 不可用」', () => {
    expect(diagnoseError('HTTP 502 Bad Gateway').headline).toContain('上游')
    expect(diagnoseError('HTTP 503 Service Unavailable').headline).toContain('不可用')
  })

  it('400 → 请求方参数问题（前端发错了）', () => {
    const d = diagnoseError('POST /api/jobs 返回 400 Bad Request')
    expect(d.layer).toBe('client')
    expect(d.status).toBe(400)
    expect(d.headline).toContain('400')
    expect(d.hint).toContain('参数')
  })

  it('EPERM → 后台写文件失败，标题带操作名与 errno', () => {
    const d = diagnoseError("EPERM: operation not permitted, rename 'C:/x/a.json.tmp-1' -> 'C:/x/a.json'")
    expect(d.layer).toBe('server')
    expect(d.headline).toContain('写文件失败')
    expect(d.headline).toContain('rename')
    expect(d.headline).toContain('EPERM')
    expect(d.hint).toContain('Windows')
  })

  it('EACCES / ENOSPC / ECONNREFUSED 各有自己的说法', () => {
    expect(diagnoseError('EACCES: permission denied').headline).toContain('EACCES')
    expect(diagnoseError("ENOSPC: no space left on device, write").hint).toContain('磁盘')
    expect(diagnoseError('ECONNREFUSED 127.0.0.1:8865').hint).toContain('后台')
  })

  it('Failed to fetch → 网络层（请求没到后台）', () => {
    const d = diagnoseError('TypeError: Failed to fetch')
    expect(d.layer).toBe('network')
    expect(d.headline).toContain('没发出去')
  })

  it('net::ERR_CONNECTION_REFUSED 单独指出来', () => {
    const d = diagnoseError('net::ERR_CONNECTION_REFUSED')
    expect(d.layer).toBe('network')
    expect(d.reason).toBe('ERR_CONNECTION_REFUSED')
    expect(d.hint).toContain('后台没起')
  })

  it('前端堆栈 → 前端（带业务代码帧）', () => {
    const d = diagnoseError('TypeError: Cannot read properties of undefined (reading \'x\')\n    at AgentMessageList.vue:120:3')
    expect(d.layer).toBe('client')
    expect(d.headline).toBe('前端报错')
    expect(d.where).toContain('AgentMessageList.vue')
  })

  it('后台日志前缀 → 后台', () => {
    const d = diagnoseError('[agentSessionStore] 写失败')
    expect(d.layer).toBe('server')
    expect(d.where).toContain('agentSessionStore')
  })

  it('认不出的错误不编结论，原样当标题', () => {
    const d = diagnoseError('something odd happened')
    expect(d.layer).toBe('unknown')
    expect(d.headline).toBe('something odd happened')
  })

  it('空文本不炸', () => {
    expect(diagnoseError('').layer).toBe('unknown')
    expect(diagnoseError(undefined).headline).toBe('未知错误')
  })

  it('层名能读', () => {
    expect(layerLabel('server')).toBe('后台')
    expect(layerLabel('client')).toBe('前端')
  })
})

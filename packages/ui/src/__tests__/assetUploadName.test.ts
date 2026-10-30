/**
 * 上传资产弹窗的「资产名称」必须真的生效。
 *
 * 现状（2026-10-30 扫描）：弹窗里有名称输入框、有多文件时的 x/50 计数、预填名字也塞进了框里，
 * 但 save() 只 emit files/urls/tags/folderId —— **名称从头到尾没被用过**。
 * 用户改了名字、点了保存，落库还是文件名（用户报「资产名称」这类输入无效时的典型形态：
 * 输入框能打字、看着像生效，实际被静默丢掉）。
 *
 * 这里不渲染组件（依赖一堆 ui 服务），而是用源码契约钉住数据流：
 *   1. 单文件 + 填了名字 → 保存时带上这个名字；
 *   2. 多文件 → 名字只对得上一个文件（避免把 N 个文件都改成同一个名字）。
 */
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'

const source = readFileSync(new URL('../components/AssetUploadDialog.vue', import.meta.url), 'utf-8')

function saveBody(): string {
  const from = source.indexOf('function save()')
  return from < 0 ? '' : source.slice(from, source.indexOf('</script>', from))
}

describe('上传弹窗的名称输入真的会写进资产', () => {
  it('save() 读了 assetName，并把它交给 emit', () => {
    const body = saveBody()
    expect(body, '找不到 save()').not.toBe('')
    // 去掉「保存后清空」那一行再看：只剩清空的话说明名称根本没被读走
    const withoutReset = body.replace(/assetName\.value\s*=\s*''/g, '')
    expect(withoutReset, '名称输入框的值没被读取 → 用户改的名字被静默丢掉').toMatch(/assetName\.value/)
  })

  it('只在单文件时应用名称（多文件共用一个名字会互相覆盖）', () => {
    const body = saveBody()
    expect(body, '没有对多文件做保护').toMatch(/files\.length === 1|length === 1/)
  })

  it('名称随 emit 的 payload 一起给出去（宿主才能落地）', () => {
    const emitLine = source.slice(source.indexOf("emit('save'"), source.indexOf(')', source.indexOf("emit('save'")) + 1)
    expect(emitLine, 'payload 里没有 name 字段').toMatch(/name/)
  })
})

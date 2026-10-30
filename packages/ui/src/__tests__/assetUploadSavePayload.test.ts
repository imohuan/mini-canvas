/**
 * 上传弹窗保存链路的载荷契约（三个宿主各写一份，必须一致）。
 *
 * 扫描发现的两个真实缺陷：
 *   1. save() 会 emit `urls`（画布上的图/视频/节点包走这条预填路径），
 *      但 LeftDrawer / AssetManageDialog 的 onUploadSave 只读 files —— 预填的那项被**静默丢掉**，
 *      用户看到「点了保存什么都没发生」；
 *   2. 同一处也没有把 `name`（用户填的资产名称）传下去。
 *
 * 这里用源码契约钉住三个宿主都按同一份 payload 处理（AssetUploadHost 是正确样板）。
 */
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'

const hosts = [
  ['components/areas/LeftDrawer.vue', '../components/areas/LeftDrawer.vue'],
  ['components/AssetManageDialog.vue', '../components/AssetManageDialog.vue'],
  ['components/AssetUploadHost.vue', '../components/AssetUploadHost.vue'],
] as const

function handlerOf(source: string): string {
  const from = source.indexOf('function onUploadSave') >= 0
    ? source.indexOf('function onUploadSave')
    : source.indexOf('async function onSave')
  if (from < 0) return ''
  const end = source.indexOf('\n}', source.indexOf('{', from))
  return source.slice(from, end + 2)
}

describe('上传弹窗的三个宿主都处理 urls 与 name', () => {
  for (const [label, rel] of hosts) {
    it(label + ' 保存时不会丢掉预填的 urls', () => {
      const source = readFileSync(new URL(rel, import.meta.url), 'utf-8')
      const fn = handlerOf(source)
      expect(fn, label + ' 找不到保存处理函数').not.toBe('')
      expect(fn, label + ' 没有处理 payload.urls（画布图/视频保存会静默失效）').toMatch(/payload\.urls|p\.urls/)
    })
  }
})

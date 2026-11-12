/**
 * 标签识别规则外置（用户 2026-10-27）。
 *
 * 编辑器不该知道「图片N 就是槽位」。插件注册 tagSpec 后，认什么写法由它决定；
 * 没注册时退回组件内置规则（保证老调用方不受影响）。
 */
import { afterEach, describe, expect, it } from 'vitest'
import {
  builtinScan,
  currentTagSpec,
  registerTagSpec,
  type TagSpec,
} from '../useEditor.ts'

afterEach(() => registerTagSpec(null))

describe('tagSpec 注册表', () => {
  it('注册后能读到；取消注册后为空', () => {
    const spec: TagSpec = { scan: () => [] }
    registerTagSpec(spec)
    expect(currentTagSpec()).toBe(spec)
    registerTagSpec(null)
    expect(currentTagSpec()).toBeNull()
  })

  it('自定义规格：一段文字里能扫出多个（含空格写法）', () => {
    const spec: TagSpec = {
      scan(text) {
        const out = []
        const re = /@(图片|视频|音频)\s*(\d+)/g
        let m: RegExpExecArray | null
        while ((m = re.exec(text)) !== null) {
          out.push({
            from: m.index,
            to: m.index + m[0].length,
            item: { id: 'ref-slot:image:' + m[2], name: '图片' + m[2], category: '素材' },
          })
        }
        return out
      },
    }
    expect(spec.scan('看 @图片1 和 @图片 2').map((m) => m.item.name)).toEqual(['图片1', '图片2'])
  })
})

describe('builtinScan（未注册时的默认规则）', () => {
  it('认 @图片N / @视频N / @音频N，并给出正确区间', () => {
    const hits = builtinScan('先 @图片3 再 @音频1')
    expect(hits.map((h) => h.item.id)).toEqual(['ref-slot:image:3', 'ref-slot:audio:1'])
    expect(hits[0].from).toBe(2)
    expect(hits[0].to).toBe(6)
  })

  it('不认没有数字的 @', () => {
    expect(builtinScan('@图片 和 @图片x')).toHaveLength(0)
  })
})


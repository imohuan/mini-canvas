/**
 * 节点设置改名：端口自己的命中范围叫「活动区域」，拖线用的叫「吸附区域」。
 * 持久化 key 不改，只改用户看到的标题与说明。
 */
import { describe, expect, it } from 'vitest'
import { Config } from '../index'

describe('节点设置文案', () => {
  it('五个 portZone 字段统一使用「活动区域」，不再叫吸附区', () => {
    const fields = Object.values(Config).filter(
      (schema) => schema.group === '节点/端口活动区' && /^活动区域/.test(schema.label ?? ''),
    )
    expect(fields).toHaveLength(5)
    for (const schema of fields) {
      expect(schema.label).not.toContain('吸附区')
      // 说明里会指向另一个菜单「吸附区域」，这是有意的区分；不能只出现旧名「吸附区」
      expect(schema.description ?? '').not.toMatch(/吸附区(?!域)/)
    }
  })

  it('吸附带四项保留原 key，显示名改成「吸附…」；说明讲拖线', () => {
    expect(Config.portZoneWidth).toBeTruthy()
    expect(Config.heightRatio.group).toBe('节点/吸附带')
    expect(Config.width.group).toBe('节点/吸附带')
    expect(Config.offset.group).toBe('节点/吸附带')
    expect(Config.shape.group).toBe('节点/吸附带')
    for (const key of ['heightRatio', 'width', 'offset', 'shape'] as const) {
      expect(Config[key].label).not.toContain('带')
      expect(Config[key].description).toMatch(/吸附/)
    }
  })
})

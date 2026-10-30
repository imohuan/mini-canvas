/**
 * 短视频剪辑的会话态必须在节点卸载时全清（2026-10-30 扫描发现）。
 *
 * videoClipStore 用模块级 Map 按 nodeId 记播放头 / 偏好 / 总时长。
 * VideoContent 卸载时只清了前两个，resetDuration 定义了却没人调 ——
 * 删掉视频节点后 durations 里还留着它，同 id 重建会读到上一份的时长
 * （剪辑面板按它铺胶片格，画面与真实视频对不上）。
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { publishDuration, readDuration, resetDuration } from '../videoClipStore'

const content = readFileSync(new URL('../VideoContent.vue', import.meta.url), 'utf-8')

describe('videoClipStore 清理', () => {
  it('VideoContent 卸载时清掉时长', () => {
    const unmount = content.slice(content.indexOf('onBeforeUnmount('), content.indexOf('</script>'))
    expect(unmount, '卸载钩子里没有 resetDuration').toMatch(/resetDuration\(props\.id\)/)
  })

  it('resetDuration 清掉后读回 0（幂等）', () => {
    publishDuration('vid-x', 12.5)
    expect(readDuration('vid-x')).toBe(12.5)
    resetDuration('vid-x')
    resetDuration('vid-x')
    expect(readDuration('vid-x')).toBe(0)
  })
})

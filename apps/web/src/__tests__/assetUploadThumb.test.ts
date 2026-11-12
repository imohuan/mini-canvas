/**
 * 上传弹窗的缩略图要**按类型画** —— 用户 2026-10-14 报的「UI 显示错误」根因：
 * 不管什么类型都拿 `<img>` 显示，视频（.mp4）放进去就是一张裂图。
 *
 * 这里钉三件事：类型怎么认（按后缀）、三类型各用什么标签画、预填项也带上 kind。
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const dialog = readFileSync(path.resolve(HERE, '../components/AssetUploadDialog.vue'), 'utf8')

describe('缩略图按类型渲染', () => {
  it('★ 图片用 img、视频用 video、其它用图标（不再一律 img）', () => {
    expect(dialog).toMatch(/<img v-if="it\.kind === 'image' && it\.preview"/)
    expect(dialog).toMatch(/<video v-else-if="it\.kind === 'video' && it\.preview"/)
    // 其它类型的兜底是图标，不是 img
    expect(dialog).toMatch(/<span v-else class="grid h-full w-full place-items-center text-ink-mute">/)
  })

  it('视频缩略图不自动播放、不发声（只取首帧）', () => {
    const seg = dialog.slice(dialog.indexOf("<video v-else-if"))
    const tag = seg.slice(0, seg.indexOf('>'))
    expect(tag).toContain('preload="metadata"')
    expect(tag).toContain('muted')
    expect(tag).not.toContain('autoplay')
  })
})

describe('类型判定', () => {
  it('★ 画布媒体按**文件名后缀**认（不看 query，节点产物常带 ?v=时间戳）', () => {
    expect(dialog).toContain('function kindOfName(name: string)')
    expect(dialog).toMatch(/split\('\?'\)\[0\]\.split\('#'\)\[0\]\.split\('\.'\)/)
    // 三类代表后缀都在表里
    expect(dialog).toContain("'mp4', 'webm', 'mov', 'm4v'")
    expect(dialog).toContain("'mp3', 'wav', 'ogg', 'm4a'")
    expect(dialog).toContain("'png', 'jpg', 'jpeg'")
  })

  it('本地文件按 MIME 认（有 File 就用 File 的 type）', () => {
    expect(dialog).toMatch(/function kindOf\(f: File\)[\s\S]{0,200}f\.type\.startsWith\('video\/'\)/)
  })

  it('★ 预填项也带上 kind（否则前端不知道该怎么画）', () => {
    expect(dialog).toMatch(/p\.file[\s\S]{0,80}kind: kindOf\(p\.file\)/)
    expect(dialog).toMatch(/preview: p\.url[\s\S]{0,60}kind: kindOfName\(p\.name\)/)
  })

  it('objectURL 只给图片（视频/音频给了也没法用 img 显示）', () => {
    expect(dialog).toMatch(/if \(kind === 'image'\) item\.preview = URL\.createObjectURL\(f\)/)
  })
})

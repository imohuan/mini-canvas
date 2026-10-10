/**
 * 底栏「添加节点」菜单（DockArea）两条结构契约 —— 2026-10-11 用户口径：
 *   ① 红框里的「智能剪辑 / 导演台 / 逐帧拉片」连「脚本」暂时先注释掉；
 *   ② 「上传」不能是死按钮：点它选本地文件（可多选，图片/视频/音频），
 *      选完进**左侧那个上传弹窗**（可改名 / 选保存位置 / 打标签），与「+ → 上传资产」同一条落库路径。
 *
 * 为什么盯源码结构：这两条都是"菜单里少一行 / 多一条通路"的约束，
 * 浏览器里跑不出"它以后不会长回来、上传选完到底去了哪"，只能钉住源码。
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const read = (rel: string): string => readFileSync(path.resolve(HERE, rel), 'utf8')

const dock = read('../components/areas/DockArea.vue')
const dialog = read('../components/AssetUploadDialog.vue')

/**
 * 菜单的**可见正文**：只取 <template> 段、并去掉 HTML 注释 ——
 * 注释掉的菜单项不算"还在菜单里"（script 段里的说明文字也不该被误当菜单项）。
 */
const visible = (s: string): string => s.slice(s.indexOf('<template>')).replace(/<!--[\s\S]*?-->/g, '')

describe('底栏「添加节点」菜单：隐藏预留项 + 上传真可用（2026-10-11 用户口径）', () => {
  it('① 智能剪辑 / 导演台 / 逐帧拉片 / 脚本 不在菜单里（原文以注释保留，便于日后恢复）', () => {
    for (const label of ['智能剪辑', '导演台', '逐帧拉片', '脚本']) {
      expect(visible(dock)).not.toContain(label)
      // 原文还在源码里（注释块内）：恢复只需删掉那层注释标记
      expect(dock).toContain(label)
    }
  })

  it('② 保留的项不受影响：文本 / 图片 / 视频 / 音频 / 素材库三项还在', () => {
    for (const label of ['文本', '图片', '视频', '音频', '素材库', '添加资源', '从生成历史选择']) {
      expect(visible(dock)).toContain(label)
    }
  })

  it('③ 「上传」= 打开文件选择（可多选），不再是 showToast 死提示', () => {
    // 菜单项本身不再挂显示提示：可见正文里「上传」后面不能紧跟 showToast
    expect(visible(dock)).not.toMatch(/上传[\s\S]{0,120}showToast/)
    expect(dock).toContain('queueUploadFiles')
    // 真·文件选择器：type=file + multiple（批量）
    expect(dock).toMatch(/<input[\s\S]{0,240}type="file"/)
    expect(dock).toMatch(/<input[\s\S]{0,240}multiple/)
  })

  it('④ 本地文件经总线进弹窗：queueUploadFiles 带 file，宿主拆成「本地文件 + 画布图」两路', () => {
    const bus = read('../composables/assetUploadBus.ts')
    expect(bus).toMatch(/export function queueUploadFiles/)
    // 荷载里带上 file（url 留空也行 —— 弹窗对本地文件自己造预览）
    expect(bus).toMatch(/queueUploadFiles[\s\S]{0,400}file: f/)
    // 弹窗宿主：有 file 的走 uploadAssetsTo、没 file 的按地址 uploadAssetsFromUrls
    const host = read('../components/AssetUploadHost.vue')
    expect(host).toMatch(/:prefill-files="prefillFiles"/)
    expect(host).toMatch(/:prefill="prefillUrls"/)
    expect(host).toMatch(/p\.file\)\.filter/)
    // 底栏入口接的是总线（不是自己另起一套状态）
    expect(dock).toContain('queueUploadFiles(list)')
  })

  it('⑤ 弹窗里本地文件与手选同一条加入逻辑（addLocalFile 一处定义、两处调用）', () => {
    expect(dialog).toContain('prefillFiles?: File[]')
    expect(dialog).toMatch(/function addLocalFile/)
    // 两处调用：props 预填 + 「+」格手选
    expect(dialog.split('addLocalFile(').length - 1).toBeGreaterThanOrEqual(3)
    expect(dialog).toMatch(/function onPick[\s\S]{0,300}addLocalFile/)
  })
})

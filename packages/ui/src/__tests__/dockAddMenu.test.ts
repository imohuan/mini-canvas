/**
 * 底栏「添加节点」菜单（DockArea）两条结构契约 —— 2026-10-11 用户口径：
 *   ① 红框里的「智能剪辑 / 导演台 / 逐帧拉片」连「脚本」暂时先注释掉；
 *   ② 「上传」不能是死按钮：点它选本地文件（可多选，图片/视频/音频），
 *      选完**直接落画布建成节点**（与拖文件进画布同一个效果）。
 *
 * 「上传」和「添加资源」是两件事（用户口径 2026-10-11 的更正，别再搞混）：
 *   · 「上传」  = 选文件 → 直接变成画布上的节点；
 *   · 「添加资源」= 打开左侧资源面板（上传进资产库那套）。
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
const ui = read('../composables/ui.ts')

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

  it('③ 「上传」= 打开文件选择（可多选），选完直接落画布', () => {
    // 不再是死提示
    expect(visible(dock)).not.toMatch(/上传[\s\S]{0,120}showToast/)
    // 真·文件选择器：type=file + multiple（批量），且放开到图片/视频/音频
    expect(dock).toMatch(/<input[\s\S]{0,240}type="file"/)
    expect(dock).toMatch(/<input[\s\S]{0,240}multiple/)
    expect(dock).toMatch(/accept="image\/\*,video\/\*/)
    // 选完交给 ui.addFilesToCanvas（**不是**进资产库/上传弹窗那条路）
    expect(dock).toMatch(/onUploadPick[\s\S]{0,300}ui\.addFilesToCanvas\(list\)/)
    expect(dock).not.toContain('queueUploadFiles')
    expect(dock).not.toContain('requestAssetUpload')
  })

  it('④ 「上传」落画布走 file-drop 的 addFiles（与拖文件进画布同一条通路）', () => {
    expect(ui).toContain('async function addFilesToCanvas')
    // 取 file-drop 服务并调它的 addFiles，不自己另写建节点
    expect(ui).toMatch(/get<FileDropLike>\('file-drop'\)/)
    expect(ui).toMatch(/svc\.addFiles\(handled, atFlow\)/)
    // 插件没装时明确提示（不静默什么都不做）
    expect(ui).toMatch(/文件拖放插件未启用/)
    // 对外导出（createUi 的返回对象里要有它，组件才调得到）
    expect(ui).toMatch(/addFilesToCanvas,/)
  })

  it('⑤ 「上传」与「添加资源」是两条路：上传落画布，添加资源开上传资产弹窗', () => {
    // 上传弹窗只服务「加入资产库」（节点右键 / 多选）与底栏「添加资源」，不再被「上传」使用
    expect(ui).not.toContain('queueUploadFiles')
    // 「添加资源」= 打开上传资产弹窗（不再只是拉开左侧抽屉）
    expect(visible(dock)).toMatch(/<AxMenuItem[^>]*openUploadDialog\(\)[^>]*>[\s\S]{0,80}添加资源/)
    expect(dock).not.toMatch(/<AxMenuItem[^>]*openDrawer\('left'\)[^>]*>[\s\S]{0,80}添加资源/)
    // 总线提供这个入口，宿主按空清单开窗（弹窗本体仍是同一份组件）
    const bus = read('../composables/assetUploadBus.ts')
    expect(bus).toMatch(/export function openUploadDialog/)
    const host = read('../components/AssetUploadHost.vue')
    expect(host).toContain('drainUploads()')
    // 「上传」不碰资产库上传 API
    expect(dock).not.toContain('uploadAssetsTo')
  })
})

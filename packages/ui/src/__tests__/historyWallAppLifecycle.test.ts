/**
 * 生成历史墙里「每张媒体卡一个 Vue 应用」的回收契约。
 *
 * 用户口径（2026-10-30）：「我点进视频和音频页面的时候，他一直在闪烁，一直在加载，
 * 直接给我的电脑干崩溃了」。
 *
 * 根因：buildMediaCard 为了在瀑布流里挂插件预览件，每张卡都 createApp().mount()；
 * 但重建墙（rebuildMasonry 的 container.innerHTML = ''）、LRU 逐出、弹窗卸载都只删 DOM，
 * **没有一个卸载点**。于是每切一次页签/筛选就多留一批活着的 Vue 应用 + <video>/<audio>
 * 实例（各自带 ResizeObserver、解码器与网络请求），内存与解码器一路涨到页面卡死。
 *
 * 这里用源码契约钉住三条：
 *   1. 挂载出来的应用必须被登记；
 *   2. 清空/丢弃墙时必须卸载它们；
 *   3. 卸载必须能处理「已从 DOM 摘走」的应用（否则 dispose 抛错会中断整轮清理）。
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'

const modalsArea = readFileSync(new URL('../components/areas/ModalsArea.vue', import.meta.url), 'utf-8')

/** 取一段源码（函数或 watch 块），找不到就返回空串让断言报出来 */
function slice(start: string, end: string): string {
  const from = modalsArea.indexOf(start)
  if (from < 0) return ''
  const to = modalsArea.indexOf(end, from + start.length)
  return modalsArea.slice(from, to < 0 ? undefined : to)
}

describe('历史墙的媒体卡 Vue 应用必须被回收', () => {
  it('挂载后把应用登记到一张表里（否则无从卸载）', () => {
    const fn = slice('function buildMediaCard', '  // 没有注册件时的兜底卡面')
    expect(fn, '找不到 buildMediaCard').not.toBe('')
    expect(fn, '挂载出的应用没有登记，之后无法卸载').toMatch(/appsOfWall\(MOUNTED_WALL\)\.add\(/)
  })

  it('有一条统一的卸载函数，逐项 unmount 并清空表', () => {
    expect(modalsArea, '缺少 unmountMountedApps（重建/逐出/卸载都靠它）').toMatch(
      /function unmountMountedApps\(/,
    )
    const fn = slice('function unmountMountedApps', 'function rebuildMasonry')
    expect(fn, '卸载函数没有真正调 unmount').toMatch(/\.unmount\(\)/)
    expect(fn, '卸载后没有清空登记表（下次清理会重复 unmount）').toMatch(/\.clear\(\)/)
    expect(fn, '单个应用 unmount 抛错会中断整轮清理（漏卸载剩下所有卡片）').toMatch(/try\s*\{[\s\S]{0,200}catch/)
  })

  it('整墙重建前先卸载（它是唯一批量新建卡片的路径）', () => {
    const fn = slice('function rebuildMasonry', 'function buildWallWrapper')
    expect(fn, '找不到 rebuildMasonry').not.toBe('')
    expect(fn, '重建前没有卸载旧墙的应用（泄漏点 1）').toMatch(/unmountMountedApps\(\)/)
  })

  it('LRU 逐出要卸载；收墙是换名保留（切回来还要复用）', () => {
    const trim = slice('function trimWallCache', 'function histZoom')
    expect(trim, '找不到 trimWallCache').not.toBe('')
    expect(trim, 'LRU 逐出只删了快照、没卸载墙里的应用（泄漏点 2）').toMatch(/unmountWallApps\(|unmountMountedApps\(/)

    const stash = slice('function stashCurrentWall', 'function switchWall')
    expect(stash, '找不到 stashCurrentWall').not.toBe('')
    // 收墙**不能**卸载（那正是不闪的原因），但登记项必须换名到该墙的 key，
    // 否则这面墙被 LRU 逐出时找不到自己的应用，泄漏就回来了。
    expect(stash, '收墙后登记项没换名，逐出时找不到这面墙的应用').toMatch(/rekeyWallApps\(MOUNTED_WALL, key\)/)
  })

  it('弹窗卸载时回收整墙应用', () => {
    const unmount = slice('onBeforeUnmount(() => {', '点一张卡：有产物就打开预览')
    expect(unmount, '找不到 onBeforeUnmount').not.toBe('')
    expect(unmount, '弹窗卸载时没有回收墙里的应用（泄漏点 4）').toMatch(/unmountMountedApps\(|unmountWallApps\(/)
  })

  it('切换「显示异常」丢弃旧墙缓存时也要卸载', () => {
    const clearCache = slice('watch(() => s.histShowError', 'onBeforeUnmount(() => {')
    expect(clearCache, '找不到 histShowError 的 watch').not.toBe('')
    expect(clearCache, 'wallCache.clear() 只丢了 DOM 快照，应用还活着').toMatch(
      /unmountWallApps\(|unmountMountedApps\(/,
    )
  })

  it('单张坏资源卡被摘掉/替换时，只卸载它自己的应用', () => {
    const fn = slice('function showBrokenResourceCard', ' * 点卡片：')
    expect(fn, '找不到 showBrokenResourceCard').not.toBe('')
    expect(fn, '摘卡/换卡前没有卸载这张卡的播放器（看不见但仍在解码）').toMatch(/unmountCardApp\(card\)/)
    expect(modalsArea, '缺少单卡回收实现').toMatch(/function unmountCardApp\(/)
  })
})


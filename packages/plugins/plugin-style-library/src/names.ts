/**
 * names —— ui 目录里各 UI 件的**名字常量**（单一来源）。
 *
 * 单独成一个文件（不放在 index.ts）：组件之间要按名互相取件（如广场取卡片），
 * 若从 index.ts 取会形成循环 import（index → 广场 → index）。名字放这里，两边都能引。
 *
 * 风格库与特效库**共用** UI 件（同一套组件、两套数据）——
 * 所以卡片/广场/外壳这些名字是通用的；只有"外壳"按库分了两个名字（标题与点击行为不同）。
 */
export const UI_OVERLAY = 'styleLibraryOverlay'
export const UI_GALLERY = 'styleLibraryGallery'
export const UI_CARD = 'styleLibraryCard'
export const UI_DETAIL = 'styleLibraryDetail'

/** 特效库外壳（与风格库外壳同构，只是标题/点击行为不同） */
export const UI_EFFECT_OVERLAY = 'effectLibraryOverlay'

/** 主题登记的全屏预览件名（生成历史用的同一个；见 plugin-theme-default） */
export const UI_MEDIA_VIEWER = 'mediaViewer'

export const UI_NAMES = [UI_OVERLAY, UI_GALLERY, UI_CARD, UI_DETAIL, UI_EFFECT_OVERLAY] as const

/**
 * folderIcons —— 文件夹图标映射的**唯一一份**（审查发现三处重复，这里收口）。
 *
 * 图标清单/映射/取组件三件事都住这里；各使用方（AssetRowMenu / AssetManageDialog /
 * LeftDrawer 的 AssetTree 注入）只 import，不再各抄一份。
 * 清单与映射必须同步改：加图标 = ICON_NAMES + ICON_MAP 各加一行。
 */
import {
  Cloud as CloudIcon, Aperture as ApertureIcon, Car as CarIcon, BookUser as BookUserIcon,
  CircleDot as CircleDotIcon, Plane as PlaneIcon, Film as FilmIcon, Cookie as CookieIcon,
  Flame as FlameIcon, Wrench as WrenchIcon, Paintbrush as PaintbrushIcon, Shapes as ShapesIcon,
  Candy as CandyIcon, Monitor as MonitorIcon, Landmark as LandmarkIcon, Book as BookIcon,
  Camera as CameraIcon, Ghost as GhostIcon, Briefcase as BriefcaseIcon,
} from 'lucide-vue-next'
import type { Component } from 'vue'

/** 文件夹可选图标名单（图标选择器网格的顺序即此清单顺序） */
export const FOLDER_ICON_NAMES = [
  'cloud', 'aperture', 'car', 'book-user', 'circle-dot', 'plane', 'film', 'cookie',
  'flame', 'wrench', 'paintbrush', 'shapes', 'candy', 'monitor', 'landmark', 'book',
  'camera', 'ghost', 'briefcase',
] as const

/** 图标名 → lucide 组件（弹窗树角标 / AssetRowMenu 选择器网格共用） */
export const FOLDER_ICON_MAP: Record<string, Component> = {
  'cloud': CloudIcon,
  'aperture': ApertureIcon,
  'car': CarIcon,
  'book-user': BookUserIcon,
  'circle-dot': CircleDotIcon,
  'plane': PlaneIcon,
  'film': FilmIcon,
  'cookie': CookieIcon,
  'flame': FlameIcon,
  'wrench': WrenchIcon,
  'paintbrush': PaintbrushIcon,
  'shapes': ShapesIcon,
  'candy': CandyIcon,
  'monitor': MonitorIcon,
  'landmark': LandmarkIcon,
  'book': BookIcon,
  'camera': CameraIcon,
  'ghost': GhostIcon,
  'briefcase': BriefcaseIcon,
}

/** 取图标组件：清单里没有的名字回落到文件夹默认图标 */
export function folderIconComponent(name: string): Component {
  return FOLDER_ICON_MAP[name] ?? FOLDER_ICON_MAP['cloud']
}


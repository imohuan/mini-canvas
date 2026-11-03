# JSDoc Comment Quality Fix - Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Fix 46 files with 1400 lines of low-quality auto-generated JSDoc comments. Every type and property must have meaningful Chinese descriptions. Single-line comments stay single-line.

**Architecture:** Two phases: (1) Script-based format fix (46 files), (2) Manual content rewrite for 14 core files.

**Tech Stack:** Python 3 + regex

---

## Problem Summary

### 1. Single-line comments exploded to 3 lines
`
// Was:  /** operation type */
// Now:  /**
//        * operation type
//        */
`

### 2. English or meaningless comments
`
/** node menu item definition */  // Should be Chinese
/** node */                        // Just repeats field name
`

### 3. Property comments that add zero information
`
/** description */   // Field is already called "description"
/** icon */          // Field is already called "icon"
`

---

## Task 1: Script - Collapse multi-line JSDoc to single-line (all 46 files)

**Files:** All src/**/*.ts (non-test)

- [ ] Run collapse script:
`python
import os, re

for root, dirs, files in os.walk('src'):
    dirs[:] = [d for d in dirs if d not in ('node_modules', '__tests__', '.worktrees')]
    for f in files:
        if not f.endswith('.ts') or f.endswith('.test.ts'):
            continue
        path = os.path.join(root, f)
        with open(path, 'r', encoding='utf-8') as fh:
            content = fh.read()
        
        def collapse(m):
            text = m.group(1).strip()
            indent = m.group(0)[:len(m.group(0)) - len(m.group(0).lstrip())]
            return f'{indent}/** {text} */'
        
        content = re.sub(r'(\s*)/\*\*\s*
\s*\*\s*(.+?)\s*
\s*\*/', collapse, content)
        
        with open(path, 'w', encoding='utf-8') as fh:
            fh.write(content)

print('Done')
`

- [ ] Verify: 
px vue-tsc --noEmit should pass

---

## Task 2: Script - Replace English/meaningless comments (all 46 files)

- [ ] Run replacement script:
`python
REPLACE = {
    '/** node menu item definition */': '/** 节点菜单项定义 */',
    '/** canvas node definition */': '/** 画布节点类型定义 */',
    '/** canvas node menu item */': '/** 节点菜单项 */',
    '/** default size */': '/** 默认卡片尺寸 */',
    '/** menu item */': '/** 菜单项配置 */',
    '/** can receive input */': '/** 是否可接收输入连线 */',
    '/** node */': '',  # delete
    '/** 显示文本 */': '',  # label speaks for itself
    '/** 描述 */': '',      # description speaks for itself
    '/** 图标 */': '',      # icon speaks for itself
    '/** 徽章 */': '',      # badge speaks for itself
    '/** 唯一标识 */': '',  # id speaks for itself
    '/** 类型 */': '',      # type speaks for itself
    '/** 名称 */': '',      # name speaks for itself
    '/** 标题 */': '',      # title speaks for itself
    '/** 版本号 */': '',    # version speaks for itself
    '/** 是否禁用 */': '',  # disabled speaks for itself
    '/** 是否可见 */': '',  # visible speaks for itself
    '/** 分组 */': '',      # group speaks for itself
    '/** 排序权重 */': '',  # order speaks for itself
    '/** 来源 */': '',      # source speaks for itself
    '/** 位置 */': '',      # position speaks for itself
    '/** 模式 */': '',      # mode speaks for itself
    '/** 数据 */': '',      # data speaks for itself
    '/** 选项 */': '',      # options speaks for itself
    '/** 配置 */': '',      # config speaks for itself
    '/** 状态 */': '',      # state speaks for itself
    '/** 值 */': '',        # value speaks for itself
    '/** 颜色 */': '',      # color speaks for itself
    '/** 尺寸 */': '',      # size speaks for itself
    '/** 宽度 */': '',      # width speaks for itself
    '/** 高度 */': '',      # height speaks for itself
    '/** 路径 */': '',      # path speaks for itself
    '/** 作者 */': '',      # author speaks for itself
    '/** 依赖 */': '',      # dependencies speaks for itself
    '/** 版本 */': '',      # version speaks for itself
}

for root, dirs, files in os.walk('src'):
    dirs[:] = [d for d in dirs if d not in ('node_modules', '__tests__', '.worktrees')]
    for f in files:
        if not f.endswith('.ts') or f.endswith('.test.ts'):
            continue
        path = os.path.join(root, f)
        with open(path, 'r', encoding='utf-8') as fh:
            content = fh.read()
        modified = False
        for old, new in REPLACE.items():
            if old in content:
                content = content.replace(old, new)
                modified = True
        if modified:
            with open(path, 'w', encoding='utf-8') as fh:
                fh.write(content)

print('Done')
`

- [ ] Verify: 
px vue-tsc --noEmit should pass

---

## Task 3: Manual rewrite - NodeRegistry.ts

**File:** src/canvas/core/registry/NodeRegistry.ts

- [ ] Rewrite all type comments:

`	s
/** 节点菜单项定义 — 创建节点菜单中每个选项的显示信息 */
export interface NodeMenuItemDefinition {
  /** 菜单项标题，如 '文本'、'图片' */
  label: string
  /** 菜单项描述，显示在标题下方的灰色小字 */
  description?: string
  /** 菜单项图标名称：text/image/video/layers/link/delete/duplicate */
  icon?: 'text' | 'image' | 'video' | 'layers' | 'link' | 'delete' | 'duplicate'
  /** 菜单项徽章文本，如 'Beta'，显示在右侧 */
  badge?: string
}

/**
 * 画布节点类型定义
 * 描述一个可创建的节点类型，包含渲染组件、默认尺寸、菜单项等。
 * 插件通过 context.canvasNodes.register() 注册。
 */
export interface CanvasNodeDefinition {
  /** 来源（插件名或 'core'），用于批量卸载 */
  source?: string
  /** 排序权重，数字越小在创建菜单中越靠前 */
  order?: number
  /** 节点类型名称，如 'image'、'text'、'video' */
  type: string
  /** Vue 渲染组件 */
  node?: Component
  /** 节点显示名称 */
  label: string
  /** 默认卡片尺寸（宽 x 高） */
  defaultSize: { cardWidth: number; cardHeight: number }
  /** 右键创建菜单中的显示配置 */
  menuItem: NodeMenuItemDefinition
  /** 是否可以接收来自其他节点的输入连线 */
  canReceiveInput?: boolean
  /** 是否允许用户拖拽调整节点大小 */
  resizable?: boolean
}

/** 节点菜单项 — NodeRegistry.getMenuItems() 返回的创建节点菜单选项 */
export interface CanvasNodeMenuItem {
  /** 节点类型名称，对应 CanvasNodeDefinition.type */
  id: string
  /** 菜单项标题 */
  label: string
  /** 菜单项描述 */
  description?: string
  /** 菜单项图标 */
  icon?: NodeMenuItemDefinition['icon']
  /** 菜单项徽章 */
  badge?: string
}
`

- [ ] Verify: 
px vue-tsc --noEmit

---

## Task 4: Manual rewrite - HistoryPlugin.ts

**File:** src/canvas/core/plugins/history/HistoryPlugin.ts

- [ ] Rewrite:

`	s
/**
 * 历史记录条目
 * 每次可撤销操作对应一条记录，包含 undo/redo 回调和元信息。
 */
export interface HistoryRecord {
  /** 操作类型，如 'addNodes'、'removeNodes'、'moveNodes' */
  type: string
  /** 撤销时执行的回调函数 */
  undo: () => void
  /** 重做时执行的回调函数 */
  redo: () => void
  /** 操作发生的时间戳 */
  timestamp: number
  /** 操作描述，用于调试日志和 UI 展示 */
  description: string
}

/**
 * HistoryPlugin 配置选项
 */
export interface HistoryOptions {
  /** 最大历史记录数，默认 100 */
  maxRecords?: number
  [key: string]: unknown
}

/**
 * 撤销重做 API
 * 基于命令模式（Command Pattern），支持批量操作合并。
 * 快捷键：Ctrl+Z 撤销，Ctrl+Y / Ctrl+Shift+Z 重做。
 */
export interface HistoryAPI {
  /** 是否有可撤销的操作 */
  readonly canUndo: boolean
  /** 是否有可重做的操作 */
  readonly canRedo: boolean
  /** 是否正在执行撤销/重做（防止递归记录历史） */
  readonly isRestoring: boolean
  /** 撤销栈中的操作数量 */
  readonly undoCount: number
  /** 重做栈中的操作数量 */
  readonly redoCount: number
  /** 执行一次撤销 */
  undo(): void
  /** 执行一次重做 */
  redo(): void
  /** 清空所有历史记录 */
  clear(): void
  /** 开始批量记录（将多次操作合并为一条记录，用于拖拽等连续操作） */
  beginBatch(): void
  /** 结束批量记录并提交到撤销栈 */
  endBatch(): void
  /** 记录一条历史操作 */
  record(record: Omit<HistoryRecord, 'timestamp'>): void
}
`

- [ ] Verify: 
px vue-tsc --noEmit

---

## Task 5: Manual rewrite - ClipboardPlugin.ts

**File:** src/canvas/core/plugins/clipboard/ClipboardPlugin.ts

- [ ] Rewrite ClipboardData and ClipboardAPI

---

## Task 6: Manual rewrite - GroupPlugin.ts

**File:** src/canvas/core/plugins/group/GroupPlugin.ts

- [ ] Rewrite GroupBounds and GroupAPI

---

## Task 7: Manual rewrite - StoragePlugin.ts + AssetStore.ts

**Files:** src/canvas/core/plugins/storage/StoragePlugin.ts, src/canvas/core/plugins/storage/adapters/AssetStore.ts

- [ ] Rewrite StorageOptions, ProjectMeta, CanvasData, StorageStatus, StorageAPI, AssetRecord, AssetStore

---

## Task 8: Manual rewrite - auto-layout/types.ts

**File:** src/canvas/core/plugins/auto-layout/types.ts

- [ ] Rewrite LayoutDirection, Spacing, AutoLayoutConfig, GroupBounds, LayoutCluster, SimpleNode, SimpleEdge, SimpleGroup, AutoLayoutAPI, GroupLayoutAPI

---

## Task 9: Manual rewrite - AutoSavePlugin.ts, FileDropPlugin.ts, MultiSelectPlugin.ts

**Files:** 3 files

- [ ] Rewrite type comments

---

## Task 10: Manual rewrite - theme/types.ts

**File:** src/canvas/core/plugins/theme/types.ts

- [ ] Rewrite ThemePresetName, ThemePreset, ThemeState, ThemeOptions, ThemeAPI

---

## Task 11: Manual rewrite - remaining small files

**Files:** src/canvas/core/types/CanvasNodeData.ts, src/canvas/core/components/performance/performanceMetrics.ts, src/canvas/core/registry/DialogRegistry.ts, src/canvas/core/runtime/CanvasEvents.ts, src/canvas/core/plugins/ShortcutManager.ts, src/canvas/core/plugins/auto-layout/focusViewport.ts, src/canvas/core/plugins/auto-layout/groupBounds.ts, src/canvas/core/plugins/auto-layout/layoutEngine.ts, src/canvas/core/plugins/theme/colorUtils.ts, src/canvas/core/utils/viewportSpace.ts

- [ ] Rewrite type comments

---

## Task 12: Final verification

- [ ] Run: pnpm build
- [ ] Expected: zero errors
- [ ] Spot-check 5 files with git diff
- [ ] Commit: git add -A && git commit -m "docs: fix JSDoc comment quality"

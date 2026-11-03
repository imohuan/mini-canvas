# UI 一致性修复说明（2026-11-02）

这次修的两类问题看起来不同，根子都是：**同一个东西被写在了两个地方**。

- 按钮底色和文字色各写各的，暗色主题下就配错了。
- 二级菜单只给菜单项加了宽度，外面的触发器没加，整行就短了一截。

媒体裁剪框也有同类问题：图片和视频共用同一个组件，却按模式写了两套控制点；
控制点底色用了界面面板色，暗色下跟着变深。

## 一、主题色上的文字，必须用配套变量

项目里有两套「底色 + 文字」：

| 底色 | 文字 | 什么时候用 |
| --- | --- | --- |
| `--ui-primary-bg` / `--ui-primary-bg-hover` | `--ui-primary-ink` | 反色主按钮。亮色下深底浅字，暗色下浅底深字，文字会跟着翻转 |
| `--ui-accent` / `--ui-accent-hover` / `--ui-danger` | `--ui-on-accent` | 强调色或危险色的实心按钮、徽章、勾选圆点。任何主题下都保持白字 |

**规则：不能交叉使用。**

把 `--ui-primary-ink` 用到 `--ui-accent` 上，亮色主题碰巧是白字，看起来没问题；
暗色主题下它变成 `#141414`，按钮就成了「青底黑字」。这次截图里的「确认」按钮就是这个原因。

错误写法：

```css
.button {
  background: var(--ui-accent);
  color: var(--ui-primary-ink); /* 错：暗色下是深色字 */
}
```

正确写法：

```css
.button {
  background: var(--ui-accent);
  color: var(--ui-on-accent);
}
```

按钮如果本来用的是反色主按钮，就继续成对使用：

```css
.inverse-button {
  background: var(--ui-primary-bg);
  color: var(--ui-primary-ink);
}
```

半透明装饰也要跟着配套文字色现算，避免出现硬编码白：

```css
background: color-mix(in srgb, var(--ui-on-accent) 24%, transparent);
```

## 二、二级菜单要量整条宽度链

菜单行「只短一截」，不是 `.ax-menu-item` 自己少了 `width: 100%`。
真正断掉的是外层的宽度链：

```text
Dropdown 根（默认 inline-flex）
  └─ 触发器外壳 .mck-dropdown__trigger（默认 inline-flex）
       └─ .ax-sub-row
            └─ .ax-menu-item（width: 100% 只能撑到父级的内容宽）
```

`AxSubMenu` 已把这三层都拉成整宽：

```css
.ax-sub-dropdown { display: flex; width: 100%; max-width: none; }
.ax-sub-dropdown > .mck-dropdown__trigger { display: flex; width: 100%; }
.ax-sub-row { display: flex; width: 100%; }
```

以后新增菜单壳、下拉壳时，先检查**从面板到文字按钮的每一层**是不是都允许撑宽。
只补最后一层，下次换个外层组件还会犯。

Chrome 里的判断方法：入口行宽度要等于菜单内容区宽度。
例如菜单外框 180px、左右内边距各 7px，那么内容区是 166px，每一行都应是 166px。

## 三、媒体裁剪框：两边一致，压在画面上的颜色要恒定

图片和视频都用 `packages/canvas-render/src/crop/MediaFrameOverlay.vue`。

1. 裁剪和扩展都给 **8 个控制点**：4 个角 + 4 条边的中点。
   边中点拖动时只改那一条边，不会顺带改高度或宽度。
2. 控制点、边框、三分线压在图片/视频画面上，**不跟暗色主题变深**。
   它们统一用恒定白色：控制点白底 + 半透黑外圈，边框白线 + 半透黑外衬，
   三分线白线 + 深色 drop-shadow。这样深色画面与浅色画面都能看见。
3. 只有界面面板、菜单、按钮这类铺在界面底色上的元素，才应读取 `--ui-panel` 等主题变量。

判断新颜色要不要跟主题，问一句：**它压在图上看，还是压在界面底色上看？**

- 压在图上：必须保证在亮图和暗图上都看得清，用恒定色。
- 压在界面底色上：用主题 token，让亮暗主题自动切换。

## 四、以后怎么防止再犯

改主题相关样式前，先做这四步：

1. 找到「底色」和「文字色」是否成对。强调色/危险色底配 `--ui-on-accent`，反色主按钮底配 `--ui-primary-ink`。
2. 在亮色和暗色各看一次。不能只看当前默认主题。
3. 共享组件先看调用方是否走同一实现。图片和视频裁剪必须继续共用 `MediaFrameOverlay`。
4. 菜单宽度从外往里量，别只量文字按钮。

已有自动检查：

- `packages/ui/src/__tests__/themeForegroundPairing.test.ts`
  扫描 `packages/plugins`、`packages/canvas-render`、`packages/ui`、`packages/ui-kit`、`packages/ui-kit-shadcn`，
  发现「强调色/危险色底 + `--ui-primary-ink`」就失败。
- `packages/canvas-render/src/crop/__tests__/mediaFrameOverlayChrome.test.ts`
  锁裁剪/扩展各 8 个控制点，并锁控制点底色为恒定白。
- `packages/ui/src/__tests__/axSubMenuWidth.test.ts`
  锁二级菜单三段宽度链。

单跑这三条：

```bash
pnpm -C packages/ui vitest run src/__tests__/themeForegroundPairing.test.ts src/__tests__/axSubMenuWidth.test.ts
pnpm -C packages/canvas-render vitest run src/crop/__tests__/mediaFrameOverlayChrome.test.ts
```

## 五、这次实际改到的公共位置

- 裁剪浮层：`packages/canvas-render/src/crop/MediaFrameOverlay.vue`、`mediaFit.ts`
- 二级菜单：`packages/ui/src/components/AxSubMenu.vue`
- 节点控制栏主按钮：`packages/canvas-render/src/styles/ui-theme.css`、
  `packages/plugins/plugin-theme-default/src/components/ui/node-toolbar-button.css`
- 其它同类按钮：`plugin-agent`、`plugin-bottom-bar`、`plugin-shortcut-manager`、
  `plugin-style-library`、`plugin-demo-kit`、`SettingsShell.vue`、`ui-kit` 的主按钮

颜色 token 的单一真源仍是 `packages/canvas-render/src/styles/ui-theme.css`。
改用新 token 前先看那里，不要在组件里再定义一套同义色。

<script setup lang="ts">
// 底部中央 dock：添加节点 / 移动 / 素材库(hover) / 角色造型室 / 生成历史 / 快捷键 / 教程 + TV Director。
// 「移动 / 抓手工具」是**真开关画布交互**的：经 ui.setCanvasMode 写宿主级设置
// （nodesDraggable / panOnDrag），详见 composables/ui.ts 的「画布开关」段。
import {
  Plus,
  Hand,
  FolderOpen,
  Shapes,
  History,
  Keyboard,
  CircleQuestionMark,
  Sparkles,
  Type,
  Image as ImageIcon,
  Video,
  AudioLines,
  // 下面四个只给「智能剪辑 / 导演台 / 逐帧拉片 / 脚本」用 —— 这几项按用户口径（2026-10-11）暂时隐藏，
  // 图标一并注释掉；日后恢复菜单项时把这行也一起放开。
  // Film, Box, Images, ScrollText,
  Upload,
  Search,
  Move,
} from "lucide-vue-next";
// 底栏按钮 / 提示 / 下拉菜单全部用 shadcn 原始组件（分离件，内容随意定制）。
import {
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@mini-canvas/ui-kit-shadcn";
import AgentOrb from "../AgentOrb.vue";
import { useUi } from "../../composables/ui";
import { openUploadDialog } from "../../composables/assetUploadBus";
import { computed, ref } from "vue";
import { SlotAnchor, SlotComposer } from "@mini-canvas/canvas-render";
import SlotButton from "./SlotButtons.vue";

const ui = useUi();
const s = ui.state;

/** 下发给插件条目的共享 props：默认按钮 + 常用函数（插件不必再抄一份样式） */
const slotShared = {
  coreButton: SlotButton,
  buttonTone: "dock",
  openDrawer: () => ui.openDrawer("left"),
  openHistory: () => ui.toggleHistory(),
  openShortcuts: () => ui.toggleShortcuts(),
  showToast: (msg: string) => ui.showToast(msg),
};

/**
 * 「+ → 上传」：挑本地文件（可多选，图片 / 视频 / 音频）→ **直接落画布**成节点。
 *
 * 用户口径（2026-10-11）：「点击『上传』时，它是直接把你选中的东西放置在画布中」
 * —— 与把文件拖进画布同一个效果，不是进资产库、也不弹窗。
 * 所以走的正是 file-drop 插件那条 addFiles（同一份识别/尺寸/落盘/选中逻辑）：
 * 图片→image 节点、视频→video 节点、文本→text 节点，多个文件会依次排开。
 * 「进资产库」那条路仍然只有「添加资源」（左侧抽屉的「+ → 上传资产」）。
 */
const uploadInput = ref<HTMLInputElement | null>(null);
function pickUploadFiles(): void {
  uploadInput.value?.click();
}
function onUploadPick(e: Event): void {
  const input = e.target as HTMLInputElement;
  const list = Array.from(input.files ?? []);
  input.value = "";
  if (!list.length) return;
  // 落点：与拖拽一致，交给 file-drop 用「最近一次鼠标位置」当锚点；
  // 没有锚点（如键盘触发）它会退到视口中心/默认位，不需要在这里另算。
  void ui.addFilesToCanvas(list);
}
</script>

<template>
  <TooltipProvider :delay-duration="200">
  <div class="flex items-center justify-center gap-2">
    <div class="flex h-[50px] items-center gap-2 rounded-xl border border-line bg-panel px-2" aria-label="画布工具栏"
      @pointerdown.stop>
      <!-- 可排序槽：内置按钮（SlotAnchor）与插件条目（ctx.slots.register('shell.dock')）一起排。
         插件写 before/after 时指向条目 id（host/shortcuts 这种），不是槽名。
         Agent 圆球是排序容器外的独立按钮，不能作为 before/after 目标。 -->
      <SlotComposer slot="shell.dock" item-class="flex-none" class="flex items-center gap-2" :shared-props="slotShared">
        <SlotAnchor id="host/upload-input" :order="90">
          <input ref="uploadInput" type="file" multiple class="hidden" aria-hidden="true"
            accept="image/*,video/*,audio/*,text/plain,.md,.txt" @change="onUploadPick" />
        </SlotAnchor>
        <SlotAnchor id="host/add" :order="100">
          <!--
          隐藏的文件选择器：菜单项「上传」触发它（选完直接建节点，见 script 里 pickUploadFiles）。
          放在**下拉之外**（菜单会被 Teleport 且点完就关）—— 若放进菜单里，
          关掉菜单会把 input 一起卸载，用户选完文件时 change 已经没人接了。
        -->
          <DropdownMenu v-model:open="s.addMenuOpen">
            <!--
              这个按钮只挂 DropdownMenu，不再套 Tooltip。

              2026-11-02 实测两轮：
                · Tooltip 在 DropdownMenuTrigger 里层 → 按钮只拿到 tooltip-trigger，
                  点下去只弹提示、菜单不出现（用户报「加号点不动」）；
                · Tooltip 在外层 → 菜单能开，但 popper 锚点被 tooltip 气泡接管，
                  整块菜单被挪到 translate(0, -200%)（屏幕外，用户仍看不到菜单）。
              原因是两个浮层共用同一个 <button> 作为 reference，reka 只有一个触发上下文。
              这里改用原生 title：悬停仍显示「添加节点」，菜单定位只认按钮本身。
            -->
            <DropdownMenuTrigger as-child>
              <Button variant="default" size="icon-sm" class="size-8 rounded-lg"
                :class="{ 'brightness-105': s.addMenuOpen }" aria-label="添加节点" title="添加节点">
                <Plus :size="17" class="size-[17px]" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent arrow side="top" align="center" :side-offset="24" :style="{ width: '240px' }">
              <div class="mb-1.5 flex h-8 items-center gap-1.5 rounded-lg bg-veil px-2.5 text-ink-dim">
                <Search :size="13" /><input class="w-full bg-transparent text-xs text-ink outline-none"
                  aria-label="搜索画布节点" placeholder="搜索画布节点" />
              </div>
              <DropdownMenuItem @select="ui.createNode('text'); s.addMenuOpen = false">
                <Type :size="15" /> 文本
              </DropdownMenuItem>
              <DropdownMenuItem @select="ui.createNode('image'); s.addMenuOpen = false">
                <ImageIcon :size="15" /> 图片
              </DropdownMenuItem>
              <DropdownMenuItem @select="ui.createNode('video'); s.addMenuOpen = false"><Video :size="15" /> 视频</DropdownMenuItem>
              <!--
          以下四项（智能剪辑 / 导演台 / 逐帧拉片 / 脚本）按用户口径（2026-10-11）暂时先注释掉，
          恢复时删掉这一对注释标记即可（对应的图标导入也一并注释在 script 里）。
        <DropdownMenuItem @select="ui.createNode('text')">
          <Film :size="15" /> 智能剪辑 <em
            class="ml-auto rounded border border-gold/40 px-1.5 py-px text-[9px] not-italic text-gold">Beta</em>
        </DropdownMenuItem>
        <DropdownMenuItem @select="ui.createNode('image')">
          <Box :size="15" /> 导演台 <em
            class="ml-auto rounded border border-brand/40 px-1.5 py-px text-[9px] not-italic text-brand">NEW</em>
        </DropdownMenuItem>
        <DropdownMenuItem @select="ui.createNode('image')">
          <Images :size="15" /> 逐帧拉片 <em
            class="ml-auto rounded border border-line px-1.5 py-px text-[9px] not-italic text-ink-dim">SD 2.5</em>
        </DropdownMenuItem>
        -->
              <DropdownMenuItem @select="ui.showToast('音频节点即将支持'); s.addMenuOpen = false">
                <AudioLines :size="15" /> 音频
              </DropdownMenuItem>
              <!-- 脚本（同样暂时隐藏）
        <DropdownMenuItem @select="ui.showToast('脚本节点即将支持')">
          <ScrollText :size="15" /> 脚本
        </DropdownMenuItem>
        -->
              <div class="px-2 py-1.5 text-[10px] font-bold tracking-wider text-ink-dim">
                素材库
              </div>
              <!-- 「添加资源」= 打开上传资产弹窗（改名 / 选保存位置 / 打标签 → 存进资产库）。
             与「上传」（选完直接落画布成节点）是两件事，别再互相顶替。 -->
              <DropdownMenuItem @select="openUploadDialog(); s.addMenuOpen = false">
                <FolderOpen :size="15" /> 添加资源
              </DropdownMenuItem>
              <DropdownMenuItem @select="pickUploadFiles(); s.addMenuOpen = false">
                <Upload :size="15" /> 上传
              </DropdownMenuItem>
              <DropdownMenuItem @select="ui.toggleHistory()">
                <History :size="15" /> 从生成历史选择
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </SlotAnchor>
        <SlotAnchor id="host/move" :order="200">
          <!-- 移动：中轴对齐的下拉（菜单中心 = 按钮中心，箭头居中指按钮），V/H 切换 -->
          <DropdownMenu v-model:open="s.moveMenuOpen">
            <DropdownMenuTrigger as-child>
              <Button variant="ghost" size="icon-sm" class="size-8 rounded-lg"
                :class="{ 'bg-chip': s.moveMenuOpen }" aria-label="移动" :aria-expanded="s.moveMenuOpen">
                <component :is="s.canvasMode === 'move' ? Move : Hand" :size="16" class="size-4" />
              </Button>
            </DropdownMenuTrigger>
            <!-- 向上弹时留 24px：sideOffset 从触发按钮算起，按钮又在 50px 托盘里下沉约 9px，
                 留 24px 后菜单底边与托盘顶部才有 14px 左右的视觉缝隙（用户口径 2026-11-02）。 -->
            <DropdownMenuContent arrow side="top" align="center" :side-offset="24" :style="{ minWidth: '200px' }">
                <DropdownMenuItem :class="{ 'bg-accent': s.canvasMode === 'move' }" @select="ui.setCanvasMode('move'); s.moveMenuOpen = false; ui.showToast('已切换到移动工具')">
                  <Move :size="15" /> 移动
                  <span class="ml-auto text-[10px] text-ink-dim">V</span>
                </DropdownMenuItem>
                <DropdownMenuItem :class="{ 'bg-accent': s.canvasMode === 'hand' }" @select="ui.setCanvasMode('hand'); s.moveMenuOpen = false; ui.showToast('已切换到抓手工具')">
                  <Hand :size="15" /> 抓手工具
                  <span class="ml-auto text-[10px] text-ink-dim">H</span>
                </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </SlotAnchor>
        <SlotAnchor id="host/library" :order="300">
          <!-- 素材库：**点击触发**（与移动一致；方向键/素材库都点开才展开，不再 hover 弹出） -->
          <DropdownMenu v-model:open="s.libraryMenuOpen">
            <DropdownMenuTrigger as-child>
              <Button variant="ghost" size="icon-sm" class="size-8 rounded-lg"
                :class="{ 'bg-chip': s.libraryMenuOpen || s.drawer === 'left' }" aria-label="素材库"
                :aria-expanded="s.libraryMenuOpen">
                <FolderOpen :size="16" class="size-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent arrow side="top" align="center" :side-offset="24" :style="{ minWidth: '228px' }">
                <!-- 「风格库」由 plugin-style-library 提供：这里执行它注册的命令（未装该插件则 no-op，不报错） -->
                <DropdownMenuItem @select="s.libraryMenuOpen = false; ui.runCommand('style-library:open')">
                  <Shapes :size="15" /> 风格库
                  <em
                    class="ml-auto rounded border border-brand/40 px-1.5 py-px text-[9px] not-italic text-brand">NEW</em>
                </DropdownMenuItem>
                <!-- 「特效库」由 plugin-style-library 提供（与风格库同一插件、两套数据）：执行它注册的命令 -->
                <DropdownMenuItem @select="s.libraryMenuOpen = false; ui.runCommand('effect-library:open')">
                  <Sparkles :size="15" /> 特效库
                  <em
                    class="ml-auto rounded border border-brand/40 px-1.5 py-px text-[9px] not-italic text-brand">NEW</em>
                </DropdownMenuItem>
                <DropdownMenuItem @select="s.libraryMenuOpen = false; ui.openDrawer('left')">
                  <FolderOpen :size="15" /> 打开工具箱
                </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </SlotAnchor>
        <SlotAnchor id="host/roles" :order="400">
          <Tooltip>
            <TooltipTrigger as-child>
              <Button variant="ghost" size="icon-sm" class="size-8 rounded-lg" aria-label="角色造型室"
                @click="ui.openDrawer('roles')">
                <Shapes :size="16" class="size-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="top">角色造型室</TooltipContent>
          </Tooltip>
        </SlotAnchor>
        <SlotAnchor id="host/history" :order="500">
          <Tooltip>
            <TooltipTrigger as-child>
              <Button variant="ghost" size="icon-sm" class="size-8 rounded-lg"
                :class="{ 'bg-chip': s.historyOpen }" aria-label="生成历史" @click="ui.toggleHistory()">
                <History :size="16" class="size-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="top">生成历史</TooltipContent>
          </Tooltip>
        </SlotAnchor>
        <SlotAnchor id="host/separator" :order="600"><span class="h-6 w-px bg-line"></span></SlotAnchor>
        <SlotAnchor id="host/shortcuts" :order="700">
          <Tooltip>
            <TooltipTrigger as-child>
              <Button variant="ghost" size="icon-sm" class="size-8 rounded-lg"
                :class="{ 'bg-chip': s.shortcutsOpen }" aria-label="快捷键" @click="ui.toggleShortcuts()">
                <Keyboard :size="16" class="size-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="top">快捷键</TooltipContent>
          </Tooltip>
        </SlotAnchor>
        <!--
      <Tooltip><TooltipTrigger as-child><button
        class="grid size-8 place-items-center rounded-lg text-ink transition-colors hover:bg-hover" aria-label="教程"
        @click="ui.showToast('教程')">
        <CircleQuestionMark :size="16" />
      </button></TooltipTrigger><TooltipContent side="top">教程</TooltipContent></Tooltip>
    -->
      </SlotComposer>
    </div>

    <!-- Agent 圆球：**独立按钮**，不属于插槽排序容器（用户口径 2026-10-28）。
         不使用 SlotAnchor，也不参与 before/after 排序。
         2026-11-02：高度与同一行的「画布工具栏」「画布状态栏」一致（40px），
         圆角走全局 --mct-radius —— 它是圆角按钮，不是圆形球（用户口径）。 -->
    <Tooltip>
      <TooltipTrigger as-child>
        <Button variant="outline" size="icon-lg" class="agent-orb-button size-10 border-line text-ink"
          :class="ui.agent.open ? 'is-open bg-panel-active' : ''" aria-label="Agent 对话"
          @click="ui.toggleAgent()">
          <!-- 表情圆球（照用户给的参考文件移植）：瞳孔跟随鼠标、悬停咧嘴、离开变惊讶。
               按钮本体的 aria-label / tooltip / 点击不变，只把里面的图标换成它。 -->
          <AgentOrb :open="ui.agent.open" />
        </Button>
      </TooltipTrigger>
      <TooltipContent side="left">Agent 对话</TooltipContent>
    </Tooltip>
  </div>
  </TooltipProvider>
</template>

<style scoped>
/* 圆球按钮自己画底：shadcn 的 outline 变体在暗色下带 dark:bg-transparent，
   会盖住 bg-panel（实测暗色主题里球身透出画布网格）。这里用组件类固定面板色；
   打开态换 --ui-panel-active，和原来的 bg-panel-active 是同一个语义。 */
/*
 * 圆角与状态栏 / 工具栏的 40px 方块一致：读全局圆角档位，不写死。
 * Button 自己带的 rounded-4xl 会把球切成 36px 大圆角，这里必须覆盖一次。
 */
.agent-orb-button {
  background: var(--ui-panel, #fff) !important;
  border-radius: var(--mct-radius, var(--radius-control, 8px));
}
.agent-orb-button:hover { background: var(--ui-panel, #fff) !important; }
.agent-orb-button.is-open { background: var(--ui-panel-active, #e8eaf0) !important; }
</style>

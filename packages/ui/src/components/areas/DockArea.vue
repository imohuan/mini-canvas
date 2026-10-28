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
import AxDropdown from "../AxDropdown.vue";
import AxTooltip from "../AxTooltip.vue";
import AxMenu from "../AxMenu.vue";
import AxMenuItem from "../AxMenuItem.vue";
import AgentOrb from "../AgentOrb.vue";
import { useUi } from "../../composables/ui";
import { openUploadDialog } from "../../composables/assetUploadBus";
import { ref } from "vue";
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
  <div class="flex items-center justify-center gap-2">
    <div
      class="flex h-[50px] items-center gap-2 rounded-xl border border-line bg-panel px-2"
      aria-label="画布工具栏"
      @pointerdown.stop
    >
      <!-- 可排序槽：内置按钮（SlotAnchor）与插件条目（ctx.slots.register('shell.dock')）一起排。
         插件写 before/after 时指向条目 id（host/agent 这种），不是槽名。 -->
      <SlotComposer
        slot="shell.dock"
        item-class="flex-none"
        class="flex items-center gap-2"
        :shared-props="slotShared"
        :debug="Boolean(s.cfg.debug.slotDebug)"
        label="底栏"
      >
        <SlotAnchor id="host/upload-input" :order="90">
          <input
            ref="uploadInput"
            type="file"
            multiple
            class="hidden"
            aria-hidden="true"
            accept="image/*,video/*,audio/*,text/plain,.md,.txt"
            @change="onUploadPick"
          />
        </SlotAnchor>
        <SlotAnchor id="host/add" :order="100">
          <!--
          隐藏的文件选择器：菜单项「上传」触发它（选完直接建节点，见 script 里 pickUploadFiles）。
          放在**下拉之外**（菜单会被 Teleport 且点完就关）—— 若放进菜单里，
          关掉菜单会把 input 一起卸载，用户选完文件时 change 已经没人接了。
        -->
          <AxDropdown
            v-model="s.addMenuOpen"
            placement="top"
            align="center"
            :offset="10"
            menu-width="240px"
          >
            <template #trigger>
              <AxTooltip content="添加节点" placement="top">
                <button
                  class="grid size-8 place-items-center rounded-lg bg-primary-bg text-primary-ink transition-colors hover:brightness-110"
                  :class="{ 'brightness-105': s.addMenuOpen }"
                  aria-label="添加节点"
                >
                  <Plus :size="17" />
                </button>
              </AxTooltip>
            </template>
            <template #default="{ close }">
              <div
                class="mb-1.5 flex h-8 items-center gap-1.5 rounded-lg bg-veil px-2.5 text-ink-dim"
              >
                <Search :size="13" /><input
                  class="w-full bg-transparent text-xs text-ink outline-none"
                  aria-label="搜索画布节点"
                  placeholder="搜索画布节点"
                />
              </div>
              <AxMenuItem
                @click="
                  ui.createNode('text');
                  close();
                "
              >
                <Type :size="15" /> 文本
              </AxMenuItem>
              <AxMenuItem
                @click="
                  ui.createNode('image');
                  close();
                "
              >
                <ImageIcon :size="15" /> 图片
              </AxMenuItem>
              <AxMenuItem
                @click="
                  ui.createNode('video');
                  close();
                "
                ><Video :size="15" /> 视频</AxMenuItem
              >
              <!--
          以下四项（智能剪辑 / 导演台 / 逐帧拉片 / 脚本）按用户口径（2026-10-11）暂时先注释掉，
          恢复时删掉这一对注释标记即可（对应的图标导入也一并注释在 script 里）。
        <AxMenuItem @click="ui.createNode('text'); close()">
          <Film :size="15" /> 智能剪辑 <em
            class="ml-auto rounded border border-gold/40 px-1.5 py-px text-[9px] not-italic text-gold">Beta</em>
        </AxMenuItem>
        <AxMenuItem @click="ui.createNode('image'); close()">
          <Box :size="15" /> 导演台 <em
            class="ml-auto rounded border border-brand/40 px-1.5 py-px text-[9px] not-italic text-brand">NEW</em>
        </AxMenuItem>
        <AxMenuItem @click="ui.createNode('image'); close()">
          <Images :size="15" /> 逐帧拉片 <em
            class="ml-auto rounded border border-line px-1.5 py-px text-[9px] not-italic text-ink-dim">SD 2.5</em>
        </AxMenuItem>
        -->
              <AxMenuItem
                @click="
                  ui.showToast('音频节点即将支持');
                  close();
                "
              >
                <AudioLines :size="15" /> 音频
              </AxMenuItem>
              <!-- 脚本（同样暂时隐藏）
        <AxMenuItem @click="ui.showToast('脚本节点即将支持'); close()">
          <ScrollText :size="15" /> 脚本
        </AxMenuItem>
        -->
              <div
                class="px-2 py-1.5 text-[10px] font-bold tracking-wider text-ink-dim"
              >
                素材库
              </div>
              <!-- 「添加资源」= 打开上传资产弹窗（改名 / 选保存位置 / 打标签 → 存进资产库）。
             与「上传」（选完直接落画布成节点）是两件事，别再互相顶替。 -->
              <AxMenuItem
                @click="
                  openUploadDialog();
                  close();
                "
              >
                <FolderOpen :size="15" /> 添加资源
              </AxMenuItem>
              <AxMenuItem
                @click="
                  pickUploadFiles();
                  close();
                "
              >
                <Upload :size="15" /> 上传
              </AxMenuItem>
              <AxMenuItem @click="ui.toggleHistory()">
                <History :size="15" /> 从生成历史选择
              </AxMenuItem>
            </template>
          </AxDropdown>
        </SlotAnchor>
        <SlotAnchor id="host/move" :order="200">
          <!-- 移动：中轴对齐的下拉（菜单中心 = 按钮中心，箭头居中指按钮），V/H 切换 -->
          <AxDropdown
            v-model="s.moveMenuOpen"
            placement="top"
            align="center"
            :offset="10"
            menu-width="200px"
          >
            <template #trigger>
              <button
                class="grid size-8 place-items-center rounded-lg text-ink transition-colors hover:bg-hover"
                :class="{ 'bg-chip': s.moveMenuOpen }"
                aria-label="移动"
                :aria-expanded="s.moveMenuOpen"
              >
                <component
                  :is="s.canvasMode === 'move' ? Move : Hand"
                  :size="16"
                />
              </button>
            </template>
            <template #default="{ close }">
              <AxMenu>
                <AxMenuItem
                  :active="s.canvasMode === 'move'"
                  hint="V"
                  @click="
                    ui.setCanvasMode('move');
                    close();
                    ui.showToast('已切换到移动工具');
                  "
                >
                  <Move :size="15" /> 移动
                </AxMenuItem>
                <AxMenuItem
                  :active="s.canvasMode === 'hand'"
                  hint="H"
                  @click="
                    ui.setCanvasMode('hand');
                    close();
                    ui.showToast('已切换到抓手工具');
                  "
                >
                  <Hand :size="15" /> 抓手工具
                </AxMenuItem>
              </AxMenu>
            </template>
          </AxDropdown>
        </SlotAnchor>
        <SlotAnchor id="host/library" :order="300">
          <!-- 素材库：**点击触发**（与移动一致；方向键/素材库都点开才展开，不再 hover 弹出） -->
          <AxDropdown
            v-model="s.libraryMenuOpen"
            placement="top"
            align="center"
            :offset="10"
            menu-width="228px"
          >
            <template #trigger>
              <button
                class="grid size-8 place-items-center rounded-lg text-ink transition-colors hover:bg-hover"
                :class="{ 'bg-chip': s.libraryMenuOpen || s.drawer === 'left' }"
                aria-label="素材库"
                :aria-expanded="s.libraryMenuOpen"
              >
                <FolderOpen :size="16" />
              </button>
            </template>
            <template #default="{ close }">
              <AxMenu>
                <!-- 「风格库」由 plugin-style-library 提供：这里执行它注册的命令（未装该插件则 no-op，不报错） -->
                <AxMenuItem
                  @click="
                    close();
                    ui.runCommand('style-library:open');
                  "
                >
                  <Shapes :size="15" /> 风格库
                  <em
                    class="ml-auto rounded border border-brand/40 px-1.5 py-px text-[9px] not-italic text-brand"
                    >NEW</em
                  >
                </AxMenuItem>
                <!-- 「特效库」由 plugin-style-library 提供（与风格库同一插件、两套数据）：执行它注册的命令 -->
                <AxMenuItem
                  @click="
                    close();
                    ui.runCommand('effect-library:open');
                  "
                >
                  <Sparkles :size="15" /> 特效库
                  <em
                    class="ml-auto rounded border border-brand/40 px-1.5 py-px text-[9px] not-italic text-brand"
                    >NEW</em
                  >
                </AxMenuItem>
                <AxMenuItem
                  @click="
                    close();
                    ui.openDrawer('left');
                  "
                >
                  <FolderOpen :size="15" /> 打开工具箱
                </AxMenuItem>
              </AxMenu>
            </template>
          </AxDropdown>
        </SlotAnchor>
        <SlotAnchor id="host/roles" :order="400">
          <AxTooltip content="角色造型室" placement="top"
            ><button
              class="grid size-8 place-items-center rounded-lg text-ink transition-colors hover:bg-hover"
              aria-label="角色造型室"
              @click="ui.openDrawer('roles')"
            >
              <Shapes :size="16" /></button
          ></AxTooltip>
        </SlotAnchor>
        <SlotAnchor id="host/history" :order="500">
          <AxTooltip content="生成历史" placement="top"
            ><button
              class="grid size-8 place-items-center rounded-lg text-ink transition-colors hover:bg-hover"
              :class="{ 'bg-chip': s.historyOpen }"
              aria-label="生成历史"
              @click="ui.toggleHistory()"
            >
              <History :size="16" /></button
          ></AxTooltip>
        </SlotAnchor>
        <SlotAnchor id="host/separator" :order="600"
          ><span class="h-6 w-px bg-line"></span
        ></SlotAnchor>
        <SlotAnchor id="host/shortcuts" :order="700">
          <AxTooltip content="快捷键" placement="top"
            ><button
              class="grid size-8 place-items-center rounded-lg text-ink transition-colors hover:bg-hover"
              :class="{ 'bg-chip': s.shortcutsOpen }"
              aria-label="快捷键"
              @click="ui.toggleShortcuts()"
            >
              <Keyboard :size="16" /></button
          ></AxTooltip>
        </SlotAnchor>
        <!-- 
      <AxTooltip content="教程" placement="top"><button
        class="grid size-8 place-items-center rounded-lg text-ink transition-colors hover:bg-hover" aria-label="教程"
        @click="ui.showToast('教程')">
        <CircleQuestionMark :size="16" />
      </button></AxTooltip>
    -->
      </SlotComposer>
    </div>

    <AxTooltip content="Agent 对话" placement="left"
      ><button
        class="grid size-12 place-items-center rounded-full border border-line bg-panel text-ink"
        aria-label="Agent 对话"
        :class="{ 'bg-panel-active': ui.agent.open }"
        @click="ui.toggleAgent()"
      >
        <!-- 表情圆球（照用户给的参考文件移植）：瞳孔跟随鼠标、悬停咧嘴、离开变惊讶。
                   按钮本体的 aria-label / tooltip / 点击不变，只把里面的图标换成它。 -->
        <AgentOrb :open="ui.agent.open" /></button
    ></AxTooltip>
  </div>
</template>

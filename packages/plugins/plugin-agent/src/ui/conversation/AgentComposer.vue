<script setup lang="ts">
/**
 * AgentComposer —— 输入区（队列 / 目标 / 编辑器 / 工具栏下拉 / 发送键）。
 *
 * 纯拆分：模板与 class / 文案 / 事件原样保留；状态来自同一个
 * useAgentConversation 控制器（入口 provide）。
 */
import { computed, inject } from 'vue'
import { useUiComponent } from '@mini-canvas/canvas-render'
import { ProseMirrorEditor } from 'prosemirror-editor-bundle'
import { X, Plus, Upload, Target, Minimize2, Search, Check, Layers, WandSparkles, Plug, RefreshCw, BellRing, GripVertical, CornerUpRight, Trash2, MoreHorizontal, Pencil, Play, Pause, ChevronDown, ArrowUp, Hand, ShieldAlert, Box, Sparkles } from 'lucide-vue-next'
import { VueDraggable } from 'vue-draggable-plus'
import { ICON_SKILL, ICON_MCP } from '../shared/agentResources.js'
import type { AgentConversationController } from './useAgentConversation'
import AgentScrollArea from './AgentScrollArea.vue'

const c = inject('agentConversation') as AgentConversationController

const cProps = c as unknown as Record<string, any>
/** MCP 探测态 */
const probing = cProps.mcpProbing as { value: boolean }
const {
  agent, s, prompt, editorRef, attached: attachedMaybe, queue, pending,
  showNotifyTip, enableNotify, notifyDismissed, onQueueReorder, hoverRowId, rowMenuId,
  openPreview, previewItem, userSegments, displayUserText, onSegClick, segTitle, segClickable,
  cancelEditQueue, steerItem, removeItem, closeItem, beginEditQueue,
  goalRow, editingGoal, startEditGoalRow, commitGoalBudget, onGoalBudgetKeydown, onGoalBudgetBlur,
  onGoalEditFocus, formatToken, tokenUnit, budgetTokenText, goalMark, goalMarkText, clearGoalMark,
  editingKind, editingKindText, scrollToEditing,
  toggleQueuePause, cancelEditing, removeAttachment, editorResources,
  onEditorKeydown, onPaste, composerMenuOpen, setComposerMenuOpen, plusOpen,
  COMPOSER_MENU_ALIGN, COMPOSER_MENU_SIDE, COMPOSER_MENU_OFFSET, addGoalMark, pickImages,
  compactNow, onFilesPicked, modeOpen, modeLabel, pickMode, AUTH_MODES, authMode, setAuthMode,
  promptPresets, authOpen, modelOpen, modelView, usableModels, setModelView, modelQuery,
  filteredModels, isModelPicked, pickModel, brandNameOf, brandSvgOf, modelNote, currentModelLabel,
  modelPlatformGroups, modelPlatform, assistantRows, hasCardView, viewOf, previewToolMedia,
  openTools, openToolGroups, toggleTool, toggleToolGroup, toolGroupTitle, toolRowSummary,
  openThinking, toggleThinking, openUserBubbles, overflowingUser, toggleUserBubble,
  setUserBubbleBody, msgTimeText, msgTimeTitle, copied, copyMessage, beginEditMessage,
  segmentByAnchor, segmentModelLabel, hasInlineError, pagerByAnchor, pagerTarget,
  skillQuery, skillView, setSkillView, filteredSkills, skillCategory, skillCategoryRows,
  skillMetaOf, skillFileCount, skillSize, skillCoverStyle, mcpQuery, mcpOpen, mcpExpanded,
  toggleMcpExpand, mcpPickedServers, mcpPickedTools, mcpToolKey, toggleMcpServer, toggleMcpTool,
  mcpPickTotal, confirmMcpPicks, mcpProbeHint, mcpStatusOf, mcpServerDesc,
  mcpTransport, mcpToolCount, mcpToolsOf, runMcpProbe, filteredMcpResources,
  sendMode, submit, showPendingOn, COMPOSER_MENU_FLAGS, contextArcOffset, CONTEXT_CIRCUMFERENCE,
  SUGGESTIONS, useSuggestion, dismissHint, hintDismissed, insertRef, brandSvg, skillOpen,
  showScrollToBottom, smoothScrollToBottom, SHOW_PROCESS_NOTICE,
} = cProps

// attached 在控制器里是 MaybeRef（数组或 ref），解构后统一展开，保持模板原样
const attached = computed(() => {
  const raw = attachedMaybe as unknown
  const list = (raw && typeof raw === 'object' && 'value' in (raw as object)) ? (raw as { value?: unknown }).value : raw
  return Array.isArray(list) ? (list as string[]) : []
})

const Button = useUiComponent('Button')
const Badge = useUiComponent('Badge')
const DropdownMenu = useUiComponent('DropdownMenu')
const DropdownMenuContent = useUiComponent('DropdownMenuContent')
const DropdownMenuTrigger = useUiComponent('DropdownMenuTrigger')
// 菜单项一律用组件库的 item / label / separator：
// 之前这里拿 Button 当菜单项写（自己补 hover 底、自己钉高度、自己排两行），
// 键盘选中、高亮、禁用态都要自己再实现一遍，且与其它面板的菜单长得不一样。
const DropdownMenuItem = useUiComponent('DropdownMenuItem')
const DropdownMenuLabel = useUiComponent('DropdownMenuLabel')
const DropdownMenuSeparator = useUiComponent('DropdownMenuSeparator')
const InputGroup = useUiComponent('InputGroup')
const InputGroupAddon = useUiComponent('InputGroupAddon')
const InputGroupButton = useUiComponent('InputGroupButton')
const InputGroupInput = useUiComponent('InputGroupInput')
const Tabs = useUiComponent('Tabs')
const TabsList = useUiComponent('TabsList')
const TabsTrigger = useUiComponent('TabsTrigger')
const Tooltip = useUiComponent('Tooltip')
const TooltipContent = useUiComponent('TooltipContent')
const TooltipProvider = useUiComponent('TooltipProvider')
const TooltipTrigger = useUiComponent('TooltipTrigger')
</script>

<template>
  <div class="ac-composer">
      <!-- 通知提示条（照参考页实测）：只在浏览器还没授权时出现，点「开启」走真的权限申请 -->
      <div v-if="showNotifyTip" class="ac-notify" role="status">
        <BellRing :size="14" class="ac-notify-icon" />
        <span class="ac-notify-text">开启浏览器通知，及时获取最新消息</span>
        <Button variant="ghost" size="sm" class="ac-notify-btn" @click="enableNotify">开启</Button>
        <Button variant="ghost" size="icon-sm" class="ac-notify-close" aria-label="不再提示" @click="notifyDismissed = true">
          <X :size="13" />
        </Button>
      </div>
      <div v-if="pending.hasAny" class="ac-pending-box">
        <div class="ac-pending-list" role="list" aria-label="目标与排队消息">
          <!-- 排队消息在上、**目标在最下**（用户口径 2026-10-11）：
                 目标是一个持续进行的循环，队列排它前面 —— 每轮跑完先清队列，
                 队列清空后才轮到目标下一轮。展示顺序跟执行顺序保持一致。 -->
          <!-- 编辑中的那条会**停住整个队列**（G7）：说清楚原因，别让用户以为卡住了 -->
          <VueDraggable :model-value="queue.rows" class="ac-queue-drag" :animation="180"
            ghost-class="ac-queue-row--ghost" chosen-class="ac-queue-row--chosen"
            handle=".ac-queue-lead-swap" @update:model-value="onQueueReorder">
            <div v-for="row in queue.rows" :key="row.id" class="ac-pending-row ac-queue-row" role="listitem"
              :class="{ 'is-editing': row.editing, 'is-sending': row.sending, 'is-hover': hoverRowId === row.id }"
              @pointerenter="hoverRowId = row.id" @pointerleave="hoverRowId === row.id && (hoverRowId = null)">
              <!-- 左侧图标 + 拖拽把手（用户口径 2026-10-16 二次修正）：默认显示**原来的
                   图标**，hover 这一行时才换成拖拽把手 —— 图标不变会显得突兀，要"有变化"。
                   发送中 / 已发送的行没有把手 —— 它们的位置由调度器钉住，不参与排序。 -->
              <span v-if="!row.sending && !row.sent" class="ac-queue-lead-swap" aria-hidden="true">
                <span class="ac-pending-lead is-rest">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
                    stroke-linecap="round" stroke-linejoin="round">
                    <path d="M6 3v12" />
                    <circle cx="18" cy="6" r="3" />
                    <circle cx="6" cy="18" r="3" />
                    <path d="M18 9a9 9 0 0 1-9 9" />
                  </svg>
                </span>
                <span class="ac-queue-handle" title="拖动调整发送顺序" :aria-label="'拖动 ' + (row.text || '').slice(0, 20)">
                  <GripVertical :size="12" />
                </span>
              </span>
              <span v-else class="ac-pending-lead" aria-hidden="true">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
                stroke-linecap="round" stroke-linejoin="round">
                <path d="M6 3v12" />
                <circle cx="18" cy="6" r="3" />
                <circle cx="6" cy="18" r="3" />
                <path d="M18 9a9 9 0 0 1-9 9" />
              </svg>
            </span>
            <!-- 迷你图 + 「+N」：白图与背景同色会看不见，加一圈淡边框（不抢眼）；多于 1 张显示 +N -->
            <img v-if="row.thumbs.length" class="ac-queue-thumb" :src="row.thumbs[0]" alt="" role="button"
              :aria-label="'查看排队图片'" :title="'这条消息带 ' + row.images.length + ' 张图'"
              @click="openPreview(row.thumbs[0], row.images)" />
            <span v-if="row.images.length > 1" class="ac-queue-thumb-more" role="status"
              :title="'共 ' + row.images.length + ' 张图'">+{{ row.images.length - 1 }}</span>
            <span class="ac-queue-text" :title="displayUserText(row.text)">
              <!-- 队列条目也是**用户消息**：@节点 / @技能 标记同样要渲染成标签，
                     否则那串 <ref …> XML 原样露出（用户口径 2026-10-11：气泡/目标/队列三处都要认）。 -->
              <template v-if="row.text">
                <template v-for="(seg, si) in userSegments(displayUserText(row.text))" :key="si">
                  <span v-if="seg.type === 'tag'" class="ac-sent-tag is-compact" :title="segTitle(seg)">{{ seg.name
                    }}</span>
                  <span v-else>{{ seg.value }}</span>
                </template>
              </template>
              <template v-else>（图片）</template>
            </span>
            <!-- 编辑中：队列**整体阻塞**（后端保证不发下一条），行上直接说明，用户不用猜为什么不动 -->
            <span v-if="row.editing" class="ac-queue-flag" role="status">编辑中</span>
            <span v-else-if="row.goal" class="ac-queue-flag is-goal"
              :title="'目标：' + goalMarkText(row.goal.objective, row.goal.budget)">目标</span>
            <span v-if="row.sending" class="ac-queue-flag is-sending">发送中</span>
            <span v-else-if="row.sent" class="ac-queue-flag is-sent">已发送</span>

            <span class="ac-queue-actions">
              <!-- 编辑中：这一条是"停住队列"的那条，行上给一个取消编辑（状态回 queued） -->
              <Button v-if="row.editing" variant="ghost" size="icon-sm" class="ac-queue-btn" aria-label="取消编辑这条排队消息" title="取消编辑"
                @click="cancelEditQueue(row.id)">
                <X :size="12" />
              </Button>
              <!-- 引导 ↳：跑着时 = 插队（插进当前轮的下一次请求）；没跑时后端直接当一次发送 -->
              <Button v-else variant="ghost" size="icon-sm" class="ac-queue-btn" aria-label="引导（插队发送）" title="引导：插到当前这一轮的下一次请求"
                @click="steerItem(row.id)">
                <CornerUpRight :size="12" />
              </Button>
              <Button variant="ghost" size="icon-sm" class="ac-queue-btn is-danger" aria-label="删除这条排队消息" title="删除" @click="removeItem(row.id)">
                <Trash2 :size="12" />
              </Button>
              <!-- ⋯ 只有两项：编辑消息 / 关闭排队（设计 §3.6.2），用目录里的 dropdown -->
                <DropdownMenu :open="rowMenuId === row.id" @update:open="(v: boolean) => (rowMenuId = v ? row.id : null)">
                  <DropdownMenuTrigger as-child>
                    <Button variant="ghost" size="icon-xs" class="ac-queue-btn" :aria-expanded="rowMenuId === row.id" aria-label="更多操作">
                      <MoreHorizontal :size="12" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent arrow align="end" side="top" :side-offset="8" class="ac-ddmenu" :style="{ minWidth: '180px' }">
                    <DropdownMenuItem @select="beginEditQueue(row.id); rowMenuId = null">
                      编辑消息
                      <span class="ac-menu-hint">改完发送，位置不变</span>
                    </DropdownMenuItem>
                    <DropdownMenuItem @select="closeItem(row.id); rowMenuId = null">
                      关闭排队
                      <span class="ac-menu-hint">内容回到输入框，不再自动发</span>
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
            </span>
          </div>
          </VueDraggable>
          <!-- 目标行（**已发送**的目标才进列表；未发送的在输入框内侧）—— 排在**队列之后、最下面**。
                 UI 与队列行刻意不同：强调色底 + 「第 N 轮」+ 已用/总预算 + 暂停/结束。 -->
          <div v-if="goalRow" class="ac-pending-row ac-goal-row" :class="{ 'is-editing': editingGoal }" role="listitem">
            <!-- 左侧图标：hover 时从「目标」变成「编辑」（用户口径 2026-10-09），点它进入编辑 -->
            <!-- 真完成的目标**不需要编辑**（用户口径 2026-10-09）：那时只画一个纯图标、不可点。
                   注意判据是 goalRow.finished（不是 ended）—— 「被中止」仍可编辑/可续跑。 -->
            <Button v-if="!goalRow.finished" variant="ghost" size="icon-sm" class="ac-pending-lead ac-goal-lead" type="button"
              :aria-label="editingGoal ? '正在编辑目标' : '编辑目标'" :title="editingGoal ? '正在编辑目标' : '编辑目标'"
              :class="{ 'is-editing': editingGoal }" @click="startEditGoalRow()">
              <!-- 图标尺寸与队列行的 lead 完全一致（14×14，内联 SVG）—— 两行左列才对得齐 -->
              <Target :size="14" class="ac-goal-lead-target" />
              <Pencil :size="14" class="ac-goal-lead-edit" />
            </Button>
            <span v-else class="ac-pending-lead" aria-hidden="true">
              <Target :size="14" />
            </span>
            <!-- 目标参考图迷你预览：**放文字前面**（与队列行同位——lead 图标之后、正文之前）。
                   淡边框 + 多图「+N」，与队列缩略图同一套样式（用户口径 2026-10-09）。 -->
            <template v-if="s.goalImages?.length">
              <img class="ac-queue-thumb" :src="s.goalImages[0]" alt="" role="button" :aria-label="'查看目标图片'"
                :title="'这个目标带 ' + s.goalImages.length + ' 张图'" @click="openPreview(s.goalImages[0], s.goalImages)" />
              <span v-if="s.goalImages.length > 1" class="ac-queue-thumb-more" role="status"
                :title="'共 ' + s.goalImages.length + ' 张图'">+{{ s.goalImages.length - 1 }}</span>
            </template>
            <span class="ac-goal-row-text" :title="s.goal?.objective">
              <!-- 目标是**用户消息**：正文里的 @节点 / @技能 标记要跟气泡同一套解析渲染成标签，
                     否则那串 <ref …> XML 会原样露出来（用户实测 2026-10-11）。 -->
              <template v-for="(seg, si) in userSegments(s.goal?.objective ?? '')" :key="si">
                <span v-if="seg.type === 'tag'" class="ac-sent-tag is-compact" :title="segTitle(seg)">{{ seg.name
                  }}</span>
                <span v-else>{{ seg.value }}</span>
              </template>
            </span>
            <span class="ac-goal-flag" :class="goalRow.badge.cls" role="status">{{ goalRow.badge.text }}</span>
            <!-- 编辑目标时在右侧打「正在编辑」标签（与消息/队列编辑同一套黄色语义，用户口径 2026-10-09） -->
            <span v-if="editingGoal" class="ac-editing-badge is-compact" role="status">
              <Pencil :size="11" /><span>正在编辑</span>
            </span>
            <!-- 右侧一组（用户口径 2026-10-09）：迷你图 → 第 N 轮 → 已用/总预算 → 按钮，**整体右对齐**（spacer 顶开）。
                   进度条删掉了 —— 「已用/总预算」数字本身就是进度。 -->
            <span class="ac-goal-round">第 {{ goalRow.round }} 轮</span>
            <!-- 「已用/总预算」一体式（用户口径 2026-10-09）：形如 5.2k/5k，左右两段**各自可点着改**。
                   左边是已用、右边是总预算；两段都能点着改，**回车才生效**。 -->
            <span class="ac-goal-ratio" :title="'已用 / 总预算' + '（点数字可改，回车生效）'">
              <span class="ac-goal-token-val" contenteditable="true" spellcheck="false" role="textbox"
                aria-label="已用 token，点击编辑（回车生效）" @focus="onGoalEditFocus($event)"
                @keydown="onGoalBudgetKeydown($event, $event.target as HTMLElement, 'used')"
                @blur="onGoalBudgetBlur($event)">{{ formatToken(s.goal?.tokensUsed, tokenUnit) }}</span>
              <span class="ac-goal-ratio-sep">/</span>
              <span class="ac-goal-token-val" contenteditable="true" spellcheck="false" role="textbox"
                aria-label="总预算，点击编辑（回车生效）" @focus="onGoalEditFocus($event)"
                @keydown="onGoalBudgetKeydown($event, $event.target as HTMLElement, 'row')"
                @blur="onGoalBudgetBlur($event)">{{ budgetTokenText(s.goal?.budget, tokenUnit) }}</span>
            </span>
            <!-- 暂停 / 播放：**只要目标没真完成就给**（用户口径 2026-10-11）。
                   被中止（aborted）不是完成 —— 那时必须还能点播放接着跑。 -->
            <Button v-if="!goalRow.finished" variant="ghost" size="icon-xs" class="ac-goal-btn" :aria-label="s.goalPaused ? '启动目标' : '暂停目标'"
              :title="s.goalPaused ? '启动目标' : '暂停目标'" @click="s.goalPaused ? agent.resumeGoal() : agent.pauseGoal()">
              <Play v-if="s.goalPaused" :size="12" />
              <Pause v-else :size="12" />
            </Button>
            <Button variant="ghost" size="icon-xs" class="ac-goal-btn" aria-label="结束目标" title="结束目标（不会自动再跑）" @click="agent.endGoal()">
              <X :size="12" />
            </Button>
          </div>
        </div>
      </div>

            <div class="ac-input-box">
        <!-- 队列暂停 / 恢复：**骑在队列容器与输入框的分界线上**、水平居中。
             位置口径与参考 HTML 一致 —— 挂在 **composer** 里（不是容器里）：容器要 overflow:hidden
             才能把内部方角按外层圆角裁掉；按钮若放进容器会被一起裁掉半个。 -->
        <!-- 显示条件（用户口径 2026-10-15）：过滤掉「发送中」后还有排着的（或已暂停要恢复）才给 -->
        <Button v-if="queue.pauseVisible" variant="ghost" size="xs" class="ac-queue-pause" :class="{ 'is-paused': queue.paused }"
          :aria-label="queue.paused ? '恢复队列' : '暂停队列自动发送'" :title="queue.pauseTitle" @click="toggleQueuePause()">
          <Play v-if="queue.paused" :size="12" />
          <Pause v-else :size="12" />
          <span>{{ queue.paused ? '队列恢复' : '队列暂停' }}</span>
          <span class="ac-queue-pause-cnt">{{ queue.pendingCount }}</span>
        </Button>
        <!-- 未发送的目标：**输入框内侧顶部**（用户口径 2026-10-09）。
             标签只写「目标」二字（目标正文就是下面输入框里的内容，不重复）；
             预算行内可编辑（下划线 = CSS text-decoration）；口径开关与取消在右侧。 -->
        <!-- 编辑**正在运行的目标**时不画这张卡片：上面已有目标行（它就是「卡片头部」），
             再画一张就成了两张卡片（用户截图指出的重复）。 -->
        <div v-if="goalMark && !editingGoal" class="ac-goal-mark">
          <Target :size="13" class="ac-goal-icon" />
          <span class="ac-goal-mark-label">目标</span>
          <span class="ac-goal-token">
            <span class="ac-goal-token-prefix">预算</span>
            <span class="ac-goal-token-val" contenteditable="true" spellcheck="false" role="textbox"
              aria-label="总预算，点击编辑" @focus="onGoalEditFocus($event)"
              @keydown="onGoalBudgetKeydown($event, $event.target as HTMLElement, 'mark')"
              @blur="onGoalBudgetBlur($event)">{{ budgetTokenText(goalMark?.budget, tokenUnit) }}</span>
          </span>
          <span class="ac-tb-spacer"></span>
          <Button variant="ghost" size="icon-xs" class="ac-goal-btn" aria-label="取消目标（这条按普通消息发）" title="取消目标" @click="clearGoalMark()">
            <X :size="12" />
          </Button>
        </div>
        <!-- 「正在编辑」联动标记：**输入框内部最上一行**（用户口径 2026-10-06 参考图箭头位），
             点它滚回那条消息、✕ 取消 —— 与消息上的徽标互为呼应 -->
        <!--    三种编辑（对话消息 / 队列消息 / 目标）**共用这一条**黄色标记（用户口径 2026-10-09）：
               谁在编辑就说谁；三者互斥，所以这里最多出现一条。 -->
        <div v-if="editingKind" class="ac-editing-mark" role="status">
          <Pencil :size="12" />
          <Button variant="ghost" size="xs" class="ac-editing-mark-btn" :aria-label="editingKindText" @click="scrollToEditing">{{ editingKindText
            }}</Button>
          <span class="ac-editing-mark-spacer"></span>
          <Button variant="ghost" size="icon-xs" class="ac-editing-x" aria-label="取消编辑" @click="cancelEditing">
            <X :size="12" />
          </Button>
        </div>
        <!-- 待发送的图片：贴在输入框上方，可单张移除；点图本体看全屏预览 -->
        <div v-if="attached.length" class="ac-attach-list">
          <div v-for="(src, i) in attached" :key="i" class="ac-attach">
            <img :src="src" alt="" role="button" :aria-label="'查看图片 ' + (i + 1)" style="cursor: zoom-in"
              @click="openPreview(src, attached)" />
            <Button variant="ghost" size="icon-sm" class="ac-attach-del" :aria-label="'移除图片 ' + (i + 1)" @click="removeAttachment(i)">
              <X :size="12" />
            </Button>
          </div>
        </div>
        <div class="ac-editor">
          <span v-if="!prompt" class="ac-placeholder" aria-hidden="true">开始你的创作，或者 @ 引用技能 / MCP</span>
          <ProseMirrorEditor v-if="!s.needsModel" ref="editorRef" v-model="prompt" :resources="editorResources"
            @keydown.capture="onEditorKeydown" @paste="onPaste" />
        </div>


        <div class="ac-toolbar">
          <DropdownMenu :open="composerMenuOpen('plus')" @update:open="(v: boolean) => setComposerMenuOpen('plus', v)">
            <DropdownMenuTrigger as-child>
              <Button variant="ghost" size="icon-sm" :aria-expanded="plusOpen" aria-label="更多添加">
                <Plus :size="16" class="size-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent arrow :align="COMPOSER_MENU_ALIGN" :side="COMPOSER_MENU_SIDE" :side-offset="COMPOSER_MENU_OFFSET" :style="{ minWidth: '180px' }">
              <!-- 简洁模式（用户口径 2026-11-04）：只留「图标 + 标题」一行，说明文案不再展示 ——
                   文字说明改为 title 提示（鼠标悬停可见），菜单也更矮更干净。
                   图标与标题同行靠 ac-ddmenu-row 的网格排布。 -->
              <DropdownMenuItem title="给这条消息挂一个目标（可改预算）" @select="addGoalMark(); plusOpen = false">
                <Target />
                <span>目标</span>
              </DropdownMenuItem>
              <DropdownMenuItem title="选图片，跟这条消息一起发" @select="pickImages(); plusOpen = false">
                <Upload />
                <span>上传文件</span>
              </DropdownMenuItem>
              <!-- 「压缩」（用户口径 2026-10-11）：把历史总结成摘要、腾出上下文。
                   与 @ 菜单里的那一项走同一条命令（agent.compact）—— 两个入口，
                   一处实现，行为只会一起改。压缩只对**已有对话**有意义：
                   没会话时后端会如实拒绝（不装作成功）。 -->
              <DropdownMenuItem :disabled="s.compacting" :title="s.compacting ? '正在压缩…' : '把历史总结成摘要，腾出上下文空间'" @select="compactNow(); plusOpen = false">
                <Minimize2 />
                <span>压缩</span>
                <span v-if="s.compacting" class="ac-menu-hint">正在压缩…</span>
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
<input ref="fileInput" class="ac-file" type="file" accept="image/*" multiple aria-hidden="true" tabindex="-1"
            @change="onFilesPicked" />
          <!-- 模式：圆角胶囊 + 下拉（向上弹，贴左对齐） -->
          <DropdownMenu :open="composerMenuOpen('mode')" @update:open="(v: boolean) => setComposerMenuOpen('mode', v)">
            <DropdownMenuTrigger as-child>
              <Button variant="ghost" size="sm" :aria-expanded="modeOpen" aria-label="选择创作模式">
                <span class="ac-pill-text">{{ modeLabel }}</span>
                <ChevronDown :size="13" class="ac-pill-caret" />
              </Button>
            </DropdownMenuTrigger>
            <!-- 位置：与输入区其它菜单同一套参数（向上 / 居中 / 统一偏移），
                 见 COMPOSER_MENU_OFFSET 的注释。 -->
            <DropdownMenuContent arrow :align="COMPOSER_MENU_ALIGN" :side="COMPOSER_MENU_SIDE" :side-offset="COMPOSER_MENU_OFFSET" :style="{ minWidth: '220px' }">
                <DropdownMenuItem v-for="m in promptPresets" :key="m.id" :aria-checked="s.activePromptId === m.id"
                  @select="pickMode(m.id, () => (modeOpen = false))">
                  {{ m.name }}
                  <span class="ac-menu-hint">{{ m.builtin ? '内置提示词' : '自建提示词' }}</span>
                </DropdownMenuItem>
                <!-- 一套都没拉到（后端没起 / 还在加载）：别给空菜单 -->
                <p v-if="!promptPresets.length" class="ac-menu-empty">还没有提示词，去「设置 → Agent → 提示词」加一个</p>
            </DropdownMenuContent>
          </DropdownMenu>

          <!-- 授权方式：接受审核 / 完全自动授权（与设置→Agent→审批规则 是同一个开关）。
               布局照 docs/demo/agent-select-panels 的「审核」面板：标题 + 计数 + 右侧状态小标签，
               下面两条大选项（图标托 / 标题 + 徽章 / 说明 / 单选圈）。 -->
          <!-- placement=top-end：菜单右缘对按钮右缘（向左铺开）。
               箭头不看 align、只看触发器中心（AxDropdown 里夹进菜单范围），
               所以菜单多宽、往哪边铺，箭头都还指着这个按钮。 -->
          <DropdownMenu :open="composerMenuOpen('auth')" @update:open="(v: boolean) => setComposerMenuOpen('auth', v)">
            <DropdownMenuTrigger as-child>
              <Button variant="ghost" size="icon-sm" :aria-expanded="authOpen"
                :aria-label="'授权方式：' + (authMode === 'ask' ? '接受审核' : '完全自动授权')">
                <component :is="authMode === 'ask' ? Hand : ShieldAlert" :size="16" class="size-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent arrow :align="COMPOSER_MENU_ALIGN" :side="COMPOSER_MENU_SIDE" :side-offset="COMPOSER_MENU_OFFSET" :style="{ width: '360px' }">
              <div class="ac-review-panel" role="listbox" aria-label="选择授权方式">
                <div class="ac-panel-head">
                  <div class="ac-panel-head-top ac-panel-head-top--review">
                    <div class="ac-panel-heading">
                      <span class="ac-panel-title">审核模式</span>
                      <span class="ac-panel-count">2</span>
                    </div>
                    <span class="ac-review-state">{{ authMode === 'ask' ? '需要确认' : '全部放行' }}</span>
                  </div>
                  <p class="ac-panel-lede">决定工具调用要不要先停下来问你。</p>
                </div>
                <div class="ac-review-body">
                  <div class="ac-review-list" role="radiogroup" aria-label="审核模式">
                    <DropdownMenuItem v-for="m in AUTH_MODES" :key="m.value" class="ac-review-item"
                      role="radio" :aria-checked="authMode === m.value"
                      @select="setAuthMode(m.value); authOpen = false">
                      <!-- 标题 + 紧跟其后的徽章（用户 2026-11-06：徽章贴在标题右侧，不要换行到下一行）。
                           徽章不再参与换行，标题过长时自己截断。 -->
                      <span class="ac-option-title">
                        <span class="ac-option-label">{{ m.label }}</span>
                        <Badge :variant="m.value === 'auto' ? 'destructive' : 'secondary'">{{ m.value === 'auto' ? '谨慎' : '推荐' }}</Badge>
                      </span>
                      <span class="ac-option-desc">{{ m.hint }}</span>
                    </DropdownMenuItem>
                  </div>
                </div>
              </div>
            </DropdownMenuContent>
          </DropdownMenu>

          <!-- 模型：多供应商场景下可能是几十条，长列表必须限高 + 滚（照参考图） -->
          <!-- 宽度随视图切换：卡片视图紧凑（两列小卡刚好），分栏视图加宽让左栏 + 右侧瓦片都站得住。 -->
          <DropdownMenu :open="composerMenuOpen('model')" @update:open="(v: boolean) => setComposerMenuOpen('model', v)">
            <DropdownMenuTrigger as-child>
              <Button variant="ghost" size="icon-sm" :aria-expanded="modelOpen" aria-label="选择模型">
                <Box :size="16" class="size-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent arrow :align="COMPOSER_MENU_ALIGN" :side="COMPOSER_MENU_SIDE" :side-offset="COMPOSER_MENU_OFFSET"
              :style="{ width: modelView === 'split' ? '588px' : '340px', maxWidth: 'calc(100vw - 24px)', maxHeight: 'min(520px, calc(100dvh - 120px))' }">
              <div class="ac-panel ac-model-panel" :class="{ 'is-split': modelView === 'split' }" role="listbox" aria-label="选择模型">
                <div class="ac-panel-head">
                  <div class="ac-panel-head-top">
                    <div class="ac-panel-heading">
                      <span class="ac-panel-title">模型</span>
                      <span class="ac-panel-count">{{ usableModels.length }}</span>
                    </div>
                    <!-- 视图切换用组件库原生的 Tabs（用户口径 2026-11-02）：
                         以前是自绘的分段按钮 + 绝对定位指示条，不跟主题尺寸走。 -->
                    <Tabs :model-value="modelView" @update:model-value="setModelView">
                      <TabsList aria-label="面板布局">
                        <TabsTrigger value="card">卡片</TabsTrigger>
                        <TabsTrigger value="split">分栏</TabsTrigger>
                      </TabsList>
                    </Tabs>
                  </div>
                  <!-- 搜索框统一用组件库 InputGroup（用户口径 2026-11-02）：
                       图标 / 清除按钮放进 Addon，输入框本体用 InputGroupInput。
                       始终整行显示，不再折叠成放大镜按钮。 -->
                  <InputGroup>
                    <InputGroupAddon align="inline-start">
                      <Search :size="14" aria-hidden="true" />
                    </InputGroupAddon>
                    <InputGroupInput v-model="modelQuery" type="search" name="ac-model-search"
                      data-ac-search="model" placeholder="搜索模型或平台" aria-label="搜索模型或平台" autocomplete="off" spellcheck="false" />
                    <InputGroupAddon v-if="modelQuery" align="inline-end">
                      <InputGroupButton size="icon-xs" aria-label="清空搜索" @click="modelQuery = ''">
                        <X :size="12" />
                      </InputGroupButton>
                    </InputGroupAddon>
                  </InputGroup>
                </div>
                <!--
                  没有可用模型时，只留这一句提示：滚动区整体不渲染。
                  以前提示和滚动区里的「没有找到模型」空态会同时出现（用户 2026-11-05 截图：
                  技能面板上下两个空态叠在一起、分类栏被挤到最底下）。
                -->
                <div v-if="!usableModels.length" class="ac-menu-empty">没有可用模型（先去设置里配一个）</div>
                <!-- 滚动区：长列表在这里滚，分组头固定在上方不动。
                     ref 挂它是为了「打开时把选中项滚进可视区」（见 scrollSelectedModelIntoView） -->
                <!--
                  两种视图**同时挂载**，切换只切显示，不做 v-if 拆装。

                  为什么要这样（用户 2026-11-06）：v-if 切换时整块内容被销毁再重建，
                  列表、滚动位置、选中项都要重新渲染一遍，切换像“硬切”。
                  现在两个面板都在 DOM 里，切到哪个哪个淡入（见 .ac-view-pane）。

                  滚动容器放在**每个视图内部**（与技能面板一致）：
                  以前是外面套一个 ScrollArea、里面再叠两个视图，外层 viewport 被
                  裁到看不见内容（用户 2026-11-06：卡片视图没有滚动条、滚不动）。
                -->
                <div v-else ref="modelScrollRef" data-model-scroll class="ac-menu-scroll ac-panel-body">
                  <div class="ac-view-stack">
                  <AgentScrollArea class="ac-panel-scroll ac-view-pane" :class="{ 'is-active': modelView === 'card' }"
                    body-class="ac-panel-scroll-body ac-model-scroll-body">
                    <div v-if="filteredModels.length" class="ac-model-grid">
                      <Button v-for="m in filteredModels" :key="m.provider + '/' + m.modelId" variant="ghost" size="sm"
                        role="option" :aria-selected="isModelPicked(m)" @click="pickModel(m, () => (modelOpen = false))">
                        <span class="ac-model-brand" :title="brandNameOf(m)" aria-hidden="true" v-html="brandSvgOf(m)"></span>
                        <span class="ac-model-copy">
                          <span class="ac-model-card-top">
                            <span class="ac-model-id">{{ m.modelId }}</span>
                            <Badge v-if="m.isDefault" variant="secondary">默认</Badge>
                            <span class="ac-check-mark" aria-hidden="true"><Check :size="16" :stroke-width="2" /></span>
                          </span>
                          <span class="ac-model-meta">
                            <span>{{ brandNameOf(m) }}</span>
                            <span class="ac-dot-sep" aria-hidden="true"></span>
                            <span>{{ modelNote(m) }}</span>
                          </span>
                        </span>
                      </Button>
                    </div>
                    <div v-else class="ac-empty-state">
                      <span class="ac-empty-icon"><Search :size="18" /></span>
                      <span class="ac-empty-title">没有找到模型</span>
                      <span class="ac-empty-desc">换个模型名或平台名试试。</span>
                    </div>
                  </AgentScrollArea>
                  <div class="ac-view-pane ac-split" :class="{ 'is-active': modelView === 'split' }">
                    <aside class="ac-split-rail" aria-label="模型平台">
                      <div class="ac-rail-label">平台</div>
                      <AgentScrollArea class="ac-rail-scroll" body-class="ac-rail-scroll-body">
                        <Button v-for="g in modelPlatformGroups" :key="g.key" variant="ghost" size="sm"
                          :aria-pressed="modelPlatform === g.key" @click="modelPlatform = g.key">
                          <span v-if="g.key === 'all'" class="ac-rail-icon" aria-hidden="true"><Layers :size="14" /></span>
                          <span v-else class="ac-rail-brand" :title="g.label" aria-hidden="true" v-html="brandSvg(g.key)"></span>
                          <span class="ac-rail-name">{{ g.label }}</span>
                          <span class="ac-rail-count">{{ g.count }}</span>
                        </Button>
                      </AgentScrollArea>
                    </aside>
                    <div class="ac-split-main">
                      <AgentScrollArea class="ac-split-scroll" body-class="ac-split-scroll-body">
                      <div v-if="filteredModels.length" class="ac-model-row-list">
                        <Button v-for="m in filteredModels" :key="m.provider + '/' + m.modelId" variant="ghost" size="sm"
                          role="option" :aria-selected="isModelPicked(m)" @click="pickModel(m, () => (modelOpen = false))">
                          <span class="ac-model-brand" :title="brandNameOf(m)" aria-hidden="true" v-html="brandSvgOf(m)"></span>
                          <span class="ac-model-copy">
                            <span class="ac-model-id">{{ m.modelId }}</span>
                            <span class="ac-model-meta">
                              <span>{{ brandNameOf(m) }}</span>
                              <span class="ac-dot-sep" aria-hidden="true"></span>
                              <span>{{ modelNote(m) }}</span>
                            </span>
                          </span>
                          <span class="ac-model-badges">
                            <Badge v-if="m.isDefault" variant="secondary">默认</Badge>
                          </span>
                          <span class="ac-check-mark" aria-hidden="true"><Check :size="16" :stroke-width="2" /></span>
                        </Button>
                      </div>
                      <div v-else class="ac-empty-state">
                        <span class="ac-empty-icon"><Search :size="18" /></span>
                        <span class="ac-empty-title">没有找到模型</span>
                        <span class="ac-empty-desc">换个模型名或平台名试试。</span>
                      </div>
                      </AgentScrollArea>
                    </div>
                  </div>
                  </div>
                  </div>
              </div>
            </DropdownMenuContent>
          </DropdownMenu>

          <!--
            技能：每行「图标 + 标题 + 说明」；点一项 = 往输入框插一个标签。

            按钮**始终显示**（用户口径 2026-11-05：技能入口在工具栏里看不到）。
            以前是 `v-if="s.skills.length"`：没装技能时整个按钮消失，用户以为功能没了；
            面板里已有「还没有技能 / 去设置里导入」的空态，入口应该一直在。
          -->
          <DropdownMenu :open="composerMenuOpen('skill')" @update:open="(v: boolean) => setComposerMenuOpen('skill', v)">
            <DropdownMenuTrigger as-child>
              <!-- 不给「已开启」高亮：引用与否以**输入框里的标签**为准（用户口径）。
                   这里再亮一个开关态会变成第二处真相，和「点一下即插入」的语义冲突。 -->
              <Button variant="ghost" size="icon-sm" :aria-expanded="skillOpen" aria-label="选择技能">
                <WandSparkles :size="16" class="size-4" />
              </Button>
            </DropdownMenuTrigger>
            <!--
              没有技能时固定用紧凑宽度：这时卡片/分栏两种视图都不渲染，右上角那组「卡片 / 分栏」
              点了也不会有任何变化。按分栏的 586px 展开只会留一大片空白（用户 2026-11-05 截图）。
              视图开关同理只在有内容时出现，没有可切换的东西就不摆按钮。
            -->
            <DropdownMenuContent arrow :align="COMPOSER_MENU_ALIGN" :side="COMPOSER_MENU_SIDE" :side-offset="COMPOSER_MENU_OFFSET"
              :style="{ width: skillView === 'split' && s.skills.length ? '588px' : '340px', maxWidth: 'calc(100vw - 24px)', maxHeight: 'min(520px, calc(100dvh - 120px))' }">
              <div class="ac-panel ac-skill-panel" :class="{ 'is-split': skillView === 'split' && !!s.skills.length }"
                role="listbox" aria-label="选择技能">
                <div class="ac-panel-head">
                  <div class="ac-panel-head-top">
                    <div class="ac-panel-heading">
                      <span class="ac-panel-title">技能</span>
                      <span class="ac-panel-count">{{ s.skills.length }}</span>
                    </div>
                    <Tabs v-if="s.skills.length" :model-value="skillView" @update:model-value="setSkillView">
                      <TabsList aria-label="面板布局">
                        <TabsTrigger value="card">卡片</TabsTrigger>
                        <TabsTrigger value="split">分栏</TabsTrigger>
                      </TabsList>
                    </Tabs>
                  </div>
                  <InputGroup>
                    <InputGroupAddon align="inline-start">
                      <Search :size="14" aria-hidden="true" />
                    </InputGroupAddon>
                    <InputGroupInput v-model="skillQuery" type="search" name="ac-skill-search"
                      data-ac-search="skill" placeholder="搜索技能" aria-label="搜索技能" autocomplete="off" spellcheck="false" />
                    <InputGroupAddon v-if="skillQuery" align="inline-end">
                      <InputGroupButton size="icon-xs" aria-label="清空搜索" @click="skillQuery = ''">
                        <X :size="12" />
                      </InputGroupButton>
                    </InputGroupAddon>
                  </InputGroup>
                </div>
                <div class="ac-panel-body">
                  <!--
                    未安装技能 = 只有这一块空态。
                    以前它和下面卡片/分栏视图里的「没有找到技能」同时渲染：分栏视图的左栏
                    （分类 / 全部）被顶到面板底部、压在底栏上，用户看到的就是两块空态叠着
                    （2026-11-05 截图）。有内容时才渲染视图本身，两种空态不会再同时出现。
                  -->
                  <div v-if="!s.skills.length" class="ac-empty-state">
                    <span class="ac-empty-icon"><WandSparkles :size="18" /></span>
                    <span class="ac-empty-title">还没有安装技能</span>
                    <span class="ac-empty-desc">到「设置 → Agent → 技能」里导入，导入后即可在这里 @ 引用。</span>
                  </div>
                  <!-- 同模型面板：两种视图同时挂载，切换只切显示（淡入），不拆装 DOM。 -->
                  <div v-else class="ac-view-stack">
                  <AgentScrollArea class="ac-panel-scroll ac-view-pane" :class="{ 'is-active': skillView === 'card' }" body-class="ac-panel-scroll-body">
                    <div v-if="filteredSkills.length" class="ac-skill-grid">
                      <!-- 卡片外壳用 div：shadcn Button 的 size="sm" 会强制 32px 高 + 左右内边距，
                           把带封面的卡片压成一条细线（用户截图 2026-11-02）。
                           这里只有「整卡点击」一件事，用 role=option + 键盘 Enter/Space 即可。 -->
                      <div v-for="item in filteredSkills" :key="item.id" class="ac-skill-card" role="option" tabindex="0"
                        :aria-pressed="false" :title="item.value"
                        @click="insertRef(item, () => (skillOpen = false))"
                        @keydown.enter.prevent="insertRef(item, () => (skillOpen = false))"
                        @keydown.space.prevent="insertRef(item, () => (skillOpen = false))">
                        <span class="ac-skill-thumb" :style="skillCoverStyle(item.name)" aria-hidden="true">
                          <span class="ac-skill-icon" v-html="ICON_SKILL"></span>
                        </span>
                        <span class="ac-skill-copy">
                          <span class="ac-skill-name-row">
                            <span class="ac-skill-name">{{ item.name }}</span>
                            <Badge v-if="skillMetaOf(item.name).featured" variant="secondary">精选</Badge>
                          </span>
                          <span class="ac-skill-desc">{{ item.value }}</span>
                          <span class="ac-skill-meta">
                            <span>{{ skillMetaOf(item.name).category }}</span>
                            <span class="ac-dot-sep" aria-hidden="true"></span>
                            <span>{{ skillFileCount(item.name) }} 文件</span>
                          </span>
                        </span>
                      </div>
                    </div>
                    <div v-else class="ac-empty-state">
                      <span class="ac-empty-icon"><Search :size="18" /></span>
                      <span class="ac-empty-title">没有找到技能</span>
                      <span class="ac-empty-desc">换个关键词，或清空搜索再试。</span>
                    </div>
                  </AgentScrollArea>
                  <div class="ac-view-pane ac-split" :class="{ 'is-active': skillView === 'split' }">
                    <aside class="ac-split-rail" aria-label="技能分类">
                      <div class="ac-rail-label">分类</div>
                      <AgentScrollArea class="ac-rail-scroll" body-class="ac-rail-scroll-body">
                        <Button v-for="row in skillCategoryRows" :key="row.name" variant="ghost" size="sm"
                          :aria-pressed="skillCategory === row.name" @click="skillCategory = row.name">
                          <span class="ac-rail-icon" aria-hidden="true">
                            <component :is="row.name === '全部' ? Layers : row.name === '精选' ? Sparkles : Box" :size="14" />
                          </span>
                          <span class="ac-rail-name">{{ row.name }}</span>
                          <span class="ac-rail-count">{{ row.count }}</span>
                        </Button>
                      </AgentScrollArea>
                    </aside>
                    <div class="ac-split-main">
                      <AgentScrollArea class="ac-split-scroll" body-class="ac-split-scroll-body">
                        <div v-if="filteredSkills.length" class="ac-skill-grid ac-skill-grid--split">
                          <div v-for="item in filteredSkills" :key="item.id" class="ac-skill-tile" role="option" tabindex="0"
                            :aria-pressed="false" :title="item.value"
                            @click="insertRef(item, () => (skillOpen = false))"
                            @keydown.enter.prevent="insertRef(item, () => (skillOpen = false))"
                            @keydown.space.prevent="insertRef(item, () => (skillOpen = false))">
                            <span class="ac-skill-cover" :style="skillCoverStyle(item.name)" aria-hidden="true">
                              <span class="ac-skill-icon" v-html="ICON_SKILL"></span>
                            </span>
                            <span class="ac-skill-tile-body">
                              <span class="ac-tile-top">
                                <span class="ac-skill-name">{{ item.name }}</span>
                              </span>
                              <span class="ac-skill-desc">{{ item.value }}</span>
                              <span class="ac-skill-meta">
                                <span>{{ skillMetaOf(item.name).category }}</span>
                                <span class="ac-dot-sep" aria-hidden="true"></span>
                                <span>{{ skillFileCount(item.name) }} 文件</span>
                                <span class="ac-dot-sep" aria-hidden="true"></span>
                                <span>{{ skillSize(item.name) }}</span>
                              </span>
                            </span>
                          </div>
                        </div>
                        <div v-else class="ac-empty-state">
                          <span class="ac-empty-icon"><Search :size="18" /></span>
                          <span class="ac-empty-title">没有找到技能</span>
                          <span class="ac-empty-desc">换个关键词，或清空搜索再试。</span>
                        </div>
                      </AgentScrollArea>
                    </div>
                  </div>
                  </div>
                </div>
                <div class="ac-panel-foot">
                  <span class="ac-selection-summary">点击技能会直接插入标签</span>
                </div>
              </div>
            </DropdownMenuContent>
          </DropdownMenu>

          <!-- MCP：同上，点一项 = 插入一个标签 -->
          <!-- MCP 暂只有轻卡片一种布局：宽度固定在紧凑档（与卡片视图一致）。
               280 是「居中还能落在屏幕内」的上限：触发器离右边缘约 124px，
               320 宽居中会被 reka 自动往左推 20px，看起来这个菜单没跟其它对齐。 -->
          <DropdownMenu v-if="s.mcpServers.length" :open="composerMenuOpen('mcp')" @update:open="(v: boolean) => setComposerMenuOpen('mcp', v)">
            <DropdownMenuTrigger as-child>
              <!-- 同上：MCP 也不做开关态高亮，引用看输入框里的标签 -->
              <Button variant="ghost" size="icon-sm" :aria-expanded="mcpOpen" aria-label="选择 MCP">
                <Plug :size="16" class="size-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent arrow :align="COMPOSER_MENU_ALIGN" :side="COMPOSER_MENU_SIDE" :side-offset="COMPOSER_MENU_OFFSET"
              :style="{ width: '400px', maxWidth: 'calc(100vw - 24px)', maxHeight: 'min(520px, calc(100dvh - 120px))' }">
              <div class="ac-panel ac-mcp-panel" role="listbox" aria-label="选择 MCP">
                <div class="ac-panel-head">
                  <div class="ac-panel-head-top">
                    <!--
                      不再写「MCP」大标题（用户 2026-11-06：面板里这块标题是多余的）。
                      留一个占位把右侧的「重新检测」推到行尾，不改变那排按钮的位置。
                    -->
                    <div class="ac-panel-heading"></div>
                    <div class="ac-panel-tools">
                      <!-- 重新检测（全部）：主动连一次，看当前连没连上、有哪些工具 -->
                      <Button variant="outline" size="sm" :disabled="probing"
                        :aria-label="probing ? '正在检测 MCP' : '检测全部 MCP 服务'" :title="probing ? '正在检测' : '检测全部 MCP 服务'" @click.stop="runMcpProbe">
                        <RefreshCw :size="14" :class="{ 'ac-spin': probing }" />
                        <span class="ac-detect-label">{{ probing ? '检测中' : '重新检测' }}</span>
                      </Button>
                    </div>
                  </div>
                  <InputGroup>
                    <InputGroupAddon align="inline-start">
                      <Search :size="14" aria-hidden="true" />
                    </InputGroupAddon>
                    <InputGroupInput v-model="mcpQuery" type="search" name="ac-mcp-search"
                      data-ac-search="mcp" placeholder="搜索服务或工具" aria-label="搜索服务或工具" autocomplete="off" spellcheck="false" />
                    <InputGroupAddon v-if="mcpQuery" align="inline-end">
                      <InputGroupButton size="icon-xs" aria-label="清空搜索" @click="mcpQuery = ''">
                        <X :size="12" />
                      </InputGroupButton>
                    </InputGroupAddon>
                  </InputGroup>
                </div>
                <div class="ac-panel-body">
                  <AgentScrollArea class="ac-panel-scroll" body-class="ac-panel-scroll-body ac-mcp-scroll-body">
                    <div v-if="filteredMcpResources.length" class="ac-mcp-list">
                      <!--
                        服务行：左侧勾选框（引用整个服务）／中间图标 + 名称 + 地址／右侧工具数与展开箭头。
                        交互语义不变，只把三块对齐到同一条基线、给足留白（用户 2026-11-06：MCP 布局乱）。
                      -->
                      <!--
                        服务卡片 = 一个整体面板（用户 2026-11-06）：
                        展开后的工具区必须**落在这张卡片的边框之内**，不能另外再长出一个面板。
                        所以卡片与工具区同属一个 .ac-mcp-item，外层边框只画一圈。
                      -->
                      <div v-for="item in filteredMcpResources" :key="item.id" class="ac-mcp-item"
                        :class="{ 'is-picked': mcpPickedServers.has(item.name), 'is-open': mcpExpanded.has(item.name) || !!item.toolHits }">
                        <div class="ac-mcp-card">
                        <button type="button" class="ac-pick-box" :aria-pressed="mcpPickedServers.has(item.name)"
                          :aria-label="'引用整个 ' + item.name + ' 服务'" :title="'引用整个 ' + item.name + ' 服务'"
                          @click.stop="toggleMcpServer(item.name)">
                          <Check :size="12" />
                        </button>
                        <button type="button" class="ac-mcp-main" :title="item.value"
                          :aria-expanded="mcpExpanded.has(item.name) || !!item.toolHits" @click="toggleMcpExpand(item.name)">
                          <span class="ac-server-icon" aria-hidden="true">
                            <span v-html="ICON_MCP"></span>
                          </span>
                          <span class="ac-server-copy">
                            <span class="ac-server-name">{{ item.name }}</span>
                            <span class="ac-server-desc">{{ mcpServerDesc(item) }}</span>
                          </span>
                        </button>
                        <span class="ac-server-side">
                          <span v-if="mcpStatusOf(item.name)" class="ac-status" :class="mcpStatusOf(item.name)!.ok ? 'is-ok' : 'is-bad'"
                            :title="mcpStatusOf(item.name)!.text">{{ mcpToolCount(item.name) }} 工具</span>
                          <span v-else class="ac-status">{{ mcpTransport(item) }}</span>
                          <span v-if="mcpToolsOf(item.name).length" class="ac-expand-btn" role="button" tabindex="0"
                            :aria-expanded="mcpExpanded.has(item.name) || !!item.toolHits" aria-label="展开工具" title="展开工具"
                            @click.stop="toggleMcpExpand(item.name)" @keydown.enter.stop.prevent="toggleMcpExpand(item.name)">
                            <ChevronDown :size="14" :class="{ 'is-open': mcpExpanded.has(item.name) || !!item.toolHits }" />
                          </span>
                        </span>
                        </div>
                        <!--
                          工具区（用户 2026-11-06 第二次反馈）：
                          · 收在服务卡片的边框内，是这张卡片自己的一块展开区；
                          · 不再有「canvas / 11 个工具」的小标题（信息在卡片行上已经有了）；
                          · 每个工具左侧是单选框，可多选；
                          · 左侧一条竖线把所有工具串起来。
                        -->
                        <div v-if="mcpExpanded.has(item.name) || item.toolHits" class="ac-mcp-tools">
                          <div v-if="!(item.toolHits || mcpToolsOf(item.name)).length" class="ac-mcp-tools-empty">
                            还没有检测到工具，点「重新检测」再试。
                          </div>
                          <template v-else>
                            <div class="ac-tool-list">
                              <button v-for="t in (item.toolHits || mcpToolsOf(item.name))" :key="t.fullName"
                                type="button" class="ac-tool-row" :class="{ 'is-picked': mcpPickedTools.has(mcpToolKey(item.name, t.name)) }"
                                role="checkbox" :aria-checked="mcpPickedTools.has(mcpToolKey(item.name, t.name))"
                                :title="t.fullName" @click.stop="toggleMcpTool(item.name, t.name)">
                                <span class="ac-tool-radio" aria-hidden="true"><Check :size="10" /></span>
                                <span class="ac-tool-copy">
                                  <span class="ac-tool-name">{{ t.name }}</span>
                                  <span class="ac-tool-desc">{{ t.description }}</span>
                                </span>
                              </button>
                            </div>
                          </template>
                        </div>
                      </div>
                    </div>
                    <div v-else class="ac-empty-state">
                      <span class="ac-empty-icon"><Search :size="18" /></span>
                      <span class="ac-empty-title">没有找到服务或工具</span>
                      <span class="ac-empty-desc">换个关键词，或清空搜索再试。</span>
                    </div>
                    <p v-if="mcpProbeHint" class="ac-panel-note">{{ mcpProbeHint }}</p>
                  </AgentScrollArea>
                </div>
                <div class="ac-panel-foot">
                  <!-- 多选 + 确认：勾选只记状态，点这里才真正往输入框插标签 -->
                  <span class="ac-selection-summary">
                    <template v-if="mcpPickTotal">
                      已选 <b class="ac-selected-number">{{ mcpPickedServers.size }}</b> 个服务 ·
                      <b class="ac-selected-number">{{ mcpPickedTools.size }}</b> 个工具
                    </template>
                    <template v-else>未选择服务或工具</template>
                  </span>
                  <Button size="xs" :disabled="!mcpPickTotal" @click="confirmMcpPicks(() => (mcpOpen = false))">
                    <Check :size="13" />确认引用
                  </Button>
                </div>
              </div>
            </DropdownMenuContent>
          </DropdownMenu>
<span class="ac-tb-spacer"></span>
          <!-- 上下文统计：**回到发送键左侧**（用户口径 2026-10-11：恢复之前的位置）。
               hover 气泡给剩余百分比；有绝对值时把「已用 / 上限」一起标在环旁边
               （只有百分比看不出还剩多少 tokens）。什么都不知道时整块不画。 -->
          <span v-if="s.contextLeft !== null || s.contextUsed !== null" class="ac-ctxwrap">
            <TooltipProvider :delay-duration="120">
              <Tooltip>
                <TooltipTrigger as-child>
              <span class="ac-context" role="img"
                :aria-label="s.contextLeft !== null ? '上下文剩余 ' + s.contextLeft + '%' : '上下文用量'">
                <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true">
                  <circle cx="6" cy="6" r="5.25" stroke="currentColor" stroke-width="1.5" class="ac-ctx-track" />
                  <circle cx="6" cy="6" r="5.25" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"
                    :stroke-dasharray="CONTEXT_CIRCUMFERENCE" :stroke-dashoffset="contextArcOffset"
                    transform="rotate(-90 6 6)" />
                </svg>
              </span>
                </TooltipTrigger>
                <TooltipContent v-if="s.contextLeft !== null" side="top">上下文剩余 {{ s.contextLeft }}%</TooltipContent>
              </Tooltip>
            </TooltipProvider>
          </span>
          <Button size="icon" data-ac-send :class="{ 'is-running': sendMode === 'stop' }"
            :aria-label="sendMode === 'stop' ? '停止' : '发送'" :disabled="sendMode === 'disabled'"
            @click="sendMode === 'stop' ? agent.stop() : submit()">
            <!-- 三态（设计 G1）：有内容 ⇒ 发送（**跑着也是发送**，点了进队列）；
                 空 + 跑着 ⇒ 红方块「终止」；空 + 空闲 ⇒ 禁用（灰色箭头）。
                 方块用 CSS 画（不受 lucide 线性图标 stroke 影响），颜色随 currentColor。 -->
            <span v-if="sendMode === 'stop'" class="ac-stop-square" aria-hidden="true"></span>
            <ArrowUp v-else :size="17" class="size-[17px]" />
          </Button>
        </div>
      </div>
    </div>
</template>

<style scoped src="./agent-composer/part1.css"></style>
<style scoped src="./agent-composer/part2.css"></style>
<style scoped src="./agent-composer/part3.css"></style>
<style scoped src="./agent-composer/part4.css"></style>
<style src="./AgentComposer.global.css"></style>

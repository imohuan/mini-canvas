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
import { ICON_SKILL, ICON_MCP } from '../../agentResources.js'
import type { AgentConversationController } from './useAgentConversation'

const c = inject('agentConversation') as AgentConversationController

const cProps = c as unknown as Record<string, any>
const {
  agent, s, prompt, attached: attachedMaybe, queue, pending,
  showNotifyTip, enableNotify, notifyDismissed, onQueueReorder, hoverRowId, rowMenuId,
  openPreview, previewItem, userSegments, displayUserText, onSegClick, segTitle, segClickable,
  cancelEditQueue, steerItem, removeItem, closeItem, beginEditQueue,
  goalRow, editingGoal, startEditGoalRow, commitGoalBudget, onGoalBudgetKeydown, onGoalBudgetBlur,
  onGoalEditFocus, formatToken, tokenUnit, budgetTokenText, goalMark, goalMarkText, clearGoalMark,
  editingKind, editingKindText, scrollToEditing,
  toggleQueuePause, cancelEditing, removeAttachment, editorResources,
  onEditorKeydown, onPaste, composerMenuOpen, setComposerMenuOpen, plusOpen, switchComposerMenu,
  COMPOSER_MENU_ALIGN, COMPOSER_MENU_SIDE, COMPOSER_MENU_OFFSET, addGoalMark, pickImages,
  compactNow, onFilesPicked, modeOpen, modeLabel, pickMode, AUTH_MODES, authMode, setAuthMode,
  promptPresets, authOpen, modelOpen, modelView, usableModels, setModelView, modelQuery,
  filteredModels, isModelPicked, pickModel, brandNameOf, brandSvgOf, modelNote,
  modelPlatformGroups, modelPlatform, assistantRows, hasCardView, viewOf, previewToolMedia,
  openTools, openToolGroups, toggleTool, toggleToolGroup, toolGroupTitle, toolRowSummary,
  openThinking, toggleThinking, openUserBubbles, overflowingUser, toggleUserBubble,
  setUserBubbleBody, msgTimeText, msgTimeTitle, copied, copyMessage, beginEditMessage,
  segmentByAnchor, segmentModelLabel, hasInlineError, pagerByAnchor, pagerTarget,
  skillQuery, skillView, setSkillView, filteredSkills, skillCategory, skillCategoryRows,
  skillMetaOf, skillFileCount, skillSize, skillCoverStyle, mcpQuery, mcpOpen, mcpExpanded,
  toggleMcpExpand, mcpPickedServers, mcpPickedTools, mcpToolKey, toggleMcpServer, toggleMcpTool,
  mcpPickTotal, confirmMcpPicks, mcpProbing, mcpProbeHint, mcpStatusOf, mcpServerDesc,
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
                    <Button variant="ghost" size="icon-sm" class="ac-queue-btn" :aria-expanded="rowMenuId === row.id" aria-label="更多操作">
                      <MoreHorizontal :size="12" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent arrow align="end" side="top" :side-offset="8" class="ac-ddmenu" :style="{ minWidth: '180px' }">
                    <div class="ac-ddmenu" role="menu" aria-label="排队消息操作">
                      <Button variant="ghost" size="sm" class="ac-menu-item" role="menuitem" @click="beginEditQueue(row.id); rowMenuId = null">
                        <span class="ac-menu-name">编辑消息</span>
                        <span class="ac-menu-hint">改完发送，位置不变</span>
                      </Button>
                      <Button variant="ghost" size="sm" class="ac-menu-item" role="menuitem" @click="closeItem(row.id); rowMenuId = null">
                        <span class="ac-menu-name">关闭排队</span>
                        <span class="ac-menu-hint">内容回到输入框，不再自动发</span>
                      </Button>
                    </div>
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
          <Button variant="ghost" size="icon-sm" class="ac-editing-x" aria-label="取消编辑" @click="cancelEditing">
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
              <Button variant="ghost" size="icon-sm" class="ac-plus" :aria-expanded="plusOpen" aria-label="更多添加" @pointerdown="switchComposerMenu('plus')">
                <Plus :size="17" class="size-[17px]" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent arrow :align="COMPOSER_MENU_ALIGN" :side="COMPOSER_MENU_SIDE" :side-offset="COMPOSER_MENU_OFFSET" class="ac-ddmenu" :style="{ minWidth: '210px' }">
              <div class="ac-ddmenu" role="menu" aria-label="添加">
                <Button variant="ghost" size="sm" class="ac-menu-item" role="menuitem" @click="addGoalMark(); plusOpen = false">
                  <span class="ac-menu-title-row">
                    <span class="ac-menu-icon">
                      <Target :size="14" />
                    </span>
                    <span class="ac-menu-name">目标</span>
                  </span>
                  <span class="ac-menu-hint">给这条消息挂一个目标（可改预算）</span>
                </Button>
                <Button variant="ghost" size="sm" class="ac-menu-item" role="menuitem" @click="pickImages(); plusOpen = false">
                  <span class="ac-menu-title-row">
                    <span class="ac-menu-icon">
                      <Upload :size="14" />
                    </span>
                    <span class="ac-menu-name">上传文件</span>
                  </span>
                  <span class="ac-menu-hint">选图片，跟这条消息一起发</span>
                </Button>
                <!-- 「压缩」（用户口径 2026-10-11）：把历史总结成摘要、腾出上下文。
                     与 @ 菜单里的那一项走同一条命令（agent.compact）—— 两个入口，
                     一处实现，行为只会一起改。压缩只对**已有对话**有意义：
                     没会话时后端会如实拒绝（不装作成功）。 -->
                <Button variant="ghost" size="sm" class="ac-menu-item" role="menuitem" :disabled="s.compacting" @click="compactNow(); plusOpen = false">
                  <span class="ac-menu-title-row">
                    <span class="ac-menu-icon">
                      <Minimize2 :size="14" />
                    </span>
                    <span class="ac-menu-name">压缩</span>
                  </span>
                  <span class="ac-menu-hint">{{ s.compacting ? '正在压缩…' : '把历史总结成摘要，腾出上下文空间' }}</span>
                </Button>
              </div>
            </DropdownMenuContent>
          </DropdownMenu>
<input ref="fileInput" class="ac-file" type="file" accept="image/*" multiple aria-hidden="true" tabindex="-1"
            @change="onFilesPicked" />
          <!-- 模式：圆角胶囊 + 下拉（向上弹，贴左对齐） -->
          <DropdownMenu :open="composerMenuOpen('mode')" @update:open="(v: boolean) => setComposerMenuOpen('mode', v)">
            <DropdownMenuTrigger as-child>
              <Button variant="ghost" size="sm" class="ac-pill" :aria-expanded="modeOpen" aria-label="选择创作模式" @pointerdown="switchComposerMenu('mode')">
                <span class="ac-pill-text">{{ modeLabel }}</span>
                <ChevronDown :size="13" class="ac-pill-caret" />
              </Button>
            </DropdownMenuTrigger>
            <!-- 位置：与输入区其它菜单同一套参数（向上 / 居中 / 统一偏移），
                 见 COMPOSER_MENU_OFFSET 的注释。 -->
            <DropdownMenuContent arrow :align="COMPOSER_MENU_ALIGN" :side="COMPOSER_MENU_SIDE" :side-offset="COMPOSER_MENU_OFFSET" class="ac-ddmenu" :style="{ minWidth: '220px', padding: '4px' }">
              <div class="ac-ddmenu" role="listbox" aria-label="选择创作模式">
                <Button v-for="m in promptPresets" :key="m.id" variant="ghost" size="sm" class="ac-menu-item" role="option"
                  :aria-selected="s.activePromptId === m.id" @click="pickMode(m.id, () => (modeOpen = false))">
                  <span class="ac-menu-name">{{ m.name }}</span>
                  <span class="ac-menu-hint">{{ m.builtin ? '内置提示词' : '自建提示词' }}</span>
                </Button>
                <!-- 一套都没拉到（后端没起 / 还在加载）：别给空菜单 -->
                <p v-if="!promptPresets.length" class="ac-menu-empty">还没有提示词，去「设置 → Agent → 提示词」加一个</p>
              </div>
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
              <Button variant="ghost" size="icon-sm" class="ac-tb-icon" :class="{ 'is-warn': authMode === 'auto' }" :aria-expanded="authOpen" @pointerdown="switchComposerMenu('auth')"
                :aria-label="'授权方式：' + (authMode === 'ask' ? '接受审核' : '完全自动授权')">
                <component :is="authMode === 'ask' ? Hand : ShieldAlert" :size="16" class="size-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent arrow :align="COMPOSER_MENU_ALIGN" :side="COMPOSER_MENU_SIDE" :side-offset="COMPOSER_MENU_OFFSET" class="ac-ddmenu" :style="{ width: '360px' }">
              <div class="ac-ddmenu ac-review-panel" role="listbox" aria-label="选择授权方式">
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
                    <Button v-for="m in AUTH_MODES" :key="m.value" variant="ghost" size="sm" class="ac-review-option" :class="{ 'is-auto': m.value === 'auto' }"
                      type="button" role="radio" :aria-checked="authMode === m.value" @click="setAuthMode(m.value); authOpen = false">
                      <span class="ac-option-icon">
                        <component :is="m.icon" :size="16" />
                      </span>
                      <span class="ac-option-copy">
                        <span class="ac-option-title">
                          {{ m.label }}
                          <span class="ac-badge" :class="m.value === 'auto' ? 'is-warn' : 'is-accent'">{{ m.value === 'auto' ? '谨慎' : '推荐' }}</span>
                        </span>
                        <span class="ac-option-desc">{{ m.hint }}</span>
                      </span>
                      <span class="ac-radio" aria-hidden="true"><Check :size="11" /></span>
                    </Button>
                  </div>
                </div>
              </div>
            </DropdownMenuContent>
          </DropdownMenu>

          <!-- 模型：多供应商场景下可能是几十条，长列表必须限高 + 滚（照参考图） -->
          <!-- 宽度随视图切换：卡片视图紧凑（两列小卡刚好），分栏视图加宽让左栏 + 右侧瓦片都站得住。 -->
          <DropdownMenu :open="composerMenuOpen('model')" @update:open="(v: boolean) => setComposerMenuOpen('model', v)">
            <DropdownMenuTrigger as-child>
              <Button variant="ghost" size="icon-sm" class="ac-tb-icon" :class="{ 'is-on': !!s.model }" :aria-expanded="modelOpen" aria-label="选择模型" @pointerdown="switchComposerMenu('model')">
                <Box :size="16" class="size-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent arrow :align="COMPOSER_MENU_ALIGN" :side="COMPOSER_MENU_SIDE" :side-offset="COMPOSER_MENU_OFFSET" class="ac-ddmenu"
              :style="{ width: modelView === 'split' ? '586px' : '320px', maxWidth: '600px', maxHeight: '440px' }">
              <div class="ac-ddmenu ac-panel ac-model-panel" :class="{ 'is-split': modelView === 'split' }" role="listbox" aria-label="选择模型">
                <div class="ac-panel-head">
                  <div class="ac-panel-head-top">
                    <div class="ac-panel-heading">
                      <span class="ac-panel-title">模型</span>
                      <span class="ac-panel-count">{{ usableModels.length }}</span>
                    </div>
                    <!-- 视图切换用组件库原生的 Tabs（用户口径 2026-11-02）：
                         以前是自绘的分段按钮 + 绝对定位指示条，不跟主题尺寸走。 -->
                    <Tabs :model-value="modelView" @update:model-value="setModelView" class="ac-view-tabs">
                      <TabsList aria-label="面板布局">
                        <TabsTrigger value="card">卡片</TabsTrigger>
                        <TabsTrigger value="split">分栏</TabsTrigger>
                      </TabsList>
                    </Tabs>
                  </div>
                  <!-- 搜索框统一用组件库 InputGroup（用户口径 2026-11-02）：
                       图标 / 清除按钮放进 Addon，输入框本体用 InputGroupInput。
                       始终整行显示，不再折叠成放大镜按钮。 -->
                  <InputGroup class="ac-search-inline">
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
                <div v-if="!usableModels.length" class="ac-menu-empty">没有可用模型（先去设置里配一个）</div>
                <!-- 滚动区：长列表在这里滚，分组头固定在上方不动。
                     ref 挂它是为了「打开时把选中项滚进可视区」（见 scrollSelectedModelIntoView） -->
                <div class="ac-menu-scroll" ref="modelScrollRef">
                  <div class="ac-panel-body ac-panel-scroll">
                  <div v-if="modelView === 'card'">
                    <div v-if="filteredModels.length" class="ac-model-grid">
                      <Button v-for="m in filteredModels" :key="m.provider + '/' + m.modelId" variant="ghost" size="sm" class="ac-model-card"
                        role="option" :aria-selected="isModelPicked(m)" @click="pickModel(m, () => (modelOpen = false))">
                        <span class="ac-model-brand" :title="brandNameOf(m)" aria-hidden="true" v-html="brandSvgOf(m)"></span>
                        <span class="ac-model-copy">
                          <span class="ac-model-card-top">
                            <span class="ac-model-id">{{ m.modelId }}</span>
                            <Badge v-if="m.isDefault" variant="secondary" class="ac-badge">默认</Badge>
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
                  </div>
                  <div v-else class="ac-split">
                    <aside class="ac-split-rail" aria-label="模型平台">
                      <div class="ac-rail-label">平台</div>
                      <div class="ac-rail-scroll">
                        <Button v-for="g in modelPlatformGroups" :key="g.key" variant="ghost" size="sm" class="ac-rail-item"
                          :aria-pressed="modelPlatform === g.key" @click="modelPlatform = g.key">
                          <span v-if="g.key === 'all'" class="ac-rail-icon" aria-hidden="true"><Layers :size="14" /></span>
                          <span v-else class="ac-rail-brand" :title="g.label" aria-hidden="true" v-html="brandSvg(g.key)"></span>
                          <span class="ac-rail-name">{{ g.label }}</span>
                          <span class="ac-rail-count">{{ g.count }}</span>
                        </Button>
                      </div>
                    </aside>
                    <div class="ac-split-main">
                      <div class="ac-split-scroll">
                      <div v-if="filteredModels.length" class="ac-model-row-list">
                        <Button v-for="m in filteredModels" :key="m.provider + '/' + m.modelId" variant="ghost" size="sm" class="ac-model-row"
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
                            <Badge v-if="m.isDefault" variant="secondary" class="ac-badge">默认</Badge>
                          </span>
                          <span class="ac-check-mark" aria-hidden="true"><Check :size="16" :stroke-width="2" /></span>
                        </Button>
                      </div>
                      <div v-else class="ac-empty-state">
                        <span class="ac-empty-icon"><Search :size="18" /></span>
                        <span class="ac-empty-title">没有找到模型</span>
                        <span class="ac-empty-desc">换个模型名或平台名试试。</span>
                      </div>
                      </div>
                    </div>
                  </div>
                  </div>
                </div>
              </div>
            </DropdownMenuContent>
          </DropdownMenu>

          <!-- 技能：每行「图标 + 标题 + 说明」；点一项 = 往输入框插一个标签 -->
          <DropdownMenu v-if="s.skills.length" :open="composerMenuOpen('skill')" @update:open="(v: boolean) => setComposerMenuOpen('skill', v)">
            <DropdownMenuTrigger as-child>
              <!-- 不给「已开启」高亮：引用与否以**输入框里的标签**为准（用户口径）。
                   这里再亮一个开关态会变成第二处真相，和「点一下即插入」的语义冲突。 -->
              <Button variant="ghost" size="icon-sm" class="ac-tb-icon" :aria-expanded="skillOpen" aria-label="选择技能" @pointerdown="switchComposerMenu('skill')">
                <WandSparkles :size="16" class="size-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent arrow :align="COMPOSER_MENU_ALIGN" :side="COMPOSER_MENU_SIDE" :side-offset="COMPOSER_MENU_OFFSET" class="ac-ddmenu"
              :style="{ width: skillView === 'split' ? '586px' : '320px', maxWidth: '600px', maxHeight: '440px' }">
              <div class="ac-ddmenu ac-panel ac-skill-panel" :class="{ 'is-split': skillView === 'split' }"
                role="listbox" aria-label="选择技能">
                <div class="ac-panel-head">
                  <div class="ac-panel-head-top">
                    <div class="ac-panel-heading">
                      <span class="ac-panel-title">技能</span>
                      <span class="ac-panel-count">{{ s.skills.length }}</span>
                    </div>
                    <Tabs :model-value="skillView" @update:model-value="setSkillView" class="ac-view-tabs">
                      <TabsList aria-label="面板布局">
                        <TabsTrigger value="card">卡片</TabsTrigger>
                        <TabsTrigger value="split">分栏</TabsTrigger>
                      </TabsList>
                    </Tabs>
                  </div>
                  <InputGroup class="ac-search-inline">
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
                  <div v-if="skillView === 'card'" class="ac-panel-scroll">
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
                            <Badge v-if="skillMetaOf(item.name).featured" variant="secondary" class="ac-badge">精选</Badge>
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
                  </div>
                  <div v-else class="ac-split">
                    <aside class="ac-split-rail" aria-label="技能分类">
                      <div class="ac-rail-label">分类</div>
                      <div class="ac-rail-scroll">
                        <Button v-for="row in skillCategoryRows" :key="row.name" variant="ghost" size="sm" class="ac-rail-item"
                          :aria-pressed="skillCategory === row.name" @click="skillCategory = row.name">
                          <span class="ac-rail-icon" aria-hidden="true">
                            <component :is="row.name === '全部' ? Layers : row.name === '精选' ? Sparkles : Box" :size="14" />
                          </span>
                          <span class="ac-rail-name">{{ row.name }}</span>
                          <span class="ac-rail-count">{{ row.count }}</span>
                        </Button>
                      </div>
                    </aside>
                    <div class="ac-split-main">
                      <div class="ac-split-scroll">
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
              <Button variant="ghost" size="icon-sm" class="ac-tb-icon" :aria-expanded="mcpOpen" aria-label="选择 MCP" @pointerdown="switchComposerMenu('mcp')">
                <Plug :size="16" class="size-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent arrow :align="COMPOSER_MENU_ALIGN" :side="COMPOSER_MENU_SIDE" :side-offset="COMPOSER_MENU_OFFSET" class="ac-ddmenu"
              :style="{ width: '280px', maxWidth: '600px', maxHeight: '440px' }">
              <div class="ac-ddmenu ac-panel ac-mcp-panel" role="listbox" aria-label="选择 MCP">
                <div class="ac-panel-head">
                  <div class="ac-panel-head-top">
                    <div class="ac-panel-heading">
                      <span class="ac-panel-title">MCP</span>
                      <span class="ac-panel-count">{{ s.mcpServers.length }}</span>
                    </div>
                    <div class="ac-panel-tools">
                      <!-- 重新检测（全部）：主动连一次，看当前连没连上、有哪些工具 -->
                      <Button variant="outline" size="sm" class="ac-detect-btn" :class="{ 'is-busy': mcpProbing }" :disabled="mcpProbing"
                        :aria-label="mcpProbing ? '正在检测 MCP' : '检测全部 MCP 服务'" :title="mcpProbing ? '正在检测' : '检测全部 MCP 服务'" @click.stop="runMcpProbe">
                        <RefreshCw :size="14" :class="{ 'ac-spin': mcpProbing }" />
                        <span class="ac-detect-label">{{ mcpProbing ? '检测中' : '重新检测' }}</span>
                      </Button>
                    </div>
                  </div>
                  <InputGroup class="ac-search-inline">
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
                  <div class="ac-panel-scroll">
                    <div v-if="filteredMcpResources.length" class="ac-mcp-list">
                      <!-- 卡片是勾选 + 展开两件事：左边的框勾「整个服务」，点标题行展开工具（DEMO 同一条分工） -->
                      <div v-for="item in filteredMcpResources" :key="item.id" class="ac-mcp-item">
                        <div class="ac-mcp-card" :class="{ 'is-picked': mcpPickedServers.has(item.name) }">
                        <Button variant="ghost" size="icon-xs" class="ac-pick-box" :aria-pressed="mcpPickedServers.has(item.name)"
                          :aria-label="'引用整个 ' + item.name + ' 服务'" :title="'引用整个 ' + item.name + ' 服务'"
                          @click.stop="toggleMcpServer(item.name)">
                          <Check :size="11" />
                        </Button>
                        <Button variant="ghost" size="sm" class="ac-mcp-server-main" :title="item.value"
                          :aria-expanded="mcpExpanded.has(item.name) || !!item.toolHits" @click="toggleMcpExpand(item.name)">
                          <span class="ac-server-icon" v-html="ICON_MCP" aria-hidden="true"></span>
                          <span class="ac-server-copy">
                            <span class="ac-server-name">{{ item.name }}</span>
                            <span class="ac-server-desc">{{ mcpServerDesc(item) }}</span>
                          </span>
                        </Button>
                        <span class="ac-server-side">
                          <span v-if="mcpStatusOf(item.name)" class="ac-status" :class="mcpStatusOf(item.name)!.ok ? 'is-ok' : 'is-bad'"
                            :title="mcpStatusOf(item.name)!.text">{{ mcpToolCount(item.name) }} 工具</span>
                          <span v-else class="ac-status">{{ mcpTransport(item) }}</span>
                          <span v-if="mcpToolsOf(item.name).length" class="ac-expand-btn" role="button" tabindex="0"
                            :aria-expanded="mcpExpanded.has(item.name) || !!item.toolHits" aria-label="展开工具" title="展开工具"
                            @click.stop="toggleMcpExpand(item.name)" @keydown.enter.stop.prevent="toggleMcpExpand(item.name)">
                            <ChevronDown :size="13" :class="{ 'is-open': mcpExpanded.has(item.name) || !!item.toolHits }" />
                          </span>
                        </span>
                        </div>
                        <!-- 工具行：搜索命中工具时自动展开、只列命中的几条；每行都能单独勾选 -->
                        <div v-if="(mcpExpanded.has(item.name) || item.toolHits) && (item.toolHits || mcpToolsOf(item.name)).length" class="ac-mcp-tools">
                          <Button v-for="t in (item.toolHits || mcpToolsOf(item.name))" :key="t.fullName" variant="ghost" size="sm"
                            class="ac-tool-row" :class="{ 'is-picked': mcpPickedTools.has(mcpToolKey(item.name, t.name)) }"
                            :title="t.fullName" :aria-pressed="mcpPickedTools.has(mcpToolKey(item.name, t.name))"
                            @click="toggleMcpTool(item.name, t.name)">
                            <span class="ac-pick-box is-sm" aria-hidden="true"><Check :size="10" /></span>
                            <span class="ac-tool-copy">
                              <span class="ac-tool-name">{{ t.name }}</span>
                              <span class="ac-tool-desc">{{ t.description }}</span>
                            </span>
                          </Button>
                        </div>
                      </div>
                    </div>
                    <div v-else class="ac-empty-state">
                      <span class="ac-empty-icon"><Search :size="18" /></span>
                      <span class="ac-empty-title">没有找到服务或工具</span>
                      <span class="ac-empty-desc">换个关键词，或清空搜索再试。</span>
                    </div>
                    <p v-if="mcpProbeHint" class="ac-panel-note">{{ mcpProbeHint }}</p>
                  </div>
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
                  <Button size="sm" class="ac-confirm-btn" :disabled="!mcpPickTotal" @click="confirmMcpPicks(() => (mcpOpen = false))">
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
          <Button size="icon" class="ac-send" :class="{ 'is-running': sendMode === 'stop' }"
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

<style scoped>
/* —— 顶部「更早对话」哨兵（对话分页，用户口径 2026-10-15）——
   颜色/字号按 ui-style-guide 的次要文本口径；它只有内容流顶部一小条，不抢视线。 */

.ac-earlier {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  min-height: 8px;
  padding: 6px 0 2px;
  font-size: 11px;
  color: var(--ui-ink-mute, #9aa3af);
}

.ac-earlier-loading {
  display: inline-flex;
  align-items: center;
  gap: 6px;
}

.ac-earlier-hint {
  user-select: none;
}

/* —— 空态（照参考图）—— */

.ac-welcome {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 20px;
  padding-top: 32px;
}

/* 主题色白名单: 空态那颗渐变球是品牌装饰（照参考图的三段青渐变），不是主题 UI 色 */

.ac-welcome-orb {
  width: 44px;
  height: 44px;
  flex: none;
  border-radius: 999px;
  /* 主题色白名单: 空态那颗渐变球是品牌装饰（照参考图的三段青渐变），不是主题 UI 色 */
  background: linear-gradient(160deg, #7dd3fc, #0891b2 55%, #0e7490);
  /* 主题色白名单: 同上（品牌装饰的辉光） */
  box-shadow: 0 0 30px rgb(8 145 178 / 0.45);
}

.ac-welcome-title {
  margin: 0;
  padding: 0 6px;
  font-size: 16px;
  font-weight: 500;
  line-height: 24px;
  color: var(--ui-ink, #f7f7f7);
}

/* —— 模型分割线（用户口径 2026-10-11）——
   切换模型 = 换一条会话（SDK 的模型钉在会话上），所以画一条横线把"换脑子"这件事说清楚。
   「中间一枚标签、两侧各一条发丝线」：与分支分页器同一族的"分隔"语义，不抢眼但要看得见。
   颜色走 --ui-*（与面板其它线一致）；只动 opacity/transform，不吃 layout。 */

.ac-model-split {
  display: flex;
  align-items: center;
  gap: 8px;
  /* 间距只用 4/6/8/10/12 档（ui-style-guide §2.4） */
  margin: 4px 0 12px;
}

.ac-model-split-line {
  flex: 1;
  min-width: 8px;
  height: 1px;
  background: var(--ui-line, #363636);
}

.ac-model-split-badge {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  /* 模型 id 没有长度上限：标签可缩、名字单行省略，极端窄面板里也不越界 */
  min-width: 0;
  max-width: 100%;
  padding: 2px 8px;
  border: 1px solid var(--ui-line, #363636);
  border-radius: 999px;
  background: var(--ui-overlay-solid, #212121);
  color: var(--ui-ink-dim, #919191);
  font-size: 11px;
  line-height: 18px;
}

.ac-model-split-name {
  min-width: 0;
  max-width: 180px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--ui-ink, #f7f7f7);
}

.ac-user-text {
  white-space: pre-wrap;
}

.ac-editing-badge {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  align-self: flex-end;
  height: 20px;
  margin-top: 4px;
  padding: 0 4px 0 8px;
  border-radius: 999px;
  background: color-mix(in srgb, var(--ui-warn, #e3a25f) 16%, transparent);
  color: var(--ui-warn, #e3a25f);
  font-size: 11px;
  font-weight: 600;
}

/* 行内版：不换行（`white-space:nowrap`）—— 否则空间不够时「正在编辑」会被逐字竖排（真机踩到）。
   真挤不下时由文字先省略；图标与标签本体始终在。 */

.ac-editing-badge.is-compact {
  flex: none;
  align-self: center;
  margin-top: 0;
  height: 18px;
  white-space: nowrap;
}

.ac-editing-badge.is-compact span {
  white-space: nowrap;
}

.ac-editing-mark {
  display: flex;
  align-items: center;
  gap: 4px;
  width: 100%;
  height: 26px;
  margin: 0;
  padding: 0 4px 0 10px;
  border-radius: 8px;
  background: color-mix(in srgb, var(--ui-warn, #e3a25f) 16%, transparent);
  color: var(--ui-warn, #e3a25f);
  font-size: 12px;
  font-weight: 600;
}

.ac-editing-mark-btn {
  color: inherit;
  font-size: 11px;
  font-weight: 600;
}

.ac-editing-mark-btn:hover {
  text-decoration: underline;
}

.ac-editing-mark-spacer {
  flex: 1;
}

.ac-editing-x {
  color: inherit;
}

.ac-rot {
  transform: rotate(90deg);
}

/* 等首个 token 的加载行（照参考图）：转圈 + 「正在思考」，整行用次要文字色。 */

.ac-pending {
  display: flex;
  align-items: center;
  gap: 8px;
  margin: 6px 0 0;
  font-size: 14px;
  line-height: 24px;
  color: var(--ui-ink-dim, #919191);
}

/* 「已停止」小标（用户口径 2026-10-16）：终止后对话里要有表示 */

.ac-stopped {
  display: flex;
  align-items: center;
  gap: 6px;
  margin: 6px 0 0;
  font-size: 13px;
  line-height: 22px;
  color: var(--ui-danger, #ef4444);
}

/* 开口圆弧 = 一个圆 + 透明上边框：转起来能看清缺口在走。
   颜色随 currentColor，所以这行整体改色时图标自动跟随。 */

.ac-pending-spin {
  display: inline-block;
  flex: none;
  width: 14px;
  height: 14px;
  border: 2px solid currentColor;
  border-top-color: transparent;
  border-radius: 50%;
  animation: ac-rotate 0.8s linear infinite;
}

.ac-notice {
  margin: 6px 0 0;
  font-size: 12px;
  color: var(--ui-ink-dim, #919191);
}

.ac-error {
  margin: 6px 0 0;
  font-size: 12px;
  color: var(--ui-danger, #ef4444);
}

/* 通知提示条：照参考页实测 40 高 / 圆角 12 / 强调色 20% 底；底色用 --ui-accent-soft 现算，
   用户改强调色后这里自动跟随，不会出现"主色改了、提示条还是青的"。 */

.ac-notify {
  display: flex;
  align-items: center;
  gap: 8px;
  height: 40px;
  margin-bottom: 8px;
  padding: 0 6px 0 10px;
  border-radius: 12px;
  background: var(--ui-accent-soft, rgb(8 145 178 / 0.2));
  color: var(--ui-ink, #f7f7f7);
}

.ac-notify-icon {
  flex: none;
  color: var(--ui-accent, #0891b2);
}

.ac-notify-text {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 13px;
}

.ac-notify-btn {
  flex: none;
  color: var(--ui-ink, #f7f7f7);
  font-size: 13px;
  font-weight: 600;
}

.ac-notify-btn:hover {
  color: var(--ui-accent, #0891b2);
}

.ac-notify-close {
  flex: none;
  color: var(--ui-ink-dim, #919191);
}

/* —— 聚合容器（目标行 + 队列行，同一个容器）——
   几何（RULES §1）：宽 90% 居中；**紧贴输入框、零间隔**（底部去掉圆角 + 边框重叠 1px）；
   **只有这个外层有圆角，内部行一律方角**；四边 1px 描边。
   它有 .ac-composer 内的正常流定位（position:relative 供「骑线」暂停键参照）。 */

/* 注意：**不能 overflow:hidden** —— 「骑线」的暂停胶囊有一半在容器外，会被裁掉。
     内部行的方角靠 .ac-pending-row 自己 border-radius:0 保证（不依赖裁切）。 */

/* 类名刻意不叫 .ac-pending —— 那个名字被上面的「正在思考」加载行占用了，
     同名会把它的 font-size:14/line-height:24 混进来，把行内文字撑成两行（真机踩到）。 */

/* overflow:hidden **必须有** —— 里面每一行都是矩形（方角），只有容器是圆角；
     不裁切的话行底色会在四个角上「顶破」圆角，露出方块（真机截图看到过）。
     底部两角去圆角 + 与输入框重叠 1px，是为了和输入框拼成一体。 */

/* 宽 90% 居中（用户口径 2026-10-09）：比输入框窄一圈、居中，不铺满整个输入框宽度。 */

.ac-pending-box {
  position: relative;
  width: 90%;
  margin: 0 auto -1px;
  border: 1px solid var(--ui-line, #363636);
  border-radius: 14px 14px 0 0;
  background: var(--ui-veil, rgb(255 255 255 / 0.04));
  overflow: hidden;
}

/* 极端防护（RULES §9）：容器变窄时，**进度条先让位**，保证目标文案/按钮不被挤没。
     用容器查询而不是媒体查询 —— 让位要看的是「这个容器多宽」，不是「窗口多宽」。 */

.ac-pending-box {
  container-type: inline-size;
}

.ac-pending-list {
  display: flex;
  flex-direction: column;
  min-width: 0;
}

/* 行几何与参考 HTML 的 .prow 一致：gap 8、padding 0 8 0 10、min-height 36 */

.ac-pending-row {
  display: flex;
  align-items: center;
  gap: 8px;
  min-height: 36px;
  min-width: 0;
  padding: 0 8px 0 10px;
  border-radius: 0;
}

.ac-pending-row+.ac-pending-row {
  border-top: 1px solid var(--ui-line-soft, #2a2a2a);
}

.ac-pending-row:hover {
  background: var(--ui-hover, rgb(255 255 255 / 0.1));
}

.ac-pending-lead {
  flex: none;
  display: grid;
  place-items: center;
  color: var(--ui-ink-mute, #a8a8a8);
}

.ac-queue-row.is-editing {
  background: color-mix(in srgb, var(--ui-warn, #e3a25f) 12%, transparent);
}

.ac-queue-row.is-sending {
  opacity: 0.7;
}

.ac-queue-thumb {
  flex: none;
  width: 16px;
  height: 16px;
  border-radius: 4px;
  object-fit: cover;
  cursor: zoom-in;
  background: var(--ui-chip, rgb(255 255 255 / 0.1));
}

/* 白图与容器背景同色会「看不见」—— 加一圈低对比发丝边 + 微阴影（用户口径 2026-10-09，
   「边框颜色不能太突出」：用 ink 的 22% 而不是强调色/警示色）。
   主题色白名单: 缩略图那圈微阴影是「无关主题的微弱遮挡环」，亮暗两套主题都要它才看得见白图，与裁剪框描边同类。 */

.ac-queue-thumb,
.ac-goal-ratio~.ac-queue-thumb {
  border: 1px solid color-mix(in srgb, var(--ui-ink, #f7f7f7) 22%, transparent);
  /* 主题色白名单: 同上（那条微阴影本身） */
  box-shadow: 0 0 0 1px rgb(0 0 0 / 0.06);
}

.ac-queue-thumb-more {
  flex: none;
  min-width: 16px;
  height: 16px;
  padding: 0 3px;
  border-radius: 4px;
  background: var(--ui-chip, rgb(255 255 255 / 0.1));
  display: grid;
  place-items: center;
  font-size: 9px;
  font-weight: 700;
  color: var(--ui-ink-dim, #919191);
}

.ac-queue-text {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 12px;
  line-height: 16px;
  color: var(--ui-ink, #f7f7f7);
}

.ac-queue-row.is-editing .ac-queue-text {
  color: var(--ui-ink-dim, #919191);
}

.ac-queue-flag {
  flex: none;
  padding: 1px 6px;
  border-radius: 999px;
  background: color-mix(in srgb, var(--ui-warn, #e3a25f) 18%, transparent);
  color: var(--ui-warn, #e3a25f);
  font-size: 10px;
  font-weight: 700;
  line-height: 14px;
}

.ac-queue-flag.is-sending {
  background: var(--ui-chip, rgb(255 255 255 / 0.1));
  color: var(--ui-ink-dim, #919191);
}

/* 图标 hover 交换（用户口径 2026-10-16）：默认显示原图标，hover 行换成把手。
   两枚图标同格叠放（grid 同格），用 opacity 切换，尺寸一致不跳动。 */

.ac-queue-lead-swap {
  display: grid;
  place-items: center;
  width: 16px;
  flex: none;
  /* 命中区=整个父元素（用户实测修正：handle 绑在子元素时命中区错位，
     鼠标放在图标上没反应）。拖拽绑定（SortableJS handle）也在父元素上。 */
  height: 20px;
  cursor: grab;
  border-radius: 4px;
}

.ac-queue-lead-swap:active {
  cursor: grabbing;
}

.ac-queue-lead-swap > * {
  grid-area: 1 / 1;
  display: inline-flex;
  align-items: center;
  justify-content: center;
}

.ac-queue-lead-swap .ac-pending-lead {
  transition: opacity 0.15s ease;
}

.ac-pending-row .ac-queue-lead-swap .ac-queue-handle {
  opacity: 0;
}

.ac-pending-row:hover .ac-queue-lead-swap .ac-queue-handle,
.ac-pending-row.is-hover .ac-queue-lead-swap .ac-queue-handle {
  opacity: 1;
}

.ac-pending-row:hover .ac-queue-lead-swap .ac-pending-lead,
.ac-pending-row.is-hover .ac-queue-lead-swap .ac-pending-lead {
  opacity: 0;
}

.ac-queue-row--ghost {
  opacity: 0.4;
}

.ac-queue-row--chosen {
  background: var(--ui-hover, rgb(255 255 255 / 0.06));
}

.ac-queue-actions {
  display: flex;
  align-items: center;
  gap: 2px;
  flex: none;
}

.ac-queue-btn {
  flex: none;
  color: var(--ui-ink-dim, #919191);
}

.ac-queue-btn:hover {
  background: var(--ui-hover-strong, rgb(255 255 255 / 0.14));
  color: var(--ui-ink, #f7f7f7);
}

.ac-queue-btn.is-danger:hover {
  background: var(--ui-danger-veil, rgb(239 68 68 / 0.1));
  color: var(--ui-danger, #ef4444);
}

/* 队列暂停/恢复：**骑在容器与输入框分界线上**、水平居中。
     它是 .ac-input-box 的子元素（不是容器的）—— 容器 overflow:hidden 会把它裁掉半个；
     挂输入框上、top:0 + translateY(-50%)，正好压在输入框上边框 = 两块的接缝。 */

.ac-queue-pause {
  position: absolute;
  top: 0;
  left: 50%;
  transform: translate(-50%, -50%);
  z-index: 6;
  gap: 5px;
  border: 1px solid var(--ui-line, #363636);
  border-radius: 999px;
  background: var(--ui-overlay-solid, #212121);
  color: var(--ui-ink-dim, #919191);
  font-size: 11px;
  font-weight: 600;
  box-shadow: var(--ui-shadow-md, 0 18px 44px rgb(0 0 0 / 0.16));
  transition: color 0.15s ease;
}

.ac-queue-pause:hover {
  color: var(--ui-ink, #f7f7f7);
  background: linear-gradient(var(--ui-hover-strong, rgb(255 255 255 / 0.15)), var(--ui-hover-strong, rgb(255 255 255 / 0.15))), var(--ui-overlay-solid, #212121);
}

/* 主题色白名单: 暂停态是琥珀实心底，字必须是白 —— 与发送键红色实心底同款口径 */

.ac-queue-pause.is-paused {
  border-color: transparent;
  background: var(--ui-warn, #e3a25f);
  /* 主题色白名单: 同上（琥珀实心底上的白字） */
  color: #fff;
}

.ac-queue-pause-cnt {
  min-width: 16px;
  height: 16px;
  padding: 0 5px;
  border-radius: 999px;
  background: var(--ui-chip, rgb(255 255 255 / 0.1));
  display: grid;
  place-items: center;
  font-size: 10px;
  color: var(--ui-ink-dim, #919191);
}

/* 主题色白名单: 琥珀实心底上的计数胶囊也走白字（同上） */

.ac-queue-pause.is-paused .ac-queue-pause-cnt {
  /* 主题色白名单: 同上（琥珀实心底上的计数胶囊） */
  background: rgb(255 255 255 / 0.28);
  /* 主题色白名单: 同上（胶囊里的白字） */
  color: #fff;
}

/* —— 目标行（**已发送**，在聚合容器里）—— UI 与队列行刻意不同 —— */

/* 目标行用**中性灰阶**（用户口径 2026-10-09：这里用不到主题强调色）——
     靠底色深浅 + 字重与队列行区分，不再染青色。 */

.ac-goal-row {
  background: var(--ui-chip, rgb(255 255 255 / 0.1));
}

.ac-goal-row:hover {
  background: var(--ui-hover-strong, rgb(255 255 255 / 0.15));
}

/* 编辑中的目标行：**统一成黄色**（与消息 / 队列编辑同一套语义，用户口径 2026-10-09）。 */

.ac-goal-row.is-editing {
  background: color-mix(in srgb, var(--ui-warn, #e3a25f) 16%, transparent);
}

.ac-goal-row.is-editing:hover {
  background: color-mix(in srgb, var(--ui-warn, #e3a25f) 20%, transparent);
}

.ac-goal-row .ac-pending-lead {
  color: var(--ui-ink-dim, #919191);
}

/* 目标行左侧那颗图标：平时画「目标」，hover / 编辑中画「编辑」—— 两枚图标叠在同一格。
     点击进入编辑（进入后按钮带 is-editing，图标保持铅笔，一眼看出「正在编辑目标」）。 */

/* 几何与队列行的 .ac-pending-lead 完全一致：不另设宽高（图标 14×14 决定格子大小），
     不用负 margin、不用绝对定位 —— 那两样会让两行左列的基线对不上（真机量到 13 vs 14）。 */

.ac-goal-lead {
  flex: none;
  color: var(--ui-ink-dim, #919191);
}

.ac-goal-lead .ac-goal-lead-edit {
  display: none;
}

.ac-goal-lead:hover .ac-goal-lead-target {
  display: none;
}

.ac-goal-lead:hover .ac-goal-lead-edit {
  display: block;
}

.ac-goal-lead.is-editing .ac-goal-lead-target {
  display: none;
}

.ac-goal-lead.is-editing .ac-goal-lead-edit {
  display: block;
}

/* 目标文案：给它一个**可伸展但有下限**的宽度（min-width 太小会被同行的进度条/轮次挤成 0，
     真机踩到「文字只剩 6px」）。flex:1 1 auto + min-width:6em 保证至少能看到一小段。 */

/* 文案是**唯一可压缩**的元素（min-width:0 + flex:1）：装不下时它先缩，绝不让按钮被挤出去。
     但**不能无上限占满** —— flex:1 会让它把进度条挤成 0（真机量到 bar 只有 6px）。
     改成「占比上限」：最多吃容器的 40%，剩余空间自然分给进度条等次要信息。 */

/* 文案 **flex:1**（吃掉剩余空间）：这样右侧一组（图 / 轮次 / 已用/总预算 / 按钮）才会
     **顶到容器右缘**（用户口径：目标行是左右布局，右侧贴右）。
     文案自身 min-width:0 + 省略号 —— 空间不够时它先缩，按钮永不被挤走（RULES §9）。 */

.ac-goal-row-text {
  flex: 1 1 auto;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 12px;
  font-weight: 600;
  color: var(--ui-ink, #f7f7f7);
}

.ac-goal-flag {
  flex: none;
  padding: 1px 6px;
  border-radius: 999px;
  font-size: 10px;
  font-weight: 700;
  line-height: 14px;
  background: var(--ui-veil, rgb(255 255 255 / 0.06));
  color: var(--ui-ink-dim, #919191);
}

.ac-goal-flag.is-paused {
  background: color-mix(in srgb, var(--ui-warn, #e3a25f) 18%, transparent);
  color: var(--ui-warn, #e3a25f);
}

.ac-goal-flag.is-done {
  background: var(--ui-chip, rgb(255 255 255 / 0.1));
  color: var(--ui-ink-dim, #919191);
}

.ac-goal-round {
  flex: none;
  font-size: 12px;
  color: var(--ui-ink-dim, #919191);
  white-space: nowrap;
}

/* —— token 数字（预算 / 已用 / 剩余）：前缀 + **可编辑数值**。
   下划线用 CSS text-decoration（不是 border —— 边框会把文字压偏，见 RULES §8）；
   数值用 contenteditable，宽度天然跟着文字走。 */

.ac-goal-token {
  flex: none;
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font-size: 12px;
  font-weight: 600;
  color: var(--ui-ink, #f7f7f7);
  white-space: nowrap;
}

.ac-goal-token-prefix {
  flex: none;
  color: var(--ui-ink-dim, #919191);
  font-weight: 600;
}

.ac-goal-token-val {
  flex: none;
  min-width: 2.2ch;
  padding: 0;
  font-size: 12px;
  font-weight: 600;
  line-height: 16px;
  white-space: pre;
  cursor: text;
  outline: none;
  text-decoration: underline;
  text-decoration-thickness: 1px;
  text-underline-offset: 3px;
  text-decoration-color: var(--ui-ink-mute, #a8a8a8);
}

.ac-goal-token-val:hover {
  text-decoration-color: var(--ui-ink, #f7f7f7);
}

.ac-goal-token-val:focus {
  text-decoration-style: solid;
  text-decoration-color: var(--ui-ink, #f7f7f7);
}

/* 「已用」只读：不画下划线、不改光标 —— 一眼能区分「这个不能改」 */

.ac-goal-token-val.is-readonly {
  text-decoration: none;
  cursor: default;
}

/* 「已用/总预算」一体式：两个可编辑数字 + 中间一个斜杠，整体一块、样式统一 */

.ac-goal-ratio {
  flex: none;
  display: inline-flex;
  align-items: center;
  gap: 1px;
  font-size: 12px;
  font-weight: 600;
  color: var(--ui-ink, #f7f7f7);
  white-space: nowrap;
}

.ac-goal-ratio .ac-goal-token-val {
  min-width: 2.6ch;
  text-align: center;
}

.ac-goal-ratio-sep {
  flex: none;
  padding: 0 1px;
  color: var(--ui-ink-mute, #a8a8a8);
  font-weight: 600;
}

/* —— 未发送目标的标签（**输入框内侧顶部**，用户口径 2026-10-09）—— */

.ac-goal-mark {
  display: flex;
  align-items: center;
  gap: 6px;
  width: 100%;
  height: 26px;
  padding: 0 4px 0 8px;
  border-radius: 8px;
  background: var(--ui-veil, rgb(255 255 255 / 0.06));
  color: var(--ui-ink, #f7f7f7);
}

.ac-goal-icon {
  flex: none;
}

/* 标签只写「目标」二字；预算（口径 + 值）紧跟其后，右端留白由 spacer 顶开 */

.ac-goal-mark-label,
.ac-goal-mark .ac-goal-token-prefix,
.ac-goal-mark .ac-goal-token-val {
  font-size: 12px;
  font-weight: 600;
  line-height: 20px;
}

.ac-goal-mark .ac-goal-token {
  color: var(--ui-ink, #f7f7f7);
}

.ac-goal-btn {
  flex: none;
  color: inherit;
}

/* 口径开关的图标：已用 = 实心、剩余 = 空心 */

.ac-goal-btn .is-hollow {
  opacity: 0.55;
}

/* 极端防护（RULES §9）：面板变窄时次要信息逐级让位，操作按钮永不被挤走 */

.ac-goal-row.is-narrow .ac-goal-bar {
  display: none;
}

.ac-editor {
  position: relative;
  min-height: 64px;
  max-height: min(45vh, 15rem);
  overflow-y: auto;
}

.ac-placeholder {
  position: absolute;
  top: 0;
  left: 0;
  font-size: 14px;
  line-height: 24px;
  color: var(--ui-ink-dim, #919191);
  pointer-events: none;
}

.ac-toolbar {
  display: flex;
  align-items: center;
  gap: 3px;
  min-width: 0;
}

.ac-plus {
  flex: none;
  color: var(--ui-ink-dim, #919191);
}

/* 原生 file input 只是「被点」的载体，视觉由上面的 + 按钮承担 */

.ac-file {
  display: none;
}

.ac-tb-icon {
  color: var(--ui-ink-dim, #919191);
}

.ac-tb-icon.is-on {
  color: var(--ui-accent, #0891b2);
}

/* 授权方式 = 完全自动授权时用警示色（琥珀）：这是唯一需要用户留意的状态，图标染上提醒留意 */

.ac-tb-icon.is-warn {
  color: var(--ui-warn, #e3a25f);
}

.ac-pill {
  gap: 1px;
  padding-inline: 8px 4px;
  border-radius: 999px;
  /* 提示词名是用户自建的（没有长度上限）：胶囊可缩、单行省略，
     保证右侧的授权 / 模型 / 发送按钮永远不被挤出工具条（RULES §9）。 */
  flex: 0 1 auto;
  min-width: 0;
  max-width: 160px;
  color: var(--ui-ink, #f7f7f7);
  font-weight: 400;
  font-size: 13px;
}

.ac-pill-text {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.ac-pill-caret {
  flex: none;
}

.ac-tb-spacer {
  flex: 1;
  min-width: 8px;
}

/* 上下文环：照参考页实测占 32×32 的触发区（图标 12×12 居中），图标色 --ui-ink-dim。
   外面再包一层 tooltip 时也要保持这个尺寸，不然工具条按钮的基线会跳。 */

.ac-context {
  display: grid;
  place-items: center;
  width: 32px;
  height: 32px;
  margin-right: 2px;
  color: var(--ui-ink-dim, #919191);
  cursor: default;
}

/* —— 上下文统计（用户口径 2026-10-11：恢复到发送键左侧）——
   只留环形进度（hover 气泡给剩余百分比）：环已经表达了用量，旁边再写「已…」
   是重复信息，且 32px 的工具条里放不下 —— 用户口径：有环就不要文字。 */

.ac-ctxwrap {
  display: inline-flex;
  align-items: center;
  gap: 2px;
  min-width: 0;
}

/* —— 图片：待发送缩略图 / 已发送缩略图 / 看大图 —— */

/* 待发送（在输入框里，图片上方） */

.ac-attach-list {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  padding: 2px 2px 0;
}

.ac-attach {
  position: relative;
  width: 56px;
  height: 56px;
  flex: none;
  border: 1px solid var(--ui-line, #363636);
  border-radius: 10px;
  overflow: hidden;
  background: var(--ui-veil, rgb(255 255 255 / 0.04));
}

.ac-attach img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
}

.ac-attach-del {
  position: absolute;
  top: 2px;
  right: 2px;
  background: var(--ui-scrim, rgb(0 0 0 / 0.6));
  color: var(--ui-tip-ink, #fff);
}

.ac-attach-del:hover {
  background: var(--ui-danger, #ef4444);
}

/* 已发送（在用户气泡里）：按原比例排，点开看大图 */

.ac-user-images {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-top: 8px;
}

.ac-user-image {
  width: 96px;
  height: 96px;
  padding: 0;
  border: 0;
  border-radius: 10px;
  overflow: hidden;
  background: transparent;
  cursor: zoom-in;
}

.ac-user-image img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
}

/* 看大图：铺满面板的遮罩（z-index 要在下拉/浮层之上） */

/* 底圈：整圈淡显（照参考页 opacity .25），提供"盘面"感 */

.ac-ctx-track {
  opacity: 0.25;
}

.ac-send {
  flex: none;
  padding: 0;
  border-radius: 12px;
  background: var(--ui-primary-bg, #f7f7f7);
  color: var(--ui-primary-ink, #141414);
  transition: opacity 0.16s ease;
}

.ac-send:disabled {
  opacity: 0.45;
}

.ac-send.is-running {
  background: var(--ui-danger, #ef4444);
  color: var(--ui-on-accent, #fff);
}

/* 停止键里的实心方块：走 currentColor（与按钮文字色同一套 token），
   不引线框图标，圆角 2 让方角不至于太生硬。 */

.ac-stop-square {
  width: 11px;
  height: 11px;
  border-radius: 2px;
  background: currentColor;
}

/* —— 下拉内容（浮层本体由目录里的 dropdown 提供：定位/翻边/出屏/互斥它负责）——
   层次结构（照参考图）：上下 flex 分栏 ——
     ┌ 分组头（固定，不滚）  标题 + 计数
     ├ 列表区（flex:1，自己滚，滚动条只出在这里）
     │   └ 行卡片：图标托 + 标题/说明 + 选中勾
   浮层用 dropdown 的 layout="inner-scroll"：它只当外框，滚动由下面的列表区负责，
   所以顶部标题天然不滚，不需要 sticky 去补。 */

.ac-ddmenu {
  display: flex;
  flex-direction: column;
  min-height: 0;
  flex: 1;
  padding: 2px;
}

/* 分组头：普通 flex 行。它不滚是因为**滚动发生在下面的列表区**，不是靠定位吸住。 */

.ac-menu-head {
  display: flex;
  align-items: center;
  gap: 8px;
  flex: none;
  padding: 8px 10px 6px;
}

.ac-menu-head-title {
  font-size: 12px;
  font-weight: 600;
  color: var(--ui-ink, #f7f7f7);
}

.ac-menu-head-count {
  min-width: 18px;
  padding: 0 5px;
  border-radius: 999px;
  background: var(--ui-chip, rgb(255 255 255 / 0.1));
  font-size: 11px;
  line-height: 16px;
  text-align: center;
  color: var(--ui-ink-dim, #919191);
}

/* 分组头右侧的操作（MCP 的「检测」）：把计数推到左边、按钮贴右 */

.ac-menu-head-spacer {
  flex: 1;
  min-width: 4px;
}

.ac-menu-head-btn {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  flex: none;
  height: 22px;
  padding: 0 8px;
  border: 1px solid var(--ui-line, #363636);
  border-radius: 999px;
  background: transparent;
  color: var(--ui-ink-dim, #919191);
  font-size: 11px;
  cursor: pointer;
}

.ac-menu-head-btn:hover:not(:disabled) {
  background: var(--ui-hover, rgb(255 255 255 / 0.1));
  color: var(--ui-ink, #f7f7f7);
}

.ac-menu-head-btn:disabled {
  opacity: 0.6;
  cursor: default;
}

/* 每行右侧的检测徽章 */

.ac-menu-card-badge {
  flex: none;
  margin-top: 3px;
  max-width: 96px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  padding: 1px 6px;
  border-radius: 999px;
  background: var(--ui-accent-soft, rgb(8 145 178 / 0.12));
  color: var(--ui-accent-hover, #0e7490);
  font-size: 11px;
  line-height: 15px;
}

.ac-menu-card-badge.is-bad {
  background: var(--ui-danger-veil, rgb(239 68 68 / 0.1));
  color: var(--ui-danger, #ef4444);
}

/* 列表区：**唯一会滚的那层**。flex:1 + min-height:0 才能在限高的浮层里正确收缩 */

.ac-menu-scroll {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: 0 2px 2px;
}

/* 行卡片：图标托 + 两行文字 + 选中勾。整行有底色/描边，才有"一条一条"的结构感 */

.ac-menu-card {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  width: 100%;
  padding: 9px 10px;
  border: 1px solid transparent;
  border-radius: 10px;
  background: var(--ui-veil, rgb(255 255 255 / 0.04));
  text-align: left;
  cursor: pointer;
  transition: background 0.14s ease, border-color 0.14s ease;
}

.ac-menu-card:hover {
  background: var(--ui-hover, rgb(255 255 255 / 0.1));
}

.ac-menu-card[aria-selected='true'] {
  border-color: var(--ui-accent, #0891b2);
  background: var(--ui-accent-soft, rgb(8 145 178 / 0.12));
}

.ac-menu-card-icon {
  display: grid;
  place-items: center;
  flex: none;
  width: 26px;
  height: 26px;
  border-radius: 8px;
  background: var(--ui-chip, rgb(255 255 255 / 0.1));
  color: var(--ui-ink-dim, #919191);
}

.ac-menu-card-icon :deep(svg) {
  width: 15px;
  height: 15px;
}

.ac-menu-card[aria-selected='true'] .ac-menu-card-icon {
  color: var(--ui-accent, #0891b2);
}

.ac-menu-card-text {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
  flex: 1;
}

.ac-menu-card-name {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 13px;
  color: var(--ui-ink, #f7f7f7);
}

.ac-menu-card[aria-selected='true'] .ac-menu-card-name {
  color: var(--ui-accent, #0891b2);
  font-weight: 600;
}

.ac-menu-card-hint {
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
  font-size: 11px;
  line-height: 1.5;
  color: var(--ui-ink-dim, #919191);
}

.ac-menu-card-check {
  flex: none;
  margin-top: 5px;
  color: var(--ui-accent, #0891b2);
}

/* —— 面板化下拉（1:1 复刻 docs/demo/agent-select-panels）——
   结构照 DEMO 的 .panel / .panel-head / .panel-body / .panel-foot：
   头部三格（标题 | 搜索 ≤240 | 工具/视图），中间滚动区（轻卡片或分栏），底部状态行。
   所有非颜色数值（尺寸 / 圆角 / 字号 / 字重 / 间距 / 阴影几何 / 动效曲线）与 DEMO 一字不差；
   颜色一律映射到 --ui-* token，兜底值就是 DEMO 的原色值。
   响应式用容器查询（DEMO 的 @container 阈值原样保留），以面板自身宽度为准。 */

/* 面板本体：铺满 dropdown 的滚动区。外框（圆角 / 描边 / 阴影 / 6px 内边距）由 dropdown 提供。
   以前这里写 margin:-6px + width:calc(100% + 12px) 去抵消外框内边距；
   但 2026-11-02 把滚动区移进 dropdown 内部后，负边距会被滚动容器的 overflow 裁掉，
   左侧少 6px、右侧多 6px。去掉这段，面板自然铺满，左右留白重新对称。 */

.ac-ddmenu.ac-panel {
  width: 100%;
  /* 最小高度（用户口径 2026-10-30：「分栏 / 卡片两种模式都要有最小高度」）。
     卡片模式只有两三条时别塌成一条窄缝。
     为什么这么小：卡片模式本来就该贴着内容长，托底只为挡住「一条窄缝」；
     真要撑高的是分栏（见 .is-split），两种模式的最小高度不是同一个数。
     外面再套一层 min()：视口极矮时按可用高度收，别把面板顶出屏幕。 */
  min-height: min(232px, calc(100dvh - 32px));
  padding: 0;
  container-type: inline-size;
  font: 13px/1.5 -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif;
}

.ac-ddmenu.ac-panel.is-split {
  /* 分栏要高过卡片：左栏是竖排分类、右栏是瓦片网格，太矮两边都只剩两行。
     上限压到 420 —— 浮层的 max-height 是 440，再高就会被裁掉（inner-scroll 不出滚动条）。
     下限给到 380：技能分栏只有两张瓦片时也要有「两列都在滚」的样子，不外扩成一条窄带。 */
  min-height: min(clamp(380px, 56vh, 420px), calc(100dvh - 32px));
}

.ac-panel-head {
  flex: none;
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 8px 10px;
}

.ac-panel-head-top {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  align-items: center;
  gap: 8px;
  min-width: 0;
}

/* 审核面板只有「标题 + 状态标签」两格（DEMO 的 review 头部没有搜索/视图开关）。 */

.ac-panel-head-top--review {
  grid-template-columns: minmax(0, 1fr) auto;
}

.ac-panel-heading {
  display: flex;
  align-items: center;
  gap: 7px;
  flex: 1;
  min-width: 0;
}

.ac-panel-title {
  margin: 0;
  font-size: 15px;
  line-height: 1.3;
  font-weight: 700;
  letter-spacing: -0.01em;
  white-space: nowrap;
  color: var(--ui-ink, #111827);
}

.ac-panel-count {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 20px;
  height: 18px;
  padding: 0 6px;
  border-radius: 999px;
  background: var(--ui-veil, rgba(0, 0, 0, 0.04));
  color: var(--ui-ink-dim, #6b7280);
  font-size: 10px;
  font-weight: 700;
  line-height: 1;
}

.ac-panel-lede {
  margin: 0;
  font-size: 12px;
  line-height: 1.45;
  color: var(--ui-ink-dim, #6b7280);
}

/* 审核头部右侧的状态小标签（用户要求：右上角一个状态小标签） */

.ac-review-state {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  flex: none;
  height: 18px;
  padding: 0 6px;
  border-radius: 999px;
  background: var(--ui-accent-soft, rgba(8, 145, 178, 0.1));
  color: var(--ui-accent-hover, #0e7490);
  font-size: 10px;
  font-weight: 600;
  white-space: nowrap;
}

.ac-panel-tools {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 5px;
  flex: none;
}

/* 中间区（DEMO 的 .panel-body）：上下 flex 的主内容，自身不滚。 */

.ac-panel-body {
  position: relative;
  display: flex;
  flex: 1;
  flex-direction: column;
  min-height: 0;
  overflow: hidden;
}

/* 滚动区（DEMO 的 .panel-scroll）：2px 12px 12px 内边距，唯一滚动层。 */

.ac-panel-scroll {
  flex: 1;
  min-height: 0;
  overflow-x: hidden;
  overflow-y: auto;
  padding: 2px 12px 12px;
  scrollbar-width: thin;
  scrollbar-color: var(--ui-scroll-thumb, rgba(0, 0, 0, 0.12)) transparent;
}

.ac-panel-scroll::-webkit-scrollbar,
.ac-rail-scroll::-webkit-scrollbar,
.ac-split-scroll::-webkit-scrollbar {
  width: 8px;
  height: 8px;
}

.ac-panel-scroll::-webkit-scrollbar-thumb,
.ac-rail-scroll::-webkit-scrollbar-thumb,
.ac-split-scroll::-webkit-scrollbar-thumb {
  border-radius: 4px;
  background: var(--ui-scroll-thumb, rgba(0, 0, 0, 0.12));
}

.ac-panel-scroll::-webkit-scrollbar-thumb:hover,
.ac-rail-scroll::-webkit-scrollbar-thumb:hover,
.ac-split-scroll::-webkit-scrollbar-thumb:hover {
  background: var(--ui-scroll-thumb-hover, rgba(0, 0, 0, 0.2));
}

/* —— 审核（DEMO 的 .review-*）—— */

.ac-review-body {
  padding: 2px 12px 12px;
}

.ac-review-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.ac-review-option {
  gap: 10px;
  width: 100%;
  min-height: 76px;
  padding: 11px;
  border: 1px solid var(--ui-line, rgba(0, 0, 0, 0.08));
  background: var(--ui-panel, #fff);
  text-align: left;
  transition: border-color 0.18s ease, background 0.18s ease, box-shadow 0.18s ease;
}

.ac-review-option:hover {
  background: var(--ui-hover-soft, rgba(0, 0, 0, 0.03));
  border-color: var(--ui-line, rgba(0, 0, 0, 0.12));
}

.ac-review-option[aria-checked='true'] {
  border-color: var(--ui-accent-line, rgba(8, 145, 178, 0.28));
  background: linear-gradient(180deg,
    color-mix(in srgb, var(--ui-accent, #0891b2) 8%, transparent),
    color-mix(in srgb, var(--ui-accent, #0891b2) 4%, transparent));
  box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--ui-accent, #0891b2) 4%, transparent);
}

.ac-review-option[aria-checked='true'] .ac-option-icon {
  background: var(--ui-accent-soft, rgba(8, 145, 178, 0.1));
  color: var(--ui-accent-hover, #0e7490);
}

.ac-review-option.is-auto .ac-option-icon {
  color: var(--ui-warn, #b45309);
}

.ac-review-option.is-auto[aria-checked='true'] .ac-option-icon {
  background: var(--ui-warn-soft, rgba(245, 158, 11, 0.14));
  color: var(--ui-warn, #b45309);
}

.ac-review-option[aria-checked='true'] .ac-radio {
  border-color: var(--ui-accent, #0891b2);
  background: var(--ui-accent, #0891b2);
}

.ac-review-option[aria-checked='true'] .ac-radio svg {
  opacity: 1;
}

/* —— 通用选择卡（DEMO 的 .skill-grid / .skill-card）—— */

.ac-skill-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(min(100%, 235px), 1fr));
  gap: 8px;
}

.ac-skill-card {
  display: flex;
  align-items: center;
  gap: 9px;
  width: 100%;
  /* 卡片是 div（不是 Button）：自己给回 72px 最小高度与 8px 内边距，
     否则 shadcn 的按钮尺寸规则会把它压扁。 */
  height: auto;
  min-width: 0;
  min-height: 72px;
  padding: 8px;
  cursor: pointer;
  border: 1px solid var(--ui-line, rgba(0, 0, 0, 0.08));
  border-radius: 12px;
  background: var(--ui-panel, #fff);
  text-align: left;
  transition: background 0.18s ease, border-color 0.18s ease, box-shadow 0.18s ease, transform 0.18s ease;
}

.ac-skill-card:focus-visible, .ac-skill-tile:focus-visible {
  outline: 2px solid var(--ui-accent-ring, rgb(8 145 178 / 0.6));
  outline-offset: 2px;
}

.ac-skill-card:hover {
  background: var(--ui-hover-soft, rgba(0, 0, 0, 0.03));
  border-color: var(--ui-line, rgba(0, 0, 0, 0.12));
  box-shadow: var(--ui-shadow-e1, 0 2px 10px rgba(0, 0, 0, 0.04));
  transform: translateY(-1px);
}

/* 封面（DEMO 的 .skill-thumb）：54×54、圆角 10、按名字 hash 的双色渐变 + 右上高光。 */

.ac-skill-thumb {
  position: relative;
  display: grid;
  place-items: center;
  width: 54px;
  height: 54px;
  flex: none;
  overflow: hidden;
  border-radius: 10px;
  color: var(--ui-primary-ink, rgba(255, 255, 255, 0.94));
  background:
    radial-gradient(circle at 78% 18%, var(--ui-primary-ink, rgba(255, 255, 255, 0.28)), transparent 36%),
    /* 主题色白名单: 技能封面是内容生成的艺术渐变（按名字 hash 的色相），不是界面主题色 */
    linear-gradient(145deg, hsl(var(--cover-h1, 208) 66% 54%), hsl(var(--cover-h2, 250) 62% 40%));
}

.ac-skill-thumb::after {
  content: '';
  position: absolute;
  inset: auto -8px -16px 12px;
  height: 28px;
  border-radius: 50%;
  background: var(--ui-primary-ink, rgba(255, 255, 255, 0.12));
  transform: rotate(-8deg);
}

.ac-skill-icon {
  position: relative;
  z-index: 1;
  display: grid;
  place-items: center;
}

.ac-skill-icon :deep(svg) {
  width: 23px;
  height: 23px;
}

.ac-skill-copy {
  display: flex;
  flex-direction: column;
  gap: 2px;
  flex: 1;
  min-width: 0;
}

.ac-skill-name-row {
  display: flex;
  align-items: center;
  gap: 5px;
  min-width: 0;
}

.ac-skill-name {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 12.5px;
  line-height: 1.35;
  font-weight: 600;
  color: var(--ui-ink, #111827);
}

.ac-skill-desc {
  display: -webkit-box;
  overflow: hidden;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 2;
  font-size: 12px;
  line-height: 1.4;
  color: var(--ui-ink-dim, #6b7280);
}

.ac-skill-meta {
  display: flex;
  align-items: center;
  gap: 5px;
  min-width: 0;
  overflow: hidden;
  font-size: 10.5px;
  color: var(--ui-ink-mute, #9ca3af);
  white-space: nowrap;
}

[aria-pressed='true'] > .ac-check-mark,
[aria-pressed='true'] .ac-skill-name-row > .ac-check-mark,
[aria-pressed='true'] .ac-model-card-top > .ac-check-mark,
[aria-checked='true'] .ac-model-card-top > .ac-check-mark,
[aria-checked='true'] > .ac-check-mark,
[aria-selected='true'] > .ac-check-mark,
[aria-selected='true'] .ac-model-card-top > .ac-check-mark {
  opacity: 1;
}

/**
 * 两项式菜单行（创作模式 / 授权方式）：**高度随两行文字长**。
 *
 * 2026-11-02 用户截图：标题与说明叠在一起。原因有两层：
 *   ① Button 本体是横向 flex（已改 column）；
 *   ② Button 的 size="sm" 被组件库 size.css 钉死 32px 高，两行文字塞不进 32px，
 *      第二行直接压在第一行上。
 * 这里显式给 height:auto + min-height，并把选择器写到比 size.css 更具体
 * （html[data-mct-size] [data-slot='button'][data-size='sm'] 是 0,3,1），否则压不住它。
 */

html[data-mct-size] [data-slot='button'].ac-menu-item[data-size='sm'] {
  height: auto;
  min-height: 46px;
  padding-block: 6px;
}

.ac-skill-grid--split {
  grid-template-columns: repeat(auto-fill, minmax(min(100%, 176px), 1fr));
}

/* 分栏封面瓦片（DEMO 的 .skill-tile / .skill-cover） */

.ac-skill-tile {
  display: flex;
  flex-direction: column;
  cursor: pointer;
  height: auto;
  min-height: 188px;
  min-width: 0;
  overflow: hidden;
  border: 1px solid var(--ui-line, rgba(0, 0, 0, 0.08));
  border-radius: 12px;
  background: var(--ui-panel, #fff);
  text-align: left;
  transition: border-color 0.18s ease, box-shadow 0.18s ease, transform 0.18s ease;
}

.ac-skill-tile:hover {
  border-color: var(--ui-line, rgba(0, 0, 0, 0.12));
  box-shadow: var(--ui-shadow-e1, 0 2px 10px rgba(0, 0, 0, 0.04));
  transform: translateY(-1px);
}

.ac-skill-tile[aria-pressed='true'] {
  border-color: var(--ui-accent-line, rgba(8, 145, 178, 0.28));
  box-shadow: 0 0 0 2px color-mix(in srgb, var(--ui-accent, #0891b2) 7%, transparent);
}

.ac-skill-cover {
  position: relative;
  display: grid;
  place-items: center;
  width: 100%;
  height: 74px;
  overflow: hidden;
  color: var(--ui-primary-ink, rgba(255, 255, 255, 0.94));
  background:
    radial-gradient(circle at 82% 16%, var(--ui-primary-ink, rgba(255, 255, 255, 0.3)), transparent 34%),
    /* 主题色白名单: 技能封面是内容生成的艺术渐变（按名字 hash 的色相），不是界面主题色 */
    linear-gradient(145deg, hsl(var(--cover-h1, 208) 66% 54%), hsl(var(--cover-h2, 250) 62% 40%));
}

.ac-skill-cover::after {
  content: '';
  position: absolute;
  inset: auto -20px -22px 16px;
  height: 48px;
  border-radius: 50%;
  background: var(--ui-primary-ink, rgba(255, 255, 255, 0.12));
  transform: rotate(-7deg);
}

.ac-skill-cover .ac-skill-icon :deep(svg) {
  width: 26px;
  height: 26px;
}

.ac-skill-tile-body {
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: 8px 9px 9px;
}

.ac-tile-top .ac-skill-name {
  white-space: normal;
}

.ac-skill-tile .ac-skill-name {
  font-size: 12px;
}

.ac-skill-tile .ac-skill-desc {
  font-size: 11px;
}

.ac-skill-tile .ac-skill-meta {
  font-size: 10px;
}

/* —— 模型（DEMO 的 .model-grid / .model-card / .brand）—— */

.ac-model-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(min(100%, 236px), 1fr));
  gap: 8px;
}

.ac-model-card {
  gap: 8px;
  width: 100%;
  min-width: 0;
  min-height: 58px;
  padding: 7px 9px;
  border: 1px solid var(--ui-line, rgba(0, 0, 0, 0.08));
  border-radius: 12px;
  background: var(--ui-panel, #fff);
  text-align: left;
  transition: background 0.18s ease, border-color 0.18s ease, box-shadow 0.18s ease, transform 0.18s ease;
}

.ac-model-card:hover {
  background: var(--ui-hover-soft, rgba(0, 0, 0, 0.03));
  border-color: var(--ui-line, rgba(0, 0, 0, 0.12));
  box-shadow: var(--ui-shadow-e1, 0 2px 10px rgba(0, 0, 0, 0.04));
  transform: translateY(-1px);
}

.ac-model-card[aria-checked='true'],
.ac-model-card[aria-selected='true'] {
  border-color: var(--ui-line, rgba(0, 0, 0, 0.08));
  background: var(--ui-hover-soft, rgba(0, 0, 0, 0.03));
}

/* 品牌图标托（DEMO 的 .brand）：35×35、圆角 9、白底 + 1px 内描边，svg 22×22。 */

.ac-model-brand {
  display: grid;
  place-items: center;
  width: 35px;
  height: 35px;
  flex: none;
  border-radius: 9px;
  background: var(--ui-panel, #fff);
  color: var(--ui-ink, #374151);
  box-shadow: inset 0 0 0 1px var(--ui-line-soft, rgba(0, 0, 0, 0.05));
}

.ac-model-brand :deep(svg) {
  width: 22px;
  height: 22px;
}

.ac-model-copy {
  display: flex;
  flex-direction: column;
  gap: 2px;
  flex: 1;
  min-width: 0;
}

.ac-model-id {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font: 600 13.5px/1.4 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  color: var(--ui-ink, #111827);
}

.ac-model-meta {
  display: flex;
  align-items: center;
  gap: 5px;
  min-width: 0;
  overflow: hidden;
  white-space: nowrap;
  font-size: 10.5px;
  color: var(--ui-ink-mute, #9ca3af);
}

.ac-model-card-top {
  display: flex;
  align-items: flex-start;
  gap: 4px;
  min-width: 0;
}

.ac-model-card-top .ac-model-id {
  flex: 1;
}

.ac-model-row-list {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.ac-model-row {
  gap: 8px;
  width: 100%;
  min-height: 54px;
  padding: 7px 9px;
  border: 1px solid transparent;
  border-radius: 10px;
  background: transparent;
  text-align: left;
}

.ac-model-row:hover {
  background: var(--ui-hover-soft, rgba(0, 0, 0, 0.03));
  border-color: var(--ui-line-soft, rgba(0, 0, 0, 0.05));
}

.ac-model-row[aria-checked='true'],
.ac-model-row[aria-selected='true'] {
  border-color: var(--ui-line-soft, rgba(0, 0, 0, 0.05));
  background: var(--ui-hover-soft, rgba(0, 0, 0, 0.03));
}

.ac-model-row .ac-model-brand {
  background: var(--ui-hover-soft, rgba(0, 0, 0, 0.03));
  box-shadow: none;
}

.ac-model-badges {
  display: flex;
  align-items: center;
  gap: 4px;
  flex: none;
}

/* 模型滚动区：契约要求滚动层是 .ac-menu-scroll，内层 .ac-panel-body 只负责内边距。 */

.ac-model-panel .ac-menu-scroll {
  flex: 1;
  min-height: 0;
  overflow-x: hidden;
  overflow-y: auto;
  display: block;
  padding: 0;
  scrollbar-width: thin;
  scrollbar-color: var(--ui-scroll-thumb, rgba(0, 0, 0, 0.12)) transparent;
}

.ac-model-panel .ac-menu-scroll .ac-panel-body {
  overflow: visible;
  padding: 2px 12px 12px;
}

/* 分栏：**外层不再滚**，滚动交给左右两列各自负责（用户口径 2026-10-30，附截图）。
   不这么改的话，外层 .ac-menu-scroll 会把整块面板一起滚：左栏被裁掉半行、右栏的滚动条
   也挂在面板最外缘 —— 两列看着像同一根滚动条，实际谁都没法各自定位。
   做法与外层同一条链：每层都 flex:1 + min-height:0，把高度一路传下去，最后两列才有
   确定的视口高度可滚。 */

.ac-model-panel.is-split .ac-menu-scroll {
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.ac-model-panel.is-split .ac-menu-scroll .ac-panel-body {
  flex: 1;
  min-height: 0;
  overflow: hidden;
  padding: 0;
}

/* —— MCP（DEMO 的 .mcp-list / .mcp-card / .status）—— */

.ac-mcp-list {
  display: flex;
  flex-direction: column;
  gap: 7px;
}

.ac-mcp-card {
  display: flex;
  align-items: center;
  gap: 7px;
  width: 100%;
  min-width: 0;
  overflow: hidden;
  padding: 7px 8px;
  border: 1px solid var(--ui-line, rgba(0, 0, 0, 0.08));
  border-radius: 12px;
  background: var(--ui-panel, #fff);
  text-align: left;
  cursor: pointer;
  transition: border-color 0.18s ease, background 0.18s ease, box-shadow 0.18s ease;
}

.ac-mcp-card:hover {
  border-color: var(--ui-line, rgba(0, 0, 0, 0.12));
}

.ac-mcp-card.is-picked {
  border-color: var(--ui-accent-line, rgba(8, 145, 178, 0.28));
  background: linear-gradient(180deg, var(--ui-accent-soft, rgba(8, 145, 178, 0.05)), var(--ui-panel, #fff) 42%);
}

.ac-pick-box[aria-pressed='true'],
.ac-mcp-card.is-picked .ac-pick-box,
.ac-tool-row.is-picked .ac-pick-box {
  border-color: var(--ui-accent, #0891b2);
  background: var(--ui-accent, #0891b2);
}

.ac-pick-box[aria-pressed='true'] :deep(svg),
.ac-mcp-card.is-picked .ac-pick-box :deep(svg),
.ac-tool-row.is-picked .ac-pick-box :deep(svg) {
  opacity: 1;
}

.ac-mcp-server-main {
  gap: 9px;
  flex: 1;
  min-width: 0;
  text-align: left;
}

/* 工具行列表：缩进对齐到服务名（20 选择框 + 8 间距），描边虚化一圈。 */

.ac-mcp-tools {
  display: flex;
  flex-direction: column;
  gap: 4px;
  margin: 4px 0 0 28px;
  padding: 4px;
  border: 1px solid var(--ui-line-soft, rgba(0, 0, 0, 0.05));
  border-radius: 10px;
  background: var(--ui-veil, rgba(0, 0, 0, 0.02));
  max-height: 180px;
  overflow-y: auto;
  scrollbar-width: thin;
}

.ac-panel-note {
  margin: 8px 2px 0;
  font-size: 11px;
  line-height: 1.4;
  color: var(--ui-ink-mute, #9ca3af);
}

/* —— 底栏：按内容高的窄条，不再用 54px 撑出一块空白 —— */

.ac-panel-foot {
  display: flex;
  align-items: center;
  gap: 8px;
  flex: none;
  min-height: 36px;
  padding: 6px 10px;
  border-top: 1px solid var(--ui-line-soft, rgba(0, 0, 0, 0.06));
  background: var(--ui-overlay, rgba(255, 255, 255, 0.94));
}

.ac-model-foot .ac-selection-summary {
  justify-content: flex-start;
}

/* 简单两项式下拉（创作模式 / 授权方式）：标题一行 + 说明一行 */

.ac-menu-item {
  /*
   * 必须是纵向。
   *
   * 2026-11-02 用户截图：下拉里「全能创作」和「内置提示词」挤在同一行，
   * 两段文字之间只剩 2px。根因是 Button 本体是 `display:flex; flex-direction:row`，
   * 这里只写了 align-items，没有改方向，两个 span 就并排了。
   * 改成 column 后才是注释里说的「标题一行 + 说明一行」。
   */
  flex-direction: column;
  align-items: stretch;
  gap: 2px;
  width: 100%;
  text-align: left;
}

.ac-menu-item:hover {
  background: var(--ui-hover, rgb(255 255 255 / 0.1));
}

.ac-menu-item[aria-selected='true'] .ac-menu-name {
  color: var(--ui-accent, #0891b2);
  font-weight: 600;
}

.ac-menu-name {
  max-width: 100%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 13px;
  color: var(--ui-ink, #f7f7f7);
}

.ac-menu-title-row {
  display: flex;
  align-items: center;
  gap: 6px;
  width: 100%;
}

.ac-menu-title-row .ac-menu-name {
  flex: 1;
  min-width: 0;
}

/* 授权方式两个选项的配色（用户口径 2026-10-03）:
   ask  = 手掌 / **默认无色**（先停一下是常态，不用彩色喊）
   auto = 盾牌+感叹号 / **琥珀**（图标与文字都染，唯一需要留意的那个选项）
   底色是同色 12% 的浅托, 亮暗主题都由 token 现算 */

.ac-menu-icon {
  flex: none;
  display: grid;
  place-items: center;
  width: 22px;
  height: 22px;
  border-radius: 6px;
  color: var(--ui-ink-dim, #919191);
  background: var(--ui-chip, rgb(255 255 255 / 0.1));
}

.ac-menu-icon.is-auto {
  color: var(--ui-warn, #e3a25f);
  background: color-mix(in srgb, var(--ui-warn, #e3a25f) 12%, transparent);
}

/* 完全自动授权那一行，文字也跟着图标染成琥珀（用户要求：不要只有图标有色） */

.ac-menu-name.is-auto {
  color: var(--ui-warn, #e3a25f);
}

.ac-menu-item[aria-selected='true'] .ac-menu-name {
  color: var(--ui-ink, #f7f7f7);
}

.ac-menu-check {
  flex: none;
  color: var(--ui-accent, #0891b2);
}

.ac-menu-hint {
  max-width: 100%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 11px;
  color: var(--ui-ink-dim, #919191);
}

.ac-menu-empty {
  margin: 8px 10px;
  font-size: 12px;
  color: var(--ui-ink-dim, #919191);
}

.ac-composer {
  position: relative;
  flex: none;
  padding: 4px 8px 12px;
}

.ac-input-box {
  position: relative;
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 8px;
  border: 1px solid var(--ui-line, #363636);
  border-radius: 16px;
  background: var(--ui-overlay-solid, #212121);
}

@container (max-width: 300px) {
  .ac-goal-bar {
    display: none;
  }
}

@container (max-width: 250px) {
  .ac-goal-flag {
    display: none;
  }
}

@media (prefers-reduced-motion: reduce) {
  .ac-queue-pause {
    transition: none;
  }
}

.ac-search-inline {
  width: 100%;
}

.ac-icon-btn {
  position: relative;
  flex: none;
  background: var(--ui-veil, rgba(0, 0, 0, 0.04));
  color: var(--ui-ink-dim, #6b7280);
}

.ac-icon-btn:hover {
  background: var(--ui-hover, rgba(0, 0, 0, 0.06));
  color: var(--ui-ink, #111827);
}

.ac-icon-btn:active {
  transform: scale(0.96);
}

.ac-icon-btn[aria-expanded='true'] {
  background: var(--ui-accent-soft, rgba(8, 145, 178, 0.1));
  color: var(--ui-accent-hover, #0e7490);
}

.ac-view-tabs {
  flex: none;
  width: auto;
}

.ac-detect-btn {
  flex: none;
  color: var(--ui-ink-dim, #6b7280);
  font-size: 11px;
  font-weight: 600;
}

.ac-detect-btn:hover:not(:disabled) {
  border-color: var(--ui-accent-line, rgba(8, 145, 178, 0.28));
  background: var(--ui-accent-soft, rgba(8, 145, 178, 0.1));
  color: var(--ui-accent-hover, #0e7490);
}

.ac-detect-btn:disabled {
  cursor: wait;
  opacity: 0.72;
}

.ac-option-icon {
  display: grid;
  place-items: center;
  width: 32px;
  height: 32px;
  flex: none;
  border-radius: 9px;
  background: var(--ui-veil, rgba(0, 0, 0, 0.04));
  color: var(--ui-ink-dim, #6b7280);
}

.ac-option-copy {
  flex: 1;
  min-width: 0;
  padding-top: 1px;
}

.ac-option-title {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-wrap: wrap;
  font-size: 13px;
  line-height: 1.35;
  font-weight: 600;
  color: var(--ui-ink, #111827);
}

.ac-option-desc {
  display: block;
  margin-top: 3px;
  font-size: 12px;
  line-height: 1.45;
  color: var(--ui-ink-dim, #6b7280);
}

.ac-badge {
  /* 尺寸 / 圆角 / 底色都由组件库 Badge 决定，这里只留面板内的一点紧凑度。 */
  flex: none;
  font-size: 10px;
}

.ac-badge.is-accent {
  background: var(--ui-accent-soft, rgba(8, 145, 178, 0.12));
  color: var(--ui-accent-hover, #0e7490);
}

.ac-badge.is-warn {
  background: var(--ui-warn-soft, rgba(245, 158, 11, 0.14));
  color: var(--ui-warn, #b45309);
}

.ac-radio {
  display: grid;
  place-items: center;
  width: 18px;
  height: 18px;
  flex: none;
  margin-top: 6px;
  border: 1px solid var(--ui-line, rgba(0, 0, 0, 0.2));
  border-radius: 50%;
  background: var(--ui-panel, #fff);
  color: var(--ui-panel, #fff);
  transition: background 0.18s ease, border-color 0.18s ease;
}

.ac-radio svg {
  opacity: 0;
}

.ac-dot-sep {
  width: 1px;
  height: 8px;
  flex: none;
  background: var(--ui-line, rgba(0, 0, 0, 0.08));
}

.ac-check-mark {
  display: grid;
  place-items: center;
  width: 16px;
  height: 16px;
  flex: none;
  color: var(--ui-ink, #18202b);
  opacity: 0;
  transition: opacity 0.12s ease;
}

.ac-split {
  display: flex;
  flex: 1;
  min-height: 0;
  overflow: hidden;
}

.ac-split-rail {
  display: flex;
  flex-direction: column;
  width: 152px;
  flex: none;
  min-height: 0;
  border-right: 1px solid var(--ui-line-soft, rgba(0, 0, 0, 0.06));
  background: var(--ui-thumb-soft, #fafbfc);
}

.ac-rail-label {
  flex: none;
  padding: 8px 12px 5px;
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.04em;
  color: var(--ui-ink-mute, #9ca3af);
}

.ac-rail-scroll {
  display: flex;
  flex: 1;
  flex-direction: column;
  gap: 2px;
  min-height: 0;
  overflow-x: hidden;
  overflow-y: auto;
  padding: 0 8px 10px;
  /* 左栏独立滚：滚到头也不把动作传给外层（否则外层一滚，右栏跟着整块跑） */
  overscroll-behavior: contain;
  scrollbar-width: thin;
  scrollbar-color: var(--ui-scroll-thumb, rgba(0, 0, 0, 0.12)) transparent;
}

html[data-mct-size] .ac-split .ac-rail-item {
  gap: 6px;
  width: 100%;
  flex: none;
  /*
   * 左栏只有 152px，Button 自带的左右 12px 内边距一占，名字只剩 67px，
   * 「DeepSeek」被截成「DeepSe…」（用户 2026-11-02 截图）。
   * 这里压到 6px，名字能完整放下；图标 14 + 间距 6 + 名字 82 + 计数 12 正好 152。
   */
  padding-inline: 6px;
  color: var(--ui-ink-dim, #6b7280);
  font-size: 12px;
  text-align: left;
  transition: background 0.18s ease, color 0.18s ease;
}

.ac-rail-item:hover {
  background: var(--ui-hover, rgba(0, 0, 0, 0.05));
  color: var(--ui-ink, #374151);
}

.ac-rail-item[aria-pressed='true'] {
  background: var(--ui-panel, #fff);
  color: var(--ui-ink, #111827);
  font-weight: 600;
  box-shadow: var(--ui-shadow-sm, 0 1px 4px rgb(15 23 42 / 0.12));
}

.ac-rail-icon {
  display: grid;
  place-items: center;
  width: 14px;
  height: 14px;
  flex: none;
}

.ac-rail-brand {
  display: grid;
  place-items: center;
  width: 14px;
  height: 14px;
  flex: none;
}

.ac-rail-brand :deep(svg) {
  width: 14px;
  height: 14px;
}

.ac-rail-name {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.ac-rail-count {
  flex: none;
  font-size: 10px;
  font-weight: 600;
  color: var(--ui-ink-mute, #9ca3af);
}

.ac-split-main {
  display: flex;
  flex: 1;
  flex-direction: column;
  min-width: 0;
  min-height: 0;
}

.ac-split-scroll {
  flex: 1;
  min-height: 0;
  overflow-x: hidden;
  overflow-y: auto;
  padding: 10px 12px 12px;
  /* 两列各自是一条独立的滚动链：不继承外层、也不把滚动传回外层 */
  overscroll-behavior: contain;
  scrollbar-width: thin;
  scrollbar-color: var(--ui-scroll-thumb, rgba(0, 0, 0, 0.12)) transparent;
}

.ac-tile-top {
  display: flex;
  align-items: flex-start;
  gap: 4px;
}

.ac-pick-box {
  flex: none;
  /* 复选块：按钮尺寸由组件库 icon-xs 提供，这里只管方框描边与选中底色 */
  width: 20px;
  height: 20px;
  border: 1px solid var(--ui-line, rgba(0, 0, 0, 0.18));
  background: var(--ui-panel, #fff);
  color: var(--ui-panel, #fff);
  transition: background 0.18s ease, border-color 0.18s ease, transform 0.15s ease;
}

.ac-pick-box:hover {
  border-color: var(--ui-accent, #0891b2);
  transform: scale(1.04);
}

.ac-pick-box.is-sm {
  width: 17px;
  height: 17px;
  border-radius: 5px;
}

.ac-pick-box :deep(svg) {
  opacity: 0;
  transition: opacity 0.15s ease;
}

.ac-server-icon {
  display: grid;
  place-items: center;
  width: 30px;
  height: 30px;
  flex: none;
  border-radius: 9px;
  background: var(--ui-accent-soft, rgba(8, 145, 178, 0.1));
  color: var(--ui-accent-hover, #0e7490);
}

.ac-server-icon :deep(svg) {
  width: 16px;
  height: 16px;
}

.ac-server-copy {
  display: flex;
  flex-direction: column;
  gap: 1px;
  flex: 1;
  min-width: 0;
}

.ac-server-name {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font: 600 12px/1.4 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  color: var(--ui-ink, #111827);
}

.ac-server-desc {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 11px;
  color: var(--ui-ink-mute, #9ca3af);
}

.ac-server-side {
  display: flex;
  align-items: center;
  gap: 5px;
  flex: none;
}

.ac-status {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  height: 18px;
  padding: 0 6px;
  border-radius: 999px;
  background: var(--ui-veil, rgba(0, 0, 0, 0.04));
  color: var(--ui-ink-dim, #6b7280);
  font-size: 10px;
  font-weight: 600;
  white-space: nowrap;
}

.ac-status::before {
  content: '';
  width: 4px;
  height: 4px;
  border-radius: 50%;
  background: var(--ui-ink-mute, #9ca3af);
}

.ac-status.is-ok {
  background: var(--ui-accent-soft, rgba(8, 145, 178, 0.09));
  color: var(--ui-accent-hover, #0e7490);
}

.ac-status.is-ok::before {
  background: var(--ui-accent, #0891b2);
}

.ac-status.is-bad {
  background: var(--ui-warn-soft, rgba(245, 158, 11, 0.14));
  color: var(--ui-warn, #b45309);
}

.ac-status.is-bad::before {
  background: var(--ui-warn, #b45309);
}

.ac-expand-btn {
  display: grid;
  place-items: center;
  width: 22px;
  height: 22px;
  flex: none;
  border: 0;
  border-radius: 6px;
  background: transparent;
  color: var(--ui-ink-mute, #9ca3af);
  cursor: pointer;
}

.ac-expand-btn:hover {
  background: var(--ui-veil, rgba(0, 0, 0, 0.04));
  color: var(--ui-ink, #111827);
}

.ac-expand-btn :deep(svg) {
  transition: transform 0.18s var(--ui-ease-back, cubic-bezier(0.34, 1.56, 0.64, 1));
}

.ac-expand-btn :deep(svg.is-open) {
  transform: rotate(180deg);
}

.ac-selection-summary {
  display: flex;
  align-items: center;
  gap: 5px;
  flex: 1;
  min-width: 0;
  color: var(--ui-ink-dim, #6b7280);
  font-size: 11px;
  line-height: 1.35;
}

.ac-selected-number {
  color: var(--ui-ink, #111827);
  font-size: 12px;
  font-weight: 700;
}

.ac-confirm-btn {
  flex: none;
  background: var(--ui-accent, #0891b2);
  /* 主题色白名单: 强调色实心按钮上的白字，任何强调色下都要最高对比 */
  color: #fff;
  font-weight: 700;
}

.ac-confirm-btn:hover:not(:disabled) {
  background: var(--ui-accent-hover, #0e7490);
}

.ac-confirm-btn:active:not(:disabled) {
  transform: scale(0.97);
}

.ac-confirm-btn:disabled {
  opacity: 0.45;
  cursor: default;
}

@container (max-width: 469px) {
  .ac-panel-head-top {
    grid-template-columns: minmax(0, 1fr) auto;
  }
}

@container (max-width: 540px) {
  .ac-detect-label {
    display: none;
  }

  .ac-detect-btn {
    width: 32px;
    padding: 0;
  }
}

@container (max-width: 386px) {
  .ac-panel-tools {
    gap: 4px;
  }

  .ac-panel-head {
    padding-left: 10px;
    padding-right: 10px;
  }
}

@container (max-width: 460px) {
  .ac-split {
    flex-direction: column;
  }

  .ac-split-rail {
    width: auto;
    flex: none;
    border-right: 0;
    border-bottom: 1px solid var(--ui-line-soft, rgba(0, 0, 0, 0.06));
  }

  .ac-rail-label {
    display: none;
  }

  .ac-rail-scroll {
    flex-direction: row;
    gap: 5px;
    overflow-x: auto;
    overflow-y: hidden;
    padding: 7px 10px;
  }

  /* 窄容器是横向滚动的胶囊条：这里保留 8px 内边距，不要被竖排那档的 6px 覆盖。 */
  html[data-mct-size] .ac-split .ac-rail-item {
    width: auto;
    height: 30px;
    flex: none;
    gap: 5px;
    padding: 0 8px;
    border: 1px solid var(--ui-line, rgba(0, 0, 0, 0.08));
    border-radius: 7px;
    background: var(--ui-panel, #fff);
  }

  .ac-rail-icon,
  .ac-rail-brand {
    width: 13px;
    height: 13px;
  }

  .ac-rail-brand :deep(svg) {
    width: 13px;
    height: 13px;
  }

  .ac-rail-count {
    display: none;
  }

  .ac-rail-item[aria-pressed='true'] {
    border-color: var(--ui-accent-line, rgba(8, 145, 178, 0.28));
    background: var(--ui-accent-soft, rgba(8, 145, 178, 0.1));
    color: var(--ui-accent-hover, #0e7490);
    box-shadow: none;
  }

  .ac-split-scroll {
    padding: 9px 10px 10px;
  }

  .ac-skill-grid--split {
    grid-template-columns: repeat(auto-fill, minmax(min(100%, 154px), 1fr));
  }
}

@container (max-width: 360px) {
  .ac-panel-head-top {
    gap: 5px;
  }

  .ac-panel-title {
    font-size: 14px;
  }

  .ac-panel-count {
    display: none;
  }

  .ac-skill-grid,
  .ac-model-grid,
  .ac-skill-grid--split {
    grid-template-columns: 1fr;
  }

  .ac-mcp-card {
    gap: 5px;
    padding: 7px 6px;
  }

  .ac-mcp-card .ac-server-icon {
    display: none;
  }

  .ac-server-side .ac-badge {
    display: none;
  }

  .ac-panel-foot {
    padding-left: 10px;
    padding-right: 10px;
  }
}
</style>

<style>
/* 编辑器最小高度：库默认 120px（.prose-mirror-editor .ProseMirror 与它的一层 wrapper），
   照参考页实测应是 64px（min-height 4rem）—— 不压下来的话整块输入区比目标高 56px。
   只作用在 Agent 面板内（都挂在 .ac-editor 下），不影响底栏等其它调用方。 */
.ac-editor .prose-mirror-editor .ProseMirror,
.ac-editor .prose-mirror-editor>div:first-child {
  min-height: 64px;
}

.prose-mirror-editor .ac-tag {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  /* 名字可能非常长（技能 / MCP / 节点名都没有长度上限）：限宽收住，
     否则一颗标签就能把整行撑出输入框（用户口径 2026-10-11）。
     200px 的取法：一颗标签最多占输入框（约 364px）一半多点，
     同一行还能并排放下第二颗；再宽就在窄面板里顶出去了。 */
  max-width: 200px;
  height: 22px;
  padding: 0 6px 0 4px;
  margin: 0 2px;
  border-radius: 6px;
  /* 与已发送标签同款底色（--ui-hover-strong）：亮暗各一档，比旧的 --ui-hover-soft 明显（用户口径 2026-10-06） */
  background: var(--ui-hover-strong, rgb(0 0 0 / 0.10));
  vertical-align: bottom;
  user-select: none;
  cursor: pointer;
}

/* 编辑器给资源节点默认画一条下划线（.resource-node 的 border-bottom），那是给"文字引用"用的。
   我们的标签自带底色块，再叠一条下划线就成了"带线的胶囊"（实测参考图里没有线）。
   用 .resource-node 一起限定，靠更高的选择器权重压过后加载的库样式。 */
.prose-mirror-editor .ac-tag.resource-node {
  border-bottom: 0;
  padding: 0 6px 0 4px;
  height: 22px;
}

.prose-mirror-editor .ac-tag .ac-tag-icon {
  display: grid;
  place-items: center;
  flex: none;
  color: var(--ui-ink-dim, #919191);
}

.prose-mirror-editor .ac-tag .ac-tag-icon svg {
  width: 13px;
  height: 13px;
}

/* 图标固定、名字让位：`min-width: 0` 不能省 —— flex 子项的默认 min-width 是「内容宽」，
   只写 max-width 的话它会把标签顶回去，省略号永远不出现。 */
.prose-mirror-editor .ac-tag .ac-tag-label {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 12px;
  font-weight: 500;
  line-height: 1;
  color: var(--ui-ink, #f7f7f7);
}

.prose-mirror-editor .ProseMirror-selectednode.ac-tag,
.prose-mirror-editor .ac-tag.resource-node-selected {
  background: var(--ui-accent, #0891b2);
}

.prose-mirror-editor .ProseMirror-selectednode.ac-tag .ac-tag-label,
.prose-mirror-editor .ac-tag.resource-node-selected .ac-tag-label {
  color: var(--ui-on-accent, #fff);
}

.prose-mirror-editor .ProseMirror-selectednode.ac-tag .ac-tag-icon,
.prose-mirror-editor .ac-tag.resource-node-selected .ac-tag-icon {
  color: var(--ui-on-accent, #fff);
}

/* @ 菜单里的行（富行外观与工具栏下拉保持一致） */
/* @ 行：默认只显示**名称**一行；hover / 键盘选中时描述行展开（多出一行，行高自然撑开）。
   描述不再常显 —— 常显会把每行都拉成两行，列表看着发灰又挤（用户口径）。 */
.mention-menu .ac-mrow {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
}

.mention-menu .ac-mrow-icon {
  display: grid;
  place-items: center;
  flex: none;
  width: 24px;
  height: 24px;
  border-radius: 6px;
  background: var(--ui-chip, rgb(255 255 255 / 0.1));
  color: var(--ui-ink, #f7f7f7);
}

.mention-menu .ac-mrow-icon svg {
  width: 14px;
  height: 14px;
}

.mention-menu .ac-mrow-text {
  display: flex;
  flex-direction: column;
  flex: 1;
  min-width: 0;
}

/* 名字超长时单行省略：不省略的话行会被名字撑宽（浮层跟着变长），
   而在窄屏上触发翻边后名字又会把描述行挤没（用户口径 2026-10-11）。 */
.mention-menu .ac-mrow-name {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 13px;
  line-height: 18px;
  color: var(--ui-ink, #f7f7f7);
}

/* 描述行：默认高度收起（0），hover/active 展开 —— 行高跟着**平滑过渡**，不是啪一下跳出来。
   为什么不用 display:none：display 不参与过渡（none ↔ block 之间没有中间态），
   展开只能是一瞬间的跳变（用户实测报的：「高度变化很突兀」）。
   改成 max-height + opacity 就可以插值；overflow:hidden 让文字在展开过程中被裁切着露出来。 */
.mention-menu .ac-mrow-hint {
  max-height: 0;
  opacity: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 11px;
  line-height: 16px;
  color: var(--ui-ink-dim, #919191);
  transition: max-height 0.18s ease, opacity 0.18s ease;
}

.mention-menu .menu-item:hover .ac-mrow-hint,
.mention-menu .menu-item.active .ac-mrow-hint {
  max-height: 16px;
  opacity: 1;
}

@media (prefers-reduced-motion: reduce) {
  .mention-menu .ac-mrow-hint {
    transition: none;
  }
}
</style>

<script setup lang="ts">
/**
 * AgentMessageList —— 对话消息流（含空态、工具块、审批、分页器、常驻提示）。
 *
 * 纯拆分：模板与 class / 文案 / 事件原样保留；状态来自同一个
 * useAgentConversation 控制器（入口 provide）。
 */
import { inject, nextTick, onMounted, ref, watch } from 'vue'
import { useUiComponent } from '@mini-canvas/canvas-render'
import AgentMarkdown from '../render/AgentMarkdown.vue'
import ToolViewBody from '../render/ToolViewBody.vue'
import AgentScrollArea from './AgentScrollArea.vue'
// AI Elements 本地件（vendored shadcn-vue）：只取消息轮次容器与内容格。
// 为什么走相对路径：这是插件专属组件，不进全局注册表（见 ui/ai-elements/README）。
import { Message as AiMessage, MessageContent, MessageFooter } from '../ai-elements/message'
// AI Elements Trace：思考行 / 工具行 / 工具分组的可折叠结构（文档 Task / Tool Demo 同款）
import {
  Trace, TraceCollapsible, TraceCollapsibleTrigger, TraceCollapsibleContent,
  TraceLine, TraceTitle, TraceDescription,
} from '../ai-elements/trace'
// TraceIcon 在 TraceCollapsibleTrigger 里已内置折叠箭头；行内状态图标用 TraceIcon + lucide
import { TraceIcon } from '../ai-elements/trace'
import { X, Loader2, LoaderCircle, Sparkles, Box, ChevronDown, ChevronLeft, ChevronRight, ChevronUp, CircleCheck, Copy, Pencil, CircleSlash, Minimize2, AlertCircle } from 'lucide-vue-next'
import type { AgentConversationController } from './useAgentConversation'

const c = inject('agentConversation') as unknown as Record<string, any>
const {
  agent, s, showScrollToBottom, smoothScrollToBottom, scroller, earlierSentinel,
  hintDismissed, dismissHint, SUGGESTIONS, useSuggestion,
  segmentByAnchor, segmentModelLabel, assistantRows, openThinking,
  hasCardView, viewOf, previewToolMedia,
  toolGroupTitle, toolRowSummary, toolTitle, thinkingLive, userSegments, displayUserText, onSegClick, segTitle, segClickable,
  openUserBubbles, overflowingUser, toggleUserBubble, setUserBubbleBody, msgTimeText, msgTimeTitle,
  copied, copyMessage, beginEditMessage, hasInlineError, pagerByAnchor, pagerTarget,
  SHOW_PROCESS_NOTICE, openPreview, showPendingOn,
} = c

const Button = useUiComponent('Button')
// 加载指示用组件库的 Spinner（shadcn 原生，转圈动画在组件里）
const Spinner = useUiComponent('Spinner')
// 全局 shadcn 原语（Bubble）：用户气泡的视觉壳，与文档 Demo 的 Message align="end" + Bubble 同款
const Bubble = useUiComponent('Bubble')
const BubbleContent = useUiComponent('BubbleContent')

/**
 * 消息流滚动层：换成组件库的 ScrollArea（用户口径 2026-11-04）。
 * 吸底、触底加载、位置恢复都直接读 ref="scroller" 的那个真实滚动元素，
 * 所以这里把它接到 AgentScrollArea 暴露的 scrollElement() 上。
 */
const scrollRef = ref<InstanceType<typeof AgentScrollArea> | null>(null)

function syncScroller(): void {
  const el = scrollRef.value?.scrollElement() ?? null
  if (el !== scroller.value) scroller.value = el
}

onMounted(() => {
  syncScroller()
  void nextTick(syncScroller)
})
watch(scrollRef, () => void nextTick(syncScroller), { flush: 'post' })
</script>

<template>
  <div class="ac-scroll-wrap">
      <!-- 「回到底部」（用户口径 2026-10-09）：放在**消息区内部、底部居中**。
         有滚动条且未滚到底时才出现（原语义不变）。 -->
      <Button v-if="showScrollToBottom" variant="ghost" size="icon-sm" class="ac-to-bottom" aria-label="回到底部" title="回到底部"
        @click="smoothScrollToBottom()">
        <ChevronDown :size="16" />
      </Button>
      <AgentScrollArea ref="scrollRef" class="ac-scroll" body-class="ac-scroll-body">
        <!-- 稳定的**内容容器**：空态与消息流都在它里面。
           为什么必须有一层稳定的壳：ResizeObserver 只能盯住一个具体的 DOM 节点，
           而空态与消息流是 v-if/v-else 互换的（挂载时看到的那个节点随后会被换掉），
           盯它就会盯到已被丢弃的节点上 —— 内容再长也不触发。 -->
        <div class="ac-inner">
          <!-- 更早历史的加载哨兵（用户口径 2026-10-15）：对话只先装最后三四轮，
               滚到顶、这个元素进入可视区域才拉更早的（每次之间有最小间隔）。
               可视化元素：加载中显示转圈文案，还有更早但没加载时给一条淡提示。 -->
          <div v-if="s.turns.length && (s.turnsHaveBefore || s.turnsLoadingEarlier)" ref="earlierSentinel"
            class="ac-earlier" role="status">
            <span v-if="s.turnsLoadingEarlier" class="ac-earlier-loading">
              <Loader2 :size="13" class="ac-spin" />
              <span>正在加载更早的对话…</span>
            </span>
            <span v-else class="ac-earlier-hint">向上滚动查看更早的对话</span>
          </div>
          <!-- 空态：中心欢迎 + 三行建议（照参考图） -->
          <div v-if="!s.turns.length" class="ac-welcome">
            <div v-if="!hintDismissed" class="ac-hint-card">
              <p class="ac-hint-text"><strong>我能帮你做很多事</strong>，比如回答问题、写文章、编剧本、生成图片/视频/音频…</p>
              <Button variant="ghost" size="icon-sm" class="ac-hint-close" aria-label="我知道了" @click="dismissHint">
                <X :size="13" />
              </Button>
            </div>
            <div class="ac-welcome-orb"></div>
            <p class="ac-welcome-title">让 Agent 辅助你的无限创意</p>
            <div class="ac-suggestions">
              <Button v-for="g in SUGGESTIONS" :key="g.text" variant="ghost" size="sm" class="ac-suggestion" @click="useSuggestion(g.text)">
                <component :is="g.icon" :size="15" />
                <span>{{ g.text }}</span>
                <ChevronRight :size="14" class="ac-suggestion-arrow" />
              </Button>
            </div>
          </div>

          <template v-for="t in s.turns" :key="t.id">
            <!-- 模型分割线（用户口径 2026-10-11）：切换模型 = 换一条会话（SDK 的模型钉在会话上），
             所以在"这边的第一句话"之前横一条线，标明这一段用的是哪个模型。
             div 不能省：用 template 包两层兄弟节点时 v-for 的 key 会落到顶层节点上，
             而分割线要先于消息渲染。 -->
            <div v-if="segmentByAnchor.get(t.id)" class="ac-model-split" role="separator"
              :aria-label="'从这里开始使用模型 ' + segmentModelLabel(segmentByAnchor.get(t.id)!)">
              <span class="ac-model-split-line"></span>
              <span class="ac-model-split-badge">
                <Box :size="12" />
                <span class="ac-model-split-name">{{ segmentModelLabel(segmentByAnchor.get(t.id)!) }}</span>
              </span>
              <span class="ac-model-split-line"></span>
            </div>
            <!-- 审批卡片：**只在等你决定时出现**。点过允许/拒绝之后这张卡就消失
             （用户口径：「都授权了 就不显示」）—— 已经放行、工具也跑完了，
             再挂一张「已允许」的死卡片只是挡着看下面的内容。 -->
            <div v-if="t.kind === 'approval' && !t.approval?.decision" class="ac-approval">
              <div class="ac-approval-head">
                <Loader2 :size="14" class="ac-spin" />
                <strong>需要审批：{{ t.approval?.toolName }}</strong>
              </div>
              <pre class="ac-approval-args">{{ t.approval?.arguments }}</pre>
              <div class="ac-approval-actions">
                <Button size="sm" @click="agent.decide(t.approval!.id, 'allow')">允许</Button>
                <Button variant="ghost" size="sm" @click="agent.decide(t.approval!.id, 'deny')">拒绝</Button>
              </div>
            </div>

            <!-- 用户靠右 / 助手靠左（照参考图，都没有头像）。
             外壳换成本地 AI Elements 的 Message（对话轮次容器，align 端对齐），
             class 与编辑态挂法不变（合同测试照旧钉住）。 -->
            <AiMessage v-else :align="t.kind === 'user' ? 'end' : 'start'" :class="['ac-msg', t.kind, { 'is-editing': t.editing }]">
              <MessageContent :class="t.kind === 'user' ? 'ac-bubble' : 'ac-bubble ac-bubble--full'">
                <!-- 助手内容**按到达顺序**逐块渲染（用户口径 2026-10-05）：
                 文字一段、中间没有文字隔开的多个工具合并成一组、再一段文字。
                 以前这里是「先把所有工具画完、再画正文」，所以工具永远堆在最上面、看不出时序。
                 注意：思考现在也是分界线（用户口径 2026-10-16）：每段思考按发生位置
                 原位渲染成折叠行（thinking 行），不再统一堆到顶部。 -->
                <template v-for="row in assistantRows(t)" :key="row.key">
                  <AgentMarkdown v-if="row.type === 'text' && row.text" :text="row.text" />

                  <!-- 原位思考折叠行（AI Elements Trace 结构，文档 Task Demo 同款）：
                       收起 = TraceCollapsibleTrigger + TraceLine「思考过程」；
                       展开 = TraceCollapsibleContent 内 pre（等宽、上限内滚动）。 -->
                  <Trace v-else-if="row.type === 'thinking' && row.text">
                    <TraceCollapsible
                      :open="thinkingLive(t) || !!openThinking[t.id + ':' + row.key]"
                      :unmount-on-hide="false"
                      @update:open="(v) => { if (!thinkingLive(t)) openThinking[t.id + ':' + row.key] = v }">
                     <TraceCollapsibleTrigger>
                      <TraceLine>
                        <TraceIcon>
                          <LoaderCircle v-if="thinkingLive(t)" :size="14" class="animate-spin" />
                          <CircleCheck v-else :size="14" />
                        </TraceIcon>
                        <TraceTitle>{{ thinkingLive(t) ? '正在思考' : '思考过程' }}</TraceTitle>
                      </TraceLine>
                    </TraceCollapsibleTrigger>
                    <TraceCollapsibleContent>
                      <div class="max-h-[min(360px,50vh)] overflow-y-auto whitespace-pre-wrap wrap-break-word">{{ row.text }}</div>
                    </TraceCollapsibleContent>
                    </TraceCollapsible>
                  </Trace>

                  <!-- 单工具：**只有带自定义卡片的画布 MCP 工具**才直接展示卡片；
                   其余全部走默认折叠行（用户口径 2026-10-10：审批有自己的卡片 UI，
                   不该给底层工具再打「卡片」标记把它顶成常驻展开 —— exec_command 这类
                   要恢复成折叠行，对齐 docs/tmp/tool-card-demo-v3.html 的做法）。 -->
                  <template v-else-if="row.type === 'tools' && row.tools.length === 1 && hasCardView(row.tools[0])">
                    <div class="ac-tool-card">
                      <!-- 运行中才给一行转圈（卡片还没内容时的进度指示）。
                       跑完就整行收掉：卡片自己的头行（图标 + 标题 + 角标）已经是头部，
                       再叠一行摘要（如「+1 ~ 0 -0」）与下面的「1 新增 / 0 更新 / 0 删除」纯属重复
                       （用户口径 2026-10-10：删掉那行没意义的文字）。 -->
                      <div v-if="!row.tools[0].settled" class="ac-tool-head">
                        <Loader2 :size="13" class="ac-spin" />
                      </div>
                      <ToolViewBody :view="viewOf(row.tools[0])" :args="row.tools[0].arguments"
                        :output="row.tools[0].output" :name="row.tools[0].name" @preview="previewToolMedia" />
                    </div>
                  </template>
                  <!-- 默认工具（通用）：AI Elements Trace 折叠行 —— 收起 = 图标 + 工具名 + 摘要；
                       展开区 = ToolViewBody（输入 / 输出），右侧摘要用 TraceDescription 语义。 -->
                  <Trace v-else-if="row.type === 'tools' && row.tools.length === 1">
                    <TraceCollapsible>
                      <TraceCollapsibleTrigger>
                        <TraceLine>
                        <TraceIcon>
                          <LoaderCircle v-if="!row.tools[0].settled" :size="14" class="animate-spin" />
                          <CircleCheck v-else :size="14" />
                        </TraceIcon>
                        <TraceTitle>{{ toolTitle(row.tools[0]) }}</TraceTitle>
                          <TraceDescription v-if="toolRowSummary(row.tools[0])">{{ toolRowSummary(row.tools[0]) }}</TraceDescription>
                        </TraceLine>
                      </TraceCollapsibleTrigger>
                      <TraceCollapsibleContent>
                        <ToolViewBody :view="viewOf(row.tools[0])" :args="row.tools[0].arguments"
                          :output="row.tools[0].output" :name="row.tools[0].name" @preview="previewToolMedia" />
                      </TraceCollapsibleContent>
                    </TraceCollapsible>
                  </Trace>

                  <!-- 多个工具：AI Elements Trace 折叠组（文档 Task Demo 的嵌套 TraceCollapsible）——
                       收起 = 组标题一行；展开 = 逐个工具（卡片直接出 / 其余再套一层 Trace 折叠行）。 -->
                  <Trace v-else-if="row.type === 'tools'">
                    <TraceCollapsible>
                      <TraceCollapsibleTrigger>
                        <TraceLine>
                        <TraceIcon>
                          <LoaderCircle v-if="row.tools.some((x) => !x.settled)" :size="14" class="animate-spin" />
                          <CircleCheck v-else :size="14" />
                        </TraceIcon>
                        <TraceTitle>{{ toolGroupTitle(row.tools) }}</TraceTitle>
                        </TraceLine>
                      </TraceCollapsibleTrigger>
                      <TraceCollapsibleContent>
                        <template v-for="tool in row.tools" :key="tool.id">
                          <!-- 有卡片（画布 MCP）→ 直接展示；其余（含要审批的默认工具）→ Trace 折叠行 -->
                          <div v-if="hasCardView(tool)" class="ac-tool-card">
                            <div v-if="!tool.settled" class="ac-tool-head">
                              <Loader2 :size="13" class="ac-spin" />
                            </div>
                            <ToolViewBody :view="viewOf(tool)" :args="tool.arguments" :output="tool.output"
                              :name="tool.name" @preview="previewToolMedia" />
                          </div>
                          <TraceCollapsible v-else>
                            <TraceCollapsibleTrigger>
                              <TraceLine>
                          <TraceIcon>
                            <LoaderCircle v-if="!tool.settled" :size="14" class="animate-spin" />
                            <CircleCheck v-else :size="14" />
                          </TraceIcon>
                          <TraceTitle>{{ toolTitle(tool) }}</TraceTitle>
                                <TraceDescription v-if="toolRowSummary(tool)">{{ toolRowSummary(tool) }}</TraceDescription>
                              </TraceLine>
                            </TraceCollapsibleTrigger>
                            <TraceCollapsibleContent>
                              <ToolViewBody :view="viewOf(tool)" :args="tool.arguments" :output="tool.output"
                                :name="tool.name" @preview="previewToolMedia" />
                            </TraceCollapsibleContent>
                          </TraceCollapsible>
                        </template>
                      </TraceCollapsibleContent>
                    </TraceCollapsible>
                  </Trace>
                </template>

                <!-- 用户消息：把正文里出现的 @技能 / @MCP 还原成**标签**（与输入框里那颗 chip 同款），
                 其余文字照常显示。为什么不直接存结构化引用：会话历史里只有纯文本（后端只存
                 getPlainText 的结果），靠"@名字 + 已装清单"回推，刷新/切会话也得到同一份渲染。 -->
                <!-- 默认只显示前 8 行（用户口径 2026-10-15）：长消息夹在 max-height 里，
                 超出的内容点左下角「展开」再看；收起按钮原地换「收起」。 -->
                <template v-if="t.kind === 'user'">
                  <!-- 文档 Demo 结构：Bubble variant="muted" align="end" 包 BubbleContent -->
                  <Bubble align="end" variant="muted" :class="['ac-user-bubble', { 'ac-user-bubble--editing': t.editing }]">
                    <BubbleContent class="ac-user-bubble-content">
                      <p v-if="t.text" class="ac-user-line" :ref="setUserBubbleBody(t.id)"
                        :class="{ 'is-open': openUserBubbles[t.id] }">
                        <!-- user_steering 块（后台队列自动发的）剥掉标记只显示内文（用户口径 2026-10-15） -->
                        <template v-for="(seg, si) in userSegments(displayUserText(t.text))" :key="si">
                          <!-- 节点标签**可点击聚焦**（节点存在且没被删时）：与输入框里的标签同一交互。
                           用户口径 2026-10-06：对话里出现的节点标签也要能点。 -->
                          <span v-if="seg.type === 'tag'" class="ac-sent-tag"
                            :class="{ 'is-clickable': segClickable(seg) }" :title="segTitle(seg)"
                            :role="segClickable(seg) ? 'button' : undefined"
                            :tabindex="segClickable(seg) ? 0 : undefined" @click="onSegClick(seg)"
                            @keydown.enter.prevent="onSegClick(seg)">
                            <span class="ac-sent-tag-icon" v-html="seg.icon" aria-hidden="true"></span>
                            <span class="ac-sent-tag-label">{{ seg.name }}</span>
                          </span>
                          <span v-else class="ac-user-text">{{ seg.value }}</span>
                        </template>
                      </p>
                      <Button v-if="overflowingUser[t.id]" variant="ghost" size="xs" class="ac-user-toggle"
                        :aria-expanded="!!openUserBubbles[t.id]" aria-label="展开完整消息"
                        :title="openUserBubbles[t.id] ? '收起' : '展开'" @click="toggleUserBubble(t.id)">
                        {{ openUserBubbles[t.id] ? '收起' : '展开' }}
                        <ChevronDown v-if="!openUserBubbles[t.id]" :size="13" />
                        <ChevronUp v-else :size="13" />
                      </Button>
                      <!-- 「正在编辑」徽标（用户口径 2026-10-06）：在气泡内部显示 -->
                      <span v-if="t.editing" class="ac-editing-badge" role="status">
                        <Pencil :size="12" />正在编辑
                        <Button variant="ghost" size="icon-xs" class="ac-editing-x" aria-label="取消编辑" @click="agent.cancelEdit()">
                          <X :size="11" />
                        </Button>
                      </span>
                    </BubbleContent>
                  </Bubble>
                </template>
                <!-- 用户消息带的图：按原比例排一行缩略图，点开看大图 -->
                <div v-if="t.kind === 'user' && t.images?.length" class="ac-user-images">
                  <Button v-for="(src, ii) in t.images" :key="ii" variant="ghost" size="icon-sm" class="ac-user-image" :aria-label="'查看图片 ' + (Number(ii) + 1)"
                    @click="openPreview(src, t.images)">
                    <img :src="src" alt="" />
                  </Button>
                </div>
                <!-- 助手消息才走 Markdown。
                 这里**必须**是独立的 v-if，不能接在用户那条的 v-else-if 链上：
                 中间隔着「用户图片」那个 div 时，链会被打断，导致用户消息既渲染标签行、
                 又再渲染一遍原始 Markdown 文本（实测文本重复出现两次，还带出字面 @名字）。 -->
                <!-- 「正在思考」就是个**加载指示**：显示依据 = 输入框按钮的「停止」状态
                 （s.running，用户口径 2026-10-16 二次澄清：按钮状态就是加载状态）。
                 与 t.streaming 解耦：streaming 标记会被 hub 重放/收尾逻辑翻转，
                 而 s.running 由后端 run_state 驱动、刷新后由 openSession 恢复，是唯一真相。 -->
                <!-- 加载行（用户口径 2026-11-05）：用 AI Elements 的 Trace 行，
                     与官方 "Researching" 同款 —— 图标转圈 + 文字用 shimmer 动效。
                     只有这一轮还没出正文时才显示（思考块已经在上面时不再叠一行）。 -->
                <Trace v-if="showPendingOn(t) && !thinkingLive(t)" role="status" aria-live="polite">
                  <TraceLine status="running">
                    <TraceIcon><Spinner class="size-4" /></TraceIcon>
                    <TraceTitle>正在思考</TraceTitle>
                  </TraceLine>
                </Trace>
                <!-- 用户按了终止（用户口径 2026-10-16：对话里要有表示，不能静默收场） -->
                <p v-if="t.aborted" class="ac-stopped" role="status">
                  <CircleSlash :size="13" aria-hidden="true" />
                  <span>已停止</span>
                </p>
                <!-- 过程提示（主要是「已连接 MCP：smart(3 个工具)」这类）**暂时隐藏**。
                 用户口径：不要删除，只是先不显示 —— 每次对话都冒一条、又说不清什么时候会出现，
                 反而干扰阅读；MCP 的真实状态改在下拉里实时看（见 MCP 下拉里的「检测」）。
                 数据仍在 turn.notice 上，想放回来把 SHOW_PROCESS_NOTICE 改 true 即可。 -->
                <p v-if="SHOW_PROCESS_NOTICE && t.notice" class="ac-notice">{{ t.notice }}</p>
                <template v-if="t.error">
                  <p class="ac-error">{{ t.error }}</p>
                </template>
              <!-- hover 操作条（文档 Demo 的 MessageFooter 语义：时间/复制/编辑贴着消息下方，
               右对齐跟气泡同侧）。编辑 = 把这条消息回填到底部输入框。 -->
              <MessageFooter v-if="t.kind === 'user'" class="ac-msg-actions">
                <span class="ac-msg-time" :title="msgTimeTitle(t.ts)">{{ msgTimeText(t.ts) }}</span>
                <Button variant="ghost" size="icon-xs" class="ac-msg-btn" :aria-label="copied[t.id] ? '已复制' : '复制消息'" title="复制"
                  @click="copyMessage(t.text, t.id)">
                  <CircleCheck v-if="copied[t.id]" :size="13" class="is-ok" />
                  <Copy v-else :size="11" />
                </Button>
                <Button variant="ghost" size="icon-xs" class="ac-msg-btn" aria-label="编辑消息（回填到输入框）" title="编辑" @click="beginEditMessage(t)">
                  <Pencil :size="11" />
                </Button>
              </MessageFooter>
              </MessageContent>
            </AiMessage>
            <!-- 内联分支分页器（用户口径 2026-10-07）：跟随消息 —— 渲染在这条消息的
             回复块结束处（下一条用户消息之前）。左右箭头切的是**这个位置**的其它版本，
             切过去后不含当前版本后来的消息。 -->
            <div v-if="pagerByAnchor.get(t.id)" class="ac-branch-nav" role="navigation" aria-label="切换分支版本">
              <Button variant="ghost" size="icon-sm" class="ac-branch-arrow" :disabled="pagerByAnchor.get(t.id)!.index <= 0" aria-label="上一个版本"
                title="上一个版本"
                @click="pagerTarget(pagerByAnchor.get(t.id)!, -1) !== null && agent.openSession(pagerTarget(pagerByAnchor.get(t.id)!, -1)!)">
                <ChevronLeft :size="14" />
              </Button>
              <span class="ac-branch-pos" :title="pagerByAnchor.get(t.id)!.items[pagerByAnchor.get(t.id)!.index].label">
                {{ pagerByAnchor.get(t.id)!.position }} / {{ pagerByAnchor.get(t.id)!.total }}
              </span>
              <Button variant="ghost" size="icon-sm" class="ac-branch-arrow"
                :disabled="pagerByAnchor.get(t.id)!.index >= pagerByAnchor.get(t.id)!.total - 1" aria-label="下一个版本"
                title="下一个版本"
                @click="pagerTarget(pagerByAnchor.get(t.id)!, 1) !== null && agent.openSession(pagerTarget(pagerByAnchor.get(t.id)!, 1)!)">
                <ChevronRight :size="14" />
              </Button>
            </div>
          </template>
          <!-- 压缩进度 / 结果（用户口径 2026-10-11）：压缩要跑一次模型，几十秒内必须有回音。
           放在消息流末尾而不是顶部：它是"刚发生的事"，跟着最新内容一起看最自然。 -->
          <div v-if="s.compacting" class="ac-compact-note" role="status" aria-live="polite">
            <Loader2 :size="13" class="ac-spin" />
            <span>正在压缩上下文…</span>
          </div>
          <div v-else-if="s.compactNotice" class="ac-compact-note" role="status">
            <Minimize2 :size="14" />
            <span>{{ s.compactNotice }}</span>
            <Button variant="ghost" size="icon-xs" class="ac-note-x" aria-label="知道了" @click="s.compactNotice = ''">
              <X :size="12" />
            </Button>
          </div>
          <!-- 常驻错误条（用户口径 2026-10-11 的问题 2）：这一轮失败时**必须**看得见。
           为什么要一条独立的条：错误以前只挂在"最后一条助手消息"上 —— 出错时若那条
           还没建出来（请求在 bootstrap 阶段就失败），错误就落在空气里，用户什么也看不到。
           若这条错误已经挂在某条消息上（不重复显示），这条就不画。 -->
          <div v-if="s.lastError && !hasInlineError" class="ac-error-bar" role="alert">
            <AlertCircle :size="14" class="ac-error-bar-icon" />
            <span class="ac-error-bar-text">{{ s.lastError }}</span>
            <Button variant="ghost" size="icon-xs" class="ac-note-x" aria-label="关闭错误提示" @click="s.lastError = ''">
              <X :size="12" />
            </Button>
          </div>
        </div>
      </AgentScrollArea>
    </div>
</template>

<style scoped src="./AgentMessageList.css"></style>

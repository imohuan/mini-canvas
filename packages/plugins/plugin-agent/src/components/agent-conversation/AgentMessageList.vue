<script setup lang="ts">
/**
 * AgentMessageList —— 对话消息流（含空态、工具块、审批、分页器、常驻提示）。
 *
 * 纯拆分：模板与 class / 文案 / 事件原样保留；状态来自同一个
 * useAgentConversation 控制器（入口 provide）。
 */
import { inject } from 'vue'
import { useUiComponent } from '@mini-canvas/canvas-render'
import AgentMarkdown from '../AgentMarkdown.vue'
import ToolViewBody from '../ToolViewBody.vue'
import { X, Loader2, Sparkles, Box, ChevronDown, ChevronLeft, ChevronRight, ChevronUp, CircleCheck, Copy, Pencil, CircleSlash, Minimize2, AlertCircle } from 'lucide-vue-next'
import type { AgentConversationController } from './useAgentConversation'

const c = inject('agentConversation') as unknown as Record<string, any>
const {
  agent, s, showScrollToBottom, smoothScrollToBottom, scroller, earlierSentinel,
  hintDismissed, dismissHint, SUGGESTIONS, useSuggestion,
  segmentByAnchor, segmentModelLabel, assistantRows, openThinking, toggleThinking,
  hasCardView, viewOf, previewToolMedia, openTools, openToolGroups, toggleTool, toggleToolGroup,
  toolGroupTitle, toolRowSummary, userSegments, displayUserText, onSegClick, segTitle, segClickable,
  openUserBubbles, overflowingUser, toggleUserBubble, setUserBubbleBody, msgTimeText, msgTimeTitle,
  copied, copyMessage, beginEditMessage, hasInlineError, pagerByAnchor, pagerTarget,
  SHOW_PROCESS_NOTICE, openPreview, showPendingOn,
} = c

const Button = useUiComponent('Button')
</script>

<template>
  <div class="ac-scroll-wrap">
      <!-- 「回到底部」（用户口径 2026-10-09）：放在**消息区内部、底部居中**。
         有滚动条且未滚到底时才出现（原语义不变）。 -->
      <Button v-if="showScrollToBottom" variant="ghost" size="icon-sm" class="ac-to-bottom" aria-label="回到底部" title="回到底部"
        @click="smoothScrollToBottom()">
        <ChevronDown :size="16" />
      </Button>
      <div ref="scroller" class="ac-scroll" role="log" aria-live="polite">
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

            <!-- 用户靠右 / 助手靠左（照参考图，都没有头像） -->
            <div v-else class="ac-msg" :class="[t.kind, { 'is-editing': t.editing }]">
              <div class="ac-bubble">
                <!-- 助手内容**按到达顺序**逐块渲染（用户口径 2026-10-05）：
                 文字一段、中间没有文字隔开的多个工具合并成一组、再一段文字。
                 以前这里是「先把所有工具画完、再画正文」，所以工具永远堆在最上面、看不出时序。
                 注意：思考现在也是分界线（用户口径 2026-10-16）：每段思考按发生位置
                 原位渲染成折叠行（thinking 行），不再统一堆到顶部。 -->
                <template v-for="row in assistantRows(t)" :key="row.key">
                  <AgentMarkdown v-if="row.type === 'text' && row.text" :text="row.text" />

                  <!-- 原位思考折叠行：这一段思考发生在它所处的位置（用户口径 2026-10-16） -->
                  <div v-else-if="row.type === 'thinking' && row.text" class="ac-think-inline">
                    <Button variant="ghost" size="xs" class="ac-think-toggle" @click="toggleThinking(t.id + ':' + row.key)">
                      <ChevronRight :size="12" :class="{ 'ac-rot': openThinking[t.id + ':' + row.key] }" />思考过程
                    </Button>
                    <pre v-if="openThinking[t.id + ':' + row.key]" class="ac-think">{{ row.text }}</pre>
                  </div>

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
                  <!-- 默认工具（通用）：折叠行 —— 收起 = 箭头 + 名字 + 摘要；展开 = 输入/输出 -->
                  <template v-else-if="row.type === 'tools' && row.tools.length === 1">
                    <div class="ac-tool-fold">
                      <Button variant="ghost" size="sm" class="ac-tf-toggle" :aria-expanded="!!openTools[row.tools[0].id]"
                        @click="toggleTool(row.tools[0].id)">
                        <ChevronRight :size="13" class="ac-tf-caret"
                          :class="{ 'is-open': openTools[row.tools[0].id] }" />
                        <code>{{ row.tools[0].name }}</code>
                        <span v-if="toolRowSummary(row.tools[0])" class="ac-tf-summary">{{ toolRowSummary(row.tools[0])
                          }}</span>
                      </Button>
                      <div v-if="openTools[row.tools[0].id]" class="ac-tf-body">
                        <ToolViewBody :view="viewOf(row.tools[0])" :args="row.tools[0].arguments"
                          :output="row.tools[0].output" :name="row.tools[0].name" @preview="previewToolMedia" />
                      </div>
                    </div>
                  </template>

                  <!-- 多个工具：折成一组（用户口径：中间没有文字的工具要合并），标题点开看逐个明细 -->
                  <div v-else-if="row.type === 'tools'" class="ac-tool-group">
                    <Button variant="ghost" size="sm" class="ac-tg-toggle" :aria-expanded="!!openToolGroups[row.key]"
                      @click="toggleToolGroup(row.key)">
                      <ChevronRight :size="13" class="ac-tf-caret" :class="{ 'is-open': openToolGroups[row.key] }" />
                      {{ toolGroupTitle(row.tools) }}
                    </Button>
                    <div v-if="openToolGroups[row.key]" class="ac-tg-body">
                      <div v-for="tool in row.tools" :key="tool.id"
                        :class="hasCardView(tool) ? 'ac-tool-card' : 'ac-tool-fold'">
                        <!-- 有卡片（画布 MCP）→ 直接展示；其余（含要审批的默认工具）→ 折叠行 -->
                        <template v-if="hasCardView(tool)">
                          <div class="ac-tool-head">
                            <!-- 同上：只留运行中的转圈，跑完不再叠一行与卡片自身重复的摘要 -->
                            <Loader2 v-if="!tool.settled" :size="13" class="ac-spin" />
                          </div>
                          <ToolViewBody :view="viewOf(tool)" :args="tool.arguments" :output="tool.output"
                            :name="tool.name" @preview="previewToolMedia" />
                        </template>
                        <template v-else>
                          <Button variant="ghost" size="sm" class="ac-tf-toggle" :aria-expanded="!!openTools[tool.id]"
                            @click="toggleTool(tool.id)">
                            <ChevronRight :size="13" class="ac-tf-caret" :class="{ 'is-open': openTools[tool.id] }" />
                            <code>{{ tool.name }}</code>
                            <span v-if="toolRowSummary(tool)" class="ac-tf-summary">{{ toolRowSummary(tool) }}</span>
                          </Button>
                          <div v-if="openTools[tool.id]" class="ac-tf-body">
                            <ToolViewBody :view="viewOf(tool)" :args="tool.arguments" :output="tool.output"
                              :name="tool.name" @preview="previewToolMedia" />
                          </div>
                        </template>
                      </div>
                    </div>
                  </div>
                </template>

                <!-- 用户消息：把正文里出现的 @技能 / @MCP 还原成**标签**（与输入框里那颗 chip 同款），
                 其余文字照常显示。为什么不直接存结构化引用：会话历史里只有纯文本（后端只存
                 getPlainText 的结果），靠"@名字 + 已装清单"回推，刷新/切会话也得到同一份渲染。 -->
                <!-- 默认只显示前 8 行（用户口径 2026-10-15）：长消息夹在 max-height 里，
                 超出的内容点左下角「展开」再看；收起按钮原地换「收起」。 -->
                <template v-if="t.kind === 'user'">
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
                </template>
                <!-- 用户消息带的图：按原比例排一行缩略图，点开看大图 -->
                <div v-if="t.kind === 'user' && t.images?.length" class="ac-user-images">
                  <Button v-for="(src, ii) in t.images" :key="ii" variant="ghost" size="icon-sm" class="ac-user-image" :aria-label="'查看图片 ' + (Number(ii) + 1)"
                    @click="openPreview(src, t.images)">
                    <img :src="src" alt="" />
                  </Button>
                </div>
                <!-- 「正在编辑」徽标（用户口径 2026-10-06：语义是正在编辑，不是已编辑；带高亮） -->
                <span v-if="t.editing" class="ac-editing-badge" role="status">
                  <Pencil :size="12" />正在编辑
                  <Button variant="ghost" size="icon-sm" class="ac-editing-x" aria-label="取消编辑" @click="agent.cancelEdit()">
                    <X :size="12" />
                  </Button>
                </span>
                <!-- 助手消息才走 Markdown。
                 这里**必须**是独立的 v-if，不能接在用户那条的 v-else-if 链上：
                 中间隔着「用户图片」那个 div 时，链会被打断，导致用户消息既渲染标签行、
                 又再渲染一遍原始 Markdown 文本（实测文本重复出现两次，还带出字面 @名字）。 -->
                <!-- 「正在思考」就是个**加载指示**：显示依据 = 输入框按钮的「停止」状态
                 （s.running，用户口径 2026-10-16 二次澄清：按钮状态就是加载状态）。
                 与 t.streaming 解耦：streaming 标记会被 hub 重放/收尾逻辑翻转，
                 而 s.running 由后端 run_state 驱动、刷新后由 openSession 恢复，是唯一真相。 -->
                <p v-if="showPendingOn(t)" class="ac-pending" role="status" aria-live="polite">
                  <!-- 图标是**一段开口的圆弧**（照参考图：3/4 圈转圈），不是整圈的 Loader2 ——
                   整圈转起来几乎看不出在动，开口的弧才有"在转"的观感。 -->
                  <span class="ac-pending-spin" aria-hidden="true"></span>
                  <span>正在思考</span>
                </p>
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
              </div>
              <!-- hover 操作条在**气泡外**（用户口径 2026-10-06 参考图：时间/复制/编辑贴着消息右下角，
               不挤占气泡内边距）。编辑 = 把这条消息回填到底部输入框。 -->
              <div v-if="t.kind === 'user'" class="ac-msg-actions">
                <span class="ac-msg-time" :title="msgTimeTitle(t.ts)">{{ msgTimeText(t.ts) }}</span>
                <Button variant="ghost" size="icon-sm" class="ac-msg-btn" :aria-label="copied[t.id] ? '已复制' : '复制消息'" title="复制"
                  @click="copyMessage(t.text, t.id)">
                  <CircleCheck v-if="copied[t.id]" :size="13" class="is-ok" />
                  <Copy v-else :size="13" />
                </Button>
                <Button variant="ghost" size="icon-sm" class="ac-msg-btn" aria-label="编辑消息（回填到输入框）" title="编辑" @click="beginEditMessage(t)">
                  <Pencil :size="13" />
                </Button>
              </div>
            </div>
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
            <Button variant="ghost" size="icon-sm" class="ac-note-x" aria-label="知道了" @click="s.compactNotice = ''">
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
            <Button variant="ghost" size="icon-sm" class="ac-note-x" aria-label="关闭错误提示" @click="s.lastError = ''">
              <X :size="12" />
            </Button>
          </div>
        </div>
      </div>
    </div>
</template>

<style scoped>
/* 间距统一交给 .ac-welcome 的 gap（照参考页：整块 gap 20px），这里不再单独留 margin */

.ac-hint-card {
  position: relative;
  width: 100%;
  padding: 10px 28px 10px 12px;
  border-radius: 12px;
  background: var(--ui-veil, rgb(255 255 255 / 0.06));
  font-size: 12px;
  line-height: 1.6;
  color: var(--ui-ink-dim, #919191);
}

.ac-hint-text {
  margin: 0;
}

.ac-hint-text strong {
  color: var(--ui-ink, #f7f7f7);
}

.ac-hint-close {
  position: absolute;
  right: 2px;
  top: 2px;
  color: var(--ui-ink-dim, #919191);
}

.ac-hint-close:hover {
  color: var(--ui-ink, #f7f7f7);
}

.ac-suggestions {
  width: 100%;
  display: flex;
  flex-direction: column;
}

/* 建议行：间距 10 / 正文 14px，文字用 60% 白；高度、圆角、内边距、悬停底色由 Button 提供 */

.ac-suggestion {
  justify-content: flex-start;
  gap: 10px;
  width: 100%;
  color: var(--ui-ink-dim, #919191);
  font-size: 14px;
  text-align: left;
}

.ac-suggestion > span:not(.ac-suggestion-arrow) {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.ac-suggestion .ac-suggestion-arrow {
  flex: none;
}

.ac-suggestion-arrow {
  color: var(--ui-ink-dim, #919191);
}

/* —— 消息（照参考图：用户靠右灰底、助手靠左无底、都无头像、正文 14px）—— */

.ac-msg {
  display: flex;
  margin-bottom: 16px;
}

/* 用户消息间距收紧（用户口径 2026-10-16）：user 气泡自带 actions 行（时间/复制/编辑），
   再叠 16px 下间距，连续气泡之间空得能塞下一条消息 —— 用户要求缩小。
   助手消息保持 16px（阅读节奏不变）。 */

.ac-msg.user {
  margin-bottom: 4px;
}

/* —— 压缩提示 / 错误条（用户口径 2026-10-11）——
   两条都是"刚发生的事"的常驻交代，挂在消息流末尾。错误条用危险色，压缩提示用中性色。 */

.ac-compact-note,
.ac-error-bar {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  margin: 4px 0 12px;
  padding: 8px 10px;
  border-radius: 10px;
  font-size: 12px;
  line-height: 18px;
}

.ac-compact-note {
  background: var(--ui-veil, rgb(255 255 255 / 0.06));
  color: var(--ui-ink-dim, #919191);
}

.ac-error-bar {
  background: color-mix(in srgb, var(--ui-danger, #ef4444) 12%, transparent);
  color: var(--ui-danger, #ef4444);
}

.ac-error-bar-icon {
  flex: none;
  margin-top: 2px;
}

.ac-error-bar-text {
  flex: 1;
  min-width: 0;
  word-break: break-word;
}

.ac-note-x {
  flex: none;
  margin-left: auto;
  margin-top: -6px;
  margin-bottom: -6px;
  color: inherit;
}

.ac-msg.user {
  justify-content: flex-end;
}

.ac-msg.assistant {
  justify-content: flex-start;
}

.ac-bubble {
  min-width: 0;
}

/* 助手消息占满整行：之前留了 84px 右内边距（照参考图早期版本量到的"正文右缘距面板 84px"），
   但那是把面板宽度量错造成的空档 —— 现在内容区左右各 16px 已经给足呼吸，
   再留 84px 就变成右边一条明显空白（用户实测点名）。 */

.ac-msg.assistant .ac-bubble {
  width: 100%;
}

.ac-msg.user .ac-bubble {
  max-width: 85%;
  padding: 12px 16px;
  border-radius: 12px;
  background: var(--ui-hover-soft, rgb(255 255 255 / 0.05));
}

/* 用户消息正文：文字与标签在同一行内自然换行 */

.ac-user-line {
  display: block;
  margin: 0;
  font-size: 14px;
  line-height: 24px;
  color: var(--ui-ink, #f7f7f7);
  word-break: break-word;
}

/* 「前 8 行」夹层（用户口径 2026-10-15）：行高 24px × 8 = 192px。
   **常驻**而不是"判定超出后才挂" —— 挂上之前元素没被夹住，
   scrollHeight == clientHeight，超出判定恒为否，折叠永远不生效（真机踩到的鸡生蛋）。
   常驻后正文元素就是测量体：scrollHeight 是完整内容高、clientHeight 是被夹住的高，
   差值超过 1px 即"超出"，左下角给「展开」。没超出的消息 max-height 不影响显示。 */

.ac-user-line {
  max-height: 192px;
  overflow: hidden;
}

.ac-user-line.is-open {
  max-height: none;
}

/* 展开 / 收起：文字 + 箭头，放气泡左下角。圆角 6、12px/600，走样式表的「文本按钮」档。 */

.ac-user-toggle {
  gap: 4px;
  align-self: flex-start;
  margin: 6px 0 0;
  color: var(--ui-ink-dim, #919191);
  font-size: 12px;
  font-weight: 600;
  line-height: 16px;
}

/* 操作行在气泡外（右下角、贴气泡下缘）：.ac-msg 是 flex 容器，操作行要跟气泡组成一列 */

.ac-msg.user {
  flex-direction: column;
  align-items: flex-end;
}

/* 已发送的标签：与输入框里那颗 chip 同款外观（图标 + 标题、圆角 6）。
   之所以单独一套类名：输入框里那颗是 ProseMirror 直接造 DOM 的（.ac-tag），
   这颗是 Vue 模板渲染的（.ac-sent-tag）—— 两边选择器作用域不同，但视觉值必须一致。
   底色用 --ui-hover-strong（用户口径 2026-10-06：原来太淡、不好区分）：它亮暗各一档、
   比旧值 --ui-hover-soft 深两三倍；而**旧值正是用户气泡本身的底色**，标签与气泡同色
   所以糊在一起，加深后才分得开。 */

.ac-sent-tag {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  max-width: 200px;
  height: 22px;
  margin: 0 2px;
  padding: 0 6px 0 4px;
  border-radius: 6px;
  background: var(--ui-hover-strong, rgb(0 0 0 / 0.10));
  vertical-align: bottom;
}

/* 可聚焦的节点标签：给 hover 态与 focus 环（用户口径：对话里的标签也要能点开聚焦） */

.ac-sent-tag.is-clickable {
  cursor: pointer;
  transition: background 0.14s ease;
}

.ac-sent-tag.is-clickable:hover {
  background: var(--ui-accent-soft, rgb(8 145 178 / 0.16));
}

.ac-sent-tag.is-clickable:focus-visible {
  outline: 2px solid var(--ui-accent, #0891b2);
  outline-offset: 1px;
}

.ac-sent-tag-icon {
  display: grid;
  place-items: center;
  flex: none;
  color: var(--ui-ink-dim, #919191);
}

.ac-sent-tag-icon :deep(svg) {
  width: 13px;
  height: 13px;
}

.ac-sent-tag-label {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 12px;
  font-weight: 500;
  line-height: 1;
  color: var(--ui-ink, #f7f7f7);
}

/* 目标行 / 队列行是**单行 dense 布局**（min-height 36）：标签收小一点，别把行撑高 */

.ac-sent-tag.is-compact {
  height: 18px;
  padding: 0 5px;
  font-size: 11px;
}

/* 用户消息 hover 操作条（时间 · 复制 · 编辑）：右下角浮出，不占布局空间。
   位置参照参考图 2 —— 时间在消息气泡外右下角，按钮跟在旁边。 */

.ac-msg {
  position: relative;
}

.ac-msg.user .ac-bubble {
  position: relative;
}

.ac-msg-actions {
  display: flex;
  align-items: center;
  gap: 2px;
  justify-content: flex-end;
  height: 22px;
  margin-top: 4px;
  opacity: 0;
  pointer-events: none;
  transition: opacity 0.16s ease;
}

.ac-msg.user:hover .ac-msg-actions,
.ac-msg-actions:focus-within {
  opacity: 1;
  pointer-events: auto;
}

.ac-msg-time {
  font-size: 11px;
  color: var(--ui-ink-dim, #919191);
  margin-right: 4px;
}

.ac-msg-btn {
  color: var(--ui-ink-dim, #919191);
}

.ac-msg-btn .is-ok {
  color: var(--ui-accent, #0891b2);
}

/* 「正在编辑」：消息高亮（琥珀警示语义，与语义色表一致）+ 徽标 + 输入框联动标记。
   高亮只描边不填底，避免盖住用户消息气泡本来的层次。 */

.ac-msg.is-editing .ac-bubble {
  box-shadow: 0 0 0 1.5px var(--ui-warn, #e3a25f);
  border-radius: 12px;
}

.ac-bubble :deep(.md) {
  font-size: 14px;
  line-height: 24px;
  color: var(--ui-ink, #f7f7f7);
}

.ac-bubble :deep(.md .md-p) {
  margin: 0 0 10px;
}

.ac-bubble :deep(.md .md-p:last-child) {
  margin-bottom: 0;
}

.ac-bubble :deep(.md .md-h) {
  margin: 14px 0 8px;
  font-size: 14px;
  font-weight: 700;
}

.ac-bubble :deep(.md .md-list) {
  margin: 6px 0 10px;
  padding-left: 24px;
  list-style: disc outside;
}

.ac-bubble :deep(.md .md-list li) {
  margin: 4px 0;
}

.ac-think-toggle {
  gap: 4px;
  margin-bottom: 6px;
  color: var(--ui-ink-dim, #919191);
  font-size: 12px;
}

/* 原位思考折叠块（用户口径 2026-10-16）：每段思考独立成块、按发生位置展示 */

.ac-think-inline {
  margin: 2px 0 8px;
}

.ac-think {
  margin: 0 0 10px;
  padding: 8px 10px;
  border-radius: 10px;
  background: var(--ui-veil, rgb(255 255 255 / 0.06));
  font-size: 12px;
  line-height: 20px;
  white-space: pre-wrap;
  word-break: break-word;
  overflow-wrap: anywhere;
  color: var(--ui-ink-dim, #919191);
  font-family: inherit;
  max-height: var(--ac-expand-max-height, min(360px, 50vh));
  overflow-y: auto;
}

.ac-tool-line {
  display: flex;
  align-items: baseline;
  gap: 6px;
  margin: 6px 0;
  font-size: 12px;
  color: var(--ui-ink-dim, #919191);
}

.ac-tool-line code {
  padding: 2px 6px;
  border-radius: 6px;
  background: var(--ui-veil, rgb(255 255 255 / 0.06));
}

.ac-tool-line-out {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.ac-tool-group {
  margin: 6px 0;
}

.ac-tg-toggle {
  gap: 4px;
  color: var(--ui-ink-dim, #919191);
  font-size: 12px;
}

.ac-tg-body {
  margin-top: 4px;
  padding-left: 10px;
  border-left: 2px solid var(--ui-line, #363636);
  max-height: var(--ac-expand-max-height, min(360px, 50vh));
  overflow-y: auto;
}

/* 可折叠工具行（单工具与组内工具同一套）：收起一行，展开看输入/输出（用户口径 2026-10-06）。
   展开块 max-width 到气泡全宽、pre 自身滚动 —— 「提供最大的范围 + 滚动条」。 */

.ac-tool-fold {
  margin: 4px 0;
}

/* 默认工具行（用户口径 2026-10-08 定稿）：悬停**不加任何背景**，只让左侧折叠箭头变亮。
   早先悬停给整行加 rgba(255,255,255,.06) 的底色 —— 用户明确不要背景条。 */

.ac-tf-toggle {
  gap: 6px;
  width: 100%;
  color: var(--ui-ink-dim, #919191);
  font-size: 12px;
  text-align: left;
}

.ac-tf-caret {
  flex: none;
  color: var(--ui-ink-dim, #919191);
}

.ac-tf-toggle:hover .ac-tf-caret {
  color: var(--ui-ink, #f7f7f7);
}

/* 折叠箭头动画（用户口径 2026-10-07）：旋转要有过渡，不是啪一下跳 */

.ac-tf-caret {
  transition: transform 0.18s ease;
}

.ac-tf-caret.is-open {
  transform: rotate(90deg);
}

.ac-tf-toggle code {
  padding: 2px 6px;
  border-radius: 6px;
  background: var(--ui-veil, rgb(255 255 255 / 0.06));
  /* 工具名没有长度上限（MCP 名可能很长）：限宽单行省略，
     否则整条折叠行会被它撑出气泡（极端长文本复查，2026-10-22）。 */
  flex: 0 1 auto;
  min-width: 0;
  max-width: 60%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.ac-tf-summary {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  opacity: 0.85;
}

.ac-tf-body {
  display: flex;
  flex-direction: column;
  gap: 6px;
  margin: 6px 0 2px;
  padding: 8px 10px;
  border: 1px solid var(--ui-line, #363636);
  border-radius: 10px;
  background: var(--ui-veil, rgb(255 255 255 / 0.04));
  max-height: var(--ac-expand-max-height, min(360px, 50vh));
  overflow-y: auto;
}

.ac-tf-block {
  display: flex;
  flex-direction: column;
  gap: 4px;
  min-width: 0;
}

.ac-tf-label {
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.04em;
  color: var(--ui-ink-dim, #919191);
}

.ac-tf-body .ac-tool-args,
.ac-tf-body .ac-tool-out {
  margin: 0;
  max-width: 100%;
  max-height: 320px;
  overflow: auto;
  white-space: pre-wrap;
  word-break: break-all;
}

/* 外层已经有统一上限并在滚动：内层 pre 别再叠一层小滚动框，
   否则同一份输入 / 输出会出现两个滚动条（用户口径 2026-10-25）。 */

.ac-tf-body .ac-tool-args,
.ac-tf-body .ac-tool-out,
.ac-tf-body :deep(.tvc-pre),
.ac-tf-body :deep(.tvb-pre) {
  max-height: none;
}

.ac-tool-card {
  margin: 8px 0;
  padding: 6px 8px;
  border: 1px solid var(--ui-line, #363636);
  border-radius: 10px;
  background: var(--ui-veil, rgb(255 255 255 / 0.04));
}

/* 分组里的**卡片**沿用同一只卡片壳（用户口径 2026-10-07：分界线要好找）；
   收起状态的折叠行不加壳（用户口径 2026-10-08）：单工具长什么样，组里就长什么样 ——
   早先的规则把每条折叠行也包了灰底 + 8px 内边距，收起行被灰底裹住、上下很空。 */

.ac-tg-body .ac-tool-card {
  margin: 6px 0;
  padding: 6px 8px;
  border: 1px solid var(--ui-line, #363636);
  border-radius: 10px;
  background: var(--ui-veil, rgb(255 255 255 / 0.04));
}

.ac-tool-head {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 13px;
}

.ac-tool-args,
.ac-tool-out {
  margin: 6px 0 0;
  font-size: 12px;
  white-space: pre-wrap;
  word-break: break-all;
  color: var(--ui-ink-dim, #919191);
  font-family: ui-monospace, Menlo, Consolas, monospace;
}

.ac-approval {
  margin: 8px 0 16px;
  padding: 12px 14px;
  border: 1px solid var(--ui-warn, #b45309);
  border-radius: 12px;
  background: var(--ui-veil, rgb(255 255 255 / 0.04));
}

.ac-approval-head {
  display: flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
  font-size: 13px;
}

/* 审批标题带工具名（MCP 名可能很长）：单行省略，别把卡片撑宽 */

.ac-approval-head strong {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.ac-approval-head svg {
  flex: none;
}

.ac-approval-args {
  margin: 8px 0 10px;
  padding: 8px 10px;
  border-radius: 8px;
  background: var(--ui-code-bg, rgb(0 0 0 / 0.25));
  font-size: 12px;
  white-space: pre-wrap;
  word-break: break-all;
  font-family: ui-monospace, Menlo, Consolas, monospace;
}

.ac-approval-actions {
  display: flex;
  align-items: center;
  gap: 8px;
}

.ac-spin {
  animation: ac-rotate 0.9s linear infinite;
}

.ac-onboard {
  display: flex;
  flex: 1;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 8px;
  padding: 24px;
  text-align: center;
}

.ac-onboard strong {
  font-size: 15px;
}

.ac-onboard p {
  margin: 0;
  font-size: 13px;
  color: var(--ui-ink-dim, #919191);
}

.ac-onboard-icon {
  color: var(--ui-accent, #0891b2);
}

.ac-onboard-path {
  font-size: 12px;
  opacity: 0.75;
  word-break: break-all;
}

/* 分支分页器（AI 回复结束下面一条）：左箭头 / 第 N / 共 M / 右箭头。
   居中、紧凑、不抢内容视线；到底/到顶的那侧箭头置灰不可点。 */

.ac-branch-nav {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 2px;
  margin: 4px 0 12px;
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

.ac-tool-row {
  gap: 7px;
  width: 100%;
  padding: 4px 6px;
  border: 0;
  border-radius: 7px;
  background: transparent;
  text-align: left;
}

.ac-tool-row:hover {
  background: var(--ui-panel, #fff);
  box-shadow: var(--ui-shadow-e1, 0 2px 10px rgba(0, 0, 0, 0.04));
}

.ac-tool-row.is-picked {
  background: var(--ui-accent-soft, rgba(8, 145, 178, 0.08));
  box-shadow: none;
}

.ac-tool-copy {
  display: flex;
  flex-direction: column;
  gap: 1px;
  flex: 1;
  min-width: 0;
}

.ac-tool-name {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font: 600 11.5px/1.4 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  color: var(--ui-ink, #111827);
}

.ac-tool-desc {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 10.5px;
  color: var(--ui-ink-mute, #9ca3af);
}

/* —— 空状态（DEMO 的 .empty-state）—— */

.ac-empty-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 6px;
  min-height: 190px;
  height: 100%;
  padding: 20px;
  color: var(--ui-ink-mute, #9ca3af);
  text-align: center;
}

.ac-empty-icon {
  display: grid;
  place-items: center;
  width: 38px;
  height: 38px;
  margin-bottom: 2px;
  border-radius: 12px;
  background: var(--ui-veil, rgba(0, 0, 0, 0.04));
  color: var(--ui-ink-mute, #9ca3af);
}

.ac-empty-title {
  font-size: 12px;
  font-weight: 600;
  color: var(--ui-ink-dim, #6b7280);
}

.ac-empty-desc {
  font-size: 11px;
}

.ac-root {
  position: relative;
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
  color: var(--ui-ink, #f7f7f7);
  /* 展开内容的统一高度上限（用户口径 2026-10-25）：思考过程、工具输入 /
     输出、工具分组、卡片详情共用一个值。不设上限时，长日志会把整段对话
     一路撑长；超出上限后在各自块内滚动，面板高度保持稳定。
     面板本身很矮时按视口收缩，别把输入框挤出可视区。 */
  --ac-expand-max-height: min(360px, 50vh);
}

.ac-scroll {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding: 12px 16px 0;
}

.ac-inner {
  display: flex;
  flex-direction: column;
  user-select: text;
}

@keyframes ac-rotate {
  to {
    transform: rotate(360deg);
  }
}

.ac-branch-arrow {
  flex: none;
  color: var(--ui-ink-dim, #919191);
}

.ac-branch-arrow:disabled {
  opacity: 0.35;
}

.ac-branch-pos {
  min-width: 48px;
  padding: 0 2px;
  text-align: center;
  font-size: 12px;
  font-variant-numeric: tabular-nums;
  color: var(--ui-ink-dim, #919191);
}

/* —— 「回到底部」：消息区**内部**、底部居中（用户口径 2026-10-09）——
   外层 .ac-scroll-wrap 是定位参照（它固定占满消息区，内容在里面的 .ac-scroll 滚）。 */

/* 注意：包了一层 wrap 之后，**必须也是 flex 容器** —— 里面的 .ac-scroll 靠 flex:1 撑高、
     自己 overflow-y:auto 滚。wrap 若只是普通块级，.ac-scroll 会按内容高度长出去、溢出到输入区，
     表现就是「消息文字压在队列行/输入框上」（真机踩到）。 */

.ac-scroll-wrap {
  position: relative;
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
}

.ac-to-bottom {
  position: absolute;
  left: 50%;
  transform: translateX(-50%);
  bottom: 12px;
  z-index: 5;
  border: 1px solid var(--ui-line, #363636);
  border-radius: 999px;
  background: var(--ui-overlay-solid, #212121);
  color: var(--ui-ink-dim, #919191);
  box-shadow: var(--ui-shadow-md, 0 18px 44px rgb(0 0 0 / 0.16));
  transition: color 0.15s ease, transform 0.15s ease;
}

.ac-to-bottom:hover {
  color: var(--ui-ink, #f7f7f7);
  transform: translateX(-50%) translateY(-1px);
}

@media (prefers-reduced-motion: reduce) {
  .ac-to-bottom {
    transition: none;
  }
}

@media (prefers-reduced-motion: reduce) {

  .ac-spin,
  .ac-pending-spin {
    animation: none;
  }
}
</style>

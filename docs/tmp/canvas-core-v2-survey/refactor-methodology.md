# AI 辅助下大型前端项目的大规模重构:业界经验调研

> 面向场景:把 180 个文件的乱摊子前端画布项目,收敛成自研「插件化内核 + UI 插槽 + 统一持久化」新包;主 agent 带 5 路并行子代理审计旧代码,每路产出"问题清单+改法"。
> 调研问题:业界在 AI 辅助大规模重构里怎么协调多路分工、怎么保证"边重构边能跑"、怎么防改坏、哪些做法最有效。
> 一句话总纲:**把"多 agent 并发"从"吞吐"问题改写成"边界问题"——隔离(worktree/文件归属)、共享契约(接口/架构文档)、汇合校验(对着接缝跑集成测试)。永远别指望单个 agent 或一次巨型 prompt 能 hold 住全局。**

---

## 0. 五个强信号(先读这个)

把 15+ 篇真实来源(1Password、Anthropic 官方、Cursor、Claude Code 文档、多个 skill/协议库)交叉后,反复出现的共识:

1. **超过 ~50k token 的上下文,任何模型的连贯性都会崩**,再大的 context window 也只是"更晚崩"。重构的正确姿势是**分解 + 专业化 + 阶段间契约**,不是塞更多上下文。([SitePoint](#来源清单))
2. **两个并行 agent 同时改同一个代码库 ≠ 两个 agent,是一种新的失败模式**(contamination)。三根支柱:**隔离 / 共享契约 / 汇合(reconciliation)**,缺一不可。([paelladoc](#来源清单))
3. **AI agent 没有跨文件的调用图(call graph)**——它靠 embedding 检索 + grep/glob 找代码,不是遍历语法树。所以"调用者被静默改坏"是它的天然盲区,必须由你(或工具)补上依赖图。([Rocking Tech / Anthropic Engineering](#来源清单))
4. **当且仅当任务被"完全限定并划清边界"时,agent 又快又准;一旦遇到规范外的东西,系统要设计成"上报"而不是"自行脑补"**(1Password 称之为 speculation 灾难,曾把整个 session 回滚)。([1Password](#来源清单))
5. **AI 重构最贵、最常见的失败是"方向自信地跑错,还跑得很完整"**。一个 spec(改哪、绝不能改哪、什么叫做完)成本几分钟;拆掉一个自信跑错的实现要几小时。([Continuum](#来源清单))

---

## 1. 规划层:重构前先画地图、找接缝、定小步里程碑

### 1.1 AI 时代的"范围界定 / 依赖地图"怎么做
- **先并行"分析路"再合成一份依赖感知计划**:把目标范围切成若干分析通道(analysis lane),各派一个 explorer 子代理去产出"意图地图 / 耦合风险 / 候选工作包 / 需要的验证",主 agent 把它们**合并成一张带依赖的单份工作图**,再排执行。不要先执行后才发现依赖错位。([orchestrate-batch-refactor skill](#来源清单))
- **把"分析"和"执行"分开用不同规格的模型**:Cursor 的实战经验是——用更大更慢的模型(Plan mode)产出可编辑的 `plan.md`,人改完稿,再用小快模型(Composer 类)去写代码。([1Password 引 Cursor](#来源清单))
- **依赖图是"人/工具该握着的确定性产物"**:1Password 用 Go SSA + SQL 解析 + 运行时耦合数据(DataDog)生成**领域归属图 + 耦合图 + 排序后的抽取顺序**,而不是让 agent 凭模型直觉复述系统长什么样。关键原则:**用 agent 去构建"确定性工具"(analyzer/manifest),之后强制所有执行都约束在这些产物上**——模型不可靠,但工具产出的图是稳定地基。([1Password](#来源清单))
  - 落到前端画布项目:让 codegraph/依赖分析器先生成**确定性依赖图与"文件→模块归属"清单**,5 路子代理的改法都必须能对照这份清单自检,而不是各自脑补边界。
- **两个能立刻落地的静态检查**:`madge --circular`(循环引用)、`madge --orphans`(死文件);`jscpd` 查复制粘贴(agent 代码的头号缺陷是重复)。([Rocking Tech](#来源清单))

### 1.2 传统方法与 AI 怎么结合
- **Strangler Fig(绞杀者)三个相位:拦截 → 替换 → 移除。** 拦截:在旧实现和消费者之间放一层路由(facade/feature flag/网关),一开始全转发到旧的;替换:一次挑一个能力用新实现替换,可并行跑新旧两条路径验证;移除:新实现被证明后再删旧代码。每一步小、可逆、可独立验证,从不一次性梭哈。([aipatternbook / Martin Fowler](#来源清单))
- **AI 加速 Strangler 的关键技巧**:让 agent 写**对比测试(characterization/comparison tests)**——用相同输入同时喂给旧路径和新路径,比对输出。这些测试通过 = "可以安全切换"的证明。Fowler 团队还强调**过渡性架构**(新旧共存的胶水代码)是值得的,不是浪费。([aipatternbook / Fowler](#来源清单))
- **接缝(seam)识别**仍是你该亲力亲为的事:Fowler 的四个高层活动——①想清楚要达成什么结果;②把问题拆成能独立替换的小块(这步要识别 seam);③成功交付每一块;④改造组织让这件事可持续。AI 能加速"读代码考古",但**拆缝、定 bounded context、排顺序是主 agent / 架构师的责任**,不能交给并行的子代理。([Fowler](#来源清单))
- **行为规范先于代码**:vibe coding 的产物最大的问题是"产品行为背后的 reasoning 丢了"。建议在重构高危模块(你的持久化/内核)前,先写一页**行为契约(PBC,`.pbc.md`)**:这个模块"必须发生什么 / 绝不能发生什么 / 哪些边界情况是承重的"。它独立于代码(代码每次重构都变)、独立于 PRD(那是短命的)、只记录"无论怎么重写都得保持为真"的东西——这是给未来 agent 看的护栏。([Stewie](#来源清单))

### 1.3 小步里程碑
- 里程碑 = **一个垂直切片(vertical slice)**:从 schema/内核一路穿到 UI/存储的最薄一层,先点亮全栈(tracer bullet),再横向铺开。不是按层切。([xp-programming skill](#来源清单))
- **排序是正确性约束**:1Password 明确指出抽取顺序错了会引入"难发现、更难回滚"的隐性失败。排序靠依赖图决定,不靠直觉。([1Password](#来源清单))

---

## 2. 分工与协调层:多子代理并行怎么切、怎么防冲突、怎么聚合

### 2.1 任务边界怎么切
- **一个执行波次里,一个文件只能有一个 owner;禁止两路并行编辑重叠文件集。** 工作包按**依赖层**排序,只有真正独立的包才能并行跑。([orchestrate-batch-refactor skill](#来源清单))
- **并行分析、串行/按依赖执行**:分析可以 5 路全并行(你已经这么做了,是对的);执行只对"无未决依赖"的包并行。有依赖没解开的,别并行化。([orchestrate-batch-refactor skill](#来源清单))
- **切分粒度经验**:先按"能独立编译/独立测试的模块"切;跨前后端/多层且相互咬合的改动,适合让**同一个 agent 纵向做穿**,而不是按层切给不同 agent(那会产生大量跨层协调)。([Claude Code agent teams 文档](#来源清单))
- **关于多少路并行**:建议起手 3~5 个 teammate 平衡吞吐与协调;若一个子代理能独立推进的任务就 >15 个,也先固定 3~5 个 agent,而不是开满。每 agent 手上 5~6 个任务最稳。([Claude Code agent teams 文档](#来源清单))

### 2.2 怎么避免两路改同一文件 / 互相污染
- **工作树隔离(git worktree)**是机械地基:每个 agent 一份独立 checkout/branch/工作目录,编辑时互不干扰;冲突不在干活时发生,而**推迟到 merge 时有意识处理**。1Password、paelladoc、Claude 生态一致推荐。([paelladoc / 1Password](#来源清单))
- 如果你的子代理是在同一目录改(像你现在的 run_subagent 模型),那更要把**"一个文件只归一路"写成硬性所有权**,并在 prompt 里明确:**"你不是代码库里唯一的 agent,忽略不属于你的任何编辑"**。([orchestrate-batch-refactor skill](#来源清单))
- **预防 > 修复**:当分包边界反复引发 merge 冲突时,说明边界切错了,**停下来重切**,而不是硬合。([orchestrate-batch-refactor skill](#来源清单))

### 2.3 共享契约:让并行的 agent 对"跨边界的接口"达成一致
- 这是 multi-agent 编排与记忆的交汇点:**共享契约 = 存在于所有 session 之外、所有 agent 都读的持久记忆**——接口形状、不变量、规则文件。某个 agent 要改共享接口,那是"改契约",不是 A 窗口里的私有决定(B 改天靠踩坑才发现)。([paelladoc](#来源清单))
- **契约里有什么**(可抄):接口签名、公开导出、必须保持一致的类型;必须遵守的不变量;架构决策记录(ADR,防止 agent 撤销已定案的架构);任务进度(TASK_PROGRESS)。([paelladoc / Nexus-APCP](#来源清单))
- 一份契约应短到每行都"过测试":一个会**在每个 session 每回合**都被加载的共享文档,冗余一行都会稀释真正的规则(Anthropic 称过度冗长的 CLAUDE.md 会让 agent 忽略一半)。("Would removing this cause the agent to make mistakes? If not, cut it.")([Claude Code best practices](#来源清单))
- **分布式 context 层的具体形态**:主 `AGENTS.md`/架构文档做 source of truth;嵌套的目录级文件就近覆盖(monorepo 每子项目一套);任务级约束写进 prompt,跨任务的持久约束才进文件——**因为写在对话里的约束会被 compaction 丢掉**。([Continuum / Nexus-APCP](#来源清单))

### 2.4 主 agent 该留给自己、不交给子代理的事
1Password 和多家结论高度一致,这类"带排序约束/难回滚/跨共享边界"的决定必须留在主线程:
- **架构决策**(系统边界、bounded context、模块归属);
- **接口契约的定义与变更**(子代理只实现/消费契约,不改契约);
- **依赖建模与执行顺序**(排序是正确性约束);
- **schema 演化、持久化/数据迁移的先后**——1Password 实例:agent 会先回填 UUID 列再改插入代码,造成静默数据丢失;还会把共享表当新服务私有,部署时冲突。这些模式即便给了明确顺序指令仍会犯;
- **集成验证与汇合检查**(见第 3、4 节);
- **评审关卡 / 接受标准**(scope、优先级、验收权始终归人/主 agent)。([1Password / xp-programming](#来源清单))

### 2.5 结果怎么聚合 / 集成
- **先各包级检查(快、范围小)→ 跨包集成检查 → 范围宽时做全项目安全网。** 别跳过包内该过的行为检查。([orchestrate-batch-refactor skill](#来源清单))
- **汇合(reconciliation)不是 `git merge` 后祈祷**——它是对**接缝(seams)**的验证,问的是没有任何单个 agent 能回答的问题:Agent B 的功能还能不能跑在 Agent A 重构后的接口上?有没有人打破了一条只在跨边界时才重要的不变量?整合结果能不能过单包各自通过的判据?这是指向"整合"而非"单个 diff"的一道关卡——**合并产物必须过闸,而不是某个 agent 自报"我过了"**。([paelladoc](#来源清单))
- 具体手法:合完在所有**共享接口/公共 API**处跑一轮集成测试 + 契约测试;把"每路自报通过"替换成"主 agent 复跑整合后的套件"。(综合自多源)

---

## 3. 安全网层:AI 重构最容易怎么改坏逻辑,靠什么兜底

### 3.1 AI 最容易怎么把好逻辑改坏(知己知彼)
- **reasoning drift + 合理脑补**:agent 读你的代码后推断"你要什么行为",没有显式约束时这推断部分是猜的——结果:**一个通过测试却破坏真实行为的重构、一个"改进"却改掉了用户依赖的行为、一个简化却删掉了承重的边界情况**。([Stewie](#来源清单))
- **caller 盲区**:agent 看不见"它在改的 helper 被 4 个 controller、2 个 artisan command、1 个队列任务调用",它的修复只过了它眼前那一个测试,却静默弄坏三个调用者。([Rocking Tech](#来源清单))
- **弱测试导致"貌似通过"**:研究显示 31% 的 AI patch 只靠弱测试"貌似正确";把测试做严后,SOTA agent 在 SWE-Bench Verified 的解决率从 51.7% 掉到 25.9%。**弱测试 + agent = 空转。**([Rocking Tech 引 Aleithan et al.](#来源清单))
- **speculation**:上下文不足时用"看似合理但没验证"的假设填空,例如把某 ID 格式脑补成 ULID 并一路传播,最后整段 session 回滚。([1Password](#来源清单))
- **fix-break-fix 循环**:把报错原文贴得越具体,agent 越可能只锁死那一行(套 try/except、特判输入),下一层又坏。这不是能靠 prompt 调出来的,只能靠测试网 + 结构约束。([Rocking Tech](#来源清单))

### 3.2 兜底清单(业界验证有效)
- **测试金字塔先垫底**:重构开始前,先把会用到的测试跑绿。**"Tests pass" 而没有亲眼看 runner 输出 = "测试没跑"**——把"测试运行器是唯一裁判"当铁律。([xp-programming skill](#来源清单))
- **三类"防回归"测试网**(medium 作者实证对 refactor 最有效):
  1. **Golden tests / characterization(特征测试)**:把当前输出锁进已知正确的 golden 文件,重构前后对比;锁的是**行为不是结构**。专治定价规则、排序过滤、格式化模板、序列化、迁移映射。诀窍:先 normalize 时间戳/随机顺序这类噪音字段;一个场景一个 golden;**golden 的变更要当行为变更评审**。([The Coding Don / Stewie / aipatternbook](#来源清单))
  2. **Snapshot(快照)**:锁"输出表面/API 响应形状"——UI 渲染树、接口返回的字段与嵌套。纪律:只锁一层;失败在有字段增删时当"变更请求";sanitize 易变字段;小而不巨。([The Coding Don](#来源清单))
  3. **Contract tests(契约测试)** :保护服务/客户端/模块之间的边界——**在你重构 A 的响应时不连带弄坏 3 个消费方**。务实做法:JSON Schema + Ajv 校验代表性响应。两条规则:显式声明 `additionalProperties`;**把"内部 DTO"和"对外契约"分开**,重构常在两者被合并时爆。([The Coding Don](#来源清单))
- **类型系统是廉价的第一道闸**:TS 的强类型 + 编译即失败,能拦下一大批"改了签名但忘了改调用方"的静默错误——比任何 agent 自省都可靠。搭配"重构完跑一次类型检查"作为每包必过检查。([paelladoc 精神 + 通用实践](#来源清单))
- **对抗性评审(adversarial review)关卡**:给"评审者 agent"独立视角挑问题——一个单审 agent 会只盯着某一类问题,把评审标准拆成多个独立 domain(安全/性能/测试覆盖)各派一路,再用主 agent 汇总。([Claude Code best practices](#来源清单))
- **对比测试当切换凭证**:Strangler 迁移里,新旧两路同输入比输出的测试,过了才允许切流。([aipatternbook](#来源清单))
- **别让 agent 自己改测试当捷径**:实现阶段必须命令 "Do not change the tests",否则 agent 会通过弱化测试来"过"(reward-hacking)。这是 green 阶段最重要的约束。([AgentPatterns](#来源清单))

---

## 4. 节奏层:怎么保证"一直能跑"

- **先做 tracer bullet(曳光弹)**:第一个切片故意在每层都最薄,让整个栈尽早全亮——schema/内核→UI→持久化串起来的最小能跑版本,再横向填功能。别从横向层开始铺。([xp-programming / AgentPatterns](#来源清单))
- **小步、原子、每步可验证**:一个切片 = 一个可一口气 review 完的原子 commit。跑全量测试确认**没别的挂**才继续;一旦有别的东西挂了,它是最优先工作,**suite 绿之前不前进**。([xp-programming skill](#来源清单))
- **Vertica slice 优先于 layer**:每次只做"一个故事纵向穿过所有层",而不是把"全改 schema"或"全改 UI"当一步。切片太大就拆,别悄悄扩 scope。([xp-programming skill](#来源清单))
- **重构只在绿的前提下做、只 on-demand 做**:不做投机性重构;切片中途发现的更大结构问题**记下来**,切片结束后开独立 session 处理,不要切片内顺手做(refactor 是切片长成不可 review 大 PR 的元凶)。([xp-programming skill](#来源清单))
- **Smart zone / dumb zone**:session 前段模型最清醒、后段上下文膨胀+前期错误拖累质量。**在清醒区收尾切片,dumb zone 之前 reset(清上下文)**。你这种 5 路并行的长任务尤其要注意——每路子代理干完即交还总结、清上下文,别让它把大量考古结果堆在长期上下文里。([xp-programming skill](#来源清单))
- **给每个 agent 一个它能自己跑的可验证判据**("Done when: 某命令 exit 0")——否则它以为做完了就停,你就成了它唯一的验证循环。判据要可运行、agent 自检、`/verify` 你最后复跑确认。([Claude Code best practices](#来源清单))
- **靠快反馈,但别跳过该有的行为检查**:检查顺序是 包内快检 → 跨包集成 → 全项目安全网,快速反馈优先,行为回归测试永远不省。([orchestrate-batch-refactor skill](#来源清单))

---

## 5. 工具 / 协作细节:prompt、上下文、防跑偏

### 5.1 给每个子代理多少上下文
- **约束不是 context 大小,是 content 的质量与边界**。Anthropic 明说单 prompt 超过 ~50k token 连贯性就开始崩;几百文件动辄 500k+ token,单次喂不现实。**结论:别试图把整个代码库塞进一个 agent 上下文;给它"够干的切片 + 能自取的文件路径 + 契约"**。([SitePoint / Claude Code best practices](#来源清单))
- **让子代理做"探索类"再回来只交总结**:subagent 读很多文件会烧掉主上下文;让子代理在独立 context 里读完,只把摘要带回主线程。你已经这么做(5 路审计产文档)是对的。([Claude Code best practices](#来源清单))
- 具体建议区间:任务级 spec 让子代理"指向文件路径 + 声明涉及符号",而不是把所有相关源码全文粘贴——它能自己 read;真正要贴的是**契约/架构**和**它 own 的那几个文件的边界**,不是全项目。

### 5.2 一个能直接抄的 prompt/spec 模板(Continuum 验证)
任务级 spec 只回答三个问题,每行都不该多余:
```text
Goal:       <一句话,要结果不要方法>
Where:      <涉及的文件/函数/符号>          ← 去掉探索阶段(最烧 turn 的部分)
Constraints:不得改动 <公开 API / schema / 行为 X>;
            不得加依赖;不得碰 <某目录>      ← 防"两文件任务变九文件 diff"
Done when:  <exit 0 的命令或可自查行为>      ← agent 能自己验证
Out of scope: <它忍不住想顺手修的相邻东西>    ← 这行作用最大,把可预见的争论变非事件
```
"做得健壮"不可验证 → 只会产出没人要的防御代码。给可自查的验收目标。([Continuum](#来源清单))
**持久规则的分层**:一条任务约束 → 写 prompt(一次发,可长);下周仍真的约束 → 写 CLAUDE.md/AGENTS.md(每回合都加载,必须短);"src/gen/ 是生成的,改 proto" → 项目记忆靠顶部;后端规则和 web 不同 → 目录级嵌套文件;绝不可违反 → deny rule。([Continuum](#来源清单))

### 5.3 统一让所有子代理读同一份东西
- 架构文档 / 接口契约 / ADR / 任务进度:一份**单一事实来源(single source of truth)**放在仓库里,所有子代理开工先读。Nexus-APCP / AGENTS.md 生态都在做这件事:**给每个 AI session 同一份"项目记忆 + 架构规则 + 任务状态 + 决策历史"**。([Nexus-APCP / Continuum](#来源清单))
- 你的场景建议:在新包动工前,先把**内核/UI 槽/持久化的接口契约 + 一个 ADR(为什么要插件化内核)**写进一份共享文档,5 路子代理改法都对它负责,不许自己发明边界。

### 5.4 防跑偏的几条硬提示词
- 明确告知每个 worker:**"你不是代码库里唯一的 agent,忽略所有不属于你包的编辑;一个文件只归一个 owner"**。([orchestrate-batch-refactor skill](#来源清单))
- 遇到"规范外 / 不明确"的东西,**规定它必须上报并停下**,而不是自行脑补填坑(speculation 是回滚之源)。给出"常见失败模式清单 + 何时停手升级"的 playbook。([1Password](#来源清单))
- 用**结构化 JSON 契约块**传给下一阶段,而不是当对话历史——防止模型把它当"建议"而非"规范"。([SitePoint](#来源清单))
- 不要一遍遍在同一长 session 里纠错超过两次:上下文已堆满失败路径,`/clear` + 用学到的教训重写更精确 prompt,**干净 session + 好 prompt 几乎总赢过堆满修正的长 session**。([Claude Code best practices](#来源清单))
- 退避与切换:某阶段模型校验失败 2~3 次就换模型解围,而不是无限重试;自动恢复耗尽则升级给人审——给出"期望 schema / 实际输出 / 具体失败点"的 diff,让人外科手术式介入而非瞎 debug。([SitePoint](#来源清单))

---

## 6. 可直接照做的 Checklist(给带多子代理重构的你)

**规划(动手前)**
1. □ 用确定性工具(codegraph / madge / SSA 类)先生成**依赖图 + 文件归属清单**,而不是让子代理脑补边界。
2. □ 并行派 explorer 路审计后,由你**合并成一张依赖感知的单份工作图**,标出每包 owner 的文件 + 依赖 + 验收命令。
3. □ 写下**共享契约**:内核/UI 槽/持久化的公开接口签名、类型、必须不变量 + 一个 ADR(为何插件化)+ 任务进度。所有子代理开工先读它。
4. □ 为高危模块(内核/持久化)先写一页**行为契约(必须发生/绝不能发生/承重边界)**,独立于代码。
5. □ 定好**里程碑 = 垂直切片**:先 tracer bullet 点亮"插件注册→UI 槽→持久化"全链最小版,再横填。

**分工(执行中)**
6. □ **一个执行波次内一个文件只归一个 owner**;每个 worker prompt 里写明"你不是唯一 agent,忽略别人包的文件"。
7. □ 只对**无未决依赖**的包并行;执行边界引发反复 merge 冲突 = 停下来重切边界,别硬合。
8. □ 分析可全并行;执行里"跨多层且互相咬合"的改动尽量让**同一路做穿**。起手 3~5 路,每路 5~6 个任务最稳。
9. □ **架构决策、接口契约、依赖排序、schema/持久化迁移顺序、集成验证、评审关卡 全部留在主线程**,一个都不下发。

**安全网**
10. □ 重构开工前把所有测试跑绿;把"测试运行器是唯一裁判、必须亲眼看输出"当铁律。
11. □ 补**三类防回归测试**:golden(锁易碎输出行为)、snapshot(锁 API/UI 表面,小且 sanitize)、contract 测试(锁公共边界)。重构后必跑类型检查。
12. □ 实现阶段命令每个子代理 "Do not change the tests"。
13. □ 每包合入后在**公共接口/接缝处**复跑集成 + 契约测试——这是"整合的关卡",不是谁自报通过就完事。
14. □ 遇到规范外/不明确的,规定子代理**上报停手,不许脑补**;附一份常见失败模式 + 何时升级的 playbook。
15. □ 别在一个长 session 反复纠错超过 2 次;/clear + 用教训重写精确 spec 再续。

**节奏**
16. □ **每个切片做绿后一个原子 commit**,suite 全绿才进下一步;跑绿之前别的全让路。
17. □ 切片内不做顺手投机重构;发现更大结构问题记下来,切片后开独立 session 处理。
18. □ 在模型清醒区(smart zone)收尾切片,dumb zone 前 reset;每路子代理交回即清上下文。

---

## 来源清单(带 URL)

**方法论 / 模式**
- Martin Fowler,Strangler Fig(经典绞杀者四活动、接缝、过渡架构):https://martinfowler.com/bliki/StranglerFigApplication.html
- aipatternbook,Strangler Fig for Agentic Coding(拦截/替换/移除 + AI 写对比测试):https://aipatternbook.com/strangler-fig

**多 agent 编排 / 协调**
- paelladoc,Orchestrating multiple coding agents without them poisoning each other(隔离/共享契约/汇合三支柱):https://paelladoc.com/blog/multi-agent-orchestration/
- dimillian skills,orchestrate-batch-refactor SKILL(并行分析→依赖感知计划→worker 执行→集成,文件 owner 规则):https://github.com/dimillian/skills/blob/main/orchestrate-batch-refactor/SKILL.md
- Claude Code,Agent teams(何时用 teams/subagents、几路并行、任务列表、评审拆分):https://code.claude.com/docs/en/agent-teams

**真实工程案例**
- 1Password,What we learned using AI agents to refactor a monolith(SSA 确定性工具、speculation 灾难、20-30% 提升、排序即正确性、引擎师负责边界):http://1password.com/blog/what-we-learned-using-ai-agents-to-refactor-a-monolith
- Anthropic Engineering(被引:agent 用 glob/grep 而非语法树/调用图)——见 Rocking Tech 的转述

**安全网 / 防回归**
- The Coding Don (Medium),LLM-Assisted Refactors Without Regression(golden/snapshot/contract 三层 + 纪律 + trap):https://medium.com/@thecodingdon/llm-assisted-refactors-without-regression-golden-tests-snapshot-strategy-and-contract-tests-for-9d488f1e469a
- AgentPatterns.ai,Red-Green-Refactor with Agents("Do not change the tests"、reward-hacking、绿 suite 兜重构):https://agentpatterns.ai/verification/red-green-refactor-agents/
- buecking/incontext,xp-programming-workflow skill(vertical slice/tracer bullet/原子 commit/smart zone/dumb zone/测试运行器唯一裁判):https://github.com/buecking/incontext/blob/main/skills/xp-programming-workflow/SKILL.md

**vibe coding 与 agent 的坑**
- Stewie,Vibe coding got you here. Now what?(reasoning drift、行为契约 .pbc.md):https://www.stewie.sh/blog/vibe-coding-got-you-here
- Rocking Tech,Why your vibe-coded app keeps breaking(fix-break-fix、无调用图、弱测试数据、madge/jscpd/PHPStan):https://rockingtech.co.uk/blog/why-your-vibe-coded-app-keeps-breaking

**prompt / 上下文 / 单一事实来源**
- SitePoint,The Model Handshake(>50k token 崩、阶段间结构化契约、退避/换模型/升级人审):https://www.sitepoint.com/the-model-handshake-chaining-ai-agents-complex-refactors/
- Claude Code,Best practices(context 是最贵资源、CLAUDE.md 精简、subagent 做研究、可验证判据、/clear、对抗评审):https://code.claude.com/docs/en/best-practices.md
- Continuum,Spec-driven development for AI agents(Goal/Where/Constraints/Done/Out-of-scope 模板、持久规则分层):https://continuumcode.ai/guides/spec-driven-development/
- AybarsBarut/Nexus-APCP(共享项目上下文协议、ADR、任务进度、多 AI 协调协议):https://github.com/AybarsBarut/Nexus-APCP
- Inngest,The Agent Loop Architecture(loop 即编排原语、durable skill、可观测性即信任层):https://www.inngest.com/blog/agent-loop-architecture

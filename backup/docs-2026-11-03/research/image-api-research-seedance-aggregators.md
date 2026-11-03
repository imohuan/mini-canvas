# 图像/视频生成 API 调研报告（C 组：Seedance 2.5 + 中转聚合渠道横评）

> 调研日期：2026-09-27
> 目标读者：中国开发者，想为「图片生成 / 视频生成」能力找**便宜好用**的 API
> 汇率口径：本报告统一按 **1 USD ≈ 7 CNY** 换算（302.ai 官方口径即为 1 PTC = $1 ≈ ¥7）
> 溯源原则：每个价格数字后附来源 URL。**查不到的明确标注「未找到」或「存疑」，不编造。**

---

## 0. 摘要决策表（5 分钟决策用）

### 0.1 视频生成 · 一条 5 秒 1080p 视频要多少钱

| 渠道 | 类型 | 模型 | 5 秒 1080p 单价（¥） | OpenAI 兼容 | 风险 | 推荐度 |
|---|---|---|---|---|---|---|
| 百度千帆 | 官方 | VQ3-Turbo | **≈ ¥2.2**（存疑） | 否 | 低 | ★★★☆ |
| 即梦开放平台 | 官方 | 视频生成 3.0 1080P | **≈ ¥3.15** | 否 | 低 | ★★★★ |
| 腾讯混元（腾讯云） | 官方 | 混元生视频 | **≈ ¥3.6** | 否（自有 SDK） | 低 | ★★★★★ |
| 百度千帆 | 官方 | VQ3-Pro | **≈ ¥4.7**（存疑） | 否 | 低 | ★★★☆ |
| 阿里百炼 DashScope | 官方 | wan2.6-t2v | **≈ ¥5.0** | 部分 | 低 | ★★★★★ |
| 火山方舟（**限时 72 折**） | 官方 | doubao-seedance-2.5 | **≈ ¥13.5** | 部分 | 低 | ★★★★ |
| 火山方舟（刊例价） | 官方 | doubao-seedance-2.5 | **¥18.71** | 部分 | 低 | ★★★ |
| 302.ai | 第三方聚合 | doubao-seedance-2.5-260628 | ≈ ¥17.0（≈官价） | 是 | 中低 | ★★ |
| API易 apiyi | 第三方聚合 | Seedance 2.0 系（无 2.5） | 官价 ×1.1，返赠后持平 | 是 | 中 | ★★★ |
| AIHubMix | 第三方聚合 | Seedance 2.0 系（无 2.5） | 未公示精确价 | 是 | 中 | ★★☆ |
| 硅基流动 SiliconFlow | 平台 | **无 Seedance**，仅 Wan2.2 **¥2.00/条** | ¥2.00 | 是 | 低 | ★★★★ |
| OpenRouter | 国际聚合 | 网页有 2.5、API 列表无（存疑） | ≈ ¥8.1（存疑） | 是 | 中 | ★★ |

### 0.2 图像生成 · 一张 1024×1024 图要多少钱

| 渠道 | 类型 | 模型 | 单价（¥/张） | OpenAI 兼容 | 风险 | 推荐度 |
|---|---|---|---|---|---|---|
| Replicate | 国际 | flux-schnell | **≈ ¥0.021** | 否 | 低 | ★★★★ |
| 百度千帆 | 官方 | musesteamer-air-image | **¥0.05** | 否 | 低 | ★★★★★ |
| 硅基流动 SiliconFlow | 平台 | Z-Image-Turbo | **¥0.10** | 是 | 低 | ★★★★★ |
| 硅基流动 SiliconFlow | 平台 | ERNIE-Image-Turbo | ¥0.11 | 是 | 低 | ★★★★ |
| Replicate | 国际 | flux-dev | ≈ ¥0.175 | 否 | 低 | ★★★★ |
| fal.ai | 国际 | Seedream V4 | ≈ ¥0.21（$0.03） | 否 | 低 | ★★★★ |
| 火山方舟 | 官方 | Doubao-Seedream-5.0-lite | **¥0.22** | 部分 | 低 | ★★★★ |
| 百度千帆 | 官方 | qwen-image | ¥0.25 | 否 | 低 | ★★★ |
| 硅基流动 / 阿里 | 平台 | Z-Image / Qwen-Image | ¥0.30 | 是 | 低 | ★★★ |
| 火山方舟 | 官方 | Doubao-Seedream-5.0-pro | ¥0.30 起 | 部分 | 低 | ★★★ |
| OpenRouter | 国际聚合 | openai/gpt-5-image-mini | $8/M image tokens（最便宜档） | 是 | 低 | ★★★★ |
| OpenRouter | 国际聚合 | google/gemini-2.5-flash-image | $30/M image tokens | 是 | 低 | ★★★ |

### 0.3 一句话结论

1. **Seedance 2.5 真实存在**（2026-07-31 发布），但**它是当前最贵的商用视频模型之一**：5 秒 1080p 官方 ¥18.71，而第三方（302.ai 持平 / API易 ×1.1）**几乎拿不到折扣**。
2. **要便宜的视频，别盯着 Seedance**。同规格 5 秒 1080p：腾讯混元 ≈¥3.6、阿里百炼 wan2.6 ≈¥5.0，只有 Seedance 2.5 的 **1/4 ~ 1/5**。
3. **要便宜的图，最划算的是国内大厂官方**，不是中转站：百度千帆 ¥0.05/张、硅基流动 Z-Image-Turbo ¥0.10/张，比绝大多数中转站都便宜且无跑路风险。
4. **中转站的核心价值是「能用上国外模型 + 人民币支付」，不是「便宜」**。在纯国产模型上，中转站普遍不比官方便宜。

---

## 1. Seedance 命名澄清（重要）

### 1.1 结论：Seedance 2.5 真实存在

任务书担心「2.5 可能是记错了，只有 1.x pro / lite」。**核实结果：2.5 存在，且是当前最新旗舰版本。**

- **发布日**：2026-07-31
- **官方项目页**：<https://seed.bytedance.com/zh/seedance2_5>
- **官方博客**：《一镜成片，随心参考｜Seedance 2.5 正式发布》 <https://seed.bytedance.com/zh/blog/one-take-creation-flexible-referencing-introducing-seedance-2-5>（发布日期字段 2026-07-31）
- **模型 ID**：`doubao-seedance-2.5`（火山方舟）；中转站上常见 `doubao-seedance-2-5-260628`

### 1.2 版本谱系（避免混淆）

| 版本 | 上线时间 | 单次时长 | 备注 |
|---|---|---|---|
| Seedance 1.0 / 1.0 pro / 1.0 pro fast / 1.0 lite | 2025-11 起 | 2–12 秒 | 早期版本，1.0 pro 官方价 ¥15/百万 token |
| Seedance 1.5 pro | 2025 末 | 4–12 秒 | 音画同生首代，支持首尾帧 |
| Seedance 2.0 / 2.0-fast / 2.0-mini | 2026-02 | 4–15 秒 | 12 个参考素材 |
| **Seedance 2.5** | **2026-07-31** | **30 秒**（可延长） | 50 个参考素材，当前旗舰 |

> ⚠️ **别混淆**：OpenRouter 上的 `bytedance-seed/seed-2-1-turbo`、`seed-2.0-lite` 等是字节 **Seed 文本模型系列**，和 **Seedance 视频系列**不是一回事。父代理已提示，本次复核一致——OpenRouter `/api/v1/models` 的 458 个模型中，`bytedance*` 前缀共 7 个，全部是 Seed 文本模型，无一个 Seedance。

### 1.3 Seedance 2.5 能力参数

来源：<https://seed.bytedance.com/zh/seedance2_5>、官方博客、302.ai 参数文档

| 能力项 | 参数 |
|---|---|
| 文生视频（T2V） | ✅ 支持 |
| 图生视频（I2V） | ✅ 支持（首帧 / 首尾帧） |
| 分辨率档位 | 480p / 720p / **1080p**（1080p 于 2026-08-17 上线，支持 10bit 色深） |
| 最长单次时长 | **30 秒**（2.0 为 15 秒）；支持多轮延长；即梦「超长生成」模式可达 180 秒 |
| 首尾帧控制 | ✅ 支持（`return_last_frame` 可回传尾帧做续接） |
| 带音频版本 | ✅ **原生音画同生**，`generate_audio` 默认 `true`（人声/音效/BGM 同步，多语言口型） |
| 多模态参考 | 单次最多 **50 个**：30 图 + 10 视频 + 10 音频；支持白模参考、绿幕编辑、运动参考 |
| 精准编辑 | ✅ 时间戳级定向编辑、视角/运镜编辑、局部替换 |
| 帧率 | 24 fps |
| 样片（Draft）模式 | ✅ 2026-09-23 上线，480p 快速验证，官方称 4 抽 1 可省约 57% 成本 |

**已知短板**：人物一致性在长镜头下仍漂移；720p 曾长期是硬上限（1080p 才刚补上）；多角色同框时面部易扭曲；文字仍有错别字；180 秒超长模式后半段形象漂移严重，仅适合概念测试。

---

## 2. Seedance 官方渠道价格（换算成人话）

### 2.1 火山方舟（火山引擎 Ark）—— 唯一的官方 API 渠道

**来源**：<https://www.volcengine.com/docs/ark/model-pricing>（最近更新 2026-09-03）、<https://docs.volcengine.com/docs/82379/1544106>、<https://ark.volcengine.com/region:cn-beijing/model/detail?name=doubao-seedance-2-5>

**计费公式（官方原文）**：

```
Token 用量 = (输入视频时长 + 输出视频时长) × 输出宽 × 输出高 × 帧率 ÷ 1024
视频费用 = Token 单价 × Token 用量
```

无视频输入时「输入视频时长」按 0 处理。

#### 单价表（中国区，在线推理）

| 模型 | 分辨率 | 输入不含视频 | 输入包含视频 |
|---|---|---|---|
| **doubao-seedance-2.5** | 480p / 720p | **¥70 / 百万 token** | **¥42 / 百万 token** |
| **doubao-seedance-2.5** | **1080p** | **¥77 / 百万 token** | **¥46 / 百万 token** |
| doubao-seedance-2.0 | 480p / 720p | ¥46 | ¥28 |
| doubao-seedance-2.0 | 1080p | ¥51 | ¥31 |
| doubao-seedance-2.0 | 4K | ¥26 | ¥16 |
| doubao-seedance-2.0-fast | 480p / 720p | ¥37（限时 75 折） | ¥22（限时 75 折） |
| doubao-seedance-2.0-mini | 480p / 720p | ¥23（限时 4 折） | ¥14（限时 4 折） |
| doubao-seedance-1.0-pro | — | ¥15（离线 ¥7.5） | — |
| doubao-seedance-1.0-pro-fast | — | ¥4.2（离线 ¥2.1） | — |

> 注意：**「输入包含视频」单价更低（42 vs 70），但不代表更便宜**——输入视频时长也会计入 token 用量，且有最低 token 用量下限。官方明确提醒不要据此判断便宜 40%。

#### 官方典型价格表（16:9，输出 5 秒）

| 分辨率 | 5 秒单价 | 折合每秒 |
|---|---|---|
| 480p | **¥3.36** | ¥0.67 |
| 720p | **¥7.56** | ¥1.51 |
| **1080p** | **¥18.71** | **¥3.74** |

**含视频输入的区间**（16:9，输入 2~30 秒，输出 5 秒）：480p ¥3.63~14.12｜720p ¥8.16~31.75｜1080p ¥20.12~78.25

#### 人话换算：生成一条视频多少钱

| 场景 | 成本 |
|---|---|
| 5 秒 480p | **¥3.36**（不到 4 块） |
| 5 秒 720p | **¥7.56** |
| **5 秒 1080p** | **¥18.71** |
| 30 秒 720p（按每秒线性估算） | **≈ ¥45.36** |
| 一条最终采用的 30 秒 720p 成片，若平均要成功生成 3 次才挑中 | **≈ ¥136** |

> 这是「一次成功生成」的价，不是「一条可用成片」的价。抽卡是视频生成最大的隐性成本。官方只对**成功生成**计费，审核失败不收费——这点比较良心。

#### 限时优惠（重要，注意日期冲突）

| 活动 | 时间 | 内容 |
|---|---|---|
| **1080p 72 折** | 官方文档 <https://docs.volcengine.com/docs/82379/1544106> 写「2026-08-14 14:00 至 **10-17** 14:00」；方舟文档 <https://ark.volcengine.com/docs/82379/2662855> 与多家媒体（财闻网/格隆汇 2026-08-17）写「即日起至 **9-17**」 | 1080p 图生视频 ¥3.7/秒 → **约 ¥2.7/秒**（5 秒 ≈ ¥13.5） |
| 2.0 mini 4 折 | 2026-08-07 14:00 至 **10-07** 14:00 | 720p 最低 **≈ ¥0.2/秒** |
| 2.0 fast 75 折 | 2026-08-07 起（另有来源称 9-07 截止） | — |

> ⚠️ **存疑**：1080p 72 折的两个截止日期（9-17 vs 10-17）来源冲突，官方两个页面说法不一。**今天是 2026-09-27，若按 9-17 口径则活动已结束。** 请以控制台实际扣费为准。

#### 免费额度

- 火山引擎 AI 体验中心：新用户 **50 万 token/月**，当月清零
- 豆包 App/网页端：每日 10 次免费生成（5 秒扣 1 次、10 秒扣 2 次）
- 小云雀：每日登录送 60–95 积分，1 秒视频消耗 8 积分
- 「新注册企业用户领 100 万 token」说法来源：<https://www.volcengine.com/article/2706856>（2026-09-16）——⚠️ 这是平台上第三方作者发布的营销分析文，**非官方公告**，文中还有大量「预估转化率」「预测阿里云将跟进」式推测，**可信度低**

### 2.2 即梦 AI（jimeng.jianying.com）—— C 端应用，不是 API 渠道

**重要**：即梦是面向创作者的应用。开发者调 API 应走火山方舟。但即梦有独立积分体系，价格可作「便宜程度」参照。

**积分消耗（Seedance 2.5，720p）** 来源：<https://www.chooseai.net/news/7069/>（2026-09-17）、记者实测报道

| 时长 | 5 秒 | 10 秒 | 15 秒 | 30 秒 |
|---|---|---|---|---|
| Seedance 2.5（720p） | 130 分 | 260 分 | 390 分 | **780 分** |
| Seedance 2.0 VIP（720p） | 70 分 | 140 分 | 210 分 | 不支持 |

**会员价格**：

- 2026-07-31 报道：基础会员连续包月 **¥41**，每月赠 725 积分（上线期 7 折）— <https://www.bs178.com/s-2-2693da4ae45fba71/>
- 2026-09 App Store 可核实 iOS 内购价：基础会员连续包月 **¥69**、即梦会员 **¥79**、连续包年 **¥659/年**；积分包 ¥50 / ¥75 / ¥150 — <https://www.readaitime.com/jimeng>（2026-09-02 核到「即梦个人档价格全线上调」）

> ⚠️ iOS 内购是苹果渠道价，与网页版不一致；网页版购买页为 JS 渲染，**本次未能直接抓到数字**。

**即梦开放平台 API（另一套计价，按时长）**：

- 视频生成 3.0 Pro：**¥1 / 秒**
- 3.0 1080P：**¥0.63 / 秒**（5 秒 ≈ ¥3.15）
- 3.0 720P：**¥0.28 / 秒**（5 秒 ≈ ¥1.40）
- 动作模仿 ¥0.5/秒；数字人快速模式 ¥1/秒

来源：<https://www.chooseai.net/news/7069/>（第三方整理，**未能在即梦官方文档直接核实，存疑**）

> 💡 注意这个价差：即梦开放平台 1080p 只要 **¥0.63/秒**，而火山方舟 Seedance 2.5 1080p 是 **¥3.74/秒**。**同样是字节自家渠道，差 6 倍**——因为前者是老模型（视频生成 3.0），后者是旗舰 Seedance 2.5。选模型比选中转站重要得多。

### 2.3 第三方渠道上的 Seedance 价格

#### 302.ai

- 页面：<https://302.ai/product/detail/jimeng-doubao-seedance-2-5-260628>（上线 2026-08-07）
- 接口：`POST https://api.302.ai/volcengine/api/v3/contents/generations/tasks`
- 价格：**输入不含视频 10 PTC / 百万 token；输入包含视频 6 PTC / 百万 token**
- **PTC 换算**：302.ai 官方口径 **1 PTC = $1 ≈ ¥7**（<https://help.302.ai/docs/liao-tian-ji-qi-ren-jia-ge>）
- 折合：**¥70 / 百万 token（不含视频输入）、¥42 / 百万 token（含视频输入）**

> 📌 **结论：302.ai 的 Seedance 2.5 与火山方舟官价完全一致，没有折扣。** 302.ai 的价值在于「一个账号打通多模型 + 人民币/美元充值 + OpenAI 兼容」，不在于便宜。最低充值 $5 起，余额**永久有效不过期**（比多数中转站良心）。

#### API易（apiyi.com）

- 只有 **Seedance 2.0 系列**（`doubao-seedance-2-0-260128` / `-fast-260128` / `doubao-seedance-2-0-mini-260615`），**未见 2.5**
- 官方价格锚点（16:9，输出 5 秒）：

| 分辨率 | 2.0 标准版 | 2.0 fast | 2.0 mini |
|---|---|---|---|
| 480p | ¥2.31 | ¥1.86 | ¥1.16 |
| 720p | ¥4.97 | ¥4.00 | ¥2.50 |
| 1080p | ¥12.39 | 不支持 | 不支持 |

- **站内实际扣费 ≈ 官价 × 1.1**（文档原话「站內扣費約上浮 10%」），叠加充值加赠（一般 10%、大客户最高 20%）后**基本与官价持平**，个别档位（1080p 大客户价）甚至更低
- 分组倍率：常规 `SeeDance2` = **0.18x**；限时特价 `SD2Mini` = **0.10x**（降 44.4%）、`SD2Fast` = **0.15x**（降 16.7%）
- ⏰ **限时特价已于 2026-09-07 23:59 截止**（今天 09-27，已过期）
- 官方来源：<https://docs.apiyi.com/zh-Hant/api-capabilities/seedance2/overview>

> 📌 **结论：API易 ≈ 官价持平。** 它明确说自己「不靠这个盈利」，很诚实。价值在于 OpenAI 兼容 + 高并发不排队。

#### AIHubMix

- 视频接口：`POST https://aihubmix.com/v1/videos`，异步三步（提交 → 轮询 → 下载），**OpenAI 兼容格式**
- 支持模型：`doubao-seedance-2-0-260128`、`doubao-seedance-2-0-fast-260128`、`jimeng-3.0-pro`、`jimeng-3.0-1080p`、Kling 全系、Wan 全系、Sora 2、Veo 3.1
- **未见 Seedance 2.5**
- 价格页 <https://aihubmix.com/models> 本次抓取**未返回视频模型精确单价**（只看到 LLM 价格）→ **视频价格未找到**
- 独立评测站 <https://aiproxy.best/> 给 AIHubMix 信任评分 **36**（302.AI 为 48）
- 来源：<https://docs.aihubmix.com/zh-Hant/api/Video-Gen>

#### 极客智坊（geekai.co）—— 少数公开「元/秒」明细的中转

- 接口：`POST https://geekai.co/api/v1/videos/generations`，模型 `doubao-seedance-1.5-pro`（**只有 1.5 pro，无 2.5**）
- 价格速算表（元/秒）：

| 分辨率 | 无声 | 有声 |
|---|---|---|
| 480p | ¥0.0875 | ¥0.175 |
| 720p | ¥0.175 | ¥0.35 |
| 1080p | ¥0.385 | ¥0.77 |

- 渠道折扣：以「高可用速度优先」渠道为例折扣 **0.8**，则 5 秒 720p 有声 = `0.35 × 5 × 0.8 = ¥1.4`
- 来源：<https://docs.geekai.co/cn/docs/video/bytedance/doubao-seedance-1.5-pro>

> 📌 这是本次调研中**把「一条视频多少钱」写得最清楚的中转站**——直接给元/秒，还告诉你折扣倍率。值得点赞，但模型只到 1.5 pro。

#### OpenRouter —— 重要存疑项

- **网页存在**：<https://openrouter.ai/bytedance/seedance-2.5>，标注 Released Aug 7, 2026，Provider 仅「Seed」一家
  - Video + audio：$10.70 / M tokens，或 **$0.23112/秒**
  - 页面顶部写「from **$0.1028/second**」
  - **端到端延迟 P50 = 235.8 秒**（约 4 分钟），**Uptime 100% 但 Availability 仅 82.35%**，Playground 单次预览 $1.156
- **但公开 API 里没有它**：本次直接抓 `https://openrouter.ai/api/v1/models`（2026-09-27，751,723 字节，458 个模型），按 `bytedance|seedance|seed` 过滤仅命中 7 个，全是 Seed 文本模型，零个 Seedance；按 `output_modalities` 含 image/video 过滤命中 38 个，也无 Seedance

> ⚠️ **存疑结论**：网页详情页存在但公开模型列表查无此模型。可能是（a）上架/下架未在列表同步；（b）页面为占位；（c）抓取时点差异。**实际调用前请用 OpenRouter 控制台核实**。该页显示可用率仅 82.35%、延迟 4 分钟，即便可用体验也偏差。

#### 硅基流动 SiliconFlow —— 确认没有 Seedance

- 价格页直接抓取验证：<https://cloud-rd.siliconflow.cn/pricing>（808,123 字节 HTML），全文检索 `seedance` → **未命中**
- 视频模型仅有：`Wan-AI/Wan2.2-I2V-A14B` **¥2.00/个**、`Wan-AI/Wan2.2-T2V-A14B` **¥2.00/个**
- 生图模型：`Tongyi-MAI/Z-Image-Turbo` **¥0.10/张**、`baidu/ERNIE-Image-Turbo` **¥0.11/张**、`Tongyi-MAI/Z-Image` ¥0.30、`Qwen/Qwen-Image` ¥0.30、`Qwen/Qwen-Image-Edit` ¥0.30
- 新用户注册赠 **¥14**；可设每月消费上限；**支持 OpenAI 兼容**（`base_url = https://api.siliconflow.cn/v1`）
- `api.siliconflow.cn/v1/models` 需鉴权（返回 30014 Token is invalid），无法匿名拉列表

> 📌 **结论：想用 Seedance 就别找硅基流动，它家压根没有。** 但 Wan2.2 ¥2.00/条 比 Seedance 2.5 便宜一个数量级，是「不追旗舰画质」时的好选择。

---

## 3. 中转/聚合渠道横评表（重头戏）

### 3.1 国际聚合平台

| 渠道 | 官网 | 鉴权 | OpenAI 兼容 | 图像/视频模型 | 精确价格（2026-09-27） | 免费额度 | 支付 | 风险 |
|---|---|---|---|---|---|---|---|---|
| **OpenRouter** | openrouter.ai | API Key | ✅ 是（换 base_url） | 38 个含 image/video 输出的模型；**无 Seedance** | 图像输出按 token：`gpt-5-image-mini` $8/M、`gemini-2.5-flash-image` $30/M、`gpt-5.4-image-2` $30/M、`gemini-3.1-flash-image` $60/M、`gpt-5-image` $40/M、`gemini-3-pro-image` $120/M | 部分模型有免费档 | 信用卡/加密货币；**人民币：否** | **低** |
| **fal.ai** | fal.ai | API Key | ❌ 否（自有 Model API） | Seedream V4、Flux Kontext、Nano Banana、Qwen、Hailuo/Vidu/Pixverse | **Seedream V4 $0.03/张**；Flux Kontext Pro $0.04/张；Nano Banana $0.0398/张；Qwen **$0.02/百万像素** | 按量付费，无最低承诺 | 信用卡 | **低** |
| **Replicate** | replicate.com | API Token | ❌ 否（自有 Prediction API） | flux-schnell/dev/1.1-pro、ideogram-v3、recraft-v3、wan-2.1 | flux-schnell **$3/千张（≈$0.003/张）**；flux-dev $0.025/张；flux-1.1-pro $0.04/张；ideogram-v3-quality $0.09/张；recraft-v3 $0.04/张；**wan-2.1-i2v 480p $0.09/秒、720p $0.25/秒** | 新用户少量免费 | 信用卡 | **低** |
| **Together AI** | together.ai | API Key | ✅ 是 | FLUX 系列等 | 第三方基准测得 ≈ **$0.045/张**（按 step 计价）；官方精确价本次**未抓到** | 有试用额度 | 信用卡 | **低** |
| **Fireworks AI** | fireworks.ai | API Key | ✅ 是 | FLUX、Stable Diffusion 等 | 官方精确价本次**未抓到**（动态渲染） | 有免费额度 | 信用卡 | **低** |
| **Cloudflare Workers AI** | developers.cloudflare.com | API Token | ⚠️ 部分 | 少量开源图像模型 | 按 Neuron 计费；**未抓到精确单价** | 每日免费 Neuron 额度 | 信用卡 | **低** |
| **Google Vertex AI** | cloud.google.com | OAuth/服务账号 | ❌ 否 | Imagen、Veo | **未抓到** | 新客 $300 抵用金 | 信用卡 | **低** |
| **AWS Bedrock** | aws.amazon.com | IAM | ❌ 否 | Titan Image、Nova 等 | **未抓到** | — | 信用卡 | **低** |
| **Azure AI Foundry** | azure.microsoft.com | API Key/Entra | ✅ 是 | DALL·E、Flux、Sora | **未抓到** | — | 信用卡 | **低** |

> 说明：国际平台本次重点放在能抓到硬数据的 OpenRouter / fal.ai / Replicate。Vertex / Bedrock / Azure / Cloudflare / Fireworks 定价页多为动态渲染或需登录，**未能直接核实到精确数字，不做猜测**，统一标注「未抓到」。

### 3.2 国内大厂平台（官方，风险低）

| 渠道 | 官网 | OpenAI 兼容 | 图像模型价格 | 视频模型价格 | 免费额度 | 风险 |
|---|---|---|---|---|---|---|
| **阿里百炼 DashScope** | bailian.console.aliyun.com | ⚠️ 部分 | `qwen-image` ¥0.25/张；wan2.6-image 等 | **wan2.6-t2v：720P ¥0.6/秒、1080P ¥1/秒**（国际 ¥0.7339/¥1.1009）→ **5 秒 1080p = ¥5.0** | 开通后 90 天内 100 万 token（限部分模型） | **低** |
| **火山方舟** | volcengine.com/product/ark | ⚠️ 部分 | **Seedream-5.0-lite ¥0.22/张**（文生图/图生图同价）；5.0-pro ¥0.30 起 | Seedance 2.5 见 §2.1（5s 1080p ¥18.71） | 体验中心 50 万 token/月；豆包端 10 次/天 | **低** |
| **腾讯混元/腾讯云** | cloud.tencent.com | ❌ 否 | **未抓到**精确价 | 混元生视频：5s 720p = 1.5 积分；5s 1080p = 3 积分。积分单价 ¥1（预付费包）/ **¥1.2（后付费）** → **5 秒 1080p ≈ ¥3.0~3.6** | **50 积分/用户**（控制台手动领，1 年有效） | **低** |
| **百度千帆** | cloud.baidu.com | ❌ 否 | **musesteamer-air-image ¥0.05/张（1024×1024）**；`qwen-image` ¥0.25/张 | VQ3-Pro：1080p 0.9375 / 720p 0.78125 / 540p 0.3125；VQ3-Turbo：1080p 0.4375 / 720p 0.3750 / 540p 0.25（1 积分=1 元） | 未抓到 | **低** |
| **讯飞** | xfyun.cn | ❌ 否 | **未找到**公开精确价 | **未找到** | 未找到 | **低** |
| **Gitee AI（模力方舟）** | ai.gitee.com | ✅ 是（base_url = https://ai.gitee.com/v1） | FLUX.1-dev 等，**未找到公开单价**（资源包抵扣，自动匹配算力） | Wan2.1-T2V-14B 等，异步接口 `/v1/async/videos/generations`，**未找到公开单价** | 未找到 | **中低**（资源包计价不透明） |
| **硅基流动 SiliconFlow** | siliconflow.cn | ✅ 是 | **Z-Image-Turbo ¥0.10/张**、ERNIE-Image-Turbo ¥0.11/张、Z-Image ¥0.30/张 | **Wan2.2 T2V/I2V ¥2.00/个** | 注册送 **¥14** | **低** |

> ⚠️ **百度千帆视频价格口径存疑**：官方表头为「模型名称 / 清晰度 / 时长 1–16 秒 / 消耗积分（元）」，**未明确是「每秒」还是「每条」**。本报告按「每秒」估算（5 秒 × 0.9375 = ¥4.69）。若实为「每条」则便宜得多。**请以控制台为准。**

### 3.3 国内第三方聚合/中转（风险区）

| 渠道 | 官网 | OpenAI 兼容 | 支持模型 | 价格水平 | 支付/人民币 | 风险评级 | 理由 |
|---|---|---|---|---|---|---|---|
| **302.ai** | 302.ai | ✅ 是 | Seedance 2.5/2.0 全系、OpenAI/Claude/Gemini/DeepSeek，40+ 工具 | **Seedance 2.5 与官价持平**（10/6 PTC per M ≈ ¥70/¥42） | 人民币/美元；$5 起充；**余额永久有效** | **中低** | 工商可查企业主体；独立站 aiproxy.best 信任评分 **48**（本表最高）；余额不过期是加分项 |
| **AIHubMix** | aihubmix.com | ✅ 是（`/v1/videos`） | Seedance **2.0 系**、即梦 3.0、Kling、Wan、Sora 2、Veo 3.1 | 视频价**未找到**；有自研 auto 路由 | 未核实 | **中** | 信任评分 **36**；注册在美国；视频价格不透明 |
| **API易（apiyi）** | apiyi.com | ✅ 是 | Seedance **2.0 系**（无 2.5） | 官价 ×1.1，充值赠 10–20% 后持平 | 人民币 | **中** | 定价透明度高（主动说明上浮 10%），加分；限时特价 9-07 已过期 |
| **极客智坊 geekai** | geekai.co | ✅ 是 | Seedance **1.5 pro** | 元/秒明细清晰，渠道折扣 0.8 | 人民币 | **中** | 小众；模型版本落后；但价格口径最诚实 |
| **向量引擎 vectorengine** | api.vectorengine.cn | ✅ 是 | Claude/GPT/Gemini/Grok + 国产 | 多分组倍率制（×1 ~ ×16），**同一模型不同分组价差可达 16 倍** | 未核实 | **中高** | 独立站 howtok 警示：「低价分组多为 Kiro/逆向等渠道，存在稳定性与模型版本风险」 |
| **CloseAI** | closeai-asia.com | ✅ 是（宣称「替换域名即可」） | OpenAI 为主 | 未抓到 | 支付宝；可开 Invoice | **中高** | 自述「亚洲规模最大」，但为境外公司运营、主做 OpenAI 官转；**国内合规灰色** |
| **老张API laozhang** | laozhang.ai | ✅ 是 | 281 个在线模型 | 按量（$/1M tokens）+ 按次；**单次充值满 $700 加赠 5%** | 美元计价 | **中** | 模型表公开且标注更新时间（2026-07-25）；数据透明度尚可 |
| **DMXAPI** | — | ✅ 是 | 「率先接入字节豆包 Seedance 系列（1.0 Pro、1.5 Pro、2.0）」 | 未抓到 | 未核实 | **中** | 独立目录站收录，标注「价格未核验」 |
| **AigcBest / ChatFire / EPhone AI / GalaxyAPI / api2gpt 等** | 见 openairouter.net | ✅ 是 | 多为 OpenAI 系 | 多在 0.3R~1.5R/刀区间 | 人民币 | **中高** | 独立目录站 <https://openairouter.net/> 收录 **97 个第三方中转**，绝大多数标注「供应商提供的历史简介（未核验）」 |
| **聚光 / 灵枢 / FastGPTPlus** | — | — | — | — | — | **N/A** | ❌ **未找到**作为 AI API 中转站的对应服务。「聚光」搜索命中的是**小红书聚光广告平台**（ad.xiaohongshu.com）；「FastGPTPlus」命中的是 **FastGPT（labring）的 AI Proxy 配置文档**，不是中转站。**任务书中这三个名字存疑，可能已改名/停运/或为小圈子内称呼** |

### 3.4 独立监控/比价站（选渠道前的工具，不是渠道本身）

| 站点 | URL | 作用 |
|---|---|---|
| RouterHubs | <https://routerhubs.com/> | 中转站独立监控：可用率、延迟、价格快照、模型覆盖、Base URL 横向对比。自称「不代理、不抽成」 |
| aiproxy.best | <https://aiproxy.best/> | 中转站排行：价格倍率、信任评分、渠道质量。302.AI=48、AIHubMix=36 |
| openairouter.net | <https://openairouter.net/> | 渠道目录：官方 10 / 聚合 17 / 第三方中转 **97** / 模型索引 56。**大量条目标注「未核验」** |
| howtok.net | <https://howtok.net/station/api-vectorengine-cn> | 单站价格快照，并给出「低价分组多为逆向渠道」的警示 |

---

## 4. 统一口径换算表（横向比价核心）

### 4.1 视频：一条 5 秒 1080p 视频的人民币成本

| 排名 | 渠道 | 模型 | 单价（¥） | 相对 Seedance 2.5 刊例 |
|---|---|---|---|---|
| 🥇 1 | 百度千帆 | VQ3-Turbo 1080p（¥0.4375/秒，口径存疑） | ≈ ¥2.2 | -88% |
| 🥈 2 | 即梦开放平台 | 视频生成 3.0 1080P（¥0.63/秒） | **≈ ¥3.15** | **-83%** |
| 🥉 3 | 腾讯混元 | 混元生视频（3 积分 × ¥1.2） | **≈ ¥3.6** | **-81%** |
| 4 | 百度千帆 | VQ3-Pro 1080p（¥0.9375/秒，口径存疑） | ≈ ¥4.7 | -75% |
| 5 | 阿里百炼 | wan2.6-t2v 1080P（¥1/秒） | **≈ ¥5.0** | **-73%** |
| 6 | 火山方舟（**72 折**） | Seedance 2.5 1080p（¥2.7/秒） | **≈ ¥13.5** | -28% |
| 7 | 火山方舟（刊例） | **Seedance 2.5 1080p** | **¥18.71** | **基准** |
| 8 | 302.ai | Seedance 2.5（≈¥70/M token） | ≈ ¥17.0 | ≈持平 |
| 9 | OpenRouter（存疑） | Seedance 2.5（$0.23112/秒） | ≈ ¥8.1 | -57%（但可用率仅 82%） |

### 4.2 视频：一条 5 秒 720p 视频的人民币成本（更常用的档位）

| 渠道 | 模型 | 单价（¥） |
|---|---|---|
| 火山方舟（2.0 mini 4 折） | Seedance 2.0-mini（≈¥0.2/秒） | **≈ ¥1.0** |
| 即梦开放平台 | 3.0 720P（¥0.28/秒） | **≈ ¥1.40** |
| 极客智坊（0.8 折渠道） | Seedance 1.5 pro（¥0.35/秒 × 0.8） | **≈ ¥1.4** |
| 阿里百炼 | wan2.6-t2v 720P（¥0.6/秒） | **≈ ¥3.0** |
| API易 | Seedance 2.0 fast 720p（官价 ×1.1） | ≈ ¥4.4 |
| 火山方舟（刊例） | Seedance 2.5 720p | **¥7.56** |

### 4.3 图像：一张 1024×1024 图的人民币成本

| 排名 | 渠道 | 模型 | 单价（¥） | 备注 |
|---|---|---|---|---|
| 🥇 1 | Replicate | flux-schnell | **≈ ¥0.021** | $0.003/张，质量最低 |
| 🥈 2 | 百度千帆 | musesteamer-air-image | **¥0.05** | 1024×1024 明示规格 |
| 🥉 3 | 硅基流动 | Z-Image-Turbo | **¥0.10** | OpenAI 兼容 |
| 4 | 硅基流动 | ERNIE-Image-Turbo | ¥0.11 | |
| 5 | Replicate | flux-dev | ≈ ¥0.175 | $0.025 |
| 6 | fal.ai | Seedream V4 | ≈ ¥0.21 | $0.03 |
| 7 | 火山方舟 | Seedream 5.0-lite | ¥0.22 | 文生图/图生图同价 |
| 8 | 百度千帆 | qwen-image | ¥0.25 | |
| 9 | 硅基流动 / 阿里 | Z-Image / Qwen-Image | ¥0.30 | |
| 10 | 火山方舟 | Seedream 5.0-pro | ¥0.30 起 | |
| — | OpenRouter | gpt-5-image-mini | $8/M image tokens | 父代理给的基准线 |
| — | OpenRouter | gemini-2.5-flash-image | $30/M image tokens | |

### 4.4 统一口径说明与坑

1. **视频计费口径有 4 种**：元/百万 token（火山方舟、302.ai）、元/秒（阿里百炼、即梦开放平台、极客智坊）、元/条（硅基流动 Wan2.2）、积分/次（腾讯混元、百度千帆、即梦 C 端）。**跨渠道比较必须先归一。**
2. **「抽卡倍率」才是真实成本**。上表都是「一次成功生成」的价，实际一条可用成片往往要生成 2–5 次。Seedance 官方也承认这点，2026-09-23 专门上线了 480p Draft 样片模式（官方称 4 抽 1 省 57%、20 抽 1 省 77%）。
3. **分辨率是非线性的**。1080p 像素量是 720p 的约 2.25 倍，价格也基本按这个倍数走（Seedance 2.5：720p ¥7.56 → 1080p ¥18.71，约 2.5 倍）。

---

## 5. 自建开源中转方案对比

来源：GitHub API 直接调用 `https://api.github.com/repos/{owner}/{repo}`，抓取 `stargazers_count` / `pushed_at` / `archived` / `open_issues_count`，**抓取时间 2026-09-27**。

| 项目 | Stars | Forks | 最近推送 | 归档 | 未关闭 issue | 语言 | 活跃度判定 |
|---|---|---|---|---|---|---|---|
| **[QuantumNous/new-api](https://github.com/QuantumNous/new-api)** | **48,949** | 11,750 | **2026-09-25** | 否 | 1,351 | — | ✅ **非常活跃**（昨天刚推） |
| [songquanpeng/one-api](https://github.com/songquanpeng/one-api) | 37,021 | 6,869 | 2026-01-09 | 否 | 1,037 | JavaScript | ⚠️ **疑似停更**（8.5 个月未推送；最后真实 commit 为 2025-02-21） |
| [MartialBE/one-hub](https://github.com/MartialBE/one-hub) | 2,893 | 493 | 2026-02-19 | 否 | 142 | — | ⚠️ **疑似停更**（7 个月未推送） |
| [yym68686/uni-api](https://github.com/yym68686/uni-api) | 1,264 | 158 | **2026-09-26** | 否 | 15 | **Rust** | ✅ **非常活跃**（昨天刚推） |
| [VoAPI/VoAPI](https://github.com/VoAPI/VoAPI) | 1,088 | 126 | 2026-01-27 | 否 | 3 | **Go** | ⚠️ **疑似停更**（8 个月未推送） |

### 5.1 选型建议

- **首选 `QuantumNous/new-api`**：48.9k stars、11.7k forks、昨天还在推。描述为「统一的 AI 模型聚合分发枢纽，支持把各种 LLM 互转为 OpenAI / Claude / Gemini 兼容格式」。是目前事实上的社区标准，也是 `one-api` 停更后的主流接班者。
- **轻量替代 `uni-api`**（Rust，1.2k stars，昨天还在推）：需要统一多后端 + 负载均衡且想要低资源占用时选它。issue 仅 15 个，维护状态健康。
- ⚠️ **`songquanpeng/one-api` 请谨慎**：虽然 37k stars 且仓库未归档，但 `pushed_at` 是 2026-01-09、最后一次真实 commit 停在 **2025-02-21**（早了 19 个月），1,037 个未关闭 issue。**典型的「高 star 僵尸项目」**——搜索排名会把它顶到第一，但别被 star 数骗了。
- 关于 `Calcium-Ion/new-api`：该路径已 **404 不存在**（项目已迁移至 `QuantumNous/new-api`）。搜索到的 `Calcium-Ion/new-api-key-tool`（455★，2026-05-14）和 `Calcium-Ion/new-api-horizon`（418★，2026-03-04）是周边工具，不是主项目。

### 5.2 自建的经济账

自建中转**不会让模型变便宜**——它只是一个网关，上游还是按官方价扣费。自建的真实价值是：

1. **统一多平台密钥管理**（一个入口管火山方舟 + 阿里百炼 + 硅基流动 + OpenAI）
2. **给团队做配额/限流/审计**
3. **避免第三方中转的「偷换模型」和「卖数据」风险**（见 §6.1）
4. **把人民币支付问题留在官方渠道解决**（国内大厂平台都支持支付宝/微信/对公转账）

> 💡 **给本项目（mini-canvas）的建议**：如果只接国内模型（Seedance / Seedream / Wan / Z-Image），**直接对接各家官方 SDK 最省心也最便宜**，自建中转收益有限。只有在需要同时接国外模型 + 做多租户配额时，才值得上 `new-api`。

---

## 6. 真实评价与踩坑汇总

### 6.1 中转站行业黑幕（V2EX 高热帖，强烈建议读原文）

**📌 帖子 1：《［无广］AI 中转站的底裤，扒给你看》**

- 链接：<https://www.v2ex.com/t/1200135>
- 时间：2026-03-22，作者 `scf2024`，**22,871 次浏览**
- 核心内容要点：
  - **产业链**：卡商/号商 → 号池 → 中转站 → 你，每层赚差价
  - **低价手法 ① 反代其他客户端**：不走官方 API，逆向破解 Kiro / Cursor / AI IDE 插件内部接口转卖额度。后果是「你的请求会被注入这些客户端自带的系统提示词（专为代码场景优化），你以为在用裸 Claude，其实在用被改造过的 Claude」
  - **低价手法 ② 模型掺水（换头术）**：「界面显示 claude-opus-4，后台跑的可能是某个 7B 开源模型。用量少的时候给你真货，高峰期或者流量大了悄悄切换」
  - **学术佐证**：CISPA 亥姆霍兹信息安全中心 2026 年 3 月论文 **arxiv:2603.01919**，实测 **24 个第三方 API 端点中超过半数在后台换了模型**；用假模型每花 1 美元，错误数是官方 API 的 **2–4 倍**；还有 187 篇学术论文在用这些假 API 跑实验，其中 62% 已被 ACL、CVPR 等顶会接收
  - **低价手法 ③ 三头吃**：收你充值（人民币真实收入）+ 用批量注册账号白嫖官方额度、被封后申请退款（成本趋零）+ 把你的明文输入输出打包卖给训练数据买家
  - **跑路生命周期**：低价+送额度 → 吸引用户 → 规模大了涨价降稳定性 → 群里一吐槽就封号踢人 → 某天域名消失，余额归零

**📌 帖子 2：《中转站排雷，个人已经被坑，经验分享》**

- 链接：<https://www.v2ex.com/t/1234306>
- 时间：2026-08-14，作者 `skills`，1,932 次浏览
- 被点名的两个雷：
  - `opusrelay.com`：充 100 元后开始掺水（「回复的话数就是 deepseek 一毛一样」），找客服被拉黑。**作者总结：最少 100 元起充的中转千万别用**
  - `cun.ai` / `capi.cun.ai` / `wapi.wintoken.dev`：充值 2 个 $9.9 后遇 API 接口故障，前期 token 全部浪费，客服推诿
  - ⚖️ **补充（对发帖人有利）**：站长 `zjason` 在帖内回应并**全额原路退款**（含已用掉的 $12），说明该站事后处理还算负责。同帖另有用户 `aaronv2` 反馈「用了 300$，挺稳定的」
- 同帖其他有效经验：
  - `xcode.best`：频繁 502，客服甩锅用户梯子（`uqf0663`）
  - `gpt2share` / `unity??`：买了 claude 月卡不给用，退款拖几个月（`HeSongZhou`）
  - `akring`：「**不掺水的中转站几乎无法盈利**……有人说那我买那种高价的，和原厂差不多价格的不就行了。**对不起，那只是让他们赚的更多而已。**」
  - 普遍建议：**先小额充值（10 元档）试水，冲了钱先联系客服试探能否退款**

### 6.2 Seedance 2.5 真实使用评价（正负两面）

**正面**

- 长镜头连贯性、对话/表演、参考驱动控制是公认强项。30 秒多镜头序列中主体在位置、光线、镜头运动大幅变化时仍能保持连贯
- 画面质感提升明显：皮肤纹理、毛孔、材质反射保留，官方与测评都提到「不再有明显塑料感和油腻感」
- 打击感接近游戏 CG，运镜有电影逻辑
- OpenRouter 基准：Checks passed 44/52，**Overall rank 2nd of 24**（质量排第 2）

**负面**（来源：<https://leadde.ai/zh/blog/seedance-2-5-reddit-review> 汇总 Reddit 讨论；<https://news.marsbit.co/20260812185309204322.html> 36氪七维实测）

- **成本**：「使用成本偏高，完整成片门槛在数百元起步」；Reddit 用户反复抱怨重复生成（reroll）成本
- 人物一致性仍是**最大痛点**：长镜头下形象漂移；180 秒超长模式后半段漂移严重，「目前只适合概念测试」
- 多角色同框时面部易扭曲（计算资源分摊导致）
- 提示词理解跟不上生成能力：抽象/文学化描述会字面还原（例：「脸上浮现淡淡红晕」被生成成「脸部叠加一圈红色光晕」）
- 文字准确性提升但仍出错别字，一旦出错该镜头报废
- 动作/舞蹈/肢体互动表现差（Reddit 反复提及）
- **内容审核不一致**：部分 2.0 能过的提示词在 2.5 被拒；不同平台/账户类型差异大
- **Artlist 争议**：用户购买「无限 Seedance 2.5」年费套餐后遭遇意外每日限制，最终取消无限访问，部分订阅者后来获得退款
- 30 秒生成失败代价高：「如果一个 30 秒的生成在 25 秒时运行良好但最后出问题，接受/修复/重生成的决策成本很高」
- OpenRouter 数据：**Availability 仅 82.35%**、端到端延迟 P50 **235.8 秒**（≈4 分钟）、Cost rank 23rd of 25（**倒数第 3 便宜**）、Speed rank 21st of 25

### 6.3 踩坑清单（可直接执行）

1. **别充大额**。V2EX 排雷帖经验：100 元起充的别碰，先 10 元试水。
2. **充值后先试探退款**。能痛快退款的相对良心，不能退的直接撤。
3. **警惕「同一模型多个分组倍率」**。向量引擎的倍率从 ×1 到 ×16，差 16 倍——低价分组几乎必然是逆向/掺水渠道（howtok.net 明确警示）。
4. **用标准探针测模型真伪**。V2EX 用户 `HFX3389` 给出的方法（虽针对 Claude，思路通用）：问「你是什么模型」、问训练数据截止、用长 prompt 塞满上下文再问——**但原帖也承认这些都容易被中转站做手脚**。
5. **别把中转站当生产依赖做不可逆决策**。余额随时可能归零，保持上游可切换。
6. **官方渠道其实在送额度**。Claude/OpenAI 官方近期有双倍额度、送 $50 额度等活动——用中转站这些好处一个都享受不到（V2EX `scf2024`）。

---

## 7. 给目标用户（中国开发者）的最终建议

### 7.1 按场景推荐

| 场景 | 推荐方案 | 理由 |
|---|---|---|
| **只要便宜的图** | 硅基流动 Z-Image-Turbo（¥0.10/张）或百度千帆 musesteamer-air-image（¥0.05/张） | 官方渠道、人民币、无跑路风险，价格已低于几乎所有中转站 |
| **要便宜的视频（不追旗舰画质）** | 阿里百炼 wan2.6-t2v（720p ¥0.6/秒）或腾讯混元（5s 1080p ≈¥3.6） | 官方价就是地板价，比 Seedance 2.5 便宜 4–5 倍 |
| **必须用 Seedance 2.5** | **直接走火山方舟官方** | 第三方（302.ai 持平、API易 ×1.1）**都不比官方便宜**，何必多一层风险 |
| **练 prompt / 批量草稿** | 火山方舟 Seedance **2.0-mini**（4 折中，720p ≈¥0.2/秒）+ 480p Draft 样片模式 | 成本降到旗舰的 1/10 以下 |
| **想一劳永逸管多平台密钥** | 自建 `QuantumNous/new-api` | 48.9k stars、昨天还在更新；注意别选已停更的 `songquanpeng/one-api` |
| **必须用国外模型 + 人民币支付** | OpenRouter（风险最低的国际聚合）> 302.ai（国内聚合，信任评分最高 48） | 接受「付一点溢价换合规与稳定」 |

### 7.2 一句话总结

> **中转站解决的是「能不能用」和「能不能付钱」，不是「便宜」。** 在国产模型上，官方渠道往往已经是地板价——这次调研里最便宜的图（¥0.05/张）和最便宜的视频（≈¥3.6/5s 1080p）**全都在大厂官方平台上，没有一个在第三方中转站**。Seedance 2.5 是个好模型，但它贵，而且第三方拿不到折扣。

---

## 8. 全部参考链接

### 8.1 Seedance 官方

- 项目主页：<https://seed.bytedance.com/zh/seedance2_5>
- 发布博客（2026-07-31）：<https://seed.bytedance.com/zh/blog/one-take-creation-flexible-referencing-introducing-seedance-2-5>
- 火山方舟模型价格：<https://www.volcengine.com/docs/ark/model-pricing>（更新 2026-09-03）
- 火山方舟模型价格（文档版）：<https://docs.volcengine.com/docs/82379/1544106>
- 方舟模型详情页：<https://ark.volcengine.com/region:cn-beijing/model/detail?name=doubao-seedance-2-5>
- 方舟 Seedance 2.5 上线公告：<https://ark.volcengine.com/docs/82379/2662855>、<https://ark.volcengine.com/docs/82379/2301412>
- 火山引擎产品页：<https://www.volcengine.com/product/ark>
- Seedance2.5 活动页：<https://www.volcengine.com/activity/seedance25>
- Draft 样片模式（新浪，2026-09-23）：<https://finance.sina.com.cn/tech/shenji/2026-09-23/doc-inisunsm5355391.shtml>
- 1080p 72 折（财闻网，2026-08-17）：<https://www.caiwennews.com/article/1555374.shtml>
- 1080p 72 折（格隆汇，2026-08-17）：<https://www.gelonghui.com/live/2616417>
- 火山上线 1080P（China Daily）：<http://ex.chinadaily.com.cn/exchange/partners/82/rss/channel/cn/columns/snl9a7/stories/WS6a82d079a310099e0fc7c341.html>
- Seedance 2.5 成本计算器分析（LaoZhang，2026-08-04）：<https://blog.laozhang.ai/zh/posts/seedance-2-pricing-free-vs-paid-guide>
- 定价公布（AITOP100，2026-07-31）：<https://www.aitop100.cn/infomation/details/34378.html>

### 8.2 Seedance 评价

- Reddit 评测汇总（leadde.ai，2026-08-23）：<https://leadde.ai/zh/blog/seedance-2-5-reddit-review>
- 36氪七维实测（MarsBit，2026-08-12）：<https://news.marsbit.co/20260812185309204322.html>
- 定价指南/多渠道对比（AtlasCloud）：<https://www.atlascloud.ai/zh/blog/tips/seedance-2.5-pricing-guide>
- OpenRouter Seedance 2.5 页：<https://openrouter.ai/bytedance/seedance-2.5>
- 即梦上线专业工具（至顶网，2026-08-05）：<https://www.zhiding.cn/ai-applications/2026/0805/3195345.shtml>

### 8.3 即梦 / 火山 C 端

- 各模型时长与积分对照（2026-09-17）：<https://www.chooseai.net/news/7069/>
- 即梦会员与 Seedance 2.5（2026-08-04）：<https://www.readaitime.com/jimeng>
- 记者实测积分消耗：<https://www.bs178.com/s-2-2693da4ae45fba71/>
- 上线期免费额度汇总（第三方作者，可信度低）：<https://www.volcengine.com/article/2706856>
- Seedance 2.0-fast 免费额度分析：<https://www.volcengine.com/article/2686733>

### 8.4 第三方中转

- 302.ai Seedance 2.5：<https://302.ai/product/detail/jimeng-doubao-seedance-2-5-260628>
- 302.ai 定价页：<https://302.ai/pricing>
- 302.ai PTC 说明：<https://help.302.ai/docs/liao-tian-ji-qi-ren-jia-ge>
- 302.ai API 价格说明：<https://help.302.ai/docs/API-jia-ge-dY9X>
- 302.ai Seedance 1.5 价格表：<https://doc.302.ai/7948566m0>
- API易 Seedance 2.0 文档：<https://docs.apiyi.com/zh-Hant/api-capabilities/seedance2/overview>
- AIHubMix 视频 API：<https://docs.aihubmix.com/zh-Hant/api/Video-Gen>
- AIHubMix 模型价格：<https://aihubmix.com/models>
- 极客智坊 Seedance 1.5 pro：<https://docs.geekai.co/cn/docs/video/bytedance/doubao-seedance-1.5-pro>
- 向量引擎定价：<https://api.vectorengine.cn/pricing>
- 向量引擎价格快照与风险提示：<https://howtok.net/station/api-vectorengine-cn>
- CloseAI 官网：<https://www.closeai-asia.com/>
- 老张API 模型价格总表：<https://docs.laozhang.ai/models>
- api2gpt：<https://www.api2gpt.com/>
- 独立监控 RouterHubs：<https://routerhubs.com/>
- 中转站排行 aiproxy.best：<https://aiproxy.best/>
- 渠道目录 openairouter.net：<https://openairouter.net/>

### 8.5 国内大厂平台

- 阿里云百炼模型价格：<https://help.aliyun.com/zh/model-studio/model-pricing>（更新 2026-09-24）
- 阿里 wan2.6-t2v：<https://help.aliyun.com/zh/model-studio/wan2-6-t2v>
- 阿里万相图像生成 API：<https://www.alibabacloud.com/help/zh/model-studio/wan-image-generation-api-reference>
- 百度千帆视频生成价格：<https://cloud.baidu.com/doc/qianfan-multimodal/s/nmo74mg17>（更新 2026-04-20）
- 百度千帆模型服务计费：<https://cloud.baidu.com/doc/qianfan/s/wmh4sv6ya>
- 腾讯混元生视频计费：<https://cloud.tencent.com/document/buy-guide/1616/118994>（更新 2026-06-10）
- 硅基流动定价：<https://siliconflow.cn/pricing> / <https://cloud-rd.siliconflow.cn/pricing>
- 硅基流动计费规则：<https://docs.siliconflow.com/cn/faqs/billing-rules>
- 硅基流动更新公告：<https://docs.siliconflow.cn/cn/release-notes/overview>
- Gitee AI Serverless API：<https://ai.gitee.com/serverless-api>
- Gitee AI 购买资源包：<https://ai.gitee.com/docs/billing/purchase>
- Gitee AI 视频模型：<https://ai.gitee.com/docs/products/apis/videos/>

### 8.6 国际平台

- fal.ai 定价：<https://fal.ai/pricing>
- fal.ai 计费说明：<https://fal.ai/docs/documentation/model-apis/pricing>
- Replicate 定价：<https://replicate.com/pricing>
- OpenRouter 模型 API（公开，无鉴权）：<https://openrouter.ai/api/v1/models>
- fal/replicate/together/fireworks 基准对比：<https://www.pruna.ai/blog/benchmark-fal-replicate-together-fireworks>

### 8.7 开源中转项目

- QuantumNous/new-api：<https://github.com/QuantumNous/new-api>（48,949★，2026-09-25）
- songquanpeng/one-api：<https://github.com/songquanpeng/one-api>（37,021★，2026-01-09，疑似停更）
- MartialBE/one-hub：<https://github.com/MartialBE/one-hub>（2,893★，2026-02-19）
- yym68686/uni-api：<https://github.com/yym68686/uni-api>（1,264★，2026-09-26）
- VoAPI/VoAPI：<https://github.com/VoAPI/VoAPI>（1,088★，2026-01-27）

### 8.8 风险与踩坑

- V2EX《［无广］AI 中转站的底裤，扒给你看》：<https://www.v2ex.com/t/1200135>
- V2EX《中转站排雷，个人已经被坑，经验分享》：<https://www.v2ex.com/t/1234306>
- CISPA 第三方 API 打假论文：arxiv:2603.01919

---

## 9. 本次调研的存疑项清单（诚实交代）

| # | 存疑项 | 状态 |
|---|---|---|
| 1 | 火山方舟 1080p 72 折截止日期 | 官方文档写 **10-17**，方舟文档与媒体写 **9-17**，冲突。今天 09-27 可能已结束。**需控制台核实** |
| 2 | OpenRouter Seedance 2.5 | 网页详情页存在，但公开 `/api/v1/models`（458 模型）中**查无此模型**。**需控制台核实** |
| 3 | 百度千帆视频价格口径 | 官方表未明确「每秒」还是「每条」，本报告按每秒估算 |
| 4 | 即梦开放平台按秒价格 | 来自第三方整理站，未能在即梦官方文档直接核实 |
| 5 | AIHubMix / vectorengine / closeai 视频价格 | 页面动态渲染，**未抓到精确数字**，未编造 |
| 6 | 「聚光 / 灵枢 / FastGPTPlus」三个中转站 | **未找到**对应的 AI API 中转服务。命中的分别是小红书广告平台、FastGPT 文档。**疑似任务书中的名字有误或已停运** |
| 7 | 火山方舟「100 万 token 免费额度」 | 来源为 volcengine.com/article 下的第三方营销分析文，**非官方公告**，文中含大量推测内容，可信度低 |
| 8 | 讯飞图像/视频生成价格 | **未找到**公开精确价 |
| 9 | Gitee AI 图像/视频单价 | 采用「全模型资源包」抵扣模式，**未找到公开单价** |
| 10 | Together AI / Fireworks / Cloudflare / Vertex / Bedrock / Azure 图像视频单价 | 页面动态渲染或需登录，**未抓到**，统一标注 |
| 11 | `songquanpeng/one-api` 停更判定 | 仓库**未归档**且 `pushed_at` 为 2026-01-09，但最后真实 commit 为 2025-02-21。判定「疑似停更」基于 commit 时间 |
| 12 | OpenRouter Seedance 2.5 的两个价格 | 同一页面顶部写「from $0.1028/秒」、Provider 表写「$0.23112/秒」，口径不一致，**存疑** |

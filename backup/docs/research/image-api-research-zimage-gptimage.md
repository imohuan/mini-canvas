# 图像生成 API 调研：Z-Image 与 GPT Image（A 组）

> 调研日期：2026-09-27　|　调研人：A 组（图像/视频生成模型 API 调研团队）
> 面向：中国开发者，目标是找到「便宜好用」的图片生成 API。
> 所有价格数字均附来源 URL 与抓取日期。**未找到的一律标注「未找到」，不编造。**

---

## 0. 先看这里：两个「版本号」的纠错

这是本次调研最重要的结论，请先看这一段。

### 0.1 「Z-Image 2.1」—— 不存在，请停止使用这个叫法

**结论：截至 2026-09-27，阿里通义官方不存在「Z-Image 2.1」，也不存在「Z-Image 2.0」。**

官方仓库 [Tongyi-MAI/Z-Image](https://github.com/Tongyi-MAI/Z-Image)（11,979 stars，Apache-2.0，创建于 2025-11-26）的 News 区完整时间线如下（2026-09-27 抓取）：

| 日期 | 事件 |
| --- | --- |
| 2025-11-26 | 🔥 **Z-Image-Turbo 发布**（Hugging Face / ModelScope 权重开放） |
| 2025-12-01 | 技术报告上线 arXiv |
| 2025-12-08 | Z-Image-Turbo 在 Artificial Analysis 文生图榜总榜第 8、**开源模型第 1** |
| 2026-01-27 | 🔥 **Z-Image（Base 版）发布** |

**实际存在的四个变体**（比「Turbo / Base / P 三个」的说法多一个，且没有叫 "P" 的）：

| 变体 | 定位 | 推理步数 | 权重状态 |
| --- | --- | --- | --- |
| **Z-Image-Turbo** | 蒸馏版，8 NFE 亚秒级出图，16G 显存可跑 | 8 | 已开放 |
| **Z-Image**（Base） | 基座，高质量 + 高多样性 + 可微调 | 50 | 已开放（2026-01-27） |
| **Z-Image-Omni-Base** | 生成 + 编辑通用基座，社区微调起点 | 50 | 官方标注 *To be released* |
| **Z-Image-Edit** | 图像编辑专用微调版 | 50 | 官方标注 *To be released* |

**用户说的「Z-Image 2.1」最可能是下面几种情况之一：**

1. **把「Z-Image」（Base 版，2026-01-27 发布）误记成了 2.x。** 这是最可能的。
2. **把阿里云百炼上其他模型的版本号串了。** 百炼同时有 `qwen-image-3.0-pro`、`qwen-image-2.0`、`wan2.7-image-pro` 等，「2.0」这个数字来自千问 / 万相系列，不是 Z-Image。
3. **看到了第三方镜像站的「Z-Image v2」。** 检索中确实出现过一篇 CSDN 文章「Z-Image文生图模型v2体验：三档模式一键切换」（https://blog.csdn.net/weixin_33608403/article/details/157755062 ，该页抓取超时未能读正文），称其为「2 亿级参数、Turbo/Standard/Quality 三档」。**这个「v2」不是阿里官方命名，参数规模（2 亿）也与官方 6B 不符，判定为第三方部署镜像的自造叫法，存疑，不建议采信。**

**建议：直接用「Z-Image-Turbo」这个准确名字去搜、去调 API。**

### 0.2 「ChatGPT Image 2.5 / GPT Image 2.5」—— 这个真的存在，而且很新

**结论：存在。2026-09-08 发布，距今仅 19 天。用户叫对了。**

需要细分清楚三件事（这是很多人搞混的地方）：

| 层面 | 正确名称 | 说明 |
| --- | --- | --- |
| ChatGPT 产品侧 | **ChatGPT Images 2.5**（中文：ChatGPT 图像 2.5） | 面向终端用户，2026-09-08 上线，全平台可用 |
| API 模型侧 | **`gpt-image-2.5-flare`** | 「日常创作均衡款」，快，官方定位为默认选择 |
| API 模型侧 | **`gpt-image-2.5-sunburst`** | 「专业精细款」，生成更慢，官方定位为**精确编辑**场景 |

来源：[OpenAI 官方公告 隆重推出 ChatGPT 图像 2.5](https://openai.com/zh-Hans-CN/index/introducing-chatgpt-images-2-5/)（2026-09-08，2026-09-27 抓取）；模型快照 ID 为 `gpt-image-2.5-flare-2026-09-08` / `gpt-image-2.5-sunburst-2026-09-08`（[官方文档](https://developers.openai.com/api/docs/models/gpt-image-2.5-flare)）。

**⚠️ 一个需要纠正的认知偏差**

本次调研中，团队内部曾依据 OpenRouter 公开 API 推断「没有 GPT Image 2.5 这个官方命名」。**这个推断是错的。** 我直接抓取 OpenAI 官方文档确认 `gpt-image-2.5-flare` 与 `gpt-image-2.5-sunburst` 均为官方在售模型。真相是：

- OpenRouter 上架的是 `openai/gpt-5.4-image-2`、`openai/gpt-5-image`、`openai/gpt-5-image-mini` 这三个**多模态主模型**（GPT-5.x 系列内建图像生成能力），**它们是另一条产品线**。
- `gpt-image-*` 是**纯图像专用模型**线，OpenRouter 上目前只上架了老款（如 `gpt-image-1-mini`），**2.5 尚未上架**（发版仅 19 天）。
- **OpenRouter 没有上架 ≠ 官方不存在。** 判断 OpenAI 模型命名必须以 developers.openai.com 为准。

---

## 1. 摘要决策表（5 分钟挑一个）

价格均为「一张 1024×1024 图」的到手价，已按 1 USD ≈ 7.1 CNY 换算，便于横向比较。

| # | 渠道 | 模型 | 单价（每张） | OpenAI 兼容 | 稳定性质疑 | 推荐度 |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | **硅基流动 SiliconFlow**（第三方托管开源权重） | Z-Image-Turbo | **¥0.10**（$0.005） | ✅ 是 | 低（上市公司背景平台） | ⭐⭐⭐⭐⭐ **最便宜，首选** |
| 2 | **fal.ai**（第三方托管） | Z-Image-Turbo | **$0.005/百万像素**（1MP 图 ≈ $0.005） | ❌ 自有 API | 低（知名国际平台） | ⭐⭐⭐⭐ 出海首选 |
| 3 | **阿里云百炼**（Z-Image 官方） | z-image-turbo | **¥0.10**（标准） / ¥0.20（思考） | ❌ 自有 API | 无（官方） | ⭐⭐⭐⭐ 国内合规首选 |
| 4 | **OpenAI 官方**（直连） | gpt-image-1-mini | **$0.005**（low） / $0.011（medium） / $0.036（high） | ✅ 是（就是原生） | 无（官方） | ⭐⭐⭐⭐ 质量 + 合规 |
| 5 | **OpenAI 官方**（直连） | gpt-image-2.5-flare | **$0.006**（low） / ~$0.053（medium） / ~$0.211（high） | ✅ 是（就是原生） | 无（官方） | ⭐⭐⭐ 最新但贵 |
| 6 | **API易 apiyi.com**（国内中转） | gpt-image-2 | 与官方同价，**充值送 10%–20%** | ✅ 是 | 中（中转站跑路风险） | ⭐⭐⭐ 想省钱走 OpenAI 时 |
| 7 | **AIHubMix**（国内中转） | gpt-image-2 / 阿里系 | 未公开明码标价（需登录查） | ✅ 是 | 中 | ⭐⭐ 备用 |
| 8 | **302.ai**（国内中转） | Z-Image-Turbo | $0.05/次 | ❌ 自有 API | 中 | ⭐ **比官方贵 3.5 倍，不推荐** |
| 9 | **VectorEngine**（国内中转） | gpt-image-2 | ¥3.0/M input、¥18/M completion | ✅ 是 | 中 | ⭐⭐ 备用 |

**一句话结论：**

- 要**便宜到极致** → 硅基流动 Z-Image-Turbo，¥0.10/张，OpenAI 兼容格式，改个 base_url 就能用。
- 要**质量 + 不出国** → 阿里云百炼 z-image-turbo，¥0.10/张，官方直营。
- 要**最好质量** → OpenAI `gpt-image-1-mini` low 档 $0.005/张，和 Z-Image 同价但质量更好；medium 档 $0.011。
- 要**最新最强** → `gpt-image-2.5-flare`，但 medium 档就要 $0.053/张，是 Z-Image 的 3.8 倍。

---

## 2. A1 详解：Z-Image-Turbo

### 2.1 官方 —— 阿里云百炼 DashScope

**这是 Z-Image 的「亲爹」，阿里通义自家的商业化出口。**

**接入信息**

| 项目 | 值 |
| --- | --- |
| 北京地域 | POST https://{WorkspaceId}.cn-beijing.maas.aliyuncs.com/api/v1/services/aigc/multimodal-generation/generation |
| 新加坡地域 | POST https://{WorkspaceId}.ap-southeast-1.maas.aliyuncs.com/api/v1/services/aigc/multimodal-generation/generation |
| 旧域名（仍可用） | https://dashscope.aliyuncs.com（北京） / https://dashscope-intl.aliyuncs.com（新加坡） |
| 鉴权 | Authorization: Bearer $DASHSCOPE_API_KEY |
| 模型名 | z-image-turbo |
| 输出 | PNG，固定 1 张，总像素限制 512x512 到 2048x2048 |
| 限流 | RPM 120 |

官方文档明确建议迁移到带 WorkspaceId 的业务空间专属域名（性能与稳定性更好），ID 在百炼控制台业务空间详情页可取。来源：[阿里云 Z-Image API 参考](https://www.alibabacloud.com/help/zh/model-studio/z-image-api-reference)（更新于 2026-09-11，2026-09-27 抓取）

**可抄的代码（Python）**

```python
import os, requests
url = "https://{WorkspaceId}.cn-beijing.maas.aliyuncs.com/api/v1/services/aigc/multimodal-generation/generation"
headers = {"Content-Type": "application/json",
           "Authorization": "Bearer " + os.environ["DASHSCOPE_API_KEY"]}
body = {
    "model": "z-image-turbo",
    "input": {"messages": [{"role": "user",
                            "content": [{"text": "一只坐着的橘黄色的猫，表情愉悦，活泼可爱，逼真准确。"}]}]},
    "parameters": {"prompt_extend": False, "size": "1024*1024"}
}
r = requests.post(url, headers=headers, json=body).json()
img_url = r["output"]["choices"][0]["message"]["content"][0]["image"]
```

**关键字段说明**

- `input.messages[].content[]` 必须且只能包含 1 个 text 对象，不传或传多个会报错。仅支持单轮，不支持多轮。
- `parameters.size` 格式是「宽*高」（星号，不是字母 x），默认 `1024*1536`。
- `parameters.prompt_extend` 直接影响价格：设为 true 触发智能提示词改写并输出思考过程，价格翻倍。省钱就设 false。
- `parameters.seed` 可选，范围 0 到 2147483647。

响应里的 `output.choices[0].message.content[0].image` 是图片 URL，有效期仅 24 小时，必须及时下载保存。

**价格（官方原价）**

| 部署范围 | 计费项 | 价格 | 单位 |
| --- | --- | --- | --- |
| 华北 2（北京） | 图片生成（标准，prompt_extend=false） | **0.10 元** | 每张 |
| 华北 2（北京） | 图片生成（思考，prompt_extend=true） | 0.20 元 | 每张 |
| 新加坡（国际） | 图片生成（标准） | 0.110089 元 | 每张 |
| 新加坡（国际） | 图片生成（思考） | 0.220177 元 | 每张 |

抓取自 [阿里云 z-image-turbo 模型信息页](https://help.aliyun.com/zh/model-studio/z-image-turbo)，该页更新时间 2026-09-11，抓取日期 2026-09-27。页面原文注明：「本文仅展示模型调用原价，不包含限时优惠等活动信息」。

**免费额度**：百炼新用户开通后自动发放，每个模型独立额度（通常 100 万 Token），有效期 90 天，来源：[百炼新人免费额度规则](https://help.aliyun.com/zh/model-studio/new-free-quota)。但要注意：Z-Image 是按「张」计费而非按 Token，价格页未标注独立免费额度，免费额度是否覆盖图像生成模型**存疑**，建议先小额充值实测。

**百炼的省钱套餐**（[来源](https://developer.aliyun.com/article/1759935)，2026-09-02）：

- Token Plan 个人版：Lite 39 元/月、Standard 139 元/月、Pro 499 元/月
- 节省计划「万相-视觉生成旗舰模型」：20 元/3 月起，阶梯折扣最低 9 折
- 资源包：20 元/3 月可抵扣 80 张（这是千问 Qwen-Image 系列，是否覆盖 z-image **存疑**）

### 2.2 第三方中转 / 托管

#### 硅基流动 SiliconFlow —— 推荐首选

**价格：Z-Image-Turbo 0.10 元/张（$0.005/Image）；Z-Image（Base 版）0.30 元/张。**

来源（两个页面互相印证，2026-09-27 抓取）：

- [siliconflow.cn/pricing](https://siliconflow.cn/pricing) 生图模型表：Tongyi-MAI / Z-Image / Tongyi-MAI/Z-Image 为 0.30 元
- [知乎专栏「硅基流动上线阿里 Z-Image」](https://zhuanlan.zhihu.com/p/2041228520328803887)（2026-05-22）：「Z-Image 与 Z-Image-Turbo 的调用价格分别为 0.3 元/张、0.1 元/张」
- [SiliconFlow 官方博客](https://www.siliconflow.com/zh/blog/z-image-turbo-now-on-siliconflow-photorealistic-bilingual-text-rendering)（2025-12-08）：「Z-Image-Turbo 只需 $0.005/Image」

**关键优势**

- **OpenAI 兼容格式**，改 base_url 即可接入现有代码。
- 与阿里官方同价（0.10 元），但没有阿里云的账号体系和地域限制，注册即用。
- **新用户注册送 14 元免费额度**（约 2000 万 Token），来源：[SiliconFlow 计费说明](https://docs.siliconflow.com/cn/faqs/billing-rules)。
- **推荐官计划**：实名认证领 16 元券，每邀请一人双方各得 16 元，上不封顶（[来源](https://www.siliconflow.cn/developer-talk/od7wj9rr23p95uhihmhrombp)，2026-01-15）。

按 0.10 元/张算，14 元赠金约等于 140 张图，足够完整验证。

#### fal.ai —— 出海 / 国际化首选

- Endpoint：POST https://fal.run/fal-ai/z-image/turbo
- **价格：0.005 美元 / 百万像素（megapixel）**，官方表述「200 megapixels per $1.00 on fal」
- 换算：一张 1024x1024 = 1.05 MP，约 0.0053 美元；一张 1536x1536 = 2.36 MP，约 0.0118 美元
- 能力：最高 4 MP，单次可批量出 1 到 4 张，推理步数 1 到 8 可配（1 步出缩略图，8 步出成品）
- **Prompt expansion 是加价项**：每张请求额外 0.0025 美元
- 支持 LoRA 微调（Z-Image Trainer），商用许可
- 来源：[fal.ai Z Image Turbo API 文档](https://fal.ai/docs/model-api-reference/image-generation-api/z-image-turbo)，2026-09-27 抓取

对比：fal 上 FLUX.2 [dev] 是 0.012 美元/MP，Z-Image-Turbo 是 0.005 美元/MP，Z-Image 便宜 58%。

#### 302.ai —— 不推荐（贵得离谱）

- Endpoint：POST https://api.302.ai/302/submit/z-image-turbo（国内环境另有 https://api.302ai.com）
- **价格：0.05 美元/次**（0.05 PTC/call）
- **比官方贵 3.5 倍**（阿里 0.10 元约合 0.014 美元，302.ai 收 0.05 美元）
- 平均运行 10 到 20 秒
- 来源：[302.ai Z-Image-Turbo 产品页](https://302.ai/product/detail/z-image-turbo)（2025-11-28）、[API 文档](https://doc.302.ai/383604205e0)，2026-09-27 抓取

#### AIHubMix —— 备用（价格不透明）

支持阿里系模型，两种调用方式：

- OpenAI 兼容接口：/v1/images/generations、/v1/images/edits（模型 ID 需写全 gpt-image-2，不能简写 image2）
- zimage 原生接口：POST https://aihubmix.com/v1/models/供应商模型id/predictions（如 bailian/z-image-turbo）

原生接口额外支持 negative_prompt、prompt_extend、watermark、seed 等 OpenAI 接口没有的参数。**价格未公开明码标价**，需登录后台查询。来源：[AIHubMix Image-Gen 文档](https://aihubmix.mintlify.app/cn/api/Image-Gen)，2026-09-27 抓取。

#### 其他渠道

| 渠道 | Z-Image 支持情况 |
| --- | --- |
| OpenRouter | 完全没有 z-image 系列（2026-09-27 直接抓 https://openrouter.ai/api/v1/models 全量验证） |
| Replicate / Together AI | 本次检索未找到明确上架信息，标记为「未核实」 |
| 火山方舟 | 未找到 Z-Image 上架信息（未核实） |
| 腾讯混元 | 自有图像模型，不是 Z-Image。参考价：混元生图极速版 0.099 元/张、3.0 版 0.2 元/张（[腾讯云文档](https://cloud.tencent.com/document/product/1668/90896)） |
| Gitee AI 模力方舟 | 托管了 [Tongyi-MAI/Z-Image-Turbo](https://ai.gitee.com/hf-models/Tongyi-MAI/Z-Image-Turbo) 权重，价格未核实 |

### 2.3 真实评价（带链接）

**正面**

- [V2EX：Z-Image-Turbo 还是有点意思的](https://www.v2ex.com/t/1183650)（2026-01-07）
  - 用户 MIUIOS：「确实强，这么小的模型直接比肩那些大尺寸模型，生成出来的图也很难看出熟料感（塑料感）」
  - 用户 BretTaylor：「震惊了，8G 显存都能跑那么高质量的生图」
  - 用户 monk66601：「出图速度是真的快，5080，7 秒一张 1024 图」
- [V2EX：基于 Z-Image Turbo 做了个能在线用的小工具](https://www.v2ex.com/t/1177881)（2025-12-09）：作者评价「速度快得有点惊到我」
- [V2EX：写了一个聚合的 AI 生成网站](https://www.v2ex.com/t/1180289)（2025-12-21）：实测「z-image-turbo 基本 20 秒出结果，生成的图片完全没有水印」
- 硬指标：Artificial Analysis 文生图榜总榜第 8、开源模型第 1（2025-12-08，官方 GitHub News）

**负面**

- [V2EX t/1183650](https://www.v2ex.com/t/1183650) 用户 jimrok 实测吐槽：「Z 的模型我试了很多提示词，有些效果就是出不来……不管怎么调，窗帘都是露着一个缝，画面没法往下搞」——复杂空间构图的指令遵循不稳定
- 同上帖用户 synrise：「生图感觉没啥意思，gemini 要强的多，edit 能出 turbo 版我觉得才是王炸」——认为纯生图竞争力不如 Gemini
- [saascrmreview Z-Image Turbo Review](https://saascrmreview.com/z-image-turbo-review/)（2026-03-07）总结的短板：
  - 长文本或复杂排版下文字渲染退化（短英文 1 到 5 词和中文字可靠，整句或多文本块常出错字、错序）
  - 默认管线不支持 Stable Diffusion 式的 negative prompt
  - LoRA 和社区工具链成熟度远不如 Stable Diffusion 和 Flux
  - 极致美学质量不是首选，不如闭源商用模型
- [GitHub Issue #108「Z-image release timeline」](https://github.com/Tongyi-MAI/Z-Image/issues/108)：用户 hanswurst232（2026-01-04）抱怨 Base 版迟迟不发布，并说已停止为 Turbo 版做 LoRA——反映 Turbo 不适合当微调基座
- [GitHub Issue #126「At least tell us what is happening」](https://github.com/Tongyi-MAI/Z-Image/issues/126)（2026-01-16）：社区对官方发布节奏不透明的不满，仓库有 110+ open issues

**我的判断**：Z-Image-Turbo 是性价比怪物——6B 参数、8 步出图、消费级显卡可跑、开源权重 Apache-2.0、0.10 元/张。短板在复杂构图的指令遵循和长文字渲染，不适合做「一次成图的高价值商稿」，非常适合批量出图、草稿迭代、中文短文字场景。

---

## 3. A2 详解：GPT Image 系列

### 3.1 官方命名全图（这张表很重要）

OpenAI 现在有**两条**图像相关的模型线，很多人搞混：

| 产品线 | 模型 ID | 说明 |
| --- | --- | --- |
| **纯图像专用模型** | `gpt-image-2.5-flare`（新） | 2026-09-08，快，日常默认 |
| | `gpt-image-2.5-sunburst`（新） | 2026-09-08，慢，精确编辑 |
| | `gpt-image-2` | 2026-04-21，上一代旗舰 |
| | `gpt-image-1.5` | 更早版本 |
| | `gpt-image-1` / `gpt-image-1-mini` | 初代 / 初代廉价版 |
| **多模态主模型（内建图像能力）** | `gpt-5.4-image-2` / `gpt-5-image` / `gpt-5-image-mini` | GPT-5.x 系列，能推理能生图，走 chat/responses 接口 |

**用户说的「ChatGPT Image 2.5」= 产品名；对应的 API 模型是 `gpt-image-2.5-flare` 或 `gpt-image-2.5-sunburst`。**

### 3.2 官方 —— OpenAI 直连

**接入信息**

| 项目 | 值 |
| --- | --- |
| 生图 | POST https://api.openai.com/v1/images/generations |
| 编辑 | POST https://api.openai.com/v1/images/edits |
| 对话式 | POST https://api.openai.com/v1/responses（内建图像工具） |
| 鉴权 | Authorization: Bearer $OPENAI_API_KEY |

**可抄的代码（Python，官方示例）**

```python
from openai import OpenAI
import base64

client = OpenAI()
result = client.images.generate(
    model="gpt-image-2",
    prompt="A children's book drawing of a veterinarian using a stethoscope to listen to the heartbeat of a baby otter."
)
image_bytes = base64.b64decode(result.data[0].b64_json)
with open("otter.png", "wb") as f:
    f.write(image_bytes)
```

来源：[OpenAI Image generation 官方指南](https://developers.openai.com/api/docs/guides/image-generation)，2026-09-27 抓取。

**重要门槛**：官方明确要求，**使用 gpt-image 系列前必须完成 API Organization Verification（组织验证）**，否则无法调用。Free tier 不支持图像模型，Tier 1 起才有额度（TPM 100,000 / IPM 5）。来源：[gpt-image-2.5-flare 模型页](https://developers.openai.com/api/docs/models/gpt-image-2.5-flare)。

**官方 token 定价（2026-09-27 抓取自 [OpenAI Pricing](https://developers.openai.com/api/docs/pricing)）**

| 模型 | 模态 | 输入 /1M | 缓存输入 /1M | 输出 /1M |
| --- | --- | --- | --- | --- |
| `gpt-image-2.5-sunburst` | Image | $8.00 | $2.00 | **$30.00** |
| | Text | $5.00 | $1.25 | - |
| `gpt-image-2.5-flare` | Image | $8.00 | $2.00 | **$30.00** |
| | Text | $5.00 | $1.25 | - |
| `gpt-image-2` | Image | $4.00 | $1.00 | **$15.00** |
| | Text | $2.50 | $0.625 | - |
| `gpt-image-1.5` | Image | $8.00 | - | **$32.00** |
| `gpt-image-1-mini` | Image | $2.50 | $0.25 | **$8.00** |
| | Text | $2.00 | $0.20 | - |

> 注意：缓存输入价只对用 Responses API 生成的图生效（GPT Image 2 / 2.5）。

### 3.3 用户最关心的：一张图到底多少钱

Token 单价没有直观意义，**下面才是你真正要付的钱。**

#### gpt-image-1-mini —— OpenAI 官方最便宜的一档（按张明码标价）

官方模型页直接给出了按张定价（**不是**按 token 估算，这是硬价）：

| 质量档 | 1024x1024 | 1024x1536 | 1536x1024 |
| --- | --- | --- | --- |
| **Low** | **$0.005** | $0.006 | $0.006 |
| **Medium** | $0.011 | $0.015 | $0.015 |
| **High** | $0.036 | $0.052 | $0.052 |

来源：[OpenAI gpt-image-1-mini 模型页](https://developers.openai.com/api/docs/models/gpt-image-1-mini)，2026-09-27 抓取；交叉验证 [aifreeapi.com](https://www.aifreeapi.com/zh/posts/gpt-image-1-mini-pricing)（2026-03-27）、[fal.ai gpt-image-1-mini](https://fal.ai/models/fal-ai/gpt-image-1-mini)。

**这是 OpenAI 官方最便宜的图，Low 档 $0.005/张，和 Z-Image-Turbo 的 ¥0.10（约 $0.014）相比其实 mini 更便宜，而且质量公认更好。**

#### gpt-image-2 —— 按 token 折算的每张实际成本

官方计算器给出的估算（标准非 Batch 调用）：

| 质量档 | 1024x1024 | 1024x1536 / 1536x1024 |
| --- | --- | --- |
| **Low** | **$0.006** | $0.005 |
| **Medium** | $0.053 | $0.041 |
| **High** | $0.211 | $0.165 |

来源：[ModelCostWatch](https://www.modelcostwatch.com/models/openai-gpt-image-2)（引 OpenAI 2026-09-03 定价数据）、[nemovideo 拆解](https://www.nemovideo.com/blog/gpt-image-2-pricing-breakdown)、[API易 文档](https://docs.apiyi.com/api-capabilities/gpt-image-2/overview)。三处数字一致。

**反推 output token 数**（帮你理解计费逻辑）：

- Medium 档 1024x1024 花 $0.053，输出价 $30/1M → 约 **1,767 个 output image token**
- High 档 $0.211 → 约 **7,033 个 output image token**
- Low 档 $0.006 → 约 **200 个 output image token**

**Batch API 可以再打 5 折**（官方支持，/v1/batch）。

#### gpt-image-2.5-flare —— 最新，但 token 单价和 2 一样贵

官方文档明确写：「**Token rates match GPT Image 2. The GPT Image 2 calculator does not estimate GPT Image 2.5 token consumption.**」

翻译：2.5 的 token 单价和 gpt-image-2 **完全相同**（image output 都是 $30/1M），但 OpenAI 官方**没有**提供 2.5 的每张成本估算表。

所以 2.5 的每张成本**存疑**，合理推测是接近 gpt-image-2 的量级（low 约 $0.006、medium 约 $0.053、high 约 $0.211），但因 2.5 新增了 `xhigh` 和 `max` 两档质量（比 high 更贵），**高档位可能显著超过 $0.211**。

> 2.5 相对 2.0 的参数变化：质量档从 3 档（low/medium/high）扩到 5 档（新增 xhigh、max）；分辨率新增 4K 档（3840x2160）；参考图上限从 10 张提到 16 张。来源：[ZOOOP 实测对比](https://zooop.ai/zh/blog/gpt-image-2-5-vs-gpt-image-2)（2026-09-09）。

### 3.4 第三方中转

#### API易（apiyi.com）—— 走 OpenAI 时最划算的国内中转

- **OpenAI 完全兼容**：「OpenAI 官方 SDK 把 base_url 指过来即可零代码改动直连」
- **单价与 OpenAI 官网完全一致**（文本输入 $5/1M、图片输入 $8/1M、图片输出 $30/1M），**没有加价**
- **折扣体现在充值**：充 $100 送 10%，最高送 20%
- 另有 `gpt-image-2-all` 统一价 $0.03/张
- 来源：[API易 gpt-image-2 文档](https://docs.apiyi.com/api-capabilities/gpt-image-2/overview)，2026-09-27 抓取

**实测数据很有价值**（API易 2026-07-15 实测，编辑接口）：

| 参考图输入 | image_tokens | 输入费用（$8/M） |
| --- | --- | --- |
| 1 张 512x512 | 1024 | 约 $0.0082 |
| 1 张 1024x1024 | 1024 | 约 $0.0082 |
| 1 张 2048x2048 | 1521 | 约 $0.0122 |
| 4 张 1024x1024 | 4096 | 约 $0.0328 |

关键结论：**参考图张数严格线性累加**，16 张 1024 方图约 16,384 tokens 约 $0.13，已和一张 high 输出（$0.211）同量级。另外 token 由像素尺寸决定而与文件体积无关——**把图压缩到 1.5MB 不会省钱**。

#### VectorEngine（vectorengine.cn）

- gpt-image-2：Enter price ¥3.0000/M、Completion price ¥18.0000/M
- 换算约 $0.42/1M input、$2.54/1M completion，需要结合其自有计费规则理解，**与官方口径不完全一致，建议实测**
- 来源：[VectorEngine 定价页](https://api.vectorengine.cn/pricing)，2026-09-27 抓取

#### AIHubMix

- 支持 `gpt-image-2`、`gpt-image-1.5`、`gpt-image-1`、`gpt-image-1-mini`、`dall-e-3`
- **已支持通过 OpenAI 兼容接口调用图片编辑**，模型 ID 必须写全 `gpt-image-2`，不能简写 `image2`
- 价格未公开，需登录查询
- 来源：[AIHubMix Image-Gen 文档](https://aihubmix.mintlify.app/cn/api/Image-Gen)

#### OpenRouter —— 只有老款和多模态线

2026-09-27 直接抓取 `https://openrouter.ai/api/v1/models` 全量验证，OpenAI 图像相关模型只有这三个：

| 模型 ID | input /1M | output /1M | image_output /1M | context |
| --- | --- | --- | --- | --- |
| `openai/gpt-5.4-image-2` | $8.00 | $15.00 | $30.00 | 272K |
| `openai/gpt-5-image` | $10.00 | $10.00 | $40.00 | 400K |
| `openai/gpt-5-image-mini` | $2.50 | $2.00 | $8.00 | 400K |

**`gpt-image-2.5-flare` / `sunburst` 尚未上架 OpenRouter**（发版仅 19 天）。

值得注意的是 `gpt-5-image-mini` 的 image_output 只要 **$8/1M**，和官方 `gpt-image-1-mini` 的 $8/1M 一致——**没有加价，也没有减价**。OpenRouter 对 OpenAI 官方模型基本是平价转售，靠的是多模型统一入口，不是价格优势。

**关于中转加价幅度的结论**：本次调研**没有发现任何一家正规中转对 OpenAI 图像模型大幅加价或减价**。API易是「同价 + 充值送 10-20%」；OpenRouter 是平价。真正便宜的是**换模型**（Z-Image）而不是换渠道。

### 3.5 真实评价（带链接）

**正面**

- [ZOOOP 实测：GPT Image 2.5 和 2.0 到底差在哪](https://zooop.ai/zh/blog/gpt-image-2-5-vs-gpt-image-2)（2026-09-09）：
  - 「2.5 的纹路一根一根立着，翻领折边的走线也更实」——细节还原明显提升
  - 「茶壶这一组最能说明细节还原指的是什么……2.0 的倒影是一团模糊的暗影，2.5 把壶把、壶身、壶盖的倒影一一映在石面上」
  - 文字渲染：「面包店招牌上的 MORNING LOAF · est. 1987 和海报上的三行文案，两代模型全部拼对，一个字母都没错」
  - 4K 原生输出是「实实在在的新增」，不用先出 2K 再放大
- OpenAI 官方公告引用了 Adobe 产品高级总监 Matt Chotin 的评价：「带来更快的生成速度和稳定的分辨率」

**负面（很重要，刚发布就有争议）**

- [TechRadar：'The noise patterns are awful' — some Reddit users aren't happy with the new ChatGPT Images 2.5](https://www.techradar.com/ai-platforms-assistants/the-noise-patterns-are-awful-some-reddit-users-arent-happy-with-the-new-chatgpt-images-2-5-so-i-did-my-own-tests-and-have-to-agree)（2026-09-10）
  - Reddit 用户原话：「**The noise patterns are awful**」（噪点模式太糟糕了）
  - 另一位：「This…looks terrible.」
  - 最狠的一条：「They need to get rid of these noisy artifacts. **It makes it mostly useless for production.**」（必须去掉这些噪点伪影，这让它基本无法用于生产）
  - TechRadar 记者自己实测后**站队吐槽方**：「the grey studio background has a persistent granular texture」——描述模型「生成了大量视觉信息却没有决定哪些部分该清晰」，与 OpenAI 宣传的「更清晰细节、更丰富纹理」**相反**
- [ZOOOP 实测](https://zooop.ai/zh/blog/gpt-image-2-5-vs-gpt-image-2)的负面发现：
  - **升档不是同一张图变清晰，而是重新出了一张**：「Low、High、Max 三张里，别针从圆形徽记变成了树叶形状，内搭从白衬衫变成了米色毛衣又变回衬衫。**如果你指望先用 Low 定稿、再升 Max 出同一张高清图，这条路走不通**」
- **Sunburst 在文生图上不比 Flare 好**：「从零生成这件事上，Sunburst 不比 Flare 好……文生图和批量出稿，Sunburst 只会让你多等」。选版规则：默认 Flare，只在精确编辑时切 Sunburst。

---

## 4. 价格横向对比

统一口径：**一张 1024x1024 的图**，按 1 USD = 7.1 CNY 换算。

| 渠道 | 模型 | 质量档 | 单价（USD） | 单价（CNY） | 相对最便宜的倍数 |
| --- | --- | --- | --- | --- | --- |
| **OpenAI 官方** | gpt-image-1-mini | Low | **$0.005** | ¥0.036 | **1.0x（最便宜）** |
| **硅基流动** | Z-Image-Turbo | - | $0.005 | **¥0.10** | 1.0x（美元价）/ 2.8x（人民币价） |
| **阿里云百炼** | z-image-turbo | 标准 | $0.014 | ¥0.10 | 2.8x |
| **fal.ai** | Z-Image-Turbo | 1MP | $0.0053 | ¥0.038 | 1.1x |
| **OpenAI 官方** | gpt-image-1-mini | Medium | $0.011 | ¥0.078 | 2.2x |
| **OpenAI 官方** | gpt-image-2 | Low | $0.006 | ¥0.043 | 1.2x |
| **OpenAI 官方** | gpt-image-1-mini | High | $0.036 | ¥0.256 | 7.2x |
| **OpenAI 官方** | gpt-image-2 | Medium | $0.053 | ¥0.376 | 10.6x |
| **OpenAI 官方** | gpt-image-2.5-flare | Medium（推算） | 约 $0.053 | 约 ¥0.376 | 约 10.6x |
| **OpenAI 官方** | gpt-image-2 | High | $0.211 | ¥1.50 | 42x |
| **OpenAI 官方** | gpt-image-2.5-flare | High（推算） | 约 $0.211 | 约 ¥1.50 | 约 42x |
| **302.ai** | Z-Image-Turbo | - | $0.05 | ¥0.355 | 10x |

> 说明：硅基流动标 $0.005 与 ¥0.10 是因为官方页面同时给了两种计价口径（国际站按美元 $0.005/Image，国内站按人民币 ¥0.10/张）。**国内开发者实际付的是 ¥0.10/张。**

### 4.1 一万张图要花多少钱

| 方案 | 一万张成本 | 备注 |
| --- | --- | --- |
| Z-Image-Turbo（硅基流动 / 百炼） | **¥1,000** | 批量出图的不二之选 |
| gpt-image-1-mini Low（OpenAI） | $50 ≈ ¥355 | 更便宜且质量更好，但 Low 档 |
| gpt-image-1-mini Medium（OpenAI） | $110 ≈ ¥781 | 质量与成本平衡点 |
| gpt-image-2 Medium（OpenAI） | $530 ≈ ¥3,763 | 质量明显更好 |
| gpt-image-2 High（OpenAI） | $2,110 ≈ ¥14,981 | 高价值商稿才用 |

### 4.2 免费额度汇总

| 渠道 | 免费额度 | 说明 |
| --- | --- | --- |
| **硅基流动** | **14 元**（注册即得）+ 16 元（实名认证）+ 16 元/人（邀请，上不封顶） | 约 140 张图起步，最容易白嫖 |
| **阿里云百炼** | 每模型 100 万 Token，有效期 90 天 | **Z-Image 按张计费，是否覆盖存疑**，需实测 |
| **OpenAI** | ❌ **无免费额度** | Free tier 明确不支持图像模型，须 Tier 1+ 且完成组织验证 |
| **fal.ai** | 未找到明确免费额度（未核实） | - |
| **腾讯混元** | 首次开通发放免费额度，有「限时免费」接口（局部消除、扩图） | 不是 Z-Image，仅作参考 |

---

## 5. 风险与坑

### 5.1 第三方中转的跑路风险（务必注意）

国内中转站（API易、AIHubMix、302.ai、vectorengine 等）本质是**二道贩子**：你充值进的是他们的账户，不是 OpenAI 或阿里的。风险包括：

- **充值余额可能打水漂**（平台跑路、封号、风控冻结）
- **价格随时可调**（今天同价明天加价，无合同约束）
- **稳定性依赖对方运维**，出问题无处申诉
- **合规风险**：中转站通常无法提供正规发票

**建议**：只用中转做**测试和过渡**，生产环境和大额充值优先走官方（阿里云百炼、OpenAI 直连）或知名上市/大厂背景平台（硅基流动）。真要用中转，**不要一次性充大额**。

### 5.2 开源中转项目现状（自己搭中转的可选方案）

2026-09-27 直接查 GitHub API 验证「还活着吗」：

| 项目 | Stars | 最后提交 | Open Issues | 状态判断 |
| --- | --- | --- | --- | --- |
| [songquanpeng/one-api](https://github.com/songquanpeng/one-api) | 37,022 | **2026-01-09** | 1,037 | ⚠️ **已停更 8 个月**，issues 积压严重。老牌但已不活跃，不建议新项目用 |
| Calcium-Ion/new-api | - | - | - | ❌ 本次 GitHub API 查询**未能取到数据**（仓库名可能有变或已迁移），**存疑** |

> 检索中常提到的 `new-api`（one-api 的活跃分支）未能通过 API 验证，标记为「未核实」。如需自建中转，请先手动确认仓库当前状态再决定。

### 5.3 具体的技术坑

**Z-Image（阿里百炼）**

1. **`prompt_extend` 默认会让你花双倍钱**。设为 `true` 价格从 ¥0.10 变 ¥0.20。省钱务必显式传 `false`。
2. **图片 URL 只有 24 小时有效期**，必须及时转存到自己的对象存储。
3. `size` 用星号 `1024*1024`，不是 `1024x1024`。写错会报错。
4. `content` 数组**只能有 1 个 text 对象**，传多个报错。
5. 只支持单轮，不支持多轮对话式改图。

**GPT Image（OpenAI）**

1. **必须先完成 Organization Verification**，否则调不通。这是最容易被卡住的一步。
2. **Free tier 不可用**，得先充值到 Tier 1（IPM 只有 5，即每分钟 5 张图）。
3. **升 quality 档 = 重新生成一张不同的图**，不是同一张变清晰。想「Low 定稿 + High 出图」会失败（[ZOOOP 实测](https://zooop.ai/zh/blog/gpt-image-2-5-vs-gpt-image-2)）。
4. **参考图费用线性累加**：16 张参考图约 $0.13，与一张 high 输出同量级。多图融合时成本会失控。
5. **压缩图片文件体积不省钱**——token 由像素尺寸决定，与文件大小无关。
6. **gpt-image-2.5 的每张成本官方没给估算表**，只能用 2.0 的数字推算，**存在预算超支风险**。
7. **2.5 存在噪点质量争议**（TechRadar 2026-09-10 报道），生产环境建议先小批量验证。

### 5.4 本次调研的存疑项（诚实交代）

| 项目 | 状态 | 说明 |
| --- | --- | --- |
| gpt-image-2.5 的每张实际成本 | **存疑** | 官方明确说计算器不支持 2.5，只能用 2.0 数字推算 |
| CSDN 那篇「Z-Image v2」文章 | **存疑/不建议采信** | 页面抓取超时未读正文，参数与官方 6B 矛盾，判定为第三方镜像自造叫法 |
| Replicate / Together AI 的 Z-Image 上架 | **未找到** | 已检索但未找到明确证据 |
| 火山方舟 Z-Image 上架 | **未找到** | 已检索但未找到明确证据 |
| new-api 仓库当前状态 | **未核实** | GitHub API 未返回数据，仓库名可能已变 |
| fal.ai / Gitee AI 的免费额度 | **未找到** | 已检索未获明确信息 |
| 百炼免费额度是否覆盖 z-image | **存疑** | Z-Image 按张计费，官方未在价格页标注独立免费额度 |

---

## 6. 全部参考链接

### 官方 —— Z-Image / 阿里

- [Tongyi-MAI/Z-Image 官方 GitHub](https://github.com/Tongyi-MAI/Z-Image)（版本时间线、四变体、11,979 stars）
- [阿里云 z-image-turbo 模型信息页](https://help.aliyun.com/zh/model-studio/z-image-turbo)（价格，更新 2026-09-11）
- [阿里云 Z-Image API 参考](https://www.alibabacloud.com/help/zh/model-studio/z-image-api-reference)（接口、参数，更新 2026-09-11）
- [阿里云文生图总览](https://www.alibabacloud.com/help/zh/model-studio/text-to-image)
- [百炼新人免费额度规则](https://help.aliyun.com/zh/model-studio/new-free-quota)
- [阿里云图片生成与编辑模型解析](https://developer.aliyun.com/article/1759935)（2026-09-02，套餐价格）

### 官方 —— OpenAI

- [OpenAI Pricing](https://developers.openai.com/api/docs/pricing)（全部 token 单价）
- [Image generation 指南](https://developers.openai.com/api/docs/guides/image-generation)（代码示例）
- [gpt-image-2.5-flare 模型页](https://developers.openai.com/api/docs/models/gpt-image-2.5-flare)
- [gpt-image-2.5-sunburst 模型页](https://developers.openai.com/api/docs/models/gpt-image-2.5-sunburst)
- [gpt-image-2 模型页](https://developers.openai.com/api/docs/models/gpt-image-2)
- [gpt-image-1-mini 模型页](https://developers.openai.com/api/docs/models/gpt-image-1-mini)（按张定价表）
- [隆重推出 ChatGPT 图像 2.5](https://openai.com/zh-Hans-CN/index/introducing-chatgpt-images-2-5/)（2026-09-08 发布公告）

### 第三方渠道

- [硅基流动定价](https://siliconflow.cn/pricing) / [国际站定价](https://www.siliconflow.com/zh/pricing)
- [硅基流动计费说明](https://docs.siliconflow.com/cn/faqs/billing-rules)（14 元免费额度）
- [SiliconFlow Z-Image-Turbo 模型页](https://www.siliconflow.com/models/z-image-turbo)（$0.005/Image）
- [fal.ai Z Image Turbo API](https://fal.ai/docs/model-api-reference/image-generation-api/z-image-turbo)（$0.005/MP）
- [302.ai Z-Image-Turbo](https://302.ai/product/detail/z-image-turbo)（$0.05/次）
- [AIHubMix Image-Gen 文档](https://aihubmix.mintlify.app/cn/api/Image-Gen)
- [API易 gpt-image-2 文档](https://docs.apiyi.com/api-capabilities/gpt-image-2/overview)（实测参考图 token 数据）
- [VectorEngine 定价](https://api.vectorengine.cn/pricing)
- [Gitee AI Z-Image-Turbo](https://ai.gitee.com/hf-models/Tongyi-MAI/Z-Image-Turbo)
- [腾讯混元生图计费](https://cloud.tencent.com/document/product/1668/90896)

### 评价与实测

- [TechRadar: 'The noise patterns are awful'...ChatGPT Images 2.5](https://www.techradar.com/ai-platforms-assistants/the-noise-patterns-are-awful-some-reddit-users-arent-happy-with-the-new-chatgpt-images-2-5-so-i-did-my-own-tests-and-have-to-agree)（2026-09-10）
- [ZOOOP: GPT Image 2.5 和 2.0 到底差在哪](https://zooop.ai/zh/blog/gpt-image-2-5-vs-gpt-image-2)（2026-09-09）
- [V2EX: Z-Image-Turbo 还是有点意思的](https://www.v2ex.com/t/1183650)（2026-01-07）
- [V2EX: 基于 Z-Image Turbo 做了个能在线用的小工具](https://www.v2ex.com/t/1177881)（2025-12-09）
- [V2EX: 写了一个聚合的 AI 生成网站](https://www.v2ex.com/t/1180289)（2025-12-21）
- [saascrmreview: Z-Image Turbo Review](https://saascrmreview.com/z-image-turbo-review/)（2026-03-07）
- [GitHub Issue #108 Z-image release timeline](https://github.com/Tongyi-MAI/Z-Image/issues/108)
- [GitHub Issue #126 At least tell us what is happening](https://github.com/Tongyi-MAI/Z-Image/issues/126)
- [ModelCostWatch: GPT Image 2 Pricing](https://www.modelcostwatch.com/models/openai-gpt-image-2)
- [aifreeapi: GPT Image 1 Mini 价格](https://www.aifreeapi.com/zh/posts/gpt-image-1-mini-pricing)
- [知乎: 硅基流动上线阿里 Z-Image](https://zhuanlan.zhihu.com/p/2041228520328803887)（2026-05-22）

### 自建中转

- [songquanpeng/one-api](https://github.com/songquanpeng/one-api)（37k stars，但 2026-01-09 后停更）

---

## 7. 最后的建议（给中国开发者的三句话）

1. **默认选硅基流动的 Z-Image-Turbo**（¥0.10/张，OpenAI 兼容格式，14 元赠金起步）。它和阿里官方同价，但注册门槛低得多，改个 base_url 就能接入现有代码。
2. **如果画质不够用，跳到 OpenAI `gpt-image-1-mini`**（Low 档 $0.005/张，和 Z-Image 同价但质量更好；Medium 档 $0.011 是最佳平衡点）。别一上来就用 gpt-image-2.5，Medium 档 $0.053/张是 Z-Image 的 3.8 倍，而且刚发布有噪点争议。
3. **生产环境别依赖中转站**。中转对 OpenAI 图像模型基本是平价转售，省不下钱（API易靠充值送 10-20%，是唯一实打实的优惠）。真想省钱是**换便宜的模型**，不是换渠道。

---

*报告完。所有价格数字均标注了来源 URL 与抓取日期（2026-09-27）。存疑项已在 §5.4 明确列出，未编造任何数字。*
---


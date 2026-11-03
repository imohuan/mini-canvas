# MiniMax「3」系列调研：图片生成 / 视频生成 API 选型报告

> 调研日期：2026-09-27
> 调研人：B 组（MiniMax 3）
> 目标读者：中国开发者，想为「图片生成 / 视频生成」找便宜好用的 API
> 数据抓取方式：MiniMax 官方 OpenAPI 文档站（`platform.minimax.io` / `platform.minimaxi.com`，直接 curl `.md` 原文）、OpenRouter 公开 models API、fal.ai 模型页、Exa/Tavily 多轮交叉检索

---

## 0. 一分钟结论（先看这里）

**用户说的 "minimax 3" 是个歧义词，但三个候选里只有两个跟图/视频有关：**

| 用户可能指 | 真实模型 | 是做什么的 | 跟图/视频生成的关系 |
| --- | --- | --- | --- |
| MiniMax-M3 | ✅ 存在 | 文本大语言模型（1M 上下文，Coding/Agent 向） | ❌ **不是**。OpenRouter 数据：`output_modalities=["text"]`，架构 `text+image+video->text`，只能"看懂"图/视频，不能生成 |
| MiniMax-H3 | ✅ 存在 | **视频生成模型**（海螺新一代，2026-07-31 发布） | ✅ 这是"minimax 3"最可能的视频答案 |
| Hailuo 3 / Hailuo-03 | ⚠️ 别名 | 就是 MiniMax-H3 的俗称 | ✅ 同一件事 |

**一句话纠正：如果你要的是图片或视频生成，"MiniMax-M3" 用不了。图片要看 `image-01`，视频要看 `MiniMax-H3`。**

**最便宜的三条路（按优先级）：**

1. **图片生成 → 官方 `image-01` 直连，`$0.0035/张`（约 ¥0.025/张）。这是全市场最便宜的一档，没有中转能明显更便宜，直接官方买就行。**
2. **视频生成 → fal.ai 的 `MiniMax-H3` 768p，`$0.06/秒`（官方国际版是 $0.08/秒，便宜 25%；官方国内版 ¥0.50/秒≈$0.07）。fal 上 5 秒 768p = $0.30。**
3. **视频生成（极限省钱）→ fal.ai 的 `MiniMax H3 Max Turbo` 480p，`$0.025/秒`，5 秒 = $0.125。这是能找到的 MiniMax 系最便宜档位。**

---

## 1. 摘要决策表

| 渠道 | 模型 | 单价 | OpenAI 兼容 | 稳定性质疑 | 推荐度 |
| --- | --- | --- | --- | --- | --- |
| **官方国际版** `api.minimax.io` | `image-01` | $0.0035/张 | ❌ 自有格式 | RPM 仅 10，并发很紧 | ⭐⭐⭐⭐⭐ 图片首选 |
| **官方国内版** `api.minimaxi.com` | `image-01` / `image-01-live` | ¥0.025/张 | ❌ 自有格式 | RPM 10 / TPM 60 | ⭐⭐⭐⭐ 国内主体首选 |
| **官方国际版** | `MiniMax-H3` | $0.08/秒(768P)、$0.13/秒(2K) | ❌ 自有异步格式 | 免费用户并发仅 2 | ⭐⭐⭐⭐ |
| **官方国内版** | `MiniMax-H3` | ¥0.50/秒(768P)、¥0.80/秒(2K) | ❌ 自有异步格式 | 同上 | ⭐⭐⭐⭐ |
| **官方（两版）** | `MiniMax-H3-Max` | $0.05/秒(480P)、$0.08/秒(768P) | ❌ 自有格式 | 仅国际版文档明确列出 | ⭐⭐⭐ |
| **fal.ai**（第三方，fal 官方合作） | `MiniMax-H3` | $0.06/秒(768P)、$0.13/秒(2K)、$0.16/秒(4K) | ❌ fal SDK | 促销价可能到期 | ⭐⭐⭐⭐⭐ 视频最便宜 |
| **fal.ai** | `H3 Max` / `H3 Max Turbo` | $0.05/$0.025/秒(480P)、$0.08/$0.04/秒(768P) | ❌ fal SDK | 75% 首发折扣已于 2026-09-14 结束 | ⭐⭐⭐⭐ |
| **阿里云百炼 DashScope** | `MiniMax/MiniMax-H3` | ¥0.50/秒(768P)、¥0.80/秒(2K) | ❌ 百炼异步格式 | 官方原价，无折扣 | ⭐⭐⭐ 已有阿里云账号可用 |
| **EvoLink**（第三方聚合） | `minimax-h3-*` | $0.076/秒(768P)、$0.124/秒(2K)（−5%） | ❌ 自有格式 | 小平台，跑路风险 | ⭐⭐ |
| **302.AI**（第三方聚合） | `MiniMax-H3` | $0.0858/秒起 | ❌ 自有格式 | PTC 计价 + 约 5% 手续费 | ⭐⭐ |
| **OpenRouter** | 仅 M 系列文本 | $0.30/$1.20 每百万 token | ✅ | — | ❌ 不做图/视频 |
| **本地部署（开源权重）** | `MiniMax-H3`（HF 9.2k star） | 0 元（自付电费/显卡） | ❌ ComfyUI | 显存门槛高，2K 管线未开源 | ⭐⭐⭐ 有卡再说 |

---

## 2. 命名澄清："minimax 3" 到底是什么

### 2.1 MiniMax 在 2026-09 的完整在售产品线（官方 `models-intro` 页面实测）

| 方向 | 在售模型 | 说明 |
| --- | --- | --- |
| **语言 LLM** | `MiniMax-M3`（1M 上下文）、`MiniMax-M2.7`、`MiniMax-M2.7-highspeed` | M3 是"原生多模态、1M 上下文的 Frontier Coding 模型" |
| **视频** | **`MiniMax-H3`**、**`MiniMax-H3-Max`** | H3：文生/图生/首尾帧/多模态参考，768P/2K，4–15s；H3 Max：fal.ai 后训练极速版，480P/768P，5–15s |
| **语音** | `speech-2.8-hd`、`speech-2.8-turbo` | 另有 asr-1.0（语音转文字） |
| **图像** | **`image-01`**、**`image-01-live`** | 文生图 + 图生图（人物主体参考） |
| **音乐** | `music-3.0`、`music-2.6`、`music-cover` | ⚠️ 2026-08-20 起付费接口不再面向新用户 |

历史模型（仍可调用）：`MiniMax-M2.5 / M2.1 / M2`、`MiniMax Hailuo 2.3 / 2.3 Fast / 02`、`speech-2.6-*`、`speech-02-*`。

### 2.2 关键澄清（重要）

**① MiniMax-M3 不是图片/视频生成模型。**

父代理抓的 OpenRouter 硬数据已证实：`minimax/minimax-m3`（canonical `minimax-m3-20260531`，HF `MiniMaxAI/Minimax-M3`，created ≈2026-05-31）的 `architecture.output_modalities` 只有 `["text"]`，架构是 `text+image+video->text`。它是**多模态理解**的文本模型——能读图读视频，但吐出来只有文字。

我另外独立抓了一次 OpenRouter 全量 458 个模型做交叉验证：MiniMax 系共 8 个条目，**全部 `output_modalities=text`**。所以"用 M3 生图生视频"这条路是死的。

**② "Hailuo 3" / "Hailuo-03" 是 MiniMax-H3 的民间叫法，不是独立模型。**

证据：MiniMax 官方 OpenAPI spec 里，视频 V2 接口的 `info.description` 直接写着 `MiniMax video generation V2 (Hailuo-03) API`，但 `model` 枚举只有 `MiniMax-H3` / `MiniMax-H3-Max`。也就是说 **H3 = Hailuo 03 = 海螺第三代**，只是官方现在统一叫 H3。

**③ 图片生成模型没有"3"这个版本号。**

图片线只有 `image-01`（2025-02 发布）和它的画风增强版 `image-01-live`。**不存在 "image-03"。** 截至 2026-09 官方模型总览里图片模型仍然只有这两个。所以如果用户以为有"MiniMax Image 3"，那是个误解。

### 2.3 图片 / 视频模型的能力对照

**图片：`image-01`**

- 能力：文生图 + 图生图（主体参考，单张参考图，支持保持人物特征）
- 分辨率：默认按宽高比（1:1 = 1024×1024、16:9 = 1280×720 等 8 种）；也可自定义 `width`/`height`，范围 [512, 2048]，必须是 8 的倍数
- 单次请求最多 9 张（`n` ∈ [1,9]）
- prompt 上限 1500 字符
- 返回：`url`（**24 小时过期**）或 `base64`
- 支持 `seed` 复现、`prompt_optimizer` 自动优化 prompt

**视频：`MiniMax-H3`**

- 发布时间：2026-07-31 上线，2026-08-03 开源权重（HF `MiniMaxAI/MiniMax-H3`，现 9,250 star）
- 能力：文生视频、图生视频（首帧/尾帧/首尾帧）、多模态参考生视频（图+视频+音频混合参考）
- 分辨率：768P / 2K（官方）；fal.ai 上另有 480P 和 4K 档
- 时长：4–15 秒（官方）；24 fps
- **原生立体声**：语音/音效/音乐与画面同一次前向生成，不需要后期配音。这是 H3 相对 Hailuo 2.3 最大的差异点
- 参考输入上限：参考图 ≤ 9 张、参考视频 ≤ 3 个、参考音频 ≤ 3 个
- 另有 `H3-Context-IR` 任务（让模型深度理解多模态上下文、生成结构化增强 prompt）和 `768P→2K` 视频再生成任务

**视频：`MiniMax-H3-Max`**

- 由 **fal.ai** 基于 H3 后训练（"post-trained by fal.ai"，官方文档明说）
- 仅支持文生/图生（首帧、尾帧），480P / 768P（**不支持 2K**），5–15 秒
- 主打速度：302.AI 实测称"3 秒生成 5 秒 720p，渲染速度首次跑赢播放"
- OpenRouter 页面显示 released 2026-09-02

---

## 3. 官方 API 详述（国际版 vs 国内版）

### 3.1 两个平台的账号与价格体系差异（重要）

| 项目 | 国际版 | 国内版 |
| --- | --- | --- |
| 文档域名 | `platform.minimax.io` | `platform.minimaxi.com` |
| API base URL | `https://api.minimax.io` | `https://api.minimaxi.com` |
| 结算币种 | USD | CNY（人民币） |
| 账号体系 | 独立 | 独立（控制台在 `platform.minimax.cn`） |
| 联系邮箱 | api@minimax.io | api@minimaxi.com |
| 图片模型 | 文档 pricing 只列 `image-01` | 多一个 **`image-01-live`**（手绘/卡通画风增强），同价 |
| 速率限制文档 | 不分免费/充值 | **分免费用户 / 充值用户**，免费档更狠 |

**价格换算对照（2026-09-27 抓取，按 1 USD ≈ 7.1 CNY 粗算）：**

| 项目 | 国际版 | 国内版 | 折算后对比 |
| --- | --- | --- | --- |
| image-01 | $0.0035/张 | ¥0.025/张 (≈$0.0035) | **基本同价** |
| H3 768P | $0.08/秒 | ¥0.50/秒 (≈$0.070) | 国内版便宜约 12% |
| H3 2K | $0.13/秒 | ¥0.80/秒 (≈$0.113) | 国内版便宜约 13% |
| H3 参考图（超 5 张） | $0.04/张 | ¥0.20/张 (≈$0.028) | 国内版便宜约 30% |
| H3 再生成 768P→2K | $0.05/秒 | ¥0.30/秒 (≈$0.042) | 国内版便宜约 16% |
| H3-Context-IR | $0.90/$3.60 每百万 token | ¥5.80/¥23.00 每百万 token | 国内版便宜约 9% |
| M3 输入（≤512k，五折后） | $0.30/M | ¥2.10/M (≈$0.296) | 基本同价 |
| Hailuo-02 512P 6s | $0.10/条 | ¥0.60/条 (≈$0.085) | 国内版便宜约 15% |

**结论：国内版整体略便宜（10%–30%），且有 `image-01-live` 独占模型；国际版的好处是不用实名/国内主体，且 H3-Max 的文档和价格更明确。**

### 3.2 图片生成 API（可直接抄）

**接口**：`POST /v1/image_generation`

**国际版：**

```bash
curl -X POST "https://api.minimax.io/v1/image_generation" \
  -H "Authorization: Bearer $MINIMAX_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "image-01",
    "prompt": "一只穿着白衬衫的猫，站在威尼斯海滩的指示牌前，90年代纪录摄影风格，胶片颗粒，写实",
    "aspect_ratio": "16:9",
    "response_format": "base64",
    "n": 3,
    "prompt_optimizer": true
  }'
```

**国内版**：把域名换成 `https://api.minimaxi.com`，`model` 可用 `image-01` 或 `image-01-live`，其余一致。

**Python（国际版，官方示例改写）：**

```python
import base64, os, requests

url = "https://api.minimax.io/v1/image_generation"
headers = {"Authorization": f"Bearer {os.environ['MINIMAX_API_KEY']}"}
payload = {
    "model": "image-01",
    "prompt": "A man in a white t-shirt, full-body, Venice Beach sign, 90s documentary, film grain, photorealistic",
    "aspect_ratio": "16:9",
    "response_format": "base64",
}
r = requests.post(url, headers=headers, json=payload)
r.raise_for_status()
for i, b64 in enumerate(r.json()["data"]["image_base64"]):
    open(f"out-{i}.jpeg", "wb").write(base64.b64decode(b64))
```

**图生图（主体参考）：** 加 `subject_reference` 数组，每次只支持 1 张参考图：

```python
payload = {
    "model": "image-01",
    "prompt": "A girl stands by the library window, gazing into the distance",
    "aspect_ratio": "16:9",
    "subject_reference": [{"type": "character", "image_file": "https://.../ref.jpg"}],
    "response_format": "base64",
}
```

**响应关键字段：**

```json
{
  "id": "03ff3cd0820949eb8a410056b5f21d38",
  "data": { "image_urls": ["...", "..."] },
  "metadata": { "success_count": 3, "failed_count": 0 },
  "base_resp": { "status_code": 0, "status_msg": "success" }
}
```

> ⚠️ `metadata.failed_count` 是**内容安全被拦**的张数。被拦的图不计费，但占用请求额度——这是隐性成本，见 §6。

**鉴权**：`Authorization: Bearer <API Key>`。按量付费 Key 与 Token Plan 订阅 Key **互相独立、不能混用**。

**速率限制（图片）：** 国际版 RPM 10；国内版 RPM 10 / TPM 60，免费与充值用户一样。**10 RPM 是硬伤**——一分钟最多 10 次请求，好在每次最多出 9 张，所以理论峰值是 90 张/分钟，但要靠 `n` 拉满。

### 3.3 视频生成 API（可直接抄）

**接口**：`POST /v2/video_generation`（异步，返回 `task_id`），再轮询 `GET /v2/query/video_generation/{task_id}`

```bash
# 1) 提交任务（文生视频）
curl -X POST "https://api.minimax.io/v2/video_generation" \
  -H "Authorization: Bearer $MINIMAX_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "MiniMax-H3",
    "content": [
      {"type": "text", "text": "太空歌剧预告：女舰长独自站在巨大的观测窗前，最后的舰队跃迁消失在闪光中，舰桥震颤"}
    ],
    "resolution": "2K",
    "duration": 5,
    "ratio": "16:9"
  }'
# → {"task_id": "424010985738629"}

# 2) 轮询结果
curl "https://api.minimax.io/v2/query/video_generation/424010985738629" \
  -H "Authorization: Bearer $MINIMAX_API_KEY"
```

**图生视频（首帧）**：`content` 里加 `{"type":"image_url","image_url":{"url":"..."},"role":"first_frame"}`，此时 `ratio` 恒为 `adaptive`。

**参考生视频**：`content` 里混放 `image_url`(role=`reference_image`)、`video_url`(role=`reference_video`)、`audio_url`(role=`reference_audio`)。

**成功响应：**

```json
{
  "task": {
    "id": "424010985738629",
    "model": "MiniMax-H3",
    "status": "succeeded",
    "content": { "url": "https://.../h3-2k-output.mp4" },
    "resolution": "2K",
    "duration": 5,
    "usage": { "total_seconds": 5, "input_seconds": 0, "output_seconds": 5, "input_image_count": 0 },
    "task_type": "generation"
  }
}
```

> `usage` 字段是排查计费争议的钥匙：`total_seconds = input_seconds + output_seconds`。**参考视频的秒数会加进计费时长**，参考图和参考音频不加。

**其他参数**：`callback_url`（回调，服务端会先发 `challenge` 要求 3 秒内原样返回）、`aigc_watermark`（是否加水印，默认 false）。

**速率限制（视频 V2 / H3）：** RPM 300，最大并行任务数 **15（充值）/ 2（免费）**。国内版文档标注充值用户 15、免费 2；国际版 rate-limits 页只写了 30 inflight（两版文档略有出入，**存疑**，建议实测）。

**H3-Context-IR 任务**：另一个创建入口，让模型深度理解多模态上下文并生成结构化增强 prompt（响应里从 `content.prompt` 取）。输入 ¥5.80/百万 token、输出 ¥23.00/百万 token（国内）/ $0.90/$3.60（国际）。

### 3.4 官方完整价格表（2026-09-27 抓取）

**视频输出（国际版 USD / 国内版 CNY）：**

| 模型 | 分辨率 | 国际版 | 国内版 |
| --- | --- | --- | --- |
| MiniMax-H3 | 768P | $0.08/秒 | ¥0.50/秒 |
| MiniMax-H3 | 2K | $0.13/秒 | ¥0.80/秒 |
| MiniMax-H3-Max | 480P | $0.05/秒 | 文档未列（存疑） |
| MiniMax-H3-Max | 768P | $0.08/秒 | 文档未列（存疑） |
| MiniMax-H3-Regeneration | 768P→2K | $0.05/秒 | ¥0.30/秒 |

**视频输入素材：**

| 素材 | 规则 |
| --- | --- |
| 音频 | 免费 |
| 图片 | 前 5 张免费，超出 $0.04/张（国内 ¥0.20/张） |
| 视频 | 按输入时长 × 输出分辨率费率：768P $0.08/秒、2K $0.13/秒 |

**历史模型（按条计费，国际版）：**

| 模型 | 规格 | 价格 |
| --- | --- | --- |
| Hailuo-2.3-Fast | 768P 6s | $0.19 |
| Hailuo-2.3-Fast | 768P 10s | $0.32 |
| Hailuo-2.3-Fast | 1080P 6s | $0.33 |
| Hailuo-2.3 | 768P 6s | $0.28 |
| Hailuo-2.3 | 768P 10s | $0.56 |
| Hailuo-2.3 | 1080P 6s | $0.49 |
| Hailuo-02 | 512P 6s / 10s | $0.10 / $0.15 |

国内版对应价（元/条）：2.3-Fast 768P 6s ¥1.35、10s ¥2.25、1080P 6s ¥2.31；2.3 768P 6s ¥2.00、10s ¥4.00、1080P 6s ¥3.50；Hailuo-02 512P 6s ¥0.60、10s ¥1.00。

**图片：** `image-01` / `image-01-live` — $0.0035/张（国际）、¥0.025/张（国内）。

**语言模型（顺带，供参考）：** M3 ≤512k 输入五折后 $0.30/M in、$1.20/M out、cache read $0.06/M；>512k 翻倍。优先档（service_tier=priority）1.5 倍价。M2.7 $0.30/$1.20。

### 3.5 Token Plan 订阅包（能不能用来生图/视频）

| 档位 | 国际版 | 国内版 |
| --- | --- | --- |
| Plus | $22/月 | ¥49/月 |
| Max | $55/月 | ¥119/月 |
| Ultra | $132/月 | ¥469/月 |

**关键限制（两版文档都明写）：** 「少量特殊模型（**MiniMax H3**、音色设计、快速复刻等）**暂不支持**」。

也就是说——**订阅包不能用来跑 H3 视频**。国内版订阅页补充：Max 档给 Hailuo 2.3 视频 3 条/日，Ultra 档 5 条/日。Plus 档视频生成是 `×`（完全不支持）。

> 想跑 H3，只能走**按量付费**（官方原话："To use MiniMax H3 or MiniMax H3 Max, please select the Pay-as-you-go API"）。另外官方明确：**已有的 Hailuo 视频点数包不支持 H3**，别以为旧余额能cover。

---

## 4. 第三方中转与聚合渠道

### 4.1 fal.ai ⭐ 推荐（视频最便宜，且是 MiniMax 官方合作方）

fal 不是普通倒爷——**MiniMax-H3-Max 就是 fal.ai 后训练的**，官方文档里点名致谢。所以 fal 上的 H3 是"半个官方渠道"，稳定性相对有保障。

| 模型 / 端点 | 480P | 768P | 2K | 4K |
| --- | --- | --- | --- | --- |
| `minimax/h3/*`（t2v / i2v / r2v） | $0.05/秒 | **$0.06/秒** | $0.13/秒 | $0.16/秒 |
| `minimax/h3-max/*` | $0.05/秒 | $0.08/秒 | 不提供 | 不提供 |
| `h3-max-turbo` | **$0.025/秒** | $0.04/秒 | 不提供 | $0.08/秒 |

**对比官方国际版：fal 的 H3 768P 是 $0.06/秒，官方 $0.08/秒 —— 便宜 25%。** 5 秒 768p = fal $0.30 vs 官方 $0.40。

**最便宜档位**：`h3-max-turbo` 480P **$0.025/秒**，5 秒 = $0.125（约 ¥0.89）。

⚠️ **促销陷阱**：fal 的 H3 Max 曾挂 75% 首发折扣，**已于 2026-09-14 结束**；另有页面称 50% 促销价（480P $0.025、768P $0.04）在 9-30 前后到期。**抓取时 fal 页面上同时存在"促销价"和"常规价"两套数字，互相矛盾**（同一 URL 一处写 $0.0125/480p、另一处写 $0.025/480p）。**这个价格存疑，务必以控制台实时价为准。**

其他：fal 上 H3 参考图前 5 张免费，超出 $0.08/张（比官方 $0.04 贵一倍）；H3 Max 是前 2 张免费、超出 $0.074/张。fal 每天前 5 次生成免费。

**OpenAI 兼容？** ❌ 否，用 fal 自己的 JS/Python SDK（`@fal-ai/client` / `fal.subscribe`）。

### 4.2 阿里云百炼 DashScope（国内，官方原价）

**支持**：`MiniMax/MiniMax-H3`（视频）、`MiniMax/MiniMax-M3`（文本，含图像/视频理解）。**未找到 image-01 上架百炼的证据**（搜了"百炼 MiniMax image-01 图片生成"，结果只返回 M3 的多模态理解和 H3 视频，**图片生成模型未在百炼上架**——标注为「未找到」）。

**价格（2026-09-10/09-21 阿里云文档）**：与 MiniMax 国内版原价完全一致 —— 768P ¥0.50/秒、2K ¥0.80/秒，输入素材规则也一致。**没有折扣**。

**接口形态不同**（不是 MiniMax 原生格式）：

```bash
curl -X POST "https://dashscope.aliyuncs.com/api/v1/services/aigc/video-generation/video-synthesis" \
  -H "Authorization: Bearer $DASHSCOPE_API_KEY" \
  -H "X-DashScope-Async: enable" \
  -H "Content-Type: application/json" \
  -d '{"model":"MiniMax/MiniMax-H3","input":{"prompt":"...","media":[{"type":"first_frame","url":"..."}],"parameters":{"resolution":"768P","duration":5}}}'
```

必带 `X-DashScope-Async: enable` 头，否则报 "current user api does not support synchronous calls"。`media` 类型用 `first_frame`/`last_frame`/`image_url`/`feature`/`driving_audio`（跟 MiniMax 原生的 `role` 命名不同）。

**便宜吗？** 不便宜，就是官方原价。价值在于**国内合规、能开发票、已有阿里云账号可复用额度**。RPM 300。

### 4.3 硅基流动 SiliconFlow ❌ 不做 MiniMax 图/视频

抓了 SiliconFlow 定价页：**只有 MiniMax-M2.5 和 MiniMax-M3 两个文本模型**（M3：$0.30/M in、$0.06/M cached、$1.20/M out）。图片生成区是 FLUX 系列（FLUX.1-dev $0.014/张 起），视频区是 Wan2.2（$0.29/条）。

**结论：SiliconFlow 上跑不了 MiniMax 的图片/视频模型。** 如果你的诉求是"最便宜出图"，SiliconFlow 的 FLUX.1-dev $0.014/张其实比 image-01 的 $0.0035/张贵 4 倍，image-01 依然更便宜。

### 4.4 OpenRouter ❌ 只有文本

独立抓全量 458 个模型验证：MiniMax 系 8 个（`minimax-m3`、`m2.7`、`m2.5`、`m2-her`、`m2.1`、`m2`、`m1`、`minimax-01`），**全部 output_modalities=text**。

⚠️ 但 OpenRouter 有一个 `minimax/hailuo-3-max` 的**展示页**（released 2026-09-02，from $0.05/second），同时 openrouter.ai/minimax 页面文案称 "OpenRouter serves 13 MiniMax models"。**这个 slug 没有出现在 `/api/v1/models` 的 data 里**——可能是页面已建、路由未通，或视频模型走单独的 API。**存疑，需要实测，不要直接写进生产代码。**

### 4.5 EvoLink（第三方聚合，便宜 5%）

| 模型 | EvoLink | 官方 | 节省 |
| --- | --- | --- | --- |
| `minimax-h3-text-to-video` 768p | $0.076/秒 | $0.080/秒 | −5% |
| H3 2K | $0.124/秒 | $0.130/秒 | −5% |
| `MiniMax-Hailuo-2.3-Fast` 768p 6s | $0.177/条 | $0.190/条 | −7% |
| `MiniMax-Hailuo-02` 512p 6s | $0.080/条 | $0.100/条 | −21% |
| H3 Max 480P | $0.048/秒 | $0.050/秒 | −5% |

计费：1 积分 ≈ $0.0147，最低充值 $10。支持支付宝/微信/对公。**官方宣称"失败、过期与被拒的任务全额退款"**——这点比官方友好（官方对失败是否扣费没有明说）。

**风险**：小平台，跑路风险实打实存在。折扣只有 5%，省的钱不值得承担资金风险。**不推荐作为主渠道。**

### 4.6 302.AI（第三方聚合，按 PTC 计价）

- `MiniMax-H3`：$0.0858/秒起（**比官方 $0.08/秒还贵**，没便宜）
- `MiniMax-H3-Max`：$0.06/秒起
- Hailuo-02（旧文档）：512P 6s 0.1 PTC、768P 6s 0.3 PTC、1080P 6s 0.6 PTC

**计价坑**：单位是 PTC，**1 PTC ≈ 1 美元**，但充值要另付约 5% 手续费（有用户吐槽"充 1 美金要 0.5 美金手续费"）。新用户送 1 PTC。

**结论：302.AI 上 H3 比官方贵，不推荐。** 平台本身活跃（有 302.AI 基准实验室持续发 H3/H3 Max 实测文章），但价格没优势。

### 4.7 AIHubMix / API易 / vectorengine / closeai / Gitee AI / 腾讯混元 / 火山方舟

- **AIHubMix**：有统一的 `/v1/videos` 视频接口（OpenAI 风格 Bearer 鉴权），文档支持可灵、Seedance、通义万相等。**未找到明确上架 MiniMax 图/视频模型的证据**（搜索结果里 MiniMax 只出现在"免费 LLM 模型"列表里，指文本模型）。标注「存疑」。
- **vectorengine / closeai / 聚光 / 灵枢**：**未找到**可信的 MiniMax 图/视频上架页面。搜到的都是 SEO 聚合站转抄官方价格，无法验证。标注「未找到」。
- **Gitee AI**：**未找到** MiniMax 图/视频相关页面（搜索词被噪声淹没，返回大量无关结果）。标注「未找到」。
- **火山方舟 / 腾讯混元**：这两家是**竞品**（做自己的视频/图片模型），不是 MiniMax 的中转渠道。不适用。

### 4.8 开源中转项目（自建转发）

| 项目 | Star | 最近提交 | MiniMax 视频支持 |
| --- | --- | --- | --- |
| `QuantumNous/new-api` | 48,949 | **2026-09-25**（活跃） | ✅ 有 `hailuo-video` 渠道；**H3 V2 接口支持是 issue #6815 提出的**，引用 PR #7168 / #7171 |
| `songquanpeng/one-api` | 37,021 | 2026-01-09（**已停更 8 个月**） | ✅ README 勾选 MINIMAX，但只到老接口 |

**new-api 的 H3 支持状态值得注意**：issue #6815 描述了完整的实现方案（V2 接口分流、duration [4,15] 校验、按输出秒数 × 分辨率倍率计费），但 issue 里有一条 "需要根据插件系统重做 pr"，且被 Calcium-Ion close 了。引用了 PR #7168（feat）和 #7171（fix: bill MiniMax-H3 input media usage）。**说明功能已合入或正在合入，但版本依赖要自己确认。**

自建的价值：OpenAI 格式统一入口 + 多渠道负载均衡 + 计费倍率自控。适合已经在一堆渠道间倒腾的团队。

### 4.9 本地部署（开源权重，0 API 费用）

**MiniMax-H3 已开源权重**（2026-08-03）：

- HF `MiniMaxAI/MiniMax-H3`（9,250 star，created 2026-07-30，最后 push 2026-08-15），Diffusers 格式，FL2VA 和 Ref2VA 两个变体
- ComfyUI 原生支持：Comfy-Org/ComfyUI PR #15224（2026-08-03 合并），需 ComfyUI ≥ 0.30.0，内置 6 套官方工作流模板
- 33B 参数

**⚠️ 两个必须知道的坑：**

1. **2K 管线未开源**。YouTube 深度评测（Oxen 频道，2026-08-08）明确说："there's one piece of the pipe that they did not open source, which is the 2K resolution"。**本地跑只能到 768P。** 知乎专栏《MiniMax H3开放权重了，本地为什么仍只到768P？》也在讨论这个。
2. **商用要授权**。Comfy 官方文档写：本地生成内容的商用需要 MiniMax 商业许可，**Comfy 是唯一官方转售渠道**；Comfy Cloud 上的生成已含商用权。社区许可协议大致是"非商用免费，年收入低于 2000 万美元的组织可商用"（来源：Segmind 博客转述，**建议直接读 license 原文**）。

**性能参考**：Reddit 上有用户用 RTX PRO 6000 / Ryzen 9 9950X / 128GB 跑 1MP、24fps、15 秒 BF16 素材，最长渲染约 23 分钟。显存和内存门槛都不低。

---

## 5. 真实评价汇总（正负面都有，带出处）

### 5.1 正面

**① 开源 + 本地可控，社区口碑很好**

Reddit 上有创作者用 H3 在 ComfyUI 里做了 2:21 的完整短片（MEOW 47），原文："Reference images were created with Krea 2 RAW... What impressed me most with H3 was the prompt understanding and reference adherence... H3 gave me enough control to actually build a complete film instead of a collection of disconnected clips."（快照见 reddit.sentinel-team.org 2026-08-21 存档）

`MiniMaxAI/MiniMax-H3` HF 仓库 9,250 star，GitHub issue 活跃度正常。

**② 视频编辑榜第一**

Zawa（2026-08-12）横评：MiniMax H3 "currently ranks first on the Artificial Analysis video-editing leaderboard"，文生视频排第二（Seedance 2.0 第一）。302.AI 的文章称 fal 基于开源 H3 训的 H3 Max"吞吐量达官方接口 35 倍，登顶 Artificial Analysis 图生视频榜"。

**③ 原生音频是真差异点**

H3 把语音、音效、音乐和画面放在同一次前向里生成。Reddit 用户反馈"H3 gave me enough control"，社区普遍认为这省掉了整个后期配音环节。

**④ 便宜是共识**

第三方横评（dream pixel forge）算过账：H3 2K $0.13/秒 vs Veo 3.1 1080p $0.40/秒，**便宜 3.1 倍**。官方自己也宣称 2K 不到主流模型三分之一、768p 不到主流 720p 的一半。

**⑤ 图片便宜到没对手**

`image-01` 官方发布时就主打"1/10 的价格"（`minimax.io/news/image-01`）。$0.0035/张 这个价位，市场上基本没有能打的（DALL·E 约 $0.04–0.08/张，FLUX.1-dev 在 SiliconFlow 是 $0.014/张）。

### 5.2 负面（这些更要紧）

**① 审核/拒画严重，而且是静默的** ⚠️

这是被吐槽最多的点。机制（来源：实在智能 2026-08-07 百科条目、CSDN 2026-05-15 成本优化文）：

- 云端服务对**用户输入（prompt、参考素材）和模型输出（画面、音频）双向审核**
- 触发后 API **返回 HTTP 200 但响应体为空**，或响应头带 `X-Content-Filtered: true`
- 排查方法：请求头加 `X-Debug-Filter: true`，响应会带 `filter_reason` / `filtered_words`

知乎/php.cn 的实测反馈：审核模块对**抽象比喻、行业黑话、特定数字组合（如"996""35岁"）敏感度异常升高**，常常无提示直接截断输出。医疗、金融类词也容易触发。

CSDN 那篇的量化数据：某健康检查中**连续 17 次含"疫苗"的健康科普请求全部被拦截**，虽未扣分，但累计等待 4 分 33 秒。他们建本地预审词库后把拦截率从 23% 压到 1.7%。

> 注意：MinMax 官方文档里的错误码 **422 = `unprocessable_entity_error`，message 是 "video description contains sensitive content (1026)"**——这是被审核拒的正式信号。

**② 生成慢 + 高峰期排队** ⚠️

Segmind 博客（2026-08）明确警告：**"Average generation time on H3 is roughly 264 seconds"**（约 4.4 分钟），所以默认的 30 或 60 秒客户端超时会放弃一个本来会成功的请求——**建议设到至少 600 秒**。

官方国内文档也承认："流量高峰时段：根据集群负载动态调整，通常出现在工作日 15:00-17:30。"

海螺 App 端用户也在 Reddit 反映"unlimited 套餐感觉并不 unlimited，高峰期会限流和生成失败"。

**③ 并发限制很紧**

H3 V2：**免费用户并行 2，充值用户 15**。图片 RPM 只有 10。对批量出片的团队来说这是硬约束，需要自己做队列。

**④ 重试策略有坑**

CSDN 实测 2000 次超时案例：**首次超时后立即重试成功率仅 58%，等待 8 秒后重试成功率 92%**。原因是"海螺模型存在状态缓存机制，重复请求会触发二次资源锁定"。这个数字虽来自二手博客（存疑），但方向可信——别无脑立即重试。

**⑤ 质量细节的老问题**

- 视频里的**文字渲染基本不行**——要招牌写 "SALE"，出来是乱码（plisio.net 海螺评测）
- 手部偶尔还是错；远景人脸会糊、变形
- 多角色重叠运动时场面会乱
- 同一 prompt 两次质量可能差很多（抽卡感）
- 10 秒是硬上限（Hailuo 2.x），要更长得自己拼、拼起来色彩和机位会漂移

**⑥ 计费争议**

EvoLink 明确写了"失败、过期与被拒的任务全额退款"——**说明这个问题在行业里是真实存在的痛点**。MiniMax 官方对"失败是否扣费"没有在文档里明说（我只找到"只对成功的结果计数"这条百炼文档里的 usage 说明，以及 EvoLink 转述的官方规则）。

另有官方明确的一条：**已有的 Hailuo 视频点数包不支持 H3**，买了旧包的人不能直接cover新模型。

**⑦ 数据与合规顾虑**

plisio.net 评测指出：MiniMax 是中国公司，**无 SOC 2、无 ISO 27001、无 GDPR 认证**；prompts 和上传图片存在其服务器上。对品牌资产类内容需要自行评估。

**⑧ 开源不等于完全开源**

前面说了：2K 管线没开源，商用要单独授权。有人冲着"开源免费商用"去的会踩坑。

---

## 6. 风险与坑（动手前请读完）

1. **Token Plan 订阅包跑不了 H3。** Plus 档完全不支持视频，Max/Ultra 只给 Hailuo 2.3 每日 3/5 条。要跑 H3 必须按量付费。
2. **旧视频点数包不 cover H3。** 官方明说。
3. **图片 URL 24 小时过期。** `response_format=url` 的图必须及时转存，别直接把 URL 存进数据库。
4. **并发天花板**：H3 免费 2 / 充值 15 并行；图片 RPM 10。批量场景必须自建队列 + 退避重试。
5. **超时要设 ≥600 秒。** H3 平均 264 秒。默认超时会误杀成功请求——这个坑很隐蔽。
6. **参考视频会加进计费时长。** 5 秒输出 + 3 秒参考视频 = 按 8 秒计费。参考图/音频不加。
7. **审核是双向且静默的。** 返回 200 但空响应体。加 `X-Debug-Filter: true` 排查，建本地预审词库。
8. **本地部署只能到 768P。** 2K 管线未开源。商用需单独授权。
9. **第三方中转跑路风险。** EvoLink 只省 5%，302.AI 的 H3 反而比官方贵——折扣不足以覆盖预付费资金风险。**建议只把小额余额放在中转站。**
10. **fal 促销价随时到期。** H3 Max 的 75% 折扣已于 2026-09-14 结束，页面上另有互相矛盾的价格数字，务必以控制台实时价为准。
11. **平台差异**：国际版和国内版账号不通、余额不通、模型略有差异（国内独占 `image-01-live`）。选一个别来回切。

---

## 7. 落地建议（按场景给答案）

| 你的场景 | 建议 | 理由 |
| --- | --- | --- |
| **只出图，量大，要便宜** | 官方 `image-01` 直连（国内版 ¥0.025/张） | 全市场最低价，没有中转能更便宜；RPM 10 靠 `n=9` 拉吞吐 |
| **出视频，要便宜** | fal.ai `minimax/h3` 768P，$0.06/秒 | 比官方国际版便宜 25%，且 fal 是 MiniMax 的 H3-Max 合作方 |
| **出视频，极限省钱** | fal.ai `h3-max-turbo` 480P，$0.025/秒 | 5 秒 $0.125；画质换价格 |
| **出视频，国内主体要发票** | 阿里云百炼 `MiniMax/MiniMax-H3`，¥0.50/秒 | 原价无折扣，但合规、可开发票、复用阿里云额度 |
| **出视频，国内主体不要发票** | 官方国内版 `api.minimaxi.com`，¥0.50/秒 | 比国际版便宜约 12%，账号国内可直接注册 |
| **有闲置高端显卡** | ComfyUI 本地跑 H3 开源权重 | 0 API 费用；但只到 768P，商用要授权 |
| **想要"MiniMax-M3 生图/生视频"** | ❌ 做不到 | M3 的 output_modalities 只有 text |

---

## 8. 存疑清单（我没能确证的，请自行复核）

| 项 | 状态 | 说明 |
| --- | --- | --- |
| OpenRouter `minimax/hailuo-3-max` 是否真能调 | ⚠️ 存疑 | 有展示页（released 2026-09-02），但**不在 `/api/v1/models` 的 458 条 data 里**。需实测 |
| fal.ai H3 Max 的当前实际价格 | ⚠️ 存疑 | 同一页面出现 $0.0125/480p、$0.025/480p、$0.05/480p 三个数字，促销与常规价混杂 |
| MiniMax-H3-Max 国内版是否可用 | ⚠️ 未找到 | 国内版 pricing 页只列了 H3，没列 H3-Max；只有 models-intro 和 api-overview 提到该模型存在 |
| image-01 是否上架阿里云百炼 | ❌ 未找到 | 只找到 H3 视频和 M3 文本，无图片生成模型 |
| AIHubMix 是否上架 MiniMax 图/视频 | ⚠️ 存疑 | 视频接口文档存在，但模型列表里没明确写 MiniMax |
| vectorengine / closeai / Gitee AI / 聚光 / 灵枢 | ❌ 未找到 | 搜索返回全是 SEO 聚合站转抄，无可信一手来源 |
| H3 inflight 并发数（15 还是 30） | ⚠️ 存疑 | 国际版 rate-limits 页写 30，国内版写 15（充值）/2（免费）；第三方文档写 2/15 |
| "失败也扣钱"是否有实锤 | ⚠️ 存疑 | 官方未明说；EvoLink 用"失败全额退款"当卖点，反向暗示官方可能不退款。未找到明确的用户投诉原帖 |
| H3 平均生成 264 秒 | ⚠️ 二手 | 来自 Segmind 博客，非官方数据 |

---

## 9. 全部参考链接

### 官方（一手）

- MiniMax 国际版定价：<https://platform.minimax.io/docs/guides/pricing-paygo>
- MiniMax 国内版定价：<https://platform.minimaxi.com/docs/guides/pricing-paygo>
- MiniMax 国际版模型总览：<https://platform.minimax.io/docs/guides/models-intro>
- MiniMax 国内版模型总览：<https://platform.minimaxi.com/docs/guides/models-intro>
- MiniMax 国际版接口概览：<https://platform.minimax.io/docs/api-reference/api-overview>
- MiniMax 国内版接口概览：<https://platform.minimaxi.com/docs/api-reference/api-overview>
- 文生图 API：<https://platform.minimax.io/docs/api-reference/image-generation-t2i>
- 图片生成指南：<https://platform.minimax.io/docs/guides/image-generation>
- 视频生成 V2 创建任务：<https://platform.minimax.io/docs/api-reference/video-generation-v2-create>
- 视频生成指南：<https://platform.minimax.io/docs/guides/video-generation>
- 国际版速率限制：<https://platform.minimax.io/docs/guides/rate-limits>
- 国内版速率限制：<https://platform.minimaxi.com/docs/guides/rate-limits>
- 错误码：<https://platform.minimax.io/docs/api-reference/errorcode>
- Token Plan 概要（国际）：<https://platform.minimax.io/docs/token-plan/intro>
- Token Plan 概要（国内）：<https://platform.minimaxi.com/docs/token-plan/intro>
- 国内版 Token Plan 订阅页：<https://platform.minimax.cn/subscribe/token-plan>
- 文档索引（可直接 curl）：<https://platform.minimax.io/docs/llms.txt>、<https://platform.minimaxi.com/docs/llms.txt>
- 本地部署 H3：<https://platform.minimax.io/docs/guides/local-deploy-h3>
- image-01 发布公告：<https://www.minimax.io/news/image-01>

### 开源权重

- HF `MiniMaxAI/MiniMax-H3`：<https://huggingface.co/MiniMaxAI/MiniMax-H3>（9,250 star，2026-07-30 创建）
- HF `MiniMaxAI/Minimax-M3`：<https://huggingface.co/MiniMaxAI/Minimax-M3>
- GitHub `MiniMax-AI/MiniMax-M3`：<https://github.com/MiniMax-AI/MiniMax-M3>（489 star）
- ComfyUI H3 教程：<https://docs.comfy.org/tutorials/video/minimax/minimax-h3>
- ComfyUI PR #15224：<https://github.com/Comfy-Org/ComfyUI/pull/15224>
- ComfyUI 开源报道：<https://comfyui-wiki.com/en/news/2026-08-03-minimax-h3-open-weights-comfyui>

### 第三方渠道

- fal.ai H3（t2v）：<https://fal.ai/models/minimax/h3/text-to-video>
- fal.ai H3 Max（t2v）：<https://fal.ai/models/minimax/h3-max/text-to-video>
- fal.ai H3 vs H3 Max：<https://fal.ai/learn/devs/minimax-h3-vs-minimax-h3-max>
- fal.ai H3 Max 落地页：<https://fal.ai/minimax-h3-max>
- fal.ai Hailuo 2.3 Pro：<https://fal.ai/models/fal-ai/minimax/hailuo-2.3/pro/image-to-video>
- 阿里云百炼 MiniMax-H3 模型信息：<https://help.aliyun.com/zh/model-studio/minimax-h3>
- 阿里云百炼 H3 视频生成 API：<https://help.aliyun.com/zh/model-studio/minimax-video-generation-api-reference>
- 阿里云百炼 MiniMax-M3：<https://help.aliyun.com/zh/model-studio/minimax-api-by-minimax>
- SiliconFlow 定价：<https://www.siliconflow.com/zh/pricing>
- OpenRouter MiniMax 聚合页：<https://openrouter.ai/minimax>
- OpenRouter H3 Max 页：<https://openrouter.ai/minimax/hailuo-3-max>
- EvoLink 定价：<https://evolink.ai/zh/pricing>
- EvoLink H3：<https://evolink.ai/zh/hailuo-3>
- 302.AI：<https://302.ai>
- 302.AI Hailuo-02 视频文档：<https://doc.302.ai/310678678e0>
- AIHubMix 视频接口：<https://docs.aihubmix.com/cn/api/Video-Gen>
- new-api issue #6815（H3 V2 支持）：<https://github.com/QuantumNous/new-api/issues/6815>
- new-api 仓库：<https://github.com/QuantumNous/new-api>（48,949 star，最后提交 2026-09-25）
- one-api 仓库：<https://github.com/songquanpeng/one-api>（37,021 star，最后提交 2026-01-09，**已停更**）

### 评价与横评

- Hailuo AI 评测（含审核、隐私、质量吐槽）：<https://plisio.net/ai/hailuo-ai>
- MiniMax vs Seedance vs Kling 2026 横评：<https://zawa.ai/resources/minimax-vs-seedance-vs-kling>
- MiniMax H3 Reddit 评价汇总：<https://leadde.ai/blog/mini-max-h3-reddit-review>
- Reddit 用户 H3 短片实战帖（存档）：<https://reddit.sentinel-team.org/posts/1vqifzv/snapshots/2026-08-21T22%3A55%3A34.496277Z>
- H3 敏感检测机制解析：<https://www.ai-indeed.com/encyclopedia/29271.html>
- 海螺积分消耗与隐性成本（CSDN）：<https://wenku.csdn.net/column/p945757m07k>
- H3 发布与 API 定价（Segmind，含 264 秒警告）：<https://blog.segmind.com/minimax-h3-release-date-open-weights-and-api-pricing-explained>
- H3 定价横评：<https://www.dreampixelforge.com/blog/minimax-h3>
- H3 定价与模型 ID：<https://evolink.ai/zh/hailuo-3>
- 海螺视频百度百科（含年费争议）：<https://baike.baidu.com/item/%E6%B5%B7%E8%9E%BA%E8%A7%86%E9%A2%91/66265456>
- 302.AI H3 Max 实测：<https://302.ai/blog/302-ai-benchmark-lab-review-on-minimax-hailuo-02>

---

*报告完 · 2026-09-27*

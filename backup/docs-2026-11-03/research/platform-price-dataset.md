# 平台价格数据集（图像 / 视频生成 API）

抓取日期：2026-09-27　制表人：research_missing_platforms 子代理
说明：价格均为抓取当天公开页面上显示的数值，可能随平台调整变动；换算前请以来源 URL 为准。
计价单位说明：
- 每张 = 每生成一张图；每秒 = 每生成一秒视频（视频已注明分辨率 / 时长档位）；
- 每百万token = 每 1,000,000 token；每条 = 每次生成一条视频（已注明时长与分辨率）；
- 套餐 = 预付费资源包或订阅。

## 数据行（平台 | 性质 | 模型ID | 模态 | 原币价格 | 币种 | 计价单位 | 来源URL）

```
API mart | 第三方 | z-image-turbo | 图像 | 0.01 | USD | 每张(默认档) | https://apimart.ai/pricing
API mart | 第三方 | z-image-turbo | 图像 | 0.02 | USD | 每张(prompt_extend档) | https://apimart.ai/pricing
API mart | 第三方 | gpt-image-2-ext | 图像 | 0.0085 | USD | 每张(Default/1K) | https://apimart.ai/pricing
API mart | 第三方 | gpt-image-2-ext | 图像 | 0.014 | USD | 每张(2K) | https://apimart.ai/pricing
API mart | 第三方 | gpt-image-2-ext | 图像 | 0.021 | USD | 每张(4K) | https://apimart.ai/pricing
API mart | 第三方 | gpt-image-2.5-ext | 图像 | 0.0085 | USD | 每张(flare@1K) | https://apimart.ai/pricing
API mart | 第三方 | gpt-image-2.5-ext | 图像 | 0.014 | USD | 每张(flare@2K) | https://apimart.ai/pricing
API mart | 第三方 | gpt-image-2.5-ext | 图像 | 0.021 | USD | 每张(flare@4K) | https://apimart.ai/pricing
API mart | 第三方 | gpt-image-2.5-ext | 图像 | 0.0085 | USD | 每张(sunburst@1K) | https://apimart.ai/pricing
API mart | 第三方 | gpt-image-2.5-ext | 图像 | 0.014 | USD | 每张(sunburst@2K) | https://apimart.ai/pricing
API mart | 第三方 | gpt-image-2.5-ext | 图像 | 0.021 | USD | 每张(sunburst@4K) | https://apimart.ai/pricing
API mart | 第三方 | nano-banana-ext | 图像 | 0.0125 | USD | 每张 | https://apimart.ai/pricing
API mart | 第三方 | nano-banana-2-lite-ext | 图像 | 0.0125 | USD | 每张 | https://apimart.ai/pricing
API mart | 第三方 | seedream-5-0-flash | 图像 | 0.0137144 | USD | 每张 | https://apimart.ai/pricing
API mart | 第三方 | seedream-5-0-pro | 图像 | 0.036 | USD | 每张(Default) | https://apimart.ai/pricing
API mart | 第三方 | seedream-5-0-pro | 图像 | 0.02925 | USD | 每张(1K) | https://apimart.ai/pricing
API mart | 第三方 | seedream-5-0-pro | 图像 | 0.0585 | USD | 每张(2K) | https://apimart.ai/pricing
API mart | 第三方 | flux-2-pro | 图像 | 0.026 | USD | 每张(Default) | https://apimart.ai/pricing
API mart | 第三方 | flux-2-pro | 图像 | 0.015 | USD | 每张(0.5K/1K) | https://apimart.ai/pricing
API mart | 第三方 | flux-2-pro | 图像 | 0.02 | USD | 每张(2K) | https://apimart.ai/pricing
API mart | 第三方 | flux-2-pro | 图像 | 0.025 | USD | 每张(4K) | https://apimart.ai/pricing
API mart | 第三方 | flux-2-max | 图像 | 0.08 | USD | 每张(Default) | https://apimart.ai/pricing
API mart | 第三方 | flux-2-flex | 图像 | 0.04 | USD | 每张(1MP) | https://apimart.ai/pricing
API mart | 第三方 | flux-2-flex | 图像 | 0.08 | USD | 每张(2MP) | https://apimart.ai/pricing
API mart | 第三方 | flux-2-flex | 图像 | 0.12 | USD | 每张(3MP) | https://apimart.ai/pricing
API mart | 第三方 | flux-2-flex | 图像 | 0.16 | USD | 每张(4MP) | https://apimart.ai/pricing
API mart | 第三方 | midjourney(imagine) | 图像 | 0.04504 | USD | 每张(每次生成) | https://apimart.ai/pricing
API mart | 第三方 | midjourney(video) | 视频 | 0.2 | USD | 每条(默认档) | https://apimart.ai/pricing
API mart | 第三方 | midjourney(video-720p) | 视频 | 0.4 | USD | 每条(720p) | https://apimart.ai/pricing
API mart | 第三方 | seedance-2.0 | 视频 | 0.0336 | USD | 每秒(720p,4-15s) | https://apimart.ai/model/doubao-seedance-2-0
API mart | 第三方 | seedance-2.5 | 视频 | 未找到 | USD | 每秒(页面仅显示按秒×分辨率档，未公开单价) | https://apimart.ai/zh/model/doubao-seedance-2-5
API mart | 第三方 | kling-v3-omni | 视频 | 0.0672 | USD | 每秒(720p,官方价8折) | https://apimart.ai/model/doubao-seedance-2-0
API mart | 第三方 | kling-video-o1 | 视频 | 0.0672 | USD | 每秒 | https://apimart.ai/model/doubao-seedance-2-0
API mart | 第三方 | kling-3.0-turbo | 视频 | 0.1144 | USD | 每秒 | https://apimart.ai/zh/model/doubao-seedance-2-5
API mart | 第三方 | wan-2.5-preview | 视频 | 0.0336 | USD | 每秒 | https://apimart.ai/model/doubao-seedance-2-0
API mart | 第三方 | pixverse-v6 | 视频 | 0.024 | USD | 每秒 | https://apimart.ai/zh/model/doubao-seedance-2-5
API mart | 第三方 | gemini-omni-1.1-flash | 视频 | 0.088 | USD | 每秒 | https://apimart.ai/zh/model/doubao-seedance-2-5
API mart | 第三方 | gemini-omni-flash-preview | 视频 | 0.088 | USD | 每秒 | https://apimart.ai/zh/model/doubao-seedance-2-5
API mart | 第三方 | grok-imagine-1.5-video-ext | 视频 | 0.0102 | USD | 每秒 | https://apimart.ai/model/doubao-seedance-2-0

API易 apiyi.com | 第三方 | Nano Banana Pro | 图像 | 0.09 | USD | 每张(1K-4K统一价) | https://docs.apiyi.com/api-capabilities/image-video-models
API易 apiyi.com | 第三方 | Nano Banana 2 | 图像 | 0.055 | USD | 每张(按量0.025-0.07) | https://docs.apiyi.com/api-capabilities/image-video-models
API易 apiyi.com | 第三方 | Nano Banana Lite | 图像 | 0.025 | USD | 每张(1K) | https://docs.apiyi.com/api-capabilities/image-video-models
API易 apiyi.com | 第三方 | gpt-image-2-all | 图像 | 0.03 | USD | 每张(按次) | https://docs.apiyi.com/api-capabilities/image-video-models
API易 apiyi.com | 第三方 | gpt-image-2-vip | 图像 | 0.03 | USD | 每张(按次,4K不加价) | https://docs.apiyi.com/api-capabilities/image-video-models
API易 apiyi.com | 第三方 | Nano Banana | 图像 | 0.02 | USD | 每张 | https://docs.apiyi.com/api-capabilities/image-video-models
API易 apiyi.com | 第三方 | Seedream 5.0 Lite | 图像 | 0.035 | USD | 每张(2K/3K) | https://docs.apiyi.com/api-capabilities/image-video-models
API易 apiyi.com | 第三方 | Seedream 4.5 | 图像 | 0.04 | USD | 每张(2K/4K) | https://docs.apiyi.com/api-capabilities/image-video-models
API易 apiyi.com | 第三方 | Seedream 4.0 | 图像 | 0.035 | USD | 每张(2K) | https://docs.apiyi.com/api-capabilities/image-video-models
API易 apiyi.com | 第三方 | flux-2-max | 图像 | 0.07 | USD | 每张 | https://docs.apiyi.com/api-capabilities/image-video-models
API易 apiyi.com | 第三方 | flux-2-pro | 图像 | 0.03 | USD | 每张 | https://docs.apiyi.com/api-capabilities/image-video-models
API易 apiyi.com | 第三方 | flux-2-flex | 图像 | 0.06 | USD | 每张 | https://docs.apiyi.com/api-capabilities/image-video-models
API易 apiyi.com | 第三方 | Wan2.7 | 视频 | 0.084 | USD | 每秒(最长12s) | https://docs.apiyi.com/api-capabilities/image-video-models
API易 apiyi.com | 第三方 | Wan2.7 | 视频 | 0.14 | USD | 每秒(高档位) | https://docs.apiyi.com/api-capabilities/image-video-models
API易 apiyi.com | 第三方 | HappyHorse 1.1 | 视频 | 0.126 | USD | 每秒(最长12s) | https://docs.apiyi.com/api-capabilities/image-video-models
API易 apiyi.com | 第三方 | HappyHorse 1.1 | 视频 | 0.224 | USD | 每秒(高档位) | https://docs.apiyi.com/api-capabilities/image-video-models
API易 apiyi.com | 第三方 | VEO 3.1 官转 | 视频 | 0.3 | USD | 每条(4/6/8s,720p/1080p/4k同价) | https://docs.apiyi.com/api-capabilities/image-video-models
API易 apiyi.com | 第三方 | VEO 3.1 官转 | 视频 | 1.2 | USD | 每条(高档位) | https://docs.apiyi.com/api-capabilities/image-video-models

EvoLink | 第三方 | seedance-2.5-reference-to-video | 视频 | 0.084 | USD | 每秒(480p,含视频输入) | https://evolink.ai/zh/pricing
EvoLink | 第三方 | seedance-2.0-reference-to-video | 视频 | 0.057 | USD | 每秒(480p,含视频输入) | https://evolink.ai/zh/pricing
EvoLink | 第三方 | seedance-2.0-fast-reference-to-video | 视频 | 0.034 | USD | 每秒(480p,含视频输入) | https://evolink.ai/zh/pricing
EvoLink | 第三方 | seedance-2.0-mini-reference-to-video | 视频 | 0.012 | USD | 每秒(480p,含视频输入) | https://evolink.ai/zh/pricing
EvoLink | 第三方 | minimax-h3-text-to-video | 视频 | 0.076 | USD | 每秒(768p) | https://evolink.ai/zh/pricing
EvoLink | 第三方 | minimax-h3-max-text-to-video | 视频 | 0.048 | USD | 每秒 | https://evolink.ai/zh/pricing
EvoLink | 第三方 | minimax-h3-max-turbo-text-to-video | 视频 | 0.024 | USD | 每秒 | https://evolink.ai/zh/pricing
EvoLink | 第三方 | wan2.6-text-to-video | 视频 | 0.075 | USD | 每秒 | https://evolink.ai/zh/pricing
EvoLink | 第三方 | wan2.7-text-to-video | 视频 | 0.087 | USD | 每秒(720p) | https://evolink.ai/zh/pricing
EvoLink | 第三方 | wan3.0-text-to-video | 视频 | 0.038 | USD | 每秒(480p) | https://evolink.ai/zh/pricing
EvoLink | 第三方 | wan3.0-prime-text-to-video | 视频 | 0.058 | USD | 每秒(480p) | https://evolink.ai/zh/pricing
EvoLink | 第三方 | kling-v3-text-to-video | 视频 | 0.080 | USD | 每秒 | https://evolink.ai/zh/pricing
EvoLink | 第三方 | kling-v3-turbo-text-to-video | 视频 | 0.106 | USD | 每秒(720p) | https://evolink.ai/zh/pricing
EvoLink | 第三方 | kling-o3-text-to-video | 视频 | 0.080 | USD | 每秒 | https://evolink.ai/zh/pricing
EvoLink | 第三方 | happyhorse-1.1-text-to-video | 视频 | 0.124 | USD | 每秒(720p) | https://evolink.ai/zh/pricing
EvoLink | 第三方 | happyhorse-1.0-text-to-video | 视频 | 0.124 | USD | 每秒(720p) | https://evolink.ai/zh/pricing
EvoLink | 第三方 | grok-imagine-video-1.5-preview | 视频 | 0.056 | USD | 每秒(480p) | https://evolink.ai/zh/pricing
EvoLink | 第三方 | gemini-omni-flash-text-to-video | 视频 | 0.015 | USD | 每千token(视频输出) | https://evolink.ai/zh/pricing
EvoLink | 第三方 | gpt-image-2 | 图像 | 0.027 | USD | 每千token(图像输出,官方价-10%) | https://evolink.ai/zh/gpt-image-2
EvoLink | 第三方 | gpt-image-2-beta | 图像 | 0.015 | USD | 每张(1K,按次固定价) | https://evolink.ai/zh/gpt-image-2

hiapi.ai | 第三方 | gpt-image-2.5-flare | 图像 | 0.050 | USD | 每张(最低) | https://www.hiapi.ai/zh
hiapi.ai | 第三方 | gpt-image-2.5-sunburst | 图像 | 0.050 | USD | 每张(最低) | https://www.hiapi.ai/zh
hiapi.ai | 第三方 | gpt-image-2 | 图像 | 0.030 | USD | 每张(最低) | https://www.hiapi.ai/zh
hiapi.ai | 第三方 | nano-banana-2 | 图像 | 0.051 | USD | 每张(最低) | https://www.hiapi.ai/zh
hiapi.ai | 第三方 | seedream-5.0-pro | 图像 | 0.050 | USD | 每张(最低) | https://www.hiapi.ai/zh
hiapi.ai | 第三方 | flux-1.1-pro | 图像 | 0.107 | USD | 每张(最低) | https://www.hiapi.ai/zh
hiapi.ai | 第三方 | seedance-2.5 | 视频 | 0.231 | USD | 每秒(最低) | https://www.hiapi.ai/zh
hiapi.ai | 第三方 | seedance-2.0 | 视频 | 0.082 | USD | 每秒(最低) | https://www.hiapi.ai/zh
hiapi.ai | 第三方 | veo-3.1 | 视频 | 0.290 | USD | 每秒(最低) | https://www.hiapi.ai/zh
hiapi.ai | 第三方 | grok-imagine-1.5 | 视频 | 0.015 | USD | 每秒(最低) | https://www.hiapi.ai/zh

302.ai | 第三方 | flux-pro-1.1 | 图像 | 0.04 | PTC(≈USD) | 每张 | https://302.ai/product/detail/flux-generate-official-api
302.ai | 第三方 | flux-pro-1.1-ultra | 图像 | 0.06 | PTC(≈USD) | 每张 | https://302.ai/product/detail/flux-generate-official-api
302.ai | 第三方 | flux-dev | 图像 | 0.025 | PTC(≈USD) | 每张 | https://302.ai/product/detail/flux-generate-official-api
302.ai | 第三方 | flux-2-max | 图像 | 0.07 | PTC(≈USD) | 每张(首个MP,后续每MP 0.03) | https://doc.302.ai/393555388e0
302.ai | 第三方 | seedance-1.5-pro | 视频 | 1.2 | PTC | 每百万token(480p,5s≈0.0603PTC/条) | https://doc.302.ai/7942672m0
302.ai | 第三方 | seedance-1.5-pro | 视频 | 1.2 | PTC | 每百万token(720p,5s≈0.1296PTC/条) | https://doc.302.ai/7942672m0
302.ai | 第三方 | seedance-1.5-pro(有声) | 视频 | 2.4 | PTC | 每百万token(720p,5s≈0.2592PTC/条) | https://doc.302.ai/7942672m0
302.ai | 第三方 | seedance-1.0-lite | 视频 | 1.5 | PTC | 每百万token(1080p,5s≈0.3672PTC/条) | https://doc.302.ai/7942672m0
302.ai | 第三方 | seedance-1.0-lite | 视频 | 1.5 | PTC | 每百万token(480p,5s≈0.0729PTC/条) | https://doc.302.ai/7942672m0

vectorengine.ai | 第三方 | gpt-image-2 | 图像 | 3.0 | USD | 每百万token(输入) | https://api.vectorengine.ai/pricing
vectorengine.ai | 第三方 | gpt-image-2 | 图像 | 18.0 | USD | 每百万token(输出) | https://api.vectorengine.ai/pricing
vectorengine.ai | 第三方 | qwen-image-2.0 | 图像 | 0.013 | USD | 每张 | https://api.vectorengine.ai/pricing
vectorengine.ai | 第三方 | wan2.7-image-pro | 图像 | 0.65 | USD | 每张 | https://api.vectorengine.ai/pricing
vectorengine.ai | 第三方 | pixverse-video | 视频 | 0.041 | USD | 每条 | https://api.vectorengine.ai/pricing
vectorengine.ai | 第三方 | pixverse-lipsync | 视频 | 0.041 | USD | 每条 | https://api.vectorengine.ai/pricing

OpenRouter | 第三方 | google/gemini-3.1-flash-image | 图像 | 0.50 | USD | 每百万token(输入) | https://openrouter.ai/api/v1/models
OpenRouter | 第三方 | google/gemini-3.1-flash-image | 图像 | 3.00 | USD | 每百万token(输出) | https://openrouter.ai/api/v1/models
OpenRouter | 第三方 | google/gemini-3-pro-image | 图像 | 2.00 | USD | 每百万token(输入) | https://openrouter.ai/api/v1/models
OpenRouter | 第三方 | google/gemini-3-pro-image | 图像 | 12.00 | USD | 每百万token(输出) | https://openrouter.ai/api/v1/models
OpenRouter | 第三方 | google/gemini-3-pro-image | 图像 | 2.00 | USD | 每张(输出图像) | https://openrouter.ai/api/v1/models
OpenRouter | 第三方 | google/gemini-3.1-flash-lite-image | 图像 | 0.25 | USD | 每百万token(输入) | https://openrouter.ai/api/v1/models
OpenRouter | 第三方 | google/gemini-3.1-flash-lite-image | 图像 | 1.50 | USD | 每百万token(输出) | https://openrouter.ai/api/v1/models
OpenRouter | 第三方 | openai/gpt-5.4-image-2 | 图像 | 8.00 | USD | 每百万token(输入) | https://openrouter.ai/api/v1/models
OpenRouter | 第三方 | openai/gpt-5.4-image-2 | 图像 | 15.00 | USD | 每百万token(输出) | https://openrouter.ai/api/v1/models
OpenRouter | 第三方 | openai/gpt-5-image-mini | 图像 | 2.50 | USD | 每百万token(输入) | https://openrouter.ai/api/v1/models
OpenRouter | 第三方 | openai/gpt-5-image-mini | 图像 | 2.00 | USD | 每百万token(输出) | https://openrouter.ai/api/v1/models
OpenRouter | 第三方 | openai/gpt-5-image | 图像 | 10.00 | USD | 每百万token(输入) | https://openrouter.ai/api/v1/models
OpenRouter | 第三方 | openai/gpt-5-image | 图像 | 10.00 | USD | 每百万token(输出) | https://openrouter.ai/api/v1/models
OpenRouter | 第三方 | google/gemini-2.5-flash-image | 图像 | 0.30 | USD | 每百万token(输入) | https://openrouter.ai/api/v1/models
OpenRouter | 第三方 | google/gemini-2.5-flash-image | 图像 | 2.50 | USD | 每百万token(输出) | https://openrouter.ai/api/v1/models
OpenRouter | 第三方 | google/gemini-2.5-flash-image | 图像 | 0.30 | USD | 每张(输出图像) | https://openrouter.ai/api/v1/models
OpenRouter | 第三方 | bytedance-seed/seedream-4.5 | 图像 | 0.04 | USD | 每张(不分尺寸) | https://openrouter.ai/collections/image-models

Together AI | 官方(云) | black-forest-labs/FLUX.1-schnell | 图像 | 0.0027 | USD | 每百万像素(MP) | https://docs.together.ai/docs/serverless/models
Together AI | 官方(云) | black-forest-labs/FLUX.1.1-pro | 图像 | 0.04 | USD | 每百万像素(MP) | https://docs.together.ai/docs/serverless/models
Together AI | 官方(云) | black-forest-labs/FLUX.2-pro | 图像 | 0.03 | USD | 每百万像素(MP) | https://docs.together.ai/docs/serverless/models
Together AI | 官方(云) | black-forest-labs/FLUX.2-dev | 图像 | 0.0154 | USD | 每百万像素(MP) | https://docs.together.ai/docs/serverless/models
Together AI | 官方(云) | black-forest-labs/FLUX.2-flex | 图像 | 0.03 | USD | 每百万像素(MP) | https://docs.together.ai/docs/serverless/models
Together AI | 官方(云) | black-forest-labs/FLUX.2-max | 图像 | 0.07 | USD | 每百万像素(MP) | https://docs.together.ai/docs/serverless/models
Together AI | 官方(云) | ByteDance-Seed/Seedream-3.0 | 图像 | 0.018 | USD | 每百万像素(MP) | https://docs.together.ai/docs/serverless/models
Together AI | 官方(云) | ByteDance-Seed/Seedream-4.0 | 图像 | 0.03 | USD | 每百万像素(MP) | https://docs.together.ai/docs/serverless/models
Together AI | 官方(云) | ByteDance/Seedream-5.0-lite | 图像 | 0.035 | USD | 每百万像素(MP) | https://docs.together.ai/docs/serverless/models
Together AI | 官方(云) | google/imagen-4.0-fast | 图像 | 0.02 | USD | 每百万像素(MP) | https://docs.together.ai/docs/serverless/models
Together AI | 官方(云) | google/imagen-4.0-preview | 图像 | 0.04 | USD | 每百万像素(MP) | https://docs.together.ai/docs/serverless/models
Together AI | 官方(云) | google/imagen-4.0-ultra | 图像 | 0.06 | USD | 每百万像素(MP) | https://docs.together.ai/docs/serverless/models
Together AI | 官方(云) | google/flash-image-2.5 | 图像 | 0.039 | USD | 每百万像素(MP) | https://docs.together.ai/docs/serverless/models
Together AI | 官方(云) | google/gemini-3-pro-image | 图像 | 0.134 | USD | 每百万像素(MP) | https://docs.together.ai/docs/serverless/models
Together AI | 官方(云) | Qwen/Qwen-Image | 图像 | 0.0058 | USD | 每百万像素(MP) | https://docs.together.ai/docs/serverless/models
Together AI | 官方(云) | ideogram/ideogram-3.0 | 图像 | 0.06 | USD | 每百万像素(MP) | https://docs.together.ai/docs/serverless/models
Together AI | 官方(云) | black-forest-labs/FLUX.1-kontext-pro | 图像 | 0.04 | USD | 每百万像素(MP) | https://docs.together.ai/docs/serverless/models
Together AI | 官方(云) | black-forest-labs/FLUX.1-kontext-max | 图像 | 0.08 | USD | 每百万像素(MP) | https://docs.together.ai/docs/serverless/models
Together AI | 官方(云) | stabilityai/stable-diffusion-xl-base-1.0 | 图像 | 0.0019 | USD | 每百万像素(MP) | https://docs.together.ai/docs/serverless/models

Replicate | 官方(云) | black-forest-labs/flux-1.1-pro | 图像 | 0.04 | USD | 每张(输出图像) | https://replicate.com/pricing
Replicate | 官方(云) | black-forest-labs/flux-dev | 图像 | 0.025 | USD | 每张(输出图像) | https://replicate.com/pricing
Replicate | 官方(云) | black-forest-labs/flux-schnell | 图像 | 3.00 | USD | 每千张(输出图像) | https://replicate.com/pricing
Replicate | 官方(云) | ideogram-ai/ideogram-v3-quality | 图像 | 0.09 | USD | 每张(输出图像) | https://replicate.com/pricing

Fal.ai | 官方(云) | Seedream V4 | 图像 | 0.03 | USD | 每张(按1MP归一) | https://fal.ai/pricing
Fal.ai | 官方(云) | Flux Kontext Pro | 图像 | 0.04 | USD | 每张(按1MP归一) | https://fal.ai/pricing
Fal.ai | 官方(云) | Nanobanana | 图像 | 0.0398 | USD | 每张(按1MP归一) | https://fal.ai/pricing
Fal.ai | 官方(云) | Qwen | 图像 | 0.02 | USD | 每百万像素(MP) | https://fal.ai/pricing
Fal.ai | 官方(云) | Wan 2.5 | 视频 | 0.05 | USD | 每秒 | https://fal.ai/pricing
Fal.ai | 官方(云) | Kling 2.5 Turbo Pro | 视频 | 0.07 | USD | 每秒 | https://fal.ai/pricing
Fal.ai | 官方(云) | Veo 3 | 视频 | 0.40 | USD | 每秒 | https://fal.ai/pricing
Fal.ai | 官方(云) | Ovi | 视频 | 0.20 | USD | 每条 | https://fal.ai/pricing

硅基流动 SiliconFlow | 官方(云) | Z-Image-Turbo | 图像 | 0.005 | USD | 每张 | https://www.siliconflow.com/zh/pricing
硅基流动 SiliconFlow | 官方(云) | FLUX.2 [pro] | 图像 | 0.03 | USD | 每张 | https://www.siliconflow.com/zh/pricing
硅基流动 SiliconFlow | 官方(云) | FLUX.2 [flex] | 图像 | 0.06 | USD | 每张 | https://www.siliconflow.com/zh/pricing
硅基流动 SiliconFlow | 官方(云) | FLUX 1.1 [pro] | 图像 | 0.04 | USD | 每张 | https://www.siliconflow.com/zh/pricing
硅基流动 SiliconFlow | 官方(云) | FLUX 1.1 [pro] Ultra | 图像 | 0.06 | USD | 每张 | https://www.siliconflow.com/zh/pricing
硅基流动 SiliconFlow | 官方(云) | FLUX.1 Kontext [pro] | 图像 | 0.04 | USD | 每张 | https://www.siliconflow.com/zh/pricing
硅基流动 SiliconFlow | 官方(云) | FLUX.1 Kontext [max] | 图像 | 0.08 | USD | 每张 | https://www.siliconflow.com/zh/pricing
硅基流动 SiliconFlow | 官方(云) | FLUX.1-dev | 图像 | 0.014 | USD | 每张 | https://www.siliconflow.com/zh/pricing
硅基流动 SiliconFlow | 官方(云) | FLUX.1-Kontext-dev | 图像 | 0.015 | USD | 每张 | https://www.siliconflow.com/zh/pricing
硅基流动 SiliconFlow | 官方(云) | Qwen-Image | 图像 | 0.02 | USD | 每张 | https://www.siliconflow.com/zh/pricing
硅基流动 SiliconFlow | 官方(云) | Qwen-Image-Edit | 图像 | 0.04 | USD | 每张 | https://www.siliconflow.com/zh/pricing
硅基流动 SiliconFlow | 官方(云) | Wan2.2-T2V-A14B | 视频 | 0.29 | USD | 每条(480P/720P,5秒) | https://www.siliconflow.com/zh/pricing
硅基流动 SiliconFlow | 官方(云) | Wan2.2-I2V-A14B | 视频 | 0.29 | USD | 每条(480P/720P,5秒) | https://www.siliconflow.com/zh/pricing

火山方舟/火山引擎 | 官方 | doubao-seedance-2-0 | 视频 | 46 | CNY | 每百万token(纯视频生成,15s≈30.888万token≈1元/秒) | https://ark.volcengine.com/region:cn-beijing/model/detail?Id=doubao-seedance-2-0
火山方舟/火山引擎 | 官方 | doubao-seedance-2-0 | 视频 | 28 | CNY | 每百万token(含视频输入/视频编辑) | https://ark.volcengine.com/region:cn-beijing/model/detail?Id=doubao-seedance-2-0
火山方舟/火山引擎 | 官方 | doubao-seedream-5-0-pro | 图像 | 0.30 | CNY | 每张(输出≤236万像素) | https://www.volcengine.com/product/doubao
火山方舟/火山引擎 | 官方 | doubao-seedream-5-0-pro | 图像 | 0.60 | CNY | 每张(输出>236万像素) | https://www.volcengine.com/product/doubao
火山方舟/火山引擎 | 官方 | doubao-seedream-5-0-pro-260628(302.ai价) | 图像 | 0.043 | PTC(≈USD) | 每张 | https://s.apifox.cn/apidoc/docs-site/4012774/484942949e0

即梦AI开放平台 | 官方 | 即梦AI-图像生成3.0系列 | 图像 | 0.2 | CNY | 每张 | https://www.chooseai.net/news/6540/
即梦AI开放平台 | 官方 | 即梦AI-图片生成4.0/4.6 | 图像 | 0.22 | CNY | 每张 | https://www.chooseai.net/news/6540/
即梦AI开放平台 | 官方 | 即梦AI-交互编辑inpainting | 图像 | 0.2 | CNY | 每张 | https://www.chooseai.net/news/6540/
即梦AI开放平台 | 官方 | 即梦AI-智能超清 | 图像 | 0.4 | CNY | 每张 | https://www.chooseai.net/news/6540/
即梦AI开放平台 | 官方 | 即梦AI-视频生成3.0 Pro | 视频 | 1.0 | CNY | 每秒 | https://www.chooseai.net/news/6540/
即梦AI开放平台 | 官方 | 即梦AI-视频生成3.0 1080p | 视频 | 0.63 | CNY | 每秒 | https://www.chooseai.net/news/6540/
即梦AI开放平台 | 官方 | 即梦AI-视频生成3.0 720P | 视频 | 0.28 | CNY | 每秒 | https://www.chooseai.net/news/6540/
即梦AI开放平台 | 官方 | 即梦AI-视频生成S2.0 Pro | 视频 | 0.65 | CNY | 每秒 | https://www.chooseai.net/news/6540/
即梦AI开放平台 | 官方 | 动作模仿 | 视频 | 0.5 | CNY | 每秒 | https://www.chooseai.net/news/6540/
即梦AI开放平台 | 官方 | 数字人快速模式 | 视频 | 1.0 | CNY | 每秒 | https://www.chooseai.net/news/6540/

百度千帆/文心一言 | 官方 | qianfan-image(o1-base) | 图像 | 0.2 | CNY | 每张(文生图/图生图/编辑) | https://cloud.baidu.com/doc/qianfan/s/cmmk7fprv
百度千帆/文心一言 | 官方 | qianfan-image(v3o 1K/2K) | 图像 | 0.2 | CNY | 每张 | https://cloud.baidu.com/doc/qianfan/s/cmmk7fprv
百度千帆/文心一言 | 官方 | qianfan-image(v3o 4K) | 图像 | 0.4 | CNY | 每张 | https://cloud.baidu.com/doc/qianfan/s/cmmk7fprv
百度千帆/文心一言 | 官方 | qianfan-image(智能补全主体图) | 图像 | 0.5 | CNY | 每张 | https://cloud.baidu.com/doc/qianfan/s/cmmk7fprv
百度千帆/文心一言 | 官方 | qianfan-Video VQ3-Pro | 视频 | 0.78125 | CNY | 每条(720p,1-16秒) | https://cloud.baidu.com/doc/qianfan-multimodal/s/nmo74mg17
百度千帆/文心一言 | 官方 | qianfan-Video VQ3-Pro | 视频 | 0.9375 | CNY | 每条(1080p,1-16秒) | https://cloud.baidu.com/doc/qianfan-multimodal/s/nmo74mg17
百度千帆/文心一言 | 官方 | qianfan-Video VQ3-Pro | 视频 | 0.3125 | CNY | 每条(540p,1-16秒) | https://cloud.baidu.com/doc/qianfan-multimodal/s/nmo74mg17
百度千帆/文心一言 | 官方 | qianfan-Video VQ3-Turbo | 视频 | 0.3750 | CNY | 每条(720p,1-16秒) | https://cloud.baidu.com/doc/qianfan-multimodal/s/nmo74mg17
百度千帆/文心一言 | 官方 | qianfan-Video VQ3-Turbo | 视频 | 0.4375 | CNY | 每条(1080p,1-16秒) | https://cloud.baidu.com/doc/qianfan-multimodal/s/nmo74mg17
百度千帆/文心一言 | 官方 | qianfan-Video VQ3-Turbo | 视频 | 0.2500 | CNY | 每条(540p,1-16秒) | https://cloud.baidu.com/doc/qianfan-multimodal/s/nmo74mg17

腾讯混元 | 官方 | 混元生图(3.0) | 图像 | 0.2 | CNY | 每张 | https://cloud.tencent.com/document/product/1668/90896
腾讯混元 | 官方 | 混元生图(2.0) | 图像 | 0.5 | CNY | 每张 | https://cloud.tencent.com/document/product/1668/90896
腾讯混元 | 官方 | 混元生图(极速版) | 图像 | 0.099 | CNY | 每张(月用量<1万) | https://cloud.tencent.com/document/product/1668/90896
腾讯混元 | 官方 | 混元生图(3.0) | 图像 | 200 | CNY | 套餐(1000张资源包) | https://cloud.tencent.com/document/product/1668/90896
腾讯混元 | 官方 | 混元生图(极速版) | 图像 | 99 | CNY | 套餐(1000张资源包) | https://cloud.tencent.com/document/product/1668/90896
腾讯混元 | 官方 | 混元生视频(后付费) | 视频 | 1.2 | CNY | 每积分(积分制,非每秒;积分单价看具体接口) | https://cloud.tencent.com/document/product/1616/118994
腾讯混元 | 官方 | 混元生视频 | 视频 | 1.0 | CNY | 每积分(5000积分资源包=5000元) | https://cloud.tencent.com/document/product/1616/118994

Vidu | 官方 | ViduQ2-turbo | 视频 | 0.1875 | CNY | 每条(540P,第1秒6积分后续每秒+2积分;1积分=0.03125元) | https://platform.vidu.cn/docs/pricing
Vidu | 官方 | ViduQ2-turbo | 视频 | 0.25 | CNY | 每条(720P,1秒:第1秒8积分) | https://platform.vidu.cn/docs/pricing
Vidu | 官方 | ViduQ2-pro | 视频 | 0.46875 | CNY | 每条(720P,1秒:第1秒15积分) | https://platform.vidu.cn/docs/pricing
Vidu | 官方 | ViduQ2(文生) | 视频 | 0.46875 | CNY | 每条(720P,1秒:第1秒15积分) | https://platform.vidu.cn/docs/pricing

MiniMax | 官方 | image-01 | 图像 | 0.0035 | USD | 每张 | https://platform.minimax.io/docs/guides/pricing-paygo
MiniMax | 官方 | MiniMax-H3 | 视频 | 0.08 | USD | 每秒(768P,4-15秒) | https://platform.minimax.io/docs/guides/pricing-paygo
MiniMax | 官方 | MiniMax-H3 | 视频 | 0.13 | USD | 每秒(2K,4-15秒) | https://platform.minimax.io/docs/guides/pricing-paygo
MiniMax | 官方 | MiniMax-H3-Max | 视频 | 0.05 | USD | 每秒(480P) | https://platform.minimax.io/docs/guides/pricing-paygo
MiniMax | 官方 | MiniMax-H3-Max | 视频 | 0.08 | USD | 每秒(768P) | https://platform.minimax.io/docs/guides/pricing-paygo

CloseAI | 第三方 | 全平台模型(商务套餐) | 图像/视频 | 1.5 | 倍率 | 套餐(官方转发价×1.5) | https://www.closeai-asia.com/pricing
CloseAI | 第三方 | 全平台模型(研发套餐) | 图像/视频 | 1.25 | 倍率 | 套餐(累计充值¥5000激活,官方价×1.25) | https://www.closeai-asia.com/pricing
CloseAI | 第三方 | 全平台模型(大客户套餐) | 图像/视频 | 1.1 | 倍率 | 套餐(累计充值¥10000激活,官方价×1.1) | https://www.closeai-asia.com/pricing

AIHubMix | 第三方 | - | - | 未找到 | - | - | 模型页 aihubmix.com/models 未公开稳定单价表，仅 API 返回动态价格
Gitee AI 模力方舟 | 官方(云) | - | - | 未找到 | - | - | 采用预付费资源包制，无公开按模型单价（ai.gitee.com/docs/billing/purchase）
阿里云百炼 DashScope | 官方 | - | - | 未找到 | - | - | 价格页 help.aliyun.com/zh/model-studio/model-pricing 未抓到图像/视频模型单价
EvoLink(图像) | 第三方 | - | - | 未找到 | - | - | 目录页仅展示视频模型单价，图像模型价在各模型子页
API mart | 第三方 | gpt-image-1-mini | 图像 | 未找到 | - | - | apimart.ai/pricing 未见 gpt-image-1-mini 档位
302.ai | 第三方 | Seedance 2.5 / Kling / Seedream | - | 未找到 | - | - | 302.ai/price 为动态页，未抓到具体档位数值
```

## 备注

- 火山方舟 Seedance 2.0：官方按 token 计价，15 秒视频约消耗 30.888 万 token，纯生成 46 元/百万 token → 约 1 元/秒。
- 302.ai 的 PTC 为其平台计费单位，官方标注 1 PTC ≈ 1 USD（充值按固定汇率）。
- Vidu 用积分制：1 积分 = 0.03125 元，且按「第 1 秒 X 积分 + 后续每秒 Y 积分」阶梯计价，长视频需按秒累加。
- 百度千帆 qianfan-Video：1 积分 = 1 元，表中「每条」按 1-16 秒内固定积分折算（VQ3 系列不随时长变价）。
- 腾讯混元生视频为积分制，未公开「每秒」单价，只给积分单价与资源包价格，无法直接换算每秒。
- CloseAI 采用「官方价 × 倍率」模式，无独立模型价表，需以 OpenAI/Google 官方价乘以套餐倍率。
- Gitee AI 模力方舟为预付费资源包制，公开页无按模型单价，只有「图像生成节点约 0.05 元/次」这类示例值。



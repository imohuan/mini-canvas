# 底栏「分镜 / 设定图」预设提示词库

> 用途：给 `packages/plugins/plugin-bottom-bar` 的「AI 按钮」准备一组可复制的生图预设。
> 目标菜单与用户截图一致：分镜叙事 6 项、空间与机位 2 项、设定图 5 项、质感调节 2 项，共 15 项。

## 先说明来源边界

- **LibTV 官方前端能确认**：按钮名、分组名、输入框里的功能说明。例如「角色三视图」的官方说明是「一键生成角色三视图（正面/侧面/背面）」，「25宫格连贯分镜」的官方说明是「生成连续分镜长图」。
- **LibTV 官方前端没有公开**：每项背后真正发给模型的完整提示词正文。
- 因此本目录是**公开对标模板**，不是 LibTV 官方原文。每条都标了公开出处，方便逐条核对、替换。
- 参考图全部保留原始链接，按各仓库许可证使用；不把第三方效果图当作 LibTV 官方截图。

## 怎么用

1. 先在画布上选一张参考图（图生图），或直接写场景描述（文生图）。
2. 打开对应文件，复制「可直接粘贴的模板」整段。
3. 把 `[方括号]` 换成你的角色、商品、场景或剧情。
4. 生成前确认 `15 秒`、`9 格`、`2:1` 这类硬约束没有被删掉。

如果接到 mini-canvas 底栏：`AiActionConfig.template` 里的 `{{prompt}}` 会被替换成输入框内容。各文件里的 `[方括号]` 是**填写位置**；接入时需要把用户输入替换进 `STORY`、`IDENTITY LOCK`、`SCENE` 等对应字段，不能只在模板末尾拼接。参考图通过节点连线 / 素材输入单独传入，不写进文字模板。

### 底栏接入建议

- 每条预设只保留一个 `{{prompt}}` 占位，放在“剧情 / 角色 / 场景描述”字段。
- 固定约束（格数、2:1、identity lock、no text）必须留在模板里，不要依赖用户每次手打。
- 预览用的短句（例如截图里的「点击生成，直接基于当前图像生成……」）放在 `description`，不要塞进发给模型的模板。

## 15 个功能索引

| 分组 | 功能 | 文件 | 结构 |
|---|---|---|---|
| 分镜叙事 | 调度故事板 | [01-调度故事板.md](./01-调度故事板.md) | 4–6 格带运动箭头 |
| 分镜叙事 | 故事板 | [02-故事板.md](./02-故事板.md) | 6 格连续性分镜 |
| 分镜叙事 | 25宫格连贯分镜 | [03-25宫格连贯分镜.md](./03-25宫格连贯分镜.md) | 5×5 长图 |
| 分镜叙事 | 剧情推演四宫格 | [04-剧情推演四宫格.md](./04-剧情推演四宫格.md) | 2×2 未来推演 |
| 分镜叙事 | 画面推演 - 3秒后 | [05-画面推演-3秒后.md](./05-画面推演-3秒后.md) | 单帧未来动作 |
| 分镜叙事 | 画面推演 - 5秒前 | [06-画面推演-5秒前.md](./06-画面推演-5秒前.md) | 单帧过去起因 |
| 空间与机位 | 720全景 | [07-720全景.md](./07-720全景.md) | 2:1 等距圆柱 |
| 空间与机位 | 多机位九宫格 | [08-多机位九宫格.md](./08-多机位九宫格.md) | 3×3 多机位 |
| 设定图 | 角色三视图 | [09-角色三视图.md](./09-角色三视图.md) | 正 / 侧 / 背 + 肖像 |
| 设定图 | 角色脸部三视图 | [10-角色脸部三视图.md](./10-角色脸部三视图.md) | 正 / 四分之三 / 侧 |
| 设定图 | 角色设定图 | [11-角色设定图.md](./11-角色设定图.md) | 主视觉 + 多角度 + 色卡 |
| 设定图 | 场景设定图 | [12-场景设定图.md](./12-场景设定图.md) | 主视图 + 多视角 + 光照 |
| 设定图 | 产品设定图 | [13-产品设定图.md](./13-产品设定图.md) | 多正交视图 + 细节 |
| 质感调节 | 人像质感调节 | [14-人像质感调节.md](./14-人像质感调节.md) | 只改皮肤与光线 |
| 质感调节 | 电影级光影校正 | [15-电影级光影校正.md](./15-电影级光影校正.md) | 只改光，锁住内容 |

## 先看效果图

![角色三视图 / 设定图示例](https://raw.githubusercontent.com/gpt-img-2/gpt-image-2-character-sheet/main/assets/gpt-image-2-character-sheet-example.webp)

*上图：公开的「角色设定图」示例，含主视觉、正 / 侧 / 背三视图、表情、道具和色卡。来源：gpt-img-2/gpt-image-2-character-sheet。*

![九宫格分镜示例](https://raw.githubusercontent.com/RainLib/AI-Storyboard/main/images/demo.jpeg)

*上图：公开的九宫格分镜示例。来源：RainLib/AI-Storyboard。*

![6 格故事板示例](https://raw.githubusercontent.com/gpt-img-2/gpt-image-2-storyboard/main/assets/cinematic-action-storyboard.webp)

*上图：公开的 6 格故事板示例。来源：gpt-img-2/gpt-image-2-storyboard。*

### 每个功能的代表图

| 功能 | 代表图 / 查看位置 |
|---|---|
| 调度故事板 | [Storyboard Reference Studio · stage.png](https://raw.githubusercontent.com/wassermanproductions/storyboard-reference-studio/main/docs/images/stage.png) |
| 故事板 | 上方第 3 张 |
| 25宫格连贯分镜 | 上方第 2 张（九宫格结构示例） |
| 剧情推演四宫格 | [4 Panel Universal Template](https://gist.github.com/kdjayakody/b99dbed27a1c6a56b3065d4c140564cc)（模板页，无示例图） |
| 画面推演 3 秒 / 5 秒 | [Storyboard Reference Studio · hero.png](https://raw.githubusercontent.com/wassermanproductions/storyboard-reference-studio/main/docs/images/hero.png)（关键帧工作板） |
| 720全景 | [text-to-360](https://github.com/ilkerzg/text-to-360)（在线演示，可拖动查看） |
| 多机位九宫格 | 上方第 2 张（同一角色九格示例） |
| 角色三视图 | 上方第 1 张（正 / 侧 / 背） |
| 角色脸部三视图 | [urban-character-sheet.webp](https://raw.githubusercontent.com/gpt-img-2/gpt-image-2-character-sheet/main/assets/urban-character-sheet.webp) |
| 角色设定图 | 上方第 1 张 |
| 场景设定图 | [AntonHu/ai-drama](https://github.com/AntonHu/ai-drama)（README 的室内 / 室外 / 山崖 / 洞穴 / 奇境案例） |
| 产品设定图 | [higgsfield reference-sheet-types](https://github.com/OSideMedia/higgsfield-ai-prompt-skill/blob/main/skills/higgsfield-cinema/references/reference-sheet-types.md)（帽子多视图示例） |
| 人像质感调节 | [eachlabs portrait-enhancement](https://github.com/eachlabs/skills/blob/main/skills/portrait-enhancement/SKILL.md)（前后对比文字案例） |
| 电影级光影校正 | [ComfyUI-qwenmultianglelight](https://github.com/wallen0322/ComfyUI-qwenmultianglelight)（仓库预览图） |

## 推荐组合顺序

分镜类先做「角色设定图」和「场景设定图」，再用它们做「多机位九宫格」与「故事板」，最后用「人像质感调节 / 电影级光影校正」统一质感。这样比从零重复描述更容易保持同一个人、同一件衣服、同一盏光。

## 文件约定

- [00-共享约束.md](./00-共享约束.md)：一页规则，所有模板共用。
- [来源与效果图.md](./来源与效果图.md)：每条模板对应的公开仓库、原始说明和效果图。
- 各功能文件：官方功能说明、适用输入、可直接粘贴的模板、填写要点、效果图、出处。


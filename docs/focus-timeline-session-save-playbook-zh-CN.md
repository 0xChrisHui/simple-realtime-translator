# Focus Timeline 与简单多段保存 Playbook

本文档用于指导后续开发：在当前实时字幕应用中，用尽量简单的方式解决三个问题：

- 长时间翻译时屏幕内容不要无限堆积。
- Focus View 在中英文切换时不要整屏历史字幕一起变语言。
- Stop 后把本次字幕加入一个临时 session 列表，用户可以之后下载或删除。
- 实时输入时减少因为持续重新换行带来的字幕闪动。

这是一个轻量功能，不追求完整会议记录系统。第一版只做当前页面内存态，不做本地持久化。

## 1. 产品边界

第一版目标：

- 支持较长时间使用，目标按 10 小时场景考虑，但不做崩溃恢复。
- Split View 保持中英分栏。
- Focus View 改为短 timeline，语言切换只影响切换点之后。
- Stop 后生成一个临时 transcript session。
- Save 按钮打开简单 session 面板。
- 每个 session 支持 `Download` 和 `Delete`。
- 最终导出以 Focus View 的翻译内容为准。

明确不做：

- 不做 IndexedDB / localStorage transcript 持久化。
- 不做刷新恢复。
- 不做云端保存。
- 不做批量选择下载。
- 不做 ZIP。
- 不做原文/译文双语复杂导出。
- 不处理成本、滥用、访问控制策略。

## 2. 当前问题

### 2.1 长时间内容堆积

如果屏幕显示持续 append 到一个大字符串，长时间使用会导致：

- React state 越来越大。
- DOM 渲染和滚动变慢。
- 屏幕字幕区域越来越难维护。

第一版只需要做到：

- 屏幕显示 buffer 裁剪到最近窗口。
- 保存用 session 数据独立于屏幕显示。

### 2.2 Focus View 整屏切换

当前 Focus View 的核心逻辑类似：

```ts
const singleTargetLanguage = sourceLanguage === "zh" ? "en" : "zh";
const singleCaption = translationCaptions[singleTargetLanguage];
```

当源语言从中文切到英文时，整个 Focus View 会从英文翻译 buffer 切到中文翻译 buffer。视觉上会出现“屏幕已有几行字幕全部变成另一种语言”的效果。

目标是：切换前的历史字幕保持原样，切换只影响之后的新字幕。

## 3. 简化后的总体设计

采用两类数据：

1. **显示数据**
   - Split View：继续按语言分栏，只保留最近文本窗口。
   - Focus View：改为最近若干个翻译片段的 timeline。

2. **临时 session 数据**
   - 每次 Start/Stop 形成一个 session。
   - session 只存在当前页面内存。
   - session 保存完整 Focus 翻译片段，用于下载。
   - 页面刷新或关闭后丢失可以接受。

## 4. 数据结构建议

### 4.1 Focus 片段

```ts
type FocusTranscriptSegment = {
  id: string;
  sourceLanguage: "en" | "zh";
  targetLanguage: "en" | "zh";
  text: string;
  final: boolean;
  startedAt: number;
  updatedAt: number;
};
```

说明：

- `sourceLanguage` 是说话语言。
- `targetLanguage` 是 Focus View 展示的翻译语言。
- `text` 是翻译文本，也是导出文本的来源。
- `final` 为 `true` 后不再用 partial 改写。
- 屏幕只渲染最近 N 个片段，例如 20-40 个。

### 4.2 Session

```ts
type TranscriptSession = {
  id: string;
  startedAt: number;
  stoppedAt: number;
  provider: "openai" | "soniox";
  segments: FocusTranscriptSegment[];
  downloaded?: boolean;
};
```

说明：

- Start 时创建 active session。
- Stop 时结束 active session，并加入 session list。
- 多次 Start/Stop 会生成多条 session。
- session list 存在 React state 或 ref 中即可。
- 下载后可把 `downloaded` 标记为 `true`，但不自动删除。
- 用户可以在面板中手动 Delete。

## 5. Focus View 语言切换规则

Focus View 仍然显示“当前说话语言的反向翻译”：

- 当前说中文，Focus View 显示英文翻译。
- 当前说英文，Focus View 显示中文翻译。

语言切换规则：

- 检测到另一种语言时，进入防抖。
- 防抖期间继续按原语言逻辑显示，不整屏切换。
- 防抖确认后，从候选切换点之后的新片段开始使用新目标语言。
- 候选切换点之前已经显示/确认的历史片段保持原样。
- 如果 candidate 被判定为误触发，不切换。

正式表述：

```txt
切换前：保持原样
防抖期间：继续按原语言显示
防抖确认后：候选切换点之后按新目标语言显示
```

第一版可以简单实现，不需要复杂回滚。关键是不要让已确认历史字幕整体换语言。

## 6. Split View 规则

Split View 保持当前中英分栏模式：

- 英文区显示英文相关字幕。
- 中文区显示中文相关字幕。
- Soniox 优先使用 token metadata。
- OpenAI 继续使用现有字符检测逻辑。

但显示文本需要裁剪，例如每种语言只保留最近 3000-5000 字符，避免长时间卡顿。

## 7. Stop 后行为

点击 Stop 后：

- 如果本次 active session 有有效 final Focus segments，则结束该 session。
- 将 session 加入 session list。
- 显示提示条：

```txt
Transcript ready
[Open Save Panel] [Dismiss]
```

提示条规则：

- 不自动消失。
- 用户点击 `Dismiss` 后关闭。
- 用户点击 `Open Save Panel` 后打开保存面板。
- 如果用户再次 Start，提示条自动关闭。
- 再次 Start 不删除上一段 session。

## 8. Save 面板

Save 按钮不再直接下载，而是打开一个简单 session 面板。

示例：

```txt
Transcripts

2026-05-22 10:03-10:18  15m  Soniox   [Download] [Delete]
2026-05-22 10:21-11:04  43m  OpenAI   [Download] [Delete]
2026-05-22 11:10-11:16   6m  Soniox   [Download] [Delete]

[Close]
```

行为：

- 每行一个 session。
- `Download` 只下载该 session。
- `Delete` 从当前页面 session list 删除该 session。
- 下载后不自动删除，避免误删。
- 用户下载过后，如果不需要保留，可以手动 Delete。
- 页面刷新后 session list 丢失可以接受。

## 9. 导出内容

第一版导出最省事方案：只导出 Focus View 翻译文本。

不导出原文，不导出双语对照。

导出来源：

- 使用 session 中完整的 final Focus segments。
- 不使用屏幕当前可见的最近 N 个片段。
- 不受 Split/Focus 当前显示模式影响。
- 不保存 partial。

导出格式建议：

```txt
Simple Realtime Translator
Session: 2026-05-22 10:03:12 - 2026-05-22 10:18:44
Provider: Soniox

[10:03:15] 中文翻译内容...
[10:03:22] 中文翻译内容...
[10:04:01] English translation...
```

如果实现更省事，也可以先不加每行时间戳，直接按片段换行：

```txt
中文翻译内容...
中文翻译内容...
English translation...
```

优先选择实现成本最低且不影响可读性的格式。

## 10. 长时间使用保护

第一版只做轻量保护：

- Split View 显示 buffer 裁剪。
- Focus View 只渲染最近 N 个片段。
- session 保存内容用 array/segments，不要每个 token 都拼接超长字符串。
- 下载时再把 segments 格式化为文本 Blob。

不做：

- 超长警告。
- 自动分段文件。
- 自动保存到磁盘。
- 崩溃恢复。

## 11. 实时排版防闪动

当前字幕在快速输入时可能出现排版格式频繁切换，表现为换行位置不断变化、字幕轻微闪动。

第一版可以牺牲一点“智能排版美观”，换取更稳定的实时字幕显示。

适用范围：

- Split View。
- Focus View。
- 浮窗字幕。

建议 CSS 策略：

```css
.caption-panel p,
.floating-caption-card p {
  text-align: left;
  text-wrap: wrap;
  overflow-wrap: anywhere;
  word-break: normal;
}
```

说明：

- 避免使用 `text-wrap: pretty` 这类会持续重新优化换行的策略。
- 不追求两端对齐或智能行宽优化。
- 让浏览器用更稳定的普通换行，减少实时追加 token 时的重排闪动。

后续如果实现 Focus timeline segment 渲染，应进一步做到：

- final segment 固定后不再改写。
- partial segment 单独作为最后一个 active segment。
- 这样只有最后一段在变化，历史字幕不会因为新 token 反复重排。

Split View 也可以采用类似策略：

- final 内容尽量固定。
- partial 内容单独追加在最后。
- 屏幕只保留最近窗口。

## 12. 推荐实现顺序

1. 新增 `FocusTranscriptSegment` 和 `TranscriptSession` 类型。
2. 新增 active session ref 和 session list state。
3. Focus View 改成 timeline 渲染最近 N 个 segments。
4. OpenAI / Soniox final translation 写入 active session segments。
5. Split View 显示 buffer 加裁剪。
6. Stop 时结束 active session 并显示提示条。
7. Save 按钮改成打开 session 面板。
8. 实现单 session Download。
9. 实现单 session Delete。
10. 加入简化的语言切换防抖：防抖期间按原语言，确认后新片段使用新目标语言。

## 13. 验收标准

- 长时间运行时，屏幕显示不会无限增长。
- Focus View 语言切换时，切换前字幕不整体变语言。
- 快速输入时，Split View 和 Focus View 不应因为智能换行反复抖动。
- Stop 后出现提示条，且需要用户手动关闭。
- 再次 Start 会关闭提示条，但不删除旧 session。
- Save 面板能看到之前 Stop 产生的 session。
- 每个 session 能单独下载。
- 下载后的 session 可以手动删除。
- 刷新页面后 session 丢失可以接受。

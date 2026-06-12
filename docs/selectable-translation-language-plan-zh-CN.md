# 可选翻译语言工作计划

更新时间：2026-06-12
前置状态：免费试用 + 开源封存计划（`free-trial-and-opensource-plan-zh-CN.md`）P1–P4 已完成，生产已上线（`https://simple-realtime-translator.vercel.app`），试用闸验收通过。
本计划把写死的 en/zh 语言对改造为用户可选的语言对，并让保存导出的内容跟随所选语言。

---

## 0. 已锁定的决策

| 决策点 | 结论 |
| --- | --- |
| 选择框形态 | **两个下拉**（语言 A / 语言 B）自由组合，默认 English / 中文；运行中禁用（同 Provider 切换） |
| Soniox 语言集 | 官方翻译支持的 **60 种全部开放**（3600+ 语言对，运行时报错兜底） |
| OpenAI 语言集 | 官方 13 种输出语言：`en zh es pt fr ja ru de ko hi id vi it`；服务端白名单从 9 扩到 13 |
| Focus 自动切向 | 三层：①不同文字系统 → 文字正则（现状）；②同文字系统 → **停用词证据**接入现有证据累积机制；③新增**手动方向锁定**（Auto / 锁 A→B / 锁 B→A）兜底，对 Soniox 也生效 |
| Soniox 语言判别 | 不变：继续用 token 自带的 `language` / `source_language` 元数据，任意组合全自动 |
| 导出格式 | **保持 .txt 不变**，仅节标题与内容跟随会话的语言对 |
| 旧存档兼容 | IndexedDB 旧记录无 `languages` 字段 → 默认按 `["en","zh"]` 读取与导出，不迁移不删除 |
| 后端 / 试用闸 | **除 OpenAI 白名单扩容外零改动**（Soniox 语言配置在浏览器端 SDK 参数里，临时 key 不限语言） |
| RTL 语言（ar/he/fa/ur） | 开放选择，字幕段落加 `dir="auto"`；标记为轻测试，问题反馈后修 |
| 持久化 | 语言对存 localStorage（`translatorLanguagePair`），解析失败回退 en/zh |

API 事实依据（2026-06-12 查证）：

- OpenAI Realtime Translation 事件流**不暴露**检测到的输入语言（`session.input_transcript.delta` 仅含 `delta/event_id/type/elapsed_ms`），输出语言 13 种，输入 70+ 种自动检测、无需配置；
- Soniox 翻译支持 60 种语言、one-way/two-way 共 3600+ 语言对，token 自带语言标签。

---

## P1：语言注册表与 lib 层去硬编码

**目标：`en/zh` 从类型系统中解除硬编码；默认 en/zh 行为与现状逐字节一致（纯重构，无行为变化）。**

### 1.1 新文件 `lib/languages.ts`（单一事实来源）

- `LANGUAGES` 注册表，每项：`code`（ISO）、`nativeLabel`（中文/日本語/Español…）、`englishLabel`、`script`（`latin | cjk | kana | hangul | cyrillic | arabic | devanagari | thai | other`）、`openai: boolean`（13 种标 true）；Soniox 默认全支持；
- 派生类型：`LanguageCode`（codes 联合类型）、`LanguagePair = { a: LanguageCode; b: LanguageCode }`；
- 按 `script` 的展示与检测预设：`defaultFontSize`（cjk 70 / 其余 60）、`lineHeightRatio`（cjk 1.2 / 其余 1.08）、`SPLIT_CAPTION_TARGET_LINES`（统一 4）、`minSwitchEvidence`（cjk/kana/hangul/thai 3，字母文字 12）；
- **停用词表**：仅为 OpenAI 13 种里的拉丁语言各备 15–25 个高频功能词（es/pt/fr/de/it/id/vi/en），西语另加特征字符 `ñ¿¡`、德语 `ßäöü` 等作加权证据；
- 工具函数：`isLanguageCode`、`getLanguage(code)`、`getOtherPairLanguage(pair, code)`、`getPairTargets(pair)`（替代常量 `TARGETS`，返回 label/placeholder）。

### 1.2 既有 lib 文件改造

- `lib/types.ts`：`TargetLanguage` 改为 `LanguageCode` 别名；`CaptionMap` 改 `Partial<Record<LanguageCode, string>>`；`isTargetLanguage` 改查注册表；`TranscriptSession` 增 `languages: [LanguageCode, LanguageCode]`；
- `lib/caption-text.ts`：`createEmptyCaptionMap(pair)`；`detectInputLanguage(delta, pair)` 与 `getInputLanguageEvidence(delta, language)` 改为按 script 正则 + 拉丁语言停用词计数；`getFocusTargetLanguage(source, pair)` 返回对侧语言；
- `lib/soniox-captions.ts`：`normalizeSonioxLanguage(language, pair)` 改为对 pair 两侧做前缀匹配（保留 zh 的 `cmn/yue` 别名），不在 pair 内的 token 照旧丢弃；`getSonioxCaptionMaps(buffer, pair)`；
- `lib/constants.ts`：删除 `TARGETS`、`DEFAULT_CAPTION_FONT_SIZES`、`SPLIT_CAPTION_*`、`SOURCE_LANGUAGE_SWITCH_MIN_EVIDENCE` 中的 en/zh 硬编码（迁入 languages.ts 预设）；新增 `LANGUAGE_PAIR_STORAGE_KEY`；`INPUT_TRANSCRIPT_TARGET` 删除，改由 pair.b 派生；
- `lib/transcript-session.ts`：`cloneCaptionMap / readTranscriptTextMap / hasTranscriptText / createTranscriptTextFromSegments` 全部改为遍历 `session.languages`。

### 1.3 验收标准

- 全部调用方暂以 `{ a: "en", b: "zh" }` 字面量传入，UI 与行为与现状完全一致（中英会话回归：双视图字幕、Focus 切向、试用倒计时、保存恢复）；
- `npm run typecheck && npm run lint && npm run build` 通过。

---

## P2：hooks 与 page 状态接线

**目标：语言对成为真正的运行时状态，开始会话前可改，所有连接/缓冲/检测跟随。**

- `page.tsx`：新增 `languagePair` state + `languagePairRef`，localStorage 持久化（读取时校验 `isLanguageCode` 且 a≠b，失败回退 en/zh）；字体大小 state/手动覆盖 ref 改按 pair 两码动态键控，**切换语言对时重置为新语言的 script 预设**；auto-fit 遍历 pair；`resetCaptionState` 用 `createEmptyCaptionMap(pair)`；
- Provider 联动：下拉选项按 provider 过滤（openai 只列 13 种）；从 Soniox 切到 OpenAI 时若当前 pair 含不支持语言，**该侧自动回退**（a→en、b→zh）并提示一条非阻断信息；切回 Soniox 恢复用户存储的 pair；
- `useSonioxTranslation`：接收 `languagePairRef`；`record()` 配置 `language_hints: [a, b]`、`translation: { type: "two_way", language_a: a, language_b: b }`；`handleSonioxResult` 全链路 pair 化；
- `useOpenAiTranslation`：会话目标从 `TARGETS` 改为 pair 两码（Split 开 a/b 两个 session，Focus 单 session 跟随切向）；输入转写归属 session 定为 pair.b；`detectInputLanguage(delta, pair)`；
- `useSourceLanguage`：初始/重置语言改 `pair.a`；阈值经注册表查询；
- `useTranscriptSession`：`beginTranscriptSession` 写入 `languages: [a, b]`。

### 验收标准

- en/zh 回归不变；
- Soniox 选 中文⇄日本語 实测：双面板出中日字幕、Focus 说中文显日文、说日文显中文；
- 运行中两个下拉均禁用；停止后切换 pair 再开始，字幕/字体/检测全部跟随。

---

## P3：UI——选择框、方向锁、面板与字体

- **ControlStrip 语言选择**：`Lang` 控件内两个紧凑下拉（A ⇄ B），样式沿用 `device-control`/`device-select`；选项文案 `nativeLabel`；选成同一语言时自动交换两侧（防呆）；`disabled={isRunning}`；
- **Focus 方向锁**：Focus 视图下显示三态小切换 `Auto / →A / →B`（segmented-switch 样式）；锁定时 `focusDirectionOverride` 直接决定显示方向并暂停自动切向（OpenAI 单 session 模式锁定即固定目标 session）；Split 视图隐藏此控件；对 Soniox 同样可用；
- `CaptionStage` / `FloatingCaptionWindow`：面板循环 `getPairTargets(pair)`；CSS 类从 `caption-panel-en/zh` 改为按 script（`caption-panel-cjk` 等），字体 CSS 变量从 `--caption-font-size-en/zh` 改槽位制 `--caption-font-size-a/b`；字幕 `<p>` 加 `dir="auto"`（RTL 兜底）；
- font-dock 两个输入框标签改为所选语言的短标签（EN/中文/日本語/ES…）。

### 验收标准

- 中⇄日、英⇄西、英⇄阿（RTL）三组视觉冒烟：标签、占位文案、字体默认值、面板方向正确；
- 方向锁三态可用且 memo 组件不被高频重渲染（复用试用倒计时时的验证方法）；
- 键盘可操作两个下拉与方向锁。

---

## P4：存档与导出跟随语言对

- `normalizeStoredTranscriptSession`：读取 `languages` 字段，缺失或非法 → `["en", "zh"]`；
- `formatTranscriptSession` 保持 .txt 纯文本结构，节标题与内容跟随语言对：

```txt
Simple Realtime Translator
Session: 2026-06-12 14:00:00 - 14:32:10

中文
（中文全文…）

日本語
（日文全文…）
```

- 节标题用 `nativeLabel`，顺序 = 会话 pair 顺序，空节省略；原“如果需要中文请翻到下方”双语提示行仅在 pair 为 en/zh 时保留（对其他组合无意义）；
- 文件名、扩展名（.txt）、MIME、BOM 全部不变；TrialEndedCard 底部小字不变。

### 验收标准

- 新会话（中⇄日）导出 .txt 两节正确；
- 旧 IndexedDB 记录（无 languages 字段）正常显示在 Save 面板并按 en/zh 导出；
- 空会话清理逻辑（`hasTranscriptText`）对任意 pair 生效。

---

## P5：服务端白名单、文档与总验证

- `app/api/session/route.ts`：`ALLOWED_TARGET_LANGUAGES` 扩为 13 种（加 `hi id vi ru`）——唯一后端改动；
- README：Features 增“可选语言对（Soniox 60 种 / OpenAI 13 种）”；How it works 补一句；
- `docs/zh-CN-quick-start.md`：增“选择翻译语言”小节（含方向锁说明）；
- `docs/api-provider-soniox-playbook-zh-CN.md`：补 two_way 语言对与 60 种语言清单链接；
- 总验证：typecheck/lint/build + 中英回归 + 中日/英西/英阿冒烟 + 试用路径回归（试用与语言选择正交：无 key 选任意 pair 仍走 180s 闸）。

---

## 执行顺序与依赖

```txt
P1（lib 重构，行为不变）→ P2（状态接线）→ P3（UI）→ P4（导出）→ P5（白名单+文档+总验证）
```

每阶段独立提交；P1/P2 的验收核心是 en/zh 回归零变化，P3 起才出现可见的新功能。

## 风险与兜底

| 风险 | 兜底 |
| --- | --- |
| Soniox 个别语言对不支持 two_way（3600+ 对未逐一验证） | 启动时 Soniox 返回错误 → 现有错误横幅原样展示；文档注明；不做预校验白名单 |
| 停用词判别误切向（同文字系统、短句、专名） | 沿用现有证据累积阈值（2.5s + ≥2 块 + 证据量）；手动方向锁兜底 |
| 旧存档无 languages | 默认 en/zh 读取导出，零迁移成本 |
| RTL 字幕排版异常 | `dir="auto"` 基础保障；标记轻测试，按反馈修 |
| localStorage 的 pair 损坏/含已下架语言 | 读取时校验，回退 en/zh |
| OpenAI 同文字系统 pair 切向延迟（需积累一两句话） | 文档说明 + 方向锁；不同文字系统组合不受影响 |
| `CaptionMap` 改 Partial 后的 undefined 渗漏 | P1 全量 typecheck 把关；读取统一 `?? ""` 习惯写法 |

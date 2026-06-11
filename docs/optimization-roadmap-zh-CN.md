# 优化路线图（多 Agent 并行执行指南）

更新时间：2026-06-12
适用版本：以当前仓库代码为基准（`app/page.tsx` 约 2638 行，三个 API 路由）。
文中行号均指当前版本文件；**拆分任务（T3）完成后行号会失效，请以函数名/常量名为锚点定位**。

---

## 0. 给执行 Agent 的总则

1. 本文档把优化工作拆成 10 个任务卡（T1–T10）。每张卡包含：背景、涉及文件、实施步骤、验收标准、与其他任务的冲突关系。
2. **安全/限流问题（服务器 Soniox key 无鉴权可被盗刷）被明确排除在本轮之外**，不要顺手去改 `app/api/_shared/access.ts` 的鉴权逻辑。
3. 项目目前**没有自动化测试**。每个任务的验收以 `npm run build` 通过 + 手动验证路径为准；T2 完成后追加 `npm run typecheck` 与 `npm run lint`。
4. 验证应用是否还能跑：`npm run dev` 启动后打开 `http://localhost:3000`，Soniox 路径需要 `.env.local` 中的 `SONIOX_API_KEY` 或在 UI 中输入 key；OpenAI 路径需要在 UI 中输入 OpenAI key。无 key 时至少验证：页面渲染正常、Provider 切换正常、点击 Start 能给出明确报错而不是白屏。
5. 改动风格：遵循现有代码风格（函数式组件 + hooks、`useCallback`、严格 TypeScript、无注释噪音）。不要引入新的运行时依赖，除非任务卡明确允许。

### 执行波次与依赖关系

```txt
Wave 1（可并行，互不冲突）：
  T1  仓库与工作区卫生（git init、清理日志）
  T2  package.json / 工具链整理
  T3  拆分 page.tsx（核心前置任务）

Wave 2（T3 完成后可并行，各自落在拆分后的不同模块）：
  T4  OpenAI Focus 模式单连接（省一半费用）
  T5  OpenAI 原文重复记录的验证与修复
  T6  渲染性能：字幕区组件化 + memo
  T7  长会议内存上限
  T8  OpenAI 自动重连
  T9  切换音频设备不中断会话
  T10 杂项小修

冲突说明：
- T4、T5、T8、T9 都会触碰拆分后的 OpenAI 连接模块（useOpenAiTranslation），
  若要并行，建议 T4+T8 合并给一个 Agent、T5 与 T9 各一个 Agent，最后由协调者合并。
- T6 触碰组件层，T7 触碰 Soniox/transcript 数据层，与上述互不冲突。
- 若不执行 T3 而直接在 2638 行的 page.tsx 上并行改动，合并冲突几乎必然发生——不要这样做。
```

---

## T1. 仓库与工作区卫生

**优先级：高　|　依赖：无　|　预计改动：不涉及业务代码**

### 背景

项目已部署到 Vercel（存在 `.vercel/project.json`），但**目录不是 git 仓库**——`.gitignore` 写好了却从未生效。同时项目根目录散落着开发期日志文件。

### 实施步骤

1. 在 `simple-realtime-translator/`（含 `package.json` 的那层）执行 `git init`。
2. 删除以下日志文件：
   - `.codex-next-dev.log`、`.codex-next-dev.err.log`
   - `.next-dev-3000.log`、`.next-dev-3000.err.log`
   - `.next-dev-3001.log`、`.next-dev-3001.err.log`
   - `.vercel-deploy.log`
3. 检查 `.gitignore`，确保至少包含：`node_modules/`、`.next/`、`.env.local`、`.env*.local`、`.vercel/`、`tsconfig.tsbuildinfo`、`*.log`。缺哪条补哪条。
4. **确认 `.env.local` 不会被提交**（其中可能有真实 Soniox key），再做首次提交。
5. 首次提交信息建议：`chore: initial commit of working translator app`。

### 验收标准

- `git status` 干净，`git log` 有首次提交。
- `git ls-files` 中不包含 `.env.local`、`.next/`、任何 `*.log`、`tsconfig.tsbuildinfo`。

---

## T2. package.json 与工具链整理

**优先级：高　|　依赖：无（与 T3 并行安全：只动配置文件与新增脚本）**

### 背景

`package.json` 中 `typescript`、`@types/node`、`@types/react`、`@types/react-dom` 放在 `dependencies`，`devDependencies` 为空；没有 ESLint，没有 `lint` / `typecheck` 脚本，类型错误只能等构建或运行时暴露。

### 实施步骤

1. 把 `typescript`、`@types/*` 移到 `devDependencies`（运行时依赖只保留 `next`、`react`、`react-dom`、`@soniox/client`）。
2. 安装 `eslint` 与 `eslint-config-next`（devDependencies），按 Next.js 15 推荐方式生成配置（flat config `eslint.config.mjs`）。
3. 在 `scripts` 中新增：
   ```json
   "lint": "next lint",
   "typecheck": "tsc --noEmit"
   ```
   （若所用 Next 版本已弃用 `next lint`，改用 `eslint .`。）
4. 运行 `npm run lint`，对现有代码报出的问题：
   - 机械性问题（未使用变量、import 顺序等）直接修；
   - 涉及逻辑判断的规则报警（如 react-hooks 依赖项警告）**只记录到本文档末尾的“遗留问题”小节，不要自行改逻辑**，避免与 Wave 2 任务冲突。

### 验收标准

- `npm run build`、`npm run typecheck` 通过；`npm run lint` 通过或仅剩已记录的逻辑类警告。
- `npm ls --omit=dev` 的依赖树中不含 typescript / @types。

---

## T3. 拆分 page.tsx（核心前置任务）

**优先级：最高　|　依赖：无　|　Wave 2 全部任务依赖本任务**

### 背景

`app/page.tsx` 2638 行，混合了：纯文本工具函数、IndexedDB 存储层、Soniox token 处理、OpenAI WebRTC 连接、转写会话管理、浮窗组件、保存面板 UI。任何并行改动都会在这个文件上冲突；顶层组件持有全部 state 也是 T6 性能问题的根源。

### 目标结构

**这是一次纯移动/重组重构，禁止改变任何运行时行为。** 建议结构（可按实际依赖微调，但模块边界必须保持）：

```txt
app/
  page.tsx                      # 仅保留 Home 组件骨架与顶层编排（目标 < 600 行）
lib/
  caption-text.ts               # 纯文本工具：appendCaptionDelta、appendSavedCaptionDelta、
                                #   normalizeTranscriptText、detectInputLanguage、
                                #   getInputLanguageEvidence、formatTimestamp* 等
  transcript-db.ts              # IndexedDB 全套：openTranscriptDb、load/save/delete/clearStoredTranscriptSessions、
                                #   normalizeStoredTranscriptSession、createStoredTranscriptSnapshot、
                                #   sortStoredTranscriptSessions 及相关类型守卫
  soniox-captions.ts            # Soniox 缓冲与 token 逻辑：SonioxCaptionBuffer、
                                #   createEmptySonioxCaptionBuffer、normalizeSonioxLanguage、
                                #   getSonioxTokenKind、getSonioxOutputLanguage、
                                #   getSonioxFinalTokenKey、combineSonioxCaption* 等
  types.ts                      # 共享类型：TargetLanguage、CaptionMap、ApiProvider、Status、
                                #   FocusTranscriptSegment、TranscriptSession、StoredTranscriptSession 等
  constants.ts                  # TARGETS、API_PROVIDERS、各类阈值常量、storage key 常量
hooks/
  useTranscriptSession.ts       # 自动保存/恢复/finalize：save loop、autosave timer、
                                #   beginTranscriptSession、finishActiveTranscriptSession、
                                #   appendSessionTranscriptText、focus segment 管理
  useOpenAiTranslation.ts       # createClientSecret、connectTranslation、startOpenAiTranslation、
                                #   peerConnections/dataChannels 引用与清理
  useSonioxTranslation.ts       # createSonioxConnectionConfig、handleSonioxResult、
                                #   startSonioxTranslation、recording 引用与清理
  useAudioInputs.ts             # refreshAudioInputs、devicechange 监听、选中设备状态
  useFloatingWindow.ts          # Document PiP / popup 开关、prepareFloatingWindow、FLOATING_WINDOW_CSS
components/
  FloatingCaptionWindow.tsx     # 现有同名组件原样迁出
  SavePanel.tsx                 # 保存面板（含 session 列表、Download/Delete/Clear All）
  CaptionStage.tsx              # 双栏/Focus 字幕显示区（为 T6 预留组件边界）
  ControlStrip.tsx              # 顶部控制条（Provider/API key/Input/按钮组）
```

### 实施步骤

1. 先迁移零依赖的纯函数（`lib/caption-text.ts`、`lib/types.ts`、`lib/constants.ts`），每迁一批跑一次 `npm run build`。
2. 再迁 `lib/transcript-db.ts` 与 `lib/soniox-captions.ts`（仅依赖第 1 步产物）。
3. 抽 hooks。注意现有代码大量使用 ref（`statusRef`、`sourceLanguageRef`、`savedCaptionsRef` 等）跨回调共享状态——抽 hook 时**保持 ref 语义不变**，hook 之间通过参数显式传递依赖（例如 `useSonioxTranslation` 需要从转写 hook 接收 `appendSessionTranscriptText`、`appendFocusTranslationDelta`、`trackSourceLanguage*`）。
4. 最后拆 UI 组件。props 按现状显式传递即可，不引入 context（留给 T6 决定）。
5. 全程不修复任何已知 bug、不改任何行为——发现问题记录到“遗留问题”小节。

### 验收标准

- `npm run build` 通过；`page.tsx` 不再包含 IndexedDB、Soniox token 处理、WebRTC 细节的实现体。
- 手动验证：页面渲染、Provider 切换、字号调整、Save 面板打开/关闭、Float 窗口打开/关闭均正常；有 key 时 Soniox 路径可出字幕。
- 各新文件没有循环依赖（`lib/` 不得 import `hooks/` 或 `components/`）。

---

## T4. OpenAI Focus 模式只建一条连接（费用减半）

**优先级：高　|　依赖：T3　|　主战场：`hooks/useOpenAiTranslation.ts`**

### 背景

`startOpenAiTranslation`（原 page.tsx:1768–1792）无条件 `Promise.all(TARGETS.map(...))`，对 en、zh 各建一条 WebRTC 连接、各开一个 `gpt-realtime-translate` session。OpenAI 按 session 计费（约 $2.04/小时/session），双连接即约 $4.08/小时。而 **Focus（single）模式只展示一个方向的翻译**，第二条连接的输出基本被丢弃。

### 实施步骤

1. 启动时读取当前 `displayMode`：
   - `dual`（Split）模式：维持现状，两条连接。
   - `single`（Focus）模式：只对 `getFocusTargetLanguage(sourceLanguageRef.current)` 建一条连接。
2. 注意 input transcript 的归属：现状只有 zh 连接处理 `session.input_transcript.delta`（`INPUT_TRANSCRIPT_TARGET = "zh"`）。单连接时，**input transcript 处理必须跟随这唯一的连接**，不能再以 target===zh 为条件——把该判断改为“当前连接是否为承担 input transcript 的连接”。
3. 源语言切换的处理（Focus 模式下说话语言反转时，需要的翻译方向也反转）：
   - 最小可行方案：检测到 `commitSourceLanguage` 切换且当前为单连接模式时，断开旧连接、按新方向重建（复用现有 `connectTranslation`）。
   - 在 UI 上将这次重建表现为 `connecting` 状态，避免用户以为挂了。
4. 运行中切换 Split/Focus 视图：现状切视图不重建连接。保持简单——**连接拓扑只在 Start 时决定**；若运行中从 Focus 切到 Split，第二语言面板显示占位提示（如“Restart to enable split captions”），不做热重建。把这个限制写进 README。
5. `connectedTargetsRef.current.size === TARGETS.length` 才置 live 的判断（原 page.tsx:1641）需改为与实际连接数比较。

### 验收标准

- Focus 模式 Start 后，浏览器 DevTools 网络面板只看到一次 `/api/session` + 一次 `/api/call`。
- Split 模式行为与现状一致（两次 session/call）。
- Focus 模式下说中文出英文字幕、说英文出中文字幕（语言切换后经重连恢复）。
- README 的成本表更新：注明 Split 模式为双 session（≈$4.08/h），Focus 模式为单 session（≈$2.04/h）。

---

## T5. 验证并修复 OpenAI 路径的原文重复记录

**优先级：中　|　依赖：T3　|　主战场：`hooks/useOpenAiTranslation.ts` 数据通道回调**

### 背景（疑似 bug，先验证后修复）

数据通道回调（原 page.tsx:1659–1701）中，每条连接的 `session.output_transcript.delta` 都会 `appendSessionTranscriptText(targetLanguage, …)`；同时 zh 连接还处理 `session.input_transcript.delta`，按 `detectInputLanguage` 把原文也写入对应语言。

潜在问题：说英文时，input transcript（判定为 en）写入 en 文本；**en 那条连接的 output（英→英）若回显原文，en 文本就会出现两份近似内容**，污染屏幕字幕与导出的 `.txt`。

### 实施步骤

1. **先实测**：用真实 OpenAI key 启动 Split 模式，说一段英文，开启 DevTools 观察两条数据通道各自的 `output_transcript.delta`：
   - 确认 en 连接对英文输入是否产生输出（回显/复述/为空？）。
   - 把观察结果记录到本文档“遗留问题”小节。
2. 若确认重复：在写入会话文本与屏幕字幕前过滤——当 `targetLanguage === 当前判定的输入语言` 时，跳过该连接 output 的 `appendSessionTranscriptText` 与 `setCaptions`（屏幕上该语言面板由 input transcript 喂内容，保持现状）。
3. 若 en 连接对英文输入无输出（API 自身不回显），则关闭本任务，仅在代码中留一行注释说明该前提。
4. 注意与 T4 的交互：T4 的 Focus 单连接模式下本问题天然不存在（只有翻译方向一条连接）；本修复只针对 Split 模式。

### 验收标准

- 实测结论已记录。
- 若修复：说 1 分钟英文后导出 `.txt`，English 段落不出现成对的重复句子；中文段落只含译文。

---

## T6. 渲染性能：字幕区组件化 + memo

**优先级：中　|　依赖：T3　|　主战场：`components/CaptionStage.tsx`、`components/ControlStrip.tsx`、`components/SavePanel.tsx`**

### 背景

所有 state 都在顶层 `Home` 组件。Soniox 高频 partial result（每秒多次）每次触发 `setCaptions` + `setTranslationCaptions`，导致控制条、字号控件、Save 面板、浮窗 portal 全部跟随重渲染。长会议（数小时）下这是持续的无谓开销。

### 实施步骤

1. 以 T3 拆出的组件为边界，对 `ControlStrip`、`SavePanel`、`FloatingCaptionWindow`、`CaptionStage` 应用 `React.memo`。
2. 检查传入这些组件的 props：
   - 回调必须是 `useCallback` 稳定引用（现状大多已是，逐一确认）；
   - 对象/数组 props（如 `captionStyle`、`focusSegments` 切片）用 `useMemo` 稳定化。
3. 高频路径只允许 `CaptionStage` 与 `FloatingCaptionWindow` 重渲染。验证方法：React DevTools Profiler 录制 10 秒 Soniox 转写，确认 `ControlStrip`、`SavePanel` 渲染次数为 0。
4. 可选进阶（仅在上述完成且有余力时）：把 captions 改为 `requestAnimationFrame` 批量提交（token 写入 ref，每帧 flush 一次 setState），将渲染频率钳制到 ≤60fps。**若实现，注意 stop/finalized 时强制 flush 一次，避免丢最后一段。**
5. 不要引入状态管理库。

### 验收标准

- Profiler 验证：转写进行中，非字幕组件零重渲染。
- 字幕显示无肉眼可见的延迟退化；自动滚动（scrollTop 跟随）仍正常。

---

## T7. 长会议内存上限

**优先级：低　|　依赖：T3　|　主战场：`hooks/useSonioxTranslation.ts`、`hooks/useTranscriptSession.ts`**

### 背景

两处只增不减的结构，在 5 小时级别会议中持续膨胀：

1. `sonioxFinalTokenKeysRef`（去重用 Set，每个 final token 存一条约 50–100 字节的字符串 key）。
2. `session.segments`（focus 段数组；`FOCUS_TIMELINE_MAX_SEGMENTS = 32` 只限制**显示**，存储仍无限增长，且每个快照保存都会全量 `cloneTranscriptSegments` 写入 IndexedDB）。

### 实施步骤

1. token key 去重集合加上限：超过 20000 条时丢弃最老的一半。Set 按插入序迭代，可取前 N 个 key 删除；或改用“双 Set 轮换”（current 满了就把 current 变 previous、查询时查两个 Set）——后者实现更简单且 O(1)，推荐。
2. `session.segments` 加存储上限：超过 512 段时丢弃最老的已 final 段（**绝不能丢未 final 段**）。注意：完整转写文本依赖的是 `transcriptText`（独立累积），segments 只服务 Focus 时间线展示与恢复，截断不影响导出内容——在代码注释中写明这一前提。
3. 验证 `cloneTranscriptSegments` 在每次自动保存时的成本随之有界。

### 验收标准

- 构造长会话模拟（可写一次性脚本向 handler 灌注 10 万 token），内存占用有界，字幕、导出文本内容正确。
- 截断不影响 `.txt` 导出的完整性（English/Chinese 段落完整）。

---

## T8. OpenAI 路径自动重连

**优先级：低　|　依赖：T3（建议与 T4 同一 Agent 执行）　|　主战场：`hooks/useOpenAiTranslation.ts`**

### 背景

Soniox 路径有 SDK 自带 `auto_reconnect: true`；OpenAI 路径在 `connectionState` 进入 `failed/disconnected/closed` 时（原 page.tsx:1645–1650）直接清理全部连接并报错，要求用户手动 Start。投影场景下讲者通常无暇操作。

### 实施步骤

1. 在 `onconnectionstatechange` 进入失败分支时，不立即报错，改为：
   - 置状态 `connecting`，提示条显示 “Reconnecting…”；
   - 对**失败的那条连接**重新走 `createClientSecret` + `connectTranslation`（复用现有 sourceStream，麦克风不重新申请）；
   - 最多重试 2 次，间隔 1s/3s；全部失败才落入现有报错路径。
2. 用 ref 记录重试计数，连接成功后清零。
3. 防止竞态：重试期间用户点 Stop，必须中止重试（检查 `statusRef.current === "stopping" || "idle"`，现有代码已有此模式，沿用）。
4. 重连期间转写会话**不**结束（不要触发 `finishActiveTranscriptSession`），字幕在恢复后继续追加。

### 验收标准

- 实测：转写中断网 5 秒再恢复，字幕自动恢复，无需手动 Start；会话导出为同一条记录。
- 断网超过重试窗口时，给出现有的明确报错，状态为 `error`。
- Stop 在重连期间点击仍能干净停止（麦克风释放、状态回 idle）。

---

## T9. 切换音频输入设备不中断会话

**优先级：低　|　依赖：T3　|　主战场：`hooks/useOpenAiTranslation.ts`、`hooks/useSonioxTranslation.ts`、设备选择回调**

### 背景

`handleAudioInputChange`（原 page.tsx:2071–2082）在 live 状态下通过 `stop()` + `start(deviceId)` 切换设备，副作用是一场会议被拆成两条转写记录，且 stop/start 之间有数秒断流。

### 实施步骤

1. **OpenAI 路径**：用 `getUserMedia` 获取新设备流后，对每条 PeerConnection 的 audio sender 调 `sender.replaceTrack(newTrack)`，停掉旧 track，更新 `sourceStreamRef`。不重建连接、不动转写会话。
2. **Soniox 路径**：查阅 `@soniox/client` 的 `MicrophoneSource` / `Recording` API 是否支持运行中换源：
   - 若支持，调用对应 API；
   - 若不支持，退化方案——保持现有 stop/start，但**不结束转写会话**：为 `start` 增加 `keepSession: true` 选项，跳过 `beginTranscriptSession` 与 `finishActiveTranscriptSession`，让新连接继续写入同一个 active session。注意此时不要调用 `resetCaptionState`（屏幕字幕保留）。
3. 切换失败（如设备被拔出）时回退到原设备并提示。

### 验收标准

- live 中切换设备：转写继续、Save 面板里仍是同一条 session 记录、屏幕字幕不清空。
- 切到无效设备时有明确报错且原连接不死。

---

## T10. 杂项小修

**优先级：低　|　依赖：无（不与 T3 冲突的部分可立即做；涉及 page.tsx 的等 T3）**

逐条清单：

1. `app/api/session/route.ts:17`：GET 响应硬编码 `http://localhost:3001`，改为不含端口的中性描述（如 “This endpoint is used by the app with POST.”）。
2. `tsconfig.tsbuildinfo` 出现在项目根目录：确认其在 `.gitignore` 中（T1 已覆盖则跳过），并从工作区删除。
3. README 成本表与 T4 联动更新（T4 验收项，此处仅提醒勿遗漏）。
4. `app/api/session/route.ts` 与 `app/api/soniox/config/route.ts` 中 `getSafetyIdentifier` / `getClientReferenceId` 是两份几乎相同的实现：合并为 `app/api/_shared/identity.ts` 导出的单一函数。
5. `package.json` 无 `engines` 字段：补 `"engines": { "node": ">=20" }`，与 Vercel 运行时对齐。

### 验收标准

- `npm run build` 通过；GET `/api/session` 返回不再含端口号；两个路由 import 同一个 identity 工具函数。

---

## 执行状态（2026-06-12 更新）

| 任务 | 状态 | 说明 |
| --- | --- | --- |
| T1 仓库卫生 | ✅ 完成 | 仓库原本已有 git 历史（环境检测的是外层目录）；删除 7 个日志文件与 tsbuildinfo，提交文档 |
| T2 工具链 | ✅ 完成 | typescript/@types 移入 devDependencies；ESLint flat config + lint/typecheck 脚本 |
| T3 拆分 page.tsx | ✅ 完成 | 2638 行 → 约 580 行编排层 + lib/hooks/components 共 16 个模块；生产服务器冒烟测试通过 |
| T4 Focus 单连接 | ✅ 完成 | Focus 模式单 session；源语言翻转时自动重建连接；README 成本表已更新 |
| T5 原文重复验证 | ⏸ 待人工实测 | 见下方遗留问题 |
| T6 渲染性能 | ✅ 完成 | 四个 UI 组件 memo 化，全部回调稳定引用 |
| T7 内存上限 | ✅ 完成 | token 去重键双 Set 轮换（上限 2×20000）；segments 存储上限 512（只丢已 final 段） |
| T8 自动重连 | ✅ 完成 | 每连接重试 2 次（1s/3s），session epoch 防竞态，Stop 可中止 |
| T9 设备切换 | ✅ 完成 | OpenAI 用 replaceTrack；Soniox 用 keepSession 重启（保留转写会话与屏幕字幕） |
| T10 杂项 | ✅ 完成 | GET /api/session 去硬编码端口；identity 工具合并；engines >=20 |

## 遗留问题（执行过程中追加）

> 各 Agent 在执行中发现的、超出自己任务卡范围的问题，统一记录在这里，不要顺手修。

- **（T5 待人工实测）OpenAI en→en 连接对英文输入的实际输出行为**：本轮执行环境没有真实 OpenAI key，无法验证 Split 模式下 en 连接对英文输入是否回显原文（导致 English 段落重复）。实测方法：用真实 key 启动 Split 模式说一段英文，在 DevTools 观察 `oai-events-en` 数据通道的 `session.output_transcript.delta` 是否有内容。若确认回显，修复方案见任务卡 T5 第 2 步（在 `hooks/useOpenAiTranslation.ts` 的 onmessage 中过滤 `targetLanguage === 当前输入语言` 的 output 写入）。注意 T4 之后 Focus 模式天然无此问题，只需验证 Split 模式。
- （T2）lint 仅报出机械性问题（6 处 prefer-const，已自动修复）与 `_request` 未使用参数（已加 argsIgnorePattern 豁免），无逻辑类警告。
- （T4 设计限制）运行中从 Focus 切到 Split 不会热建第二条连接，需 Stop/Start 重启；已写入 README。
- （T9 设计限制）Soniox 无运行中换音源 API（已确认 `@soniox/client` 2.x 的 `Recording` 仅有 pause/resume/stop/cancel），采用保留会话的重启方案，切换瞬间约有 1-2 秒断流。

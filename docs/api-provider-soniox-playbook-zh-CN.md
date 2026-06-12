# OpenAI / Soniox API Provider 开发 Playbook

本文档用于指导后续 AI 或开发者把当前项目改造成可在首页切换 OpenAI / Soniox 两种实时翻译 API 的版本。

目标是：同一个主页按钮切换 provider，同一套字幕 UI，只做“声音到文字”的实时翻译字幕，不做译音播放或 TTS。

## 0. 目标边界

- 只实现实时字幕翻译，不做译音播放、TTS、语音克隆或 speech-to-speech。
- OpenAI 现有功能必须保持不回退。
- Soniox 使用官方 Web SDK 或 WebSocket 直连方案，优先使用官方 Web SDK。
- 不要把 Soniox 实时 WebSocket 长连接代理放进 Next.js API route。
- 后端只负责 Soniox temporary API key 签发。

## 1. 现状盘点

先检查这些文件：

- `app/page.tsx`
- `app/api/session/route.ts`
- `app/api/call/route.ts`
- `app/api/_shared/access.ts`
- `.env.example`
- `README.md`
- `package.json`

当前 OpenAI 路径：

1. 前端调用 `/api/session` 创建 OpenAI Realtime Translation client secret。
2. 前端创建 WebRTC offer。
3. 前端调用 `/api/call` 做 SDP exchange。
4. 浏览器通过 WebRTC track 发送麦克风音频。
5. OpenAI Realtime data channel 返回字幕 delta。

Soniox 不能按这个 WebRTC SDP 方案接入。Soniox 应走 WebSocket / Web SDK，并通过 temporary API key 让浏览器直连 Soniox。

## 2. 新增依赖

安装 Soniox Web SDK：

```bash
npm install @soniox/client
```

确认 `package.json` 和 `package-lock.json` 已更新。

## 3. 定义 Provider 类型

在前端增加 provider 类型：

```ts
type ApiProvider = "openai" | "soniox";
```

新增 localStorage keys：

```ts
const API_PROVIDER_STORAGE_KEY = "translatorApiProvider";
const OPENAI_API_KEY_STORAGE_KEY = "translatorOpenAiApiKey";
const SONIOX_API_KEY_STORAGE_KEY = "translatorSonioxApiKey";
```

注意：

- 保留现有 OpenAI key 兼容逻辑，避免老用户升级后丢配置。
- 当前已有 `translatorOpenAiApiKey`，不要重命名导致旧数据失效。

## 4. 首页控制区改造

在 `app/page.tsx` 的 header 控制区增加 provider 选择器：

- `OpenAI`
- `Soniox`

API key 输入框根据 provider 切换：

- OpenAI: placeholder `OpenAI key`
- Soniox: placeholder `Soniox key`

运行中建议禁用 provider 切换，避免状态混乱。也可以在切换前自动 stop，但推荐第一版直接禁用。

## 5. 新增 Soniox Temporary Key API

新增文件：

```txt
app/api/soniox/config/route.ts
```

要求：

- `export const runtime = "nodejs";`
- 复用 `denyWithoutAccessCode`
- 响应统一加 `Cache-Control: no-store`
- 请求 body 支持：

```ts
type SonioxConfigRequest = {
  sonioxApiKey?: string;
};
```

key 优先级：

1. 用户在前端输入的 `sonioxApiKey`
2. 服务端环境变量 `SONIOX_API_KEY`

没有 key 时返回 400：

```json
{ "error": "Enter a Soniox API key in the app, or set SONIOX_API_KEY on the server." }
```

调用 Soniox REST：

```txt
POST https://api.soniox.com/v1/auth/temporary-api-key
Authorization: Bearer <long-lived-key>
Content-Type: application/json
```

建议 body：

```json
{
  "usage_type": "transcribe_websocket",
  "expires_in_seconds": 60,
  "single_use": true,
  "max_session_duration_seconds": 7200
}
```

返回给前端至少包含：

```json
{
  "api_key": "...",
  "expires_at": "..."
}
```

安全要求：

- 不要把长期 Soniox API key 下发给浏览器。
- 不要在日志中打印 API key。
- 不要缓存 temporary key 响应。

## 6. 抽出 OpenAI Adapter

把当前 `createClientSecret()`、`connectTranslation()` 这条 OpenAI WebRTC 路径保留为 OpenAI adapter。

建议命名：

```ts
async function startOpenAiTranslation(sourceStream: MediaStream): Promise<void>
```

或保持 React hook callback 形式也可以。

OpenAI 行为保持不变：

- 仍然对 `TARGETS` 开两个连接。
- 仍然调用 `/api/session`。
- 仍然调用 `/api/call`。
- 仍然用 data channel 处理：
  - `session.output_transcript.delta`
  - `session.input_transcript.delta`

不要为了接 Soniox 改坏 OpenAI 旧路径。

## 7. 新增 Soniox Adapter

新增 Soniox 启动函数：

```ts
async function startSonioxTranslation(audioInputId?: string): Promise<void>
```

用 `SonioxClient` 创建客户端：

```ts
const client = new SonioxClient({
  config: async () => {
    const response = await fetch("/api/soniox/config", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...getAccessCodeHeaders(),
      },
      body: JSON.stringify({
        sonioxApiKey: sonioxApiKeyRef.current || undefined,
      }),
    });

    const data = await response.json();
    if (!response.ok) {
      throw new Error(getErrorMessage(data, "Failed to create Soniox temporary key."));
    }

    return data;
  },
});
```

推荐录音配置：

```ts
const recording = client.realtime.record({
  model: "stt-rt-v4",
  language_hints: ["en", "zh"],
  enable_language_identification: true,
  enable_endpoint_detection: true,
  translation: {
    type: "two_way",
    language_a: "en",
    language_b: "zh",
  },
});
```

如果 SDK 支持 `MicrophoneSource` constraints，则传入当前音频设备配置：

```ts
{
  echoCancellation: true,
  noiseSuppression: true,
  autoGainControl: true,
  deviceId: audioInputId ? { exact: audioInputId } : undefined,
}
```

注意：

- Soniox `two_way` 一条录音流即可处理双向翻译（`language_a` / `language_b` 自 2026-06 起由用户选择的语言对决定，不再写死 en/zh；见 `lib/languages.ts` 注册表与 `selectable-translation-language-plan-zh-CN.md`）。
- Soniox 翻译支持 60 种语言、3600+ 语言对（one-way/two-way），完整清单见官方文档 <https://soniox.com/docs/translation/supported-languages>；个别组合若不支持 two_way，会在建立会话时返回错误，前端按普通错误横幅展示。
- 不需要像 OpenAI 当前实现那样为两种语言分别开两个连接。

## 8. 字幕 Buffer 设计

这是最关键的部分。Soniox token 不能简单 append 到现有字幕，否则会出现重复字、闪烁、保存文本污染。

建议建立 Soniox buffer refs：

```ts
type SonioxCaptionBuffer = {
  finalOriginal: CaptionMap;
  partialOriginal: CaptionMap;
  finalTranslation: CaptionMap;
  partialTranslation: CaptionMap;
};
```

处理 Soniox `recording.on("result")`：

- `token.translation_status === "original"`：源语文本
- `token.translation_status === "translation"`：译文文本
- `token.language`：当前 token 文本语言
- `token.source_language`：译文来源语言
- `token.is_final === true`：进入 final buffer
- `token.is_final !== true`：进入本轮 partial buffer

屏幕显示：

```txt
final + partial
```

保存文本：

```txt
只保存 final token
```

不要把 non-final / partial token 写进 `savedCaptionsRef`，否则导出的字幕会重复或包含后续被修正的临时文本。

## 9. Soniox Token 到现有字幕状态的映射

当前 UI 主要有两个状态：

```ts
const [captions, setCaptions] = useState<CaptionMap>({ en: "", zh: "" });
const [translationCaptions, setTranslationCaptions] = useState<CaptionMap>({ en: "", zh: "" });
```

建议语义：

- `captions[language]`：该语言当前应该显示的最终字幕文本。
- `translationCaptions[language]`：该语言作为译文时的字幕文本。

Soniox 映射规则：

1. original token:
   - 根据 `token.language` 更新 `captions[token.language]`
   - 用于源语识别和 Split View

2. translation token:
   - 根据 `token.language` 更新 `translationCaptions[token.language]`
   - 同时也可以更新 `captions[token.language]`，保持现有 UI 不需要大改

如果 token language 不在 `"en" | "zh"` 中，第一版可以忽略，避免污染中英 UI。

## 10. Focus View 语言判断

OpenAI 继续使用现有字符检测逻辑：

- 中文字符 -> `zh`
- 英文字母 -> `en`

Soniox 优先使用 metadata：

- original token 且 `language === "en"` -> `sourceLanguage = "en"`
- original token 且 `language === "zh"` -> `sourceLanguage = "zh"`

Focus View 展示相反语言：

```ts
const singleTargetLanguage: TargetLanguage = sourceLanguage === "zh" ? "en" : "zh";
```

不要在 Soniox 路径中优先用字符猜测语言。Soniox 的 `language` / `source_language` 更可靠。

## 11. 统一 Start / Stop

`start()` 根据 provider 分发：

```ts
if (apiProviderRef.current === "openai") {
  await startOpenAiTranslation(...);
} else {
  await startSonioxTranslation(...);
}
```

OpenAI：

- 继续 `getUserMedia`
- 继续 WebRTC
- 继续清理 `RTCPeerConnection` / `RTCDataChannel` / `MediaStream`

Soniox：

- 用 SDK 管理录音和 WebSocket
- 新增 ref：

```ts
const sonioxRecordingRef = useRef<Recording | null>(null);
```

如果类型不好导入，可以先用结构类型或 `unknown` 包一层最小接口：

```ts
type SonioxRecordingHandle = {
  stop(): Promise<void>;
  cancel(): void;
  on(event: string, handler: (...args: unknown[]) => void): unknown;
};
```

清理逻辑：

- 用户正常点 Stop：优先 `await recording.stop()`
- 出错或组件卸载：用 `recording.cancel()`
- 防止重复 stop/cancel

## 12. Access Code 重试

OpenAI 当前已有 401 时 request access code 的重试逻辑。Soniox temporary key endpoint 也要复用同样体验。

要求：

- `/api/soniox/config` 返回 401 时，前端弹出 access code 输入。
- 用户输入后重试同一个请求。
- 两个 provider 都受 `ACCESS_CODE` 保护。

## 13. 错误处理

Soniox SDK error event：

```ts
recording.on("error", (error) => {
  setError(error instanceof Error ? error.message : "Soniox realtime API error.");
  setRealtimeStatus("error");
});
```

状态映射建议：

- 创建 session / 获取 temporary key：`connecting`
- SDK connected：`live`
- SDK stopped：`idle`
- SDK error：`error`

错误文案要求：

- 没有 Soniox key：明确提示输入 Soniox key 或配置 `SONIOX_API_KEY`
- temporary key 创建失败：显示 Soniox 返回的错误 message
- 浏览器不支持录音：沿用当前麦克风错误提示

## 14. 环境变量

更新 `.env.example`：

```bash
# Optional fallback. Users can also enter their own OpenAI API key in the app.
# OPENAI_API_KEY=sk-your-openai-api-key

# Optional fallback for Soniox provider.
# SONIOX_API_KEY=your-soniox-api-key

# Optional. Used only to hash a safety identifier per visitor.
SAFETY_SALT=change-me

# Optional. Set on Vercel before public use to prevent anonymous API spend.
# ACCESS_CODE=change-me-too

# Optional. Public URL or public-path image for the on-screen watermark.
# NEXT_PUBLIC_WATERMARK_IMAGE=/watermark.png
```

## 15. README 更新

README 增加内容：

- 支持 OpenAI / Soniox provider 切换。
- OpenAI 使用 Realtime Translation WebRTC。
- Soniox 使用 Web SDK + WebSocket + temporary key。
- Soniox 当前只做声音到文字翻译字幕，不做译音播放。
- 公开部署建议设置 `ACCESS_CODE`。
- 可选环境变量：
  - `OPENAI_API_KEY`
  - `SONIOX_API_KEY`

## 16. 验证清单

必须运行：

```bash
npm run build
```

人工验证：

- OpenAI provider 旧功能正常。
- Soniox provider 可以启动、停止、重启。
- 英文讲话时显示中文字幕。
- 中文讲话时显示英文字幕。
- Focus View 能根据源语言切换方向。
- Split View 两栏正常。
- Save 导出的字幕不包含重复 partial。
- 切换麦克风后能重新连接。
- 没有 OpenAI key 时错误清楚。
- 没有 Soniox key 时错误清楚。
- 开启 `ACCESS_CODE` 后两个 provider 都受保护。
- Stop 后浏览器不再继续占用麦克风。

## 17. 不要做的事

- 不要重写 UI。
- 不要把 OpenAI 路径改坏。
- 不要把 Soniox 长期 API key 下发到浏览器。
- 不要用 Next.js API route 代理 Soniox 实时 WebSocket。
- 不要把 Soniox non-final token 直接写进保存文本。
- 不要强行让 OpenAI 和 Soniox 共享同一套底层连接逻辑。它们协议不同，只共享上层字幕 UI 和 provider adapter 接口。

## 18. 官方文档

- Soniox Web SDK: https://soniox.com/docs/sdk/web-SDK
- Soniox Real-time Translation: https://soniox.com/docs/stt/rt/real-time-translation
- Soniox STT WebSocket API: https://soniox.com/docs/api-reference/stt/websocket-api
- Soniox Temporary API Keys: https://soniox.com/docs/guides/temporary-api-keys
- Soniox Models: https://soniox.com/docs/stt/models


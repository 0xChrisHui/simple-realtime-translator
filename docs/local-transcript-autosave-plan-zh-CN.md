# 本地字幕自动保存与恢复开发计划

## 目标

为 Simple Realtime Translator 增加本地自动保存能力，避免页面刷新、浏览器意外关闭、网络异常等情况导致字幕记录丢失。

最终用户体验：

- 翻译过程中自动保存字幕到浏览器本地。
- 正常点击 Stop 后，Save 面板出现一条完整记录。
- 如果翻译中途页面意外关闭，重新打开页面后，Save 面板出现一条 Recovered 记录。
- Save 面板只显示合并后的 session，不显示内部 segment 小段。
- 用户可以 Download、Delete 单条记录，也可以 Clear All 一键清空所有保存记录。

## 技术方案

使用 IndexedDB 存储字幕 session。

不使用固定系统路径，不保存音频文件，只保存文本和元数据。数据保存在当前浏览器、当前网址对应的本地存储空间中，Mac 和 Windows 均可用。

## 数据模型

新增本地 session 状态：

```ts
type TranscriptSessionStatus = "draft" | "completed" | "recovered";

type StoredTranscriptSession = TranscriptSession & {
  status: TranscriptSessionStatus;
  updatedAt: number;
  downloaded?: boolean;
};
```

字段说明：

- `draft`：Start 后创建，正在翻译中。
- `completed`：用户点击 Stop 后正常完成。
- `recovered`：页面加载时发现未完成 draft，自动转为 recovered。
- `downloaded`：用户已下载过，不自动删除。

## 保存策略

1. Start 时创建 draft session，并写入 IndexedDB。
2. final segment 产生后保存，但需要节流，建议 500-1000ms 合并写。
3. partial segment 每 5 秒 checkpoint 一次。
4. 同一时间只允许一个 IndexedDB 写事务。
5. 如果写入过程中又有更新，标记 dirty，当前写完后补写一次。
6. Stop 时强制 flush，并将 session 标记为 completed。
7. 下载时不重新保存整段文本，只在用户点击 Download 时临时格式化 `.txt`。

## 恢复策略

页面初始化时读取 IndexedDB：

1. `completed` session 直接恢复到 Save 面板。
2. `draft` session 说明上次未正常 Stop，将其状态改为 `recovered`。
3. `recovered` 默认显示在 Save 面板最上方。
4. UI 只显示一条合并后的 session，不显示内部 segments。
5. 如果 recovered session 没有有效 segment，不显示或自动删除。

## Save 面板调整

Save 面板显示 completed 和 recovered session。

每条记录显示：

- 时间范围
- 时长
- 状态：Recovered / Downloaded

不显示：

- provider
- segment 数量

每条记录支持：

- Download
- Delete

新增：

- Clear All 按钮
- 点击前弹确认
- 清空所有历史记录，包括 completed、recovered、downloaded
- 清空后同步清空当前页面 Save 面板
- 如果当前正在 live 翻译，Clear All 不删除 active draft，只清历史记录；实现上可禁用 Clear All 或跳过 active draft

## IndexedDB 设计

建议数据库名：

```txt
simple-realtime-translator
```

Object store：

```txt
transcriptSessions
```

Key：

```txt
session.id
```

建议封装以下 helper：

```ts
openTranscriptDb()
loadStoredTranscriptSessions()
saveStoredTranscriptSession(session)
deleteStoredTranscriptSession(sessionId)
clearStoredTranscriptSessions(options?)
```

当前项目规模较小，可以先把 IndexedDB helper 放在 `app/page.tsx` 附近；如果实现后文件过大，再拆到独立前端 helper。

## UI 行为

- Save 按钮打开 Save 面板。
- 页面加载后，如果本地有记录，Save 面板可直接看到。
- Stop 后显示 Transcript ready banner。
- Download 后标记 Downloaded。
- Delete 删除内存 state 和 IndexedDB。
- Clear All 删除所有历史本地记录，并清空内存 state。
- Download 不自动删除记录。

## 隐私与边界

需要在 UI 或文档中说明：

- 本地保存只在同一浏览器、同一网址可恢复。
- 清除浏览器网站数据会丢失记录。
- 无痕模式不保证恢复。
- 换浏览器或换域名不能恢复。
- IndexedDB 不是用户可直接打开的固定文件路径。
- 真正导出 `.txt` 仍需点击 Download。

## 验收标准

1. Start 后产生 draft session。
2. 翻译过程中刷新页面，重新打开后 Save 面板出现一条 Recovered 记录。
3. Recovered 记录包含已保存的多个 segments，但 UI 只显示一条 session。
4. 正常 Start -> Stop 后，Save 面板出现 completed 记录。
5. 刷新页面后 completed 记录仍然存在。
6. Download 可正常导出 `.txt`。
7. Download 后记录标记为 Downloaded。
8. Delete 可删除单条记录，刷新后不再出现。
9. Clear All 可清空所有历史记录，刷新后不再出现。
10. 正在 live 翻译时 Clear All 不破坏 active draft。
11. 长时间运行时页面无明显卡顿。
12. IndexedDB 写入失败时不影响实时翻译，只显示非阻塞错误提示或静默降级。

## 实施顺序

1. 增加 IndexedDB helper。
2. 增加 `StoredTranscriptSession` / session status。
3. Start 时写入 draft。
4. final segment 节流保存。
5. partial segment 5 秒 checkpoint。
6. Stop 时 flush 并标记 completed。
7. 页面加载时恢复 completed / recovered。
8. Save 面板接入本地恢复数据。
9. Delete 同步删除 IndexedDB。
10. Clear All 同步清空 IndexedDB。
11. 调整 Save 面板显示字段。
12. 补充 README 或文档说明。
13. 跑 `npm run build`。
14. 手动验证刷新恢复、Delete、Clear All、Download。

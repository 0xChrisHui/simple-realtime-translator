# 免费试用 + 开源封存工作计划

更新时间：2026-06-12
前置状态：优化路线图（`optimization-roadmap-zh-CN.md`）T1–T10 已完成，代码已模块化（`lib/` + `hooks/` + `components/`），构建/lint/typecheck 全绿。
本计划解决此前搁置的「第 1 条安全问题」（服务器 Soniox key 无鉴权可被盗刷），并把项目包装为封存级开源项目。

---

## 0. 已锁定的决策

| 决策点 | 结论 |
| --- | --- |
| 试用时长 | 每次 **180 秒**，由 Soniox 临时 key 的 `max_session_duration_seconds` 服务端强制执行 |
| 每客户端配额 | **2 次/天**（按 `getClientIdentity` 的 IP+UA 加盐哈希识别） |
| 全局日预算 | **100 次/天**（≈300 分钟 ≈ $0.9/天封顶），超额后试用通道关闭至次日 |
| 配额存储 | **Upstash Redis**（Vercel Marketplace 免费档）+ HMAC 签名 Cookie 双层 |
| 降级行为 | 未配置 Redis 时试用通道自动降级为仅 Cookie 模式（`TRIAL_ENABLED=cookie-only`）或关闭 |
| OpenAI 路径 | 纯 BYOK，不提供试用，行为不变 |
| BYOK 路径 | 用户自带 key 时行为完全不变（5 小时 key，不计配额） |
| 试用结束卡片 | 两个链接做成**按钮**：「Get a free Soniox key」和「Deploy your own」 |
| 仓库 | 沿用 `simple-realtime-translator`，GitHub 公开 |
| 许可证 | MIT |

---

## P1：试用配额后端

**目标：任何人都无法用你的 key 产生超过 ~$1/天的成本；正式了结安全问题第 1 条。**

### 1.1 依赖与环境变量

- 新增依赖：`@upstash/redis`（仅此一个，REST 客户端，无连接池问题，适配 Vercel Serverless）。
- `.env.example` 与 README 新增：

```bash
# 试用通道：full（Redis+Cookie）/ cookie-only / off
TRIAL_ENABLED=full
TRIAL_SECONDS=180
TRIAL_PER_CLIENT_PER_DAY=2
TRIAL_GLOBAL_PER_DAY=100
# 仅 TRIAL_ENABLED=full 时需要（Vercel 集成 Upstash 后自动注入）
UPSTASH_REDIS_REST_URL=
UPSTASH_REDIS_REST_TOKEN=
# 逗号分隔的允许来源，留空则跳过 Origin 校验（本地开发）
ALLOWED_ORIGINS=https://your-app.vercel.app
```

### 1.2 新文件 `app/api/_shared/trial.ts`

试用闸门核心逻辑，导出单一入口 `checkAndConsumeTrial(request): Promise<TrialDecision>`：

```txt
TrialDecision =
  | { allowed: true; setCookie: string }            // 放行，附带要种的签名 Cookie
  | { allowed: false; reason: "disabled" | "origin_denied" | "client_exhausted" | "global_exhausted" }
```

内部按顺序执行四道闸：

1. **开关检查**：`TRIAL_ENABLED=off` 或（`full` 模式但 Redis 变量缺失且无法降级）→ `disabled`；
2. **Origin/Referer 校验**：`ALLOWED_ORIGINS` 非空时，请求的 Origin 不在名单内 → `origin_denied`；
3. **客户端配额**：
   - 解析请求 Cookie `trial_quota`（HMAC-SHA256 签名，密钥 `SAFETY_SALT`，载荷 `{day, count}`），签名不合法视为无 Cookie；
   - Cookie 计数 ≥ `TRIAL_PER_CLIENT_PER_DAY` → `client_exhausted`；
   - full 模式下再查 Redis `trial:client:{identityHash}:{YYYYMMDD}`（INCR + 24h TTL），超限 → `client_exhausted`（Cookie 被清也挡得住）；
4. **全局预算**：Redis `trial:global:{YYYYMMDD}`（INCR + 48h TTL），超过 `TRIAL_GLOBAL_PER_DAY` → `global_exhausted`。cookie-only 模式跳过此步（无全局保护，README 注明风险）。

注意事项：
- 日期统一用 UTC，避免时区边界绕过；
- Redis INCR 先加后判，超限不回滚（多扣不少扣，安全方向正确）；
- Redis 请求 1.5s 超时，超时按 `client_exhausted` 拒绝（fail-closed，宁可拒绝试用也不漏成本）。

### 1.3 修改 `app/api/soniox/config/route.ts`

- **带 `sonioxApiKey` 的请求**：完全不变（透传，`max_session_duration_seconds: 18000`）；
- **不带 key 的请求**（试用路径）：
  - 调 `checkAndConsumeTrial`，拒绝时返回 `403 { error, reason }`（reason 为机器可读码，前端按码展示文案）；
  - 放行时：检查服务器 `SONIOX_API_KEY` 存在（否则 400，同现状），向 Soniox 申请临时 key 时改用 `max_session_duration_seconds: TRIAL_SECONDS`，响应附加 `trial: true, trial_seconds: 180`，并 `Set-Cookie` 更新签名配额 Cookie（`HttpOnly; Secure; SameSite=Lax; Max-Age=86400`）;
- 删除 `app/api/_shared/access.ts` 空壳及三处 `denyWithoutAccessCode` 调用（`noStoreHeaders` 移入 `_shared/identity.ts` 或新建 `_shared/http.ts`）。

### 1.4 验收标准

- BYOK 请求行为与现状逐字节一致（回归点：响应字段、key 时长 18000）；
- 无 key 请求第 1、2 次成功且响应含 `trial: true`，第 3 次返回 403 `client_exhausted`；清 Cookie 后重试仍被 Redis 挡住；
- 把 `TRIAL_GLOBAL_PER_DAY` 临时设为 1 实测全局闸：第 2 个不同身份的客户端收到 `global_exhausted`；
- 伪造 Origin 的 curl 收到 `origin_denied`；
- 注释掉 Redis 环境变量 + `TRIAL_ENABLED=cookie-only`：仅 Cookie 限额生效；`TRIAL_ENABLED=off`：无 key 请求直接 403 `disabled`；
- `npm run typecheck && npm run lint && npm run build` 通过。

---

## P2：试用体验前端

**目标：路人 0 配置点一下就能看到字幕，结束后被体面地引导到 BYOK 或自部署。**

### 2.1 试用状态管理（`hooks/useSonioxTranslation.ts` + `page.tsx`）

- `createSonioxConnectionConfig` 解析响应中的 `trial / trial_seconds`，通过回调上报给 page（新增 hook 参数 `onTrialSession?: (trialSeconds: number) => void`）；
- 403 时把 `reason` 码随 Error 抛出（自定义字段或 Error message 前缀），page 据此区分「试用用尽」与普通错误；
- page 新增状态：`trialCountdownSeconds: number | null`（null = 非试用会话）、`trialEndedVisible: boolean`。

### 2.2 倒计时显示

- 试用会话 live 后启动 1s 间隔倒计时（`setInterval`，stop/错误时清除）；
- 显示位置：ControlStrip 状态 chip 旁新增 `trial-countdown` 徽标，格式 `Trial 2:43`；最后 30 秒变红色提醒；
- 倒计时到 0 或 Soniox 在 180s 切断连接（`finished`/`error` 事件）时：**不走红色错误横幅**，置 `trialEndedVisible=true`、正常走 stop 流程（转写记录照常保存，可下载）。

### 2.3 试用结束卡片（新组件 `components/TrialEndedCard.tsx`）

- 居中卡片（复用 `save-panel-backdrop` 的遮罩样式语言），内容：
  - 标题：`试用结束 / Trial ended`；
  - 一句话：`喜欢的话，两种方式继续使用 / Two ways to keep using it:`；
  - **两个按钮**（并排，主次样式）：
    - 主按钮 `Get a free Soniox key` → `https://console.soniox.com/`（新标签）；副文案注明 Soniox 注册有免费额度；
    - 次按钮 `Deploy your own` → GitHub 仓库 README 的 Deploy 章节锚点（新标签）；
  - 关闭按钮（×）；底部小字提示「本次 3 分钟的字幕已保存，可在 Save 面板下载」。
- 入口复用：`client_exhausted` / `global_exhausted` 的 403 同样弹这张卡（文案微调为「今日试用次数已用完」），不再走错误横幅。

### 2.4 Start 按钮文案

- 条件：provider=Soniox 且 key 输入框为空 → Start 按钮文案改为 `Try 3 min free`（样式不变，仍是 primary）；填了 key 恢复 `Start`。ControlStrip 增加一个 `trialMode: boolean` prop。

### 2.5 验收标准

- 无 key 点击试用按钮 → 正常出字幕 → 倒计时归零 → 卡片弹出且无红色报错 → Save 面板能下载这 3 分钟转写；
- 用尽次数后再点 → 直接弹卡片（不建立连接）；
- 填入自己的 key → 按钮恢复 Start、无倒计时、行为同现状；
- 卡片两个按钮均可点击跳转、键盘可聚焦（基本无障碍）；
- memo 组件不被倒计时高频重渲染拖累（倒计时状态只影响 ControlStrip）。

---

## P3：开源封存包装

**目标：仓库公开后，陌生访客 60 秒内明白这是什么、怎么试、怎么自己部署；并明确传达「完成态、被动维护」。**

### 3.1 LICENSE

- 根目录 `LICENSE`，MIT，版权人写 GitHub 用户名。

### 3.2 README 重写（英文为主）

结构（自上而下）：

1. 项目名 + 一句话定位 + 徽章（CI 状态、license）；
2. **状态声明**：`Status: feature-complete and passively maintained. Issues and PRs are welcome but responses may be slow. Forking is encouraged.`；
3. 截图/GIF（占位，部署后补真实截图：Split 视图 + Focus 视图各一张）；
4. Live Demo 链接 + `Try 3 minutes free` 说明（无需注册）；
5. Features（沿用现有列表，补试用机制一条）；
6. **Deploy your own**：Vercel Deploy Button（`vercel.com/new/clone?repository-url=...&env=SONIOX_API_KEY,SAFETY_SALT,TRIAL_ENABLED,...`）+ Upstash 集成开通步骤 + 全部环境变量表（含试用四件套的默认值与含义）；
7. BYOK 指南（OpenAI / Soniox key 获取链接 + 成本表，沿用现有内容）；
8. 架构简述（三个 API 路由 + 试用闸门一段话 + 简单 ASCII 图）；
9. Local development（现有内容 + lint/typecheck 命令）；
10. License。

中文文档：更新 `docs/zh-CN-quick-start.md`，补试用机制与自部署章节；README 顶部加中文文档链接（现状已有，确认不失效）。

### 3.3 CI（`.github/workflows/ci.yml`）

- 触发：push 到 main + PR；
- 步骤：checkout → setup-node 20（缓存 npm）→ `npm ci` → `npm run lint` → `npm run typecheck` → `npm run build`；
- README 挂 CI 徽章。

### 3.4 仓库卫生

- 移除 `docs/paid-service-roadmap-zh-CN.md`（与免费开源定位冲突；内容如需保留移到仓库外）；
- 其余 docs（playbook、优化路线图、本计划）保留——对二次开发者有价值；
- 推送前跑一次历史扫描：`git log -p | grep` 常见 key 前缀（`sk-`、soniox key 格式），确认 `.env.local` 从未入库（此前已验证 `git ls-files` 无它，再复核一次历史）；
- `.env.example` 同步 P1 的新变量。

### 3.5 验收标准

- 新克隆者按 README 步骤能在本地跑起来、能在 Vercel 部署出可用实例；
- CI 在 GitHub 上首跑即绿；
- 仓库历史无任何真实 key。

---

## P4：部署、验证与公开

1. **Vercel 配置**：通过 Marketplace 接入 Upstash Redis（自动注入两个环境变量）；设置 `SONIOX_API_KEY`、`SAFETY_SALT`（换新随机值）、`TRIAL_*`、`ALLOWED_ORIGINS=<生产域名>`；
2. **端到端验收**（生产环境过一遍 P1/P2 验收清单的核心项：试用 2 次成功 → 第 3 次被拒 → BYOK 正常）；
3. **成本告警**：Soniox 控制台设余额/用量告警；建议账户内只留小额余额（天然止损）；
4. **GitHub 公开**：补仓库 description、topics（`translation`、`realtime`、`nextjs`、`soniox`、`openai`、`captions`）、社交预览图（可用应用截图）；README 的 Demo 链接与 Deploy Button 换成真实 URL；
5. **补真实截图**进 README（P3 占位项）。

---

## 执行顺序与依赖

```txt
P1（后端）──→ P2（前端，依赖 P1 的响应字段）──→ P4（部署验证）
P3（包装）──────────────────────────────────────↗（环境变量表依赖 P1 定稿）
```

P3 的 LICENSE/CI/仓库卫生可与 P1 并行；README 的环境变量章节等 P1 定稿后写。
每个阶段独立提交，沿用现有验证流程（typecheck + lint + build + 冒烟测试）。

## 风险与兜底

| 风险 | 兜底 |
| --- | --- |
| 有人换 IP+UA 刷试用 | 全局 100 次/天硬顶，最坏 ~$1/天；Soniox 账户少充值 |
| Upstash 免费档限额（10K 命令/天） | 每次试用约 3-4 个 Redis 命令，100 次/天 ≪ 限额；超时 fail-closed |
| Vercel 免费档函数额度被刷 | 接口本身轻量；如被恶意打可在 Vercel 开启 Attack Challenge Mode |
| Cookie/Redis 都不可用（cookie-only 模式被清 Cookie 绕过） | README 明确建议生产部署使用 full 模式 |
| 试用中途用户手动 Stop 再 Start | 每次 Start 消耗一次配额（接受，规则简单可解释；卡片文案写明「每天 2 次」） |

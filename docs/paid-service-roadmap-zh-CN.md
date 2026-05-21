# 付费化与账户支付系统路线图

更新日期：2026-05-17

本文记录本项目从当前 demo 演进为可上线付费服务的讨论结论。当前项目是一个 Next.js + Vercel 的实时同传工具，核心成本入口集中在 `/api/session` 创建 OpenAI Realtime Translation client secret。付费化的关键不是重写同传 UI，而是在创建会话前增加账户、余额、权限、风控和用量扣费。

## 当前状态

- 已有：实时中英同传 UI、WebRTC 连接、OpenAI Realtime session 创建、`ACCESS_CODE` 简单保护。
- 暂无：真实用户账号、数据库、支付、订阅、余额、用量扣费、管理后台。
- 关键保护点：`app/api/session/route.ts`。任何公开付费版本都必须先在这里检查用户权限和余额，再创建 OpenAI client secret。
- 重要成本特征：当前实现会同时连接中英两个翻译目标，实际用户分钟成本可能需要按多个 Realtime session 估算。

## 核心模块

### 1. 账号系统

需要用户注册、登录、退出、找回密码。它用于替代现在的 `ACCESS_CODE`，否则系统无法判断是谁在使用、谁付了费、谁需要被限流。

可选方案：

- 懒人 MVP：不用统一 SSO，先用账户中心生成 `license key`，翻译站只校验 key。
- 自建 Next.js 登录：Better Auth / Auth.js。
- 独立身份服务：Logto，适合未来多个网页项目统一登录。
- Web3 友好登录：Privy，可作为身份源和钱包基础设施，但业务账户与账务仍应放在自己的数据库。

建议：第一版如果追求最快上线，用 `license key` 模式；如果想长期多项目复用，用 Logto 或 Better Auth。

### 2. 订阅/支付系统

标准 SaaS 方案可以用 Stripe Checkout、Clerk Billing、Paddle、Lemon Squeezy、Airwallex 等。但本轮讨论更倾向于支持：

- 支付宝/微信：彩虹易支付/易支付兼容通道。
- 加密货币：Privy 钱包能力、BTCPay Server、Stripe Stablecoin 或链上监听。
- 手动收款：微信/支付宝静态二维码 + 后台人工确认。

建议第一版不要做复杂自动续费，优先做“充值分钟包/credits”。支付成功后给用户账户增加内部余额。

### 3. 权限与付费墙

在 `/api/session` 创建 OpenAI Realtime session 前检查：

- 用户是否已登录，或是否提供有效 `license key`。
- 用户状态是否正常。
- 是否有有效会员、套餐或余额。
- 是否超过单次会话、每日、每月、并发限制。
- 是否被管理员封禁或临时限流。

这部分是最关键的成本闸门。

### 4. 用量统计/额度系统

MVP 建议先做“分钟余额”或“credits 余额”，不要一开始做复杂按秒账单。

推荐账本模型：

```txt
credit_ledger
- id
- user_id
- project_id
- delta_credits
- source: epay | crypto | manual | promo | usage
- original_currency: CNY | USDC | USDT | none
- original_amount
- order_id
- tx_hash
- note
- created_at
```

同传开始后，每 15-30 秒上报一次用量并扣费。余额不足时后端返回 `quota_exceeded`，前端停止翻译。

### 5. 成本控制

必须有：

- 单用户每日/月度上限。
- 单次会话最长时长。
- 并发会话限制。
- OpenAI API 创建 session 失败处理。
- 余额不足自动停止。
- 后台总预算和每日成本估算。

上线早期可以粗一点，但不能没有。否则公开访问后容易被滥用并消耗 OpenAI 额度。

### 6. 用户控制台

最小版本需要：

- 当前套餐或 license 状态。
- 剩余额度/已用分钟。
- 充值入口。
- 购买记录。
- API/麦克风/余额不足错误提示。

不需要一开始做复杂 dashboard。

### 7. 管理后台

MVP 最好有：

- 用户列表。
- 查看余额、用量、订单。
- 手动赠送或扣减额度。
- 手动确认收款/补单。
- 禁用异常用户。
- 查看支付回调状态。
- 创建兑换码。

如果使用 license key 懒人方案，后台还需要支持生成、续期、冻结 license。

### 8. 生产部署配置

需要：

- Vercel 环境变量。
- 数据库。
- 支付回调域名。
- OpenAI API key。
- 彩虹易支付商户 ID、密钥、接口地址。
- Crypto 收款钱包或 Privy/BTCPay 配置。
- 域名、HTTPS、日志。

还要把当前 README 和 `.env.example` 补齐生产配置说明。

### 9. 监控与日志

至少记录：

- session 创建成功/失败。
- OpenAI API 错误。
- 每日总分钟数。
- 每日成本估算。
- 用户余额变化。
- 支付下单、回调、补单失败。
- 异常用户和异常 license key。

### 10. 法务与基础页面

付费网站最好补齐：

- Pricing 页面。
- Terms of Service。
- Privacy Policy。
- Refund policy。
- Contact/support 邮箱。

如果使用 credits，需要明确 credits 不可提现、不可转让、仅用于本站服务。

## 支付路线

### 标准 SaaS 支付

适合长期正规运营：

- Stripe：银行卡、Apple Pay、Google Pay、部分地区支持 Alipay/WeChat Pay 和 Stablecoin。
- Airwallex：跨境和亚洲本地支付更友好。
- Paddle / Lemon Squeezy：Merchant of Record，帮忙处理税务与发票，但支付方式和订阅能力会受平台限制。

缺点是需要商户审核、KYC，部分通道对中国本地支付和虚拟服务有限制。

### 彩虹易支付/易支付兼容通道

适合小流量、早期验证、支付宝/微信扫码收款。

优点：

- 接入快。
- API 简单。
- 适合充值分钟包。
- 很多小站、发卡站、VPN/中转站面板都支持类似接口。

风险：

- 服务商质量差异大。
- 有些是平台代收，资金和结算风险更高。
- 微信/支付宝风控仍然存在。
- 不适合长期把大量资金留在平台。

建议：

- 优先选择资金直清到自己微信/支付宝商户号的服务。
- 平台代收只用于小额测试。
- 系统内部只认自己的账本，不绑定某一家支付平台。
- 支付后写入 `credit_ledger`，不要把第三方余额当用户余额。

候选服务商只作为调研对象，不作背书：

- 微极速支付：强调官方结算、资金不经过第三方。
- jiangcen 彩虹易支付：文档完整，适合参考接口。
- 快支付：兼容彩虹易支付/码支付接口。
- yzfpay、80z、糖果易支付等：可作为备选，需要小额测试。

### 加密货币支付

可行方案：

- Privy：做登录、embedded wallet、server wallet、入账 webhook。
- BTCPay Server：自托管，适合 BTC/Lightning，适合更重视隐私支付的场景。
- Stripe Stablecoin / Coinbase Commerce：更托管，合规和开发成本低一些。

建议 first version 只支持一种或两种稳定币网络，例如 USDC on Base 或 Polygon。不要一开始支持太多链。

关键原则：

- 用户自己的 Privy 钱包余额不等于本站余额。
- 用户必须向你控制的商户收款钱包付款。
- 到账后由你的系统写入 `credit_ledger`。
- crypto 充值不可提现，不支持用户间转账。
- 少付、多付、付错链第一版人工处理。

## 账户与身份路线

### Privy 的定位

Privy 可以作为身份源和钱包基础设施，但不应该作为完整账务系统。

推荐分工：

```txt
Privy
  登录、身份验证、邮箱/社交/钱包绑定、钱包基础设施

自己的数据库
  用户资料、订单、余额、会员、用量、项目权限、风控状态
```

用户登录后，系统把 `privy_user_id` 映射到自己的 `users.id`。所有订单、余额、会员和用量都使用自己的用户主键。

### 圈内常见方案

VPN/机场圈常见：

- SSPanel-UIM
- V2Board / Xboard

中转站圈常见：

- One API
- New API
- VoAPI

它们适合参考“余额、套餐、充值、支付回调、后台补单、兑换码、用量日志”，但不建议直接把本同传项目塞进这些系统。

原因：

- 机场面板围绕节点、流量、订阅链接。
- 中转站面板围绕 API key、模型、渠道、token/quota。
- 本项目围绕网页功能和实时翻译分钟。

## 最懒可上线方案

如果目标是最快公开小范围收费测试，推荐：

```txt
账户/充值中心
  注册登录或 license key
  彩虹易支付充值
  管理员补单
  余额/分钟包

Realtime Translator
  保留当前 Next.js UI
  用户输入 license key
  /api/session 校验 license 和余额
  翻译中定时扣分钟
```

用户流程：

1. 用户到账户中心注册。
2. 用户通过支付宝/微信/crypto 充值。
3. 账户中心生成或展示 `license key`。
4. 用户在翻译网页输入 `license key`。
5. 翻译站后端检查余额后才创建 OpenAI session。
6. 使用过程中按时间扣除 credits。

账户中心最少暴露 3 个 API：

```txt
POST /api/license/verify
  输入 license_key
  返回 user_id, balance, status

POST /api/usage/reserve
  开始会话前预扣或锁定额度

POST /api/usage/consume
  每 15-30 秒扣一次分钟/credits
```

这个方案不需要一开始做完整 SSO，改动当前翻译项目最小。

## 长期可复用方案：SaaS Core

如果未来多个网页项目都要复用账户、支付、会员、额度，可以做一个独立 SaaS Core：

```txt
saas-core.example.com
  账号、支付、订单、余额、会员、用量、后台

translator.example.com
  同传业务 UI
  调用 SaaS Core 检查权限和扣费

project-b.example.com
  另一个网页产品
  同样调用 SaaS Core
```

每个业务项目只需要：

- 配置 `PROJECT_ID`。
- 接入登录或 license key。
- 调用 entitlement API。
- 上报 usage。
- 购买按钮跳转 SaaS Core。

核心 API：

```txt
POST /api/entitlements/check
POST /api/usage/report
POST /api/payments/create-order
POST /api/payments/notify/epay
POST /api/payments/notify/crypto
```

## 推荐阶段路线

### Phase 0：保留 demo，补安全边界

- 保留当前 `ACCESS_CODE`。
- 加基础 rate limit。
- 加 session 创建日志。
- 估算单次会议成本。

### Phase 1：最小付费 MVP

- 做账户/充值中心或 license key 后台。
- 接彩虹易支付兼容 provider。
- 建 `orders`、`payments`、`credit_ledger`、`usage_ledger`。
- 翻译站 `/api/session` 校验 license 和余额。
- 翻译中 heartbeat 扣分钟。
- 后台支持补单、加额度、封禁。

### Phase 2：多支付与更稳运营

- 加 crypto 充值。
- 加手动二维码收款和兑换码。
- 加订单查询二次确认。
- 加成本监控和异常用户告警。
- 加用户控制台。

### Phase 3：统一 SaaS Core

- 多项目 `projects` 表。
- 每个项目独立套餐、额度、价格。
- 统一 entitlement/usage API。
- 可选接 Logto/Better Auth 做统一登录。
- 给每个项目提供简单 SDK。

### Phase 4：正规化和规模化

- Stripe/Airwallex/Paddle 等正规通道。
- 税务、发票、退款流程。
- 团队账户。
- 更精细的风控。
- 更完整的监控、告警和客服后台。

## 参考仓库使用原则

可以下载以下项目做 reference：

- New API：参考额度、充值、渠道、用量日志。
- One API：参考中转站 quota/billing。
- V2Board / Xboard：参考套餐、订单、支付插件、邀请返佣。
- SSPanel-UIM：参考传统机场面板模型。
- VoAPI：参考多余额、多货币、兑换码、后台体验。

但不建议直接复制代码：

- New API 是 AGPL-3.0，直接复制核心实现可能触发开源义务。
- 技术栈不一致，直接 copy Go/PHP/Laravel 代码进 Next.js 价值不高。
- 本项目需要的是通用网页产品的付费能力，不是完整中转站或机场面板。

建议给 AI 的开发指令：

```txt
参考 references/xboard 的支付插件结构和 references/new-api 的额度流水设计，
但不要复制代码。请在本项目中用 TypeScript/Next.js/数据库重新实现简化版。
```

## 当前建议结论

短期最实用路线：

```txt
license key + 彩虹易支付充值 + credits/minutes 余额 + /api/session 付费墙 + heartbeat 扣费
```

长期更好的路线：

```txt
独立 SaaS Core + 多项目接入 + 多支付 provider + 自己的账本系统
```

不要把支付平台、Privy 钱包余额或第三方面板余额当作最终账本。最终可信账本必须在自己的数据库里。

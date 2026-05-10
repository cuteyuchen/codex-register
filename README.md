# <p align="center">codex-register</p>

<p align="center">
  <img alt="Version" src="https://img.shields.io/badge/version-v1.0.6-111827">
  <img alt="GitHub Repo stars" src="https://img.shields.io/github/stars/klsf/codex-register?style=social">
</p>

用于批量注册 OpenAI 账号、生成授权文件，并批量检查 `auth` 目录里的额度。

---

## 免责声明

本项目仅供学习、研究与接口行为测试使用。使用者应自行确保其用途符合目标平台的服务条款、当地法律法规以及所在网络环境的合规要求。

因使用本项目导致的账号风险、访问限制、数据丢失、封禁、法律责任或其他任何损失，均由使用者自行承担，项目作者与维护者不承担任何直接或间接责任。

## 环境要求

- Node.js 18+
- 先安装依赖：`npm install`
- 需要准备 `config.json`
- 需要可用代理，默认读取 `config.json.defaultProxyUrl`

## 先做这 3 步

### 1）安装依赖

```bash
npm install
```

### 2）准备配置文件

把 `config.example.json` 复制为 `config.json`，至少改这几项：

```json
{
  "provider": "proxiedmail",
  "defaultProxyUrl": "http://127.0.0.1:10808",
  "defaultPassword": "kuaileshifu88",
  "loopDelayMs": 120000,
  "cliproxyApiAutoUploadAuth": false,
  "cliproxyApiBaseUrl": "http://localhost:8317",
  "cliproxyApiManagementKey": ""
}
```

---

## 最常用命令

### 开发模式运行

直接跑源码：

```bash
npm run dev
```

只跑 1 轮：

```bash
npm run dev -- --n 1
```

### 构建

```bash
npm run build
```

### 运行构建后的主程序

```bash
npm run start
```

### 检查授权额度

```bash
npm run check
npm run check:cpa
```

---

## 主程序：`npm run dev` / `npm run start`

这两个命令参数是一样的：

```bash
npm run dev -- [参数]
npm run start -- [参数]
```

### 常用参数

- `--n <次数>`
    - 自动模式最多跑多少轮
- `--email <邮箱>`
    - 指定单个邮箱执行, 配合 `--otp` 使用
- `--auth`
    - 只登录并生成授权文件，必须配合 `--email`
- `--otp`
    - 手动输入邮箱验证码
- `--sign`
    - 直接注册并授权
- `--at`
    - 只注册 ChatGPT，不走 Codex OAuth 授权；注册成功后读取 ChatGPT `accessToken`
    - token 会保存到 `./auth/at/日期-邮箱.json`，文件名规则与 `./auth` 授权文件一致
- `--st`
    - Sentinel 使用浏览器模式

### 常用示例

#### 自动模式只跑 1 次

```bash
npm run dev -- --n 1
```

#### 指定邮箱，注册并授权

```bash
npm run dev -- --email your_mail@example.com
```

#### 指定邮箱，只做登录授权

```bash
npm run dev -- --email your_mail@example.com --auth
```

#### 指定邮箱，手动输入验证码

```bash
npm run dev -- --email your_mail@example.com --otp
```

#### 直接注册并授权

```bash
npm run dev -- --email your_mail@example.com --sign
```

#### 只注册并保存 ChatGPT accessToken

```bash
npm run dev -- --at
```

指定邮箱：

```bash
npm run dev -- --email your_mail@example.com --at
```

输出文件位于：

```text
./auth/at/日期-邮箱.json
```

如果要启用短信验证，见教程：

- [ADD_PHONE_HERO_SMS.md](./ADD_PHONE_HERO_SMS.md)

---

## 状态及剩余额度检查：`npm run check` / `npm run check:cpa`

批量检查 `auth` 目录里的授权文件额度。

```bash
npm run check -- [参数]
npm run check:cpa -- [参数]
```

### 参数

- `--dir <目录>`
    - 指定 auth 目录，默认 `./auth`
- `--limit <数量>`
    - 只检查前 N 个文件
- `--proxy <代理地址>`
    - 指定代理，不传就用 `config.json.defaultProxyUrl`
- `--refresh`
    - 检查前先尝试刷新 token
- `--verbose`
    - 输出原始状态码和原始响应体
- `--table`
    - 最后输出表格
- `--concurrency <数量>` 或 `-c <数量>`
    - 并发检查数量
- `--cpa`
    - 从 CLIProxyAPI 的 `auth-files` 里读取并检查 auth（`npm run check:cpa` 已内置）

### 示例

```bash
npm run check
npm run check -- --limit 20
npm run check -- --concurrency 8
npm run check -- --limit 50 -c 10
npm run check -- --refresh --table
npm run check -- --proxy http://127.0.0.1:7890 --table
npm run check:cpa
npm run check:cpa -- --refresh --limit 20 -c 8
```

### 输出说明

单个账号输出示例：

```text
[✅️][free][100.00%]someone@example.com-2026-04-21 15:33:10
[❌️]someone@example.com-Encountered invalidated oauth token for user, failing request
```

汇总输出示例：

```text
总数 10 | 可用 8 | 限额 1 | 移除 1 | 可用额度 6.42
```

含义：

- `总数`：检查的账号总数
- `可用`：请求成功的账号数
- `限额`：剩余额度为 `0%` 的账号数
- `移除`：被移除的账号数（本地模式移动到 `auth/401/`，CPA 模式通过 API 删除）
- `可用额度`：所有可用账号剩余额度之和，按小数累计

### `check:cpa` 说明

`npm run check:cpa` 会：

- 从 CLIProxyAPI 的 `auth-files` 拉取 auth 列表
- 下载其中可识别的 codex 授权文件
- 执行和本地 `check` 相同的额度检查
- 如果检查过程中 refresh 成功，会把**更新后的 token 回写到 CPA 对应 auth 文件**
- 如果命中需要移除的 401 凭证，会直接通过 CPA 的 `auth-files` API 删除
- 会根据剩余额度自动调整 CPA auth 状态：
  - `剩余额度 ≤ 5%`：如果当前是启用状态，则调用 API 停用
  - `剩余额度 > 5%`：如果当前是停用状态，则调用 API 启用
  - 如果当前状态本来就符合条件，则不会重复调用 API

说明：

- `check:cpa` 依赖以下配置：
  - `cliproxyApiBaseUrl`
  - `cliproxyApiManagementKey`
- CPA 模式下的“移除”表示通过 API 删除远端 auth 文件，不会移动到本地 `auth/401/`

---

## provider 配置说明

`config.json` 里的 `provider` 可选：

- `proxiedmail`
- `gmail`
- `gptmail`
- `hotmail`
- `2925`
- `cloudflare`

### 1）proxiedmail

~~最省事，适合自动化。~~[已不可用]

```json
{
  "provider": "proxiedmail"
}
```

### 2）gmail

需要配置 Gmail API token 和主邮箱：

```json
{
  "provider": "gmail",
  "gmailAccessToken": "your_gmail_access_token",
  "gmailEmailAddress": "your_gmail@gmail.com"
}
```

临时 token 获取教程见：[GMAIL_OAUTH_PLAYGROUND.md](./GMAIL_OAUTH_PLAYGROUND.md)

### 3）hotmail

```json
{
  "provider": "hotmail"
}
```

邮箱账号放 `hotmail/tokens.txt` 文件里：

`tokens.txt` 格式为：

```text
邮箱----密码----client_id----refresh_token
```

一行一个账号，例如：

```text
someone@hotmail.com----YourPassword123----a016c639-6112-4efe-b2cd-8ef74231bb97----M.Cxxxx...
```

说明：

- 第 1 段：邮箱
- 第 2 段：密码
- 第 3 段：`client_id`
- 第 4 段：`refresh_token`

程序会：

- 从 `tokens.txt` 随机取账号生成别名邮箱
- 用 `refresh_token` 刷新访问令牌
- 根据刷新后返回的 `scope` 自动选择：
  - 包含 `outlook.office.com`：走 Outlook REST API
  - 其他情况：走 Microsoft Graph
- 读取收件箱和垃圾箱中的验证码邮件
- 刷新后的 `refresh_token` 会回写到 `tokens.txt`

### 4）gptmail

```json
{
  "provider": "gptmail",
  "gptMailApiKey": "your_gptmail_api_key",
  "gptMailDomain": ""
}
```

说明：

- `gptMailApiKey`
  - GPTMail API Key
- `gptMailDomain`
  - 可选，指定生成邮箱时使用的域名；留空则由服务端随机分配

程序会：

- 调用 GPTMail 的生成邮箱接口获取邮箱
- 轮询邮件列表并读取邮件详情
- 提取验证码
- 命中后自动删除该邮件

文档：

- [GPTMail API 文档](https://mail.chatgpt.org.uk/zh/api)

### 5）2925

```json
{
  "provider": "2925",
  "2925EmailAddress": "your_2925@2925.com",
  "2925Password": "your_2925_password"
}
```

### 6）cloudflare

```json
{
  "provider": "cloudflare",
  "cloudflareEmailDomain": "54782.xyz",
  "cloudflareApiBaseUrl": "https://mail-d1-api.xxx.workers.dev",
  "cloudflareApiKey": "your_api_key"
}
```

适合自有域名的邮箱注册。
Cloudflare Worker 部署说明见：[MAIL_WORKER_DEPLOY.md](./MAIL_WORKER_DEPLOY.md)

---

## 配置项说明

- `provider`
    - 验证码邮箱提供方
- `defaultProxyUrl`
    - 默认代理地址
- `defaultPassword`
    - 注册默认密码
- `loopDelayMs`
    - 自动模式每轮间隔时间，单位毫秒
- `gmailAccessToken`
    - Gmail API access token
- `gmailEmailAddress`
    - Gmail 主邮箱地址
- `gptMailApiKey`
    - GPTMail API Key
- `gptMailDomain`
    - GPTMail 指定生成邮箱时使用的域名，可留空
- `hotmail`
    - 使用 `./hotmail/tokens.txt` 作为 Hotmail/Outlook 账号来源
- `2925EmailAddress`
    - 2925 邮箱账号
- `2925Password`
    - 2925 邮箱密码
- `cloudflareEmailDomain`
    - Cloudflare Email Routing 的域名
- `cloudflareApiBaseUrl`
    - Cloudflare 邮件 Worker 地址
- `cloudflareApiKey`
    - Cloudflare 邮件 Worker 的 `x-api-key`
- `cliproxyApiAutoUploadAuth`
    - 授权成功后是否自动上传 auth 文件到 CLIProxyAPI
- `cliproxyApiBaseUrl`
    - CLIProxyAPI 管理地址，例如 `http://localhost:8317`
- `cliproxyApiManagementKey`
    - CLIProxyAPI 的 `MANAGEMENT_KEY`

## CLIProxyAPI 自动上传 auth

如果你希望授权成功后，把新生成的 `auth/*.json` 自动上传到 CLIProxyAPI，可在 `config.json` 中开启：

```json
{
  "cliproxyApiAutoUploadAuth": true,
  "cliproxyApiBaseUrl": "http://localhost:8317",
  "cliproxyApiManagementKey": "your_management_key"
}
```

行为说明：

- auth 文件仍然会先保存到本地 `./auth`
- 然后再调用 CLIProxyAPI 管理接口上传
- 上传失败不会中断主流程，只会输出警告日志

## 更新日志

### 2026-05-04

- 新增主程序参数 `--at`：
    - 注册成功后直接获取 ChatGPT `accessToken` 可用于聊天和生成图片
    - 自动保存到 `./auth/at/日期-邮箱.json`

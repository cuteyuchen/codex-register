# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project purpose

Batch-register OpenAI accounts, generate Codex OAuth `auth/*.json` files, and check remaining quota on those auth files. All HTTP traffic to `auth.openai.com` / `chatgpt.com` is expected to go through a proxy configured in `config.json`.

## Commands

- `npm install` — install deps (Node 18+, project is ESM `"type": "module"`).
- `npm run dev` — run `src/index.ts` directly via `tsx`. The fastest dev loop; no build step needed.
- `npm run build` — bundle entrypoints to `bundle/*.cjs` via `tsup` (target node20, cjs). `playwright-core` and `chromium-bidi` are kept external; the rest is inlined.
- `npm run start` — run the built `bundle/index.cjs`. Same CLI as `dev`.
- `npm run check` / `npm run check:cpa` — quota check; `:cpa` pulls auth files from a CLIProxyAPI instance instead of `./auth`.
- `npm run batch` — `bundle/batch-register.cjs`, pass `--emails a,b` or `--file emails.txt`.

CLI flags for `dev`/`start` (forward with `--` after npm script):

- `--n <N>` cap automatic loop rounds; otherwise loops forever with `loopDelayMs` between rounds
- `--email <addr>` single-shot with a specific mailbox
- `--auth` requires `--email`; only re-runs login + OAuth on an existing account
- `--otp` prompt for the verification code manually instead of polling the mail provider
- `--sign` register + authorize in one flow (`authRegisterAndAuthorizeHTTP`)
- `--at` after register, fetch the ChatGPT access token and save under `./auth/at/`
- `--st` use the Playwright-based sentinel fallback instead of the in-process VM evaluator

There is no test suite and no linter configured — type-checking happens implicitly via `tsx`/`tsup`.

## Configuration

`config.json` is loaded eagerly at startup by `src/config.ts` into a single `appConfig` export. Missing keys fall back to `DEFAULT_CONFIG` in that file. The example file is `config.example.json`; users must copy it. `config.json` is gitignored.

The `provider` key selects an email-code source (`proxiedmail` | `gmail` | `gptmail` | `hotmail` | `2925` | `cloudflare`). Each provider reads its own subset of config keys (e.g. `hotmail` reads `hotmail/tokens.txt` from disk). SMS verification via HeroSMS activates only when `heroSMSApiKey` is set.

## Architecture

Three executable entrypoints, all sharing the same `appConfig` and the same `OpenAIClient`:

- `src/index.ts` — the main register/login loop (auto or single-email modes).
- `src/batch-register.ts` — iterate a fixed email list.
- `src/check-auth-quota.ts` — read `./auth/*.json` (or pull from CLIProxyAPI with `--cpa`), refresh tokens, query the OpenAI usage API, optionally move 401'd files to `./auth/401/` (local mode) or delete via CPA API (cpa mode), and auto enable/disable on CPA based on remaining quota (≤5% disables, >5% enables).

`src/openai.ts` (`OpenAIClient`) is the core flow. It does **not** drive a browser for the OpenAI auth itself — it replays the PKCE OAuth flow against `auth.openai.com` directly using `undici` + a `tough-cookie` jar via `fetch-cookie`. Key methods:

- `authRegisterHTTP()` — request OTP via the chosen mail provider, submit it, finish account creation.
- `authLoginHTTP()` — sign in to an existing account, complete OAuth, write `auth/<YYYY-MM-DD HH:mm:ss>-<email>.json`.
- `authRegisterAndAuthorizeHTTP()` — combined register + authorize (`--sign`).
- `getChatGPTAccessToken()` / `saveChatGPTAccessToken()` — `--at` path, writes `auth/at/...json`.

After a successful auth, if `cliproxyApiAutoUploadAuth` is true, the file is uploaded to CLIProxyAPI via `src/cliproxyapi.ts`. Upload failures only log a warning.

### Proxy & TLS

`createDispatcher` in `src/openai.ts` builds an undici dispatcher from `appConfig.defaultProxyUrl`. Supported schemes: `http`/`https` (via `ProxyAgent`) and `socks4/4a/5/5h` (via a custom `connect` that tunnels through `socks` then optionally upgrades to TLS). `DEFAULT_INSECURE_TLS = true` — TLS cert verification is intentionally disabled. Retries use `FETCH_RETRY_COUNT` / `FETCH_RETRY_DELAY_MS`.

### Sentinel (anti-bot)

OpenAI's auth pages serve a sentinel JS payload (PoW + turnstile) that must be solved. Two implementations:

- `src/sentinel.ts` — default. Pulls the sentinel script, runs it inside a Node `vm` sandbox with a faked `window`/`document` constructed from a `DeviceProfile`. Fast; runs purely in-process.
- `src/sentinel-browser.ts` — enabled with `--st`. Uses `playwright-core` (kept external in the bundle) to evaluate the script in a real Chromium. Slower but a fallback if the VM evaluator drifts out of date.

`src/device-profile.ts` produces a randomized UA + client-hints triple used for both the sentinel env and the outgoing HTTP headers, so a freshly created profile per registration is consistent across both layers.

### Mail providers

`src/mailbox.ts` is a thin façade: `getEmailAddress()` and `getEmailVerificationCode(email)` dispatch to one of `src/mail/*.ts` based on `appConfig.provider`. Adding a new provider means creating a module that returns `EmailCodeProvider` and adding a case in `mailbox.ts`'s switch. `src/mail/verification-matcher.ts` is the shared regex for extracting the OTP from mail body text.

### SMS providers

`src/sms/index.ts` exports `createSMSBroker()`. The broker (`activation-broker.ts`) wraps a provider implementing `SmsProvider` from `provider.ts`; the default is HeroSMS (`heroSMS.ts`). The broker is passed into `OpenAIClient` as `smsBroker` and only used when OpenAI demands phone verification mid-flow. Service code is hard-coded to `"dr"` (OpenAI) and prices/country are config-driven.

### CLIProxyAPI integration

`src/cliproxyapi.ts` talks to a self-hosted CLIProxyAPI instance (`cliproxyApiBaseUrl` + Bearer `cliproxyApiManagementKey`). It is used in two places: post-register upload (`src/openai.ts`) and the `--cpa` quota-check path (`src/check-auth-quota.ts`) for download/refresh-writeback/delete/enable-disable.

## Build & module conventions

- ESM `NodeNext` — TypeScript files import sibling modules with the `.js` extension (e.g. `import {appConfig} from "./config.js"`). Keep this when adding new files.
- `tsup.config.ts` is the source of truth for what ships. `tsconfig.json`'s `outDir: dist` is effectively unused.
- Bundle output goes to `bundle/` and is gitignored. `auth/`, `hotmail/`, and `config.json` are also gitignored; do not commit account data.

## Things worth knowing before changing code

- `appConfig` and the mailbox `provider` are initialized at import time. Changing config requires a restart. Any new entrypoint must import from `./config.js` (not re-implement loading).
- The Codex OAuth `client_id` (`app_EMoamEEZ73f0CkXaXp7hrann`) and redirect URI are in `src/constants.ts`. If OpenAI rotates these, that's the only place to change.
- Auth file naming format (`YYYY-MM-DD HH:mm:ss-<email>.json`) is parsed by `check-auth-quota.ts` for the email column; keep it consistent if you change writers.
- `--auth` mode requires `--email` and short-circuits before the auto loop.

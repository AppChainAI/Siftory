# Siftory 桌面应用架构（开发文档）

> 状态：已确认的基线架构。本文档是开发的依据，改动架构先改本文档。

## 1. 技术选型

```
┌─ Tauri App ─────────────────────────────────┐
│  Webview UI (React + Vite)                   │
│    │ fetch + WebSocket → 127.0.0.1:随机端口   │
│  Rust（薄）：                                  │
│    ·  spawn/守护 sidecar（崩溃重启、退出杀死）  │
│    ·  分配随机端口 + 生成一次性 token          │
│    ·  窗口/托盘/自动更新/原生通知              │
└──────────────│───────────────────────────────┘
               │ spawn (Tauri externalBin)
┌─ Sidecar: siftory-agent（Bun 单文件二进制）───┐
│  pi-durable Harness                          │
│    ├─ Storage: SQLite（adapter 包 bun:sqlite）│
│    ├─ HTTP 端点: submit / configure / config  │
│    └─ WS 推送: conversation.viewState()       │
└──────────────────────────────────────────────┘
```

| 决策 | 选择 | 理由 |
|---|---|---|
| 桌面壳 | Tauri | 包体小（~15MB）、原生体验；不为 Electron 的 Chromium 付 150MB |
| Agent 运行时 | pi-durable（Bun sidecar） | 持久化内核：会话/工具调用先落存储再展示，崩溃续跑——视频渲染这类长任务的刚需 |
| sidecar 通信 | localhost HTTP + WebSocket | webview 直连，Rust 不中转消息，只管进程生命周期 |
| sidecar 安全 | 绑定 127.0.0.1 + 随机端口 + Bearer token | 不加 token 则同机任意进程可驱动 Agent |
| 存储 | SQLite（WAL） | pi-durable 官方后端；adapter 用官方 conformance 套件验收 |
| UI 框架 | React + Vite + TypeScript | 主流默认，无特殊需求不折腾 |

## 2. pi-durable 关键事实（开发前必读）

- **Experimental**：API 随版本变动，锁死版本号，升级前读 CHANGELOG。
- **单进程持有存储**：同一时刻只有一个进程能打开存储，无跨进程锁。Harness 必须住在 sidecar 里，UI 永不直连存储。
- **一切状态可订阅**：`conversation.viewState()` 返回只读 Chord 状态，每次 commit 后更新——UI 的全部数据来自它（entries、pi.live 流式输出、pi.inbox、pi.usage、pi.agent）。
- **与 pi Agent 的关系**：pi-durable 是 pi 的下一代内核（Pico5），pi-coding-agent 1.x 仍跑在旧内核 pi-agent-core 上。**pi 扩展插件不能在 pi-durable 里直接用**（两套扩展 API），可复用的只有纯工具逻辑（TypeBox schema + execute 函数体）和 provider 配置。
- **共享底层**：`@earendil-works/pi-ai`（模型访问）、`@earendil-works/chord`（文档状态）、TypeBox。

## 3. 目录结构

```
Siftory/
├── package.json                    # Bun workspace 根
│
├── apps/
│   ├── desktop/                    # Tauri 壳
│   │   ├── src-tauri/
│   │   │   ├── src/main.rs         # sidecar 生命周期、端口/token、窗口
│   │   │   ├── tauri.conf.json     # bundle.externalBin → sidecar 产物
│   │   │   └── Cargo.toml
│   │   └── ui/                     # Webview 前端（React + Vite）
│   │       └── src/
│   │           ├── api/client.ts   # 只依赖 packages/protocol 的类型
│   │           └── components/     # Composer 等
│   │
│   └── agent/                      # ★ sidecar：pi-durable 宿主（Bun）
│       ├── src/
│       │   ├── main.ts             # 入口：HTTP/WS 服务、token 校验、--data-dir
│       │   ├── config.ts           # LLM 提供商配置（config.json + env）
│       │   ├── harness.ts          # Harness.open() 装配
│       │   ├── storage/sqlite.ts   # bun:sqlite → SqliteDatabase facade
│       │   ├── server/             # http.ts / ws.ts
│       │   └── extensions/         # ★ pi-durable 扩展，一文件夹一个
│       │       ├── index.ts        # installAll(registry)：显式装配清单
│       │       ├── research/       # Discover 阶段
│       │       ├── synthesize/     # Synthesize 阶段
│       │       ├── narrate/        # Narrate 阶段
│       │       └── render/         # Visualize 阶段
│       └── test/                   # storage conformance + 崩溃续跑
│
├── packages/
│   └── protocol/                   # sidecar ↔ UI 共享类型（纯 TS 类型）
│
└── scripts/
    ├── dev.ts                      # 并行拉起 sidecar + vite + tauri dev
    └── build-sidecar.ts            # bun build --compile × 4 平台
```

## 4. 扩展管理约定

pi-durable 扩展是**进程内代码**：必须与 Harness 同进程、编译进 sidecar；没有自动发现机制，装配清单显式维护。

每个扩展文件夹的固定形状：

```
research/
├── index.ts        # export default defineExtension({...})，只装配不写逻辑
├── tools/          # 一个 defineTool 一个文件
├── sections.ts     # 系统提示词节
├── hooks.ts        # 钩子（beforeTool 等）
└── docs.ts         # defineDoc：该扩展的自定义状态
```

装配清单 `extensions/index.ts`：

```typescript
export const builtins = [research, synthesize, narrate, render]; // 顺序有意义
export function installAll(registry: Registry) {
	for (const ext of builtins) registry.install(ext);
}
```

规则：

1. **顺序有意义**：同名工具后者覆盖前者；`wraps` 依赖安装顺序。
2. **`docs.ts` 跟扩展走**：自定义状态（研究笔记、分镜稿、渲染进度）的定义属于产生它的扩展。
3. **按会话选择**：扩展装在全局 registry，会话用 `configure({ extensions: [...] })` 选子集。管线各阶段的会话只暴露该阶段工具。
4. **热重载**：`registry.install()` 同名原地替换；在跑的调用用旧代码完成，下一阶段用新代码。
5. **用户扩展（预留不做）**：约定 `appDataDir/extensions/*.ts`，Bun 可直接 import TS。涉及信任/隔离，是产品决策，待内置扩展跑通后再议。

## 5. 数据存储位置

| 场景 | 位置 |
|---|---|
| dev（`bun run dev`） | `<仓库>/apps/agent/.data/`（main.ts 默认值） |
| release 桌面版 | macOS `~/Library/Application Support/ai.appchain.siftory/`；Windows `%APPDATA%\ai.appchain.siftory\`；Linux `~/.local/share/ai.appchain.siftory/`（main.rs 传入 `--data-dir`） |

内容：`siftory.sqlite`（会话、pi.agent 配置、未完成任务；WAL 伴生文件要一起备份）、`auth.json`（API key，0600）、`providers.json`（自定义供应商）。

## 6. LLM 提供商与会话配置

三层配置面（pi-durable 原生）：

| 层级 | 配置项 | 存储 |
|---|---|---|
| 会话级（`pi.agent` 文档） | `model`、`thinkingLevel`（off~max）、`instructions`（追加系统提示词）、`tools`/`extensions`、`cwd` | `siftory.sqlite`（持久、崩溃不丢、fork 继承） |
| 提供商级 | `apiKey`（env 变量自动兜底合并）；内置 provider 的 baseUrl 出厂写死 | `<data-dir>/auth.json`（0600，pi 同款形状），`FileCredentialStore` 实现 pi-ai 的 `CredentialStore` |
| 自定义供应商 | OpenAI 兼容端点：`name`、`baseUrl`、模型列表；key 仍走 auth.json | `<data-dir>/providers.json`（非密钥）；`createProvider + openAICompletionsApi()` 注册，`setProvider` live 生效 |

- 自定义供应商与内置 deepseek 同款构造；OpenAI 兼容差异（参数支持等）由 pi-ai 从 baseUrl 自动探测。
| 运行策略级（`HarnessSettings`） | `stream.timeoutMs`、`retry`、`compaction` 阈值 | 不存储，宿主代码给 |

- sidecar 暴露 `GET/PUT /api/config`；会话级配置走 `root.configure()`（单 commit），改完即生效，无需重启。
- API key 只存 auth.json，不进 UI 的 localStorage，不进协议消息（UI 只能看到"已配置/未配置"）。
- 没有独立的应用 config.json：模型选择的持久化由 `pi.agent` 承担，不重复造。

## 7. 桌面端启动

| 场景 | 命令 | 说明 |
|---|---|---|
| 浏览器开发（最轻） | `bun run dev` | sidecar(47911, faux) + Vite(5173) |
| 桌面窗口开发 | `bun run dev:desktop` | 上面两个 + `tauri dev`；debug 构建不 spawn sidecar，UI 直连 47911 |
| sidecar 二进制 | `bun run build:sidecar [bun-target]` | 产物到 `apps/desktop/bin/siftory-agent-<triple>`；**tauri 编译期就校验 externalBin 存在，首次 tauri dev 前必须先编当前平台的** |
| 打包分发 | `cd apps/desktop && bunx tauri build` | release：Rust spawn sidecar（随机端口 + token），eval 注入 webview |

注意：`tauri.conf.json` 的 `externalBin` 路径相对 src-tauri 目录解析（`../bin/siftory-agent`）。

## 8. 落地路线（按风险从高到低）

| 步骤 | 内容 | 验证标准 |
|---|---|---|
| ① | Bun + pi-durable + bun:sqlite adapter | conformance 套件全绿 + 杀进程续跑 |
| ② | sidecar HTTP/WS 协议 | curl/wscat 跑通一次问答 |
| ③ | Tauri 壳 + 打包 matrix | 三端安装包跑起来 |
| ④ | Siftory 业务工具（search/fetch/视频合成） | 管线各阶段会话可用 |

## 9. 已知风险

1. `bun:sqlite` adapter 行为需 conformance 套件验证（步骤①）。
2. `bun build --compile` 对动态 import 的支持未验证（影响将来的用户扩展）。
3. macOS 公证 Bun 二进制的流程待趟（步骤③）。
4. pi-durable Experimental，版本升级可能 breaking。

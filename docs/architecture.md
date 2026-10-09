# Siftory 桌面应用架构

> 当前实现基线。修改架构时同步更新本文档。业务管线规划与已实现能力分别说明。

## 1. 技术与进程边界

```text
Tauri 壳 ──管理── Bun sidecar
    │                ├─ pi-durable Harness
    │                ├─ SQLite session + 独占所有权锁
    │                ├─ HTTP 命令接口
    │                └─ WebSocket committed snapshots
    └─ React WebView ──HTTP / WS──┘
```

- React 负责界面、输入草稿、连接和展示状态，不读写数据库。
- Rust 负责定位安装包里的 sidecar、启动握手、崩溃重启和退出清理。Agent 业务逻辑仍在 Bun 中。
- sidecar 绑定 `127.0.0.1`，端口由 sidecar 用端口 `0` 自行分配；通过 stdout 的 JSON `ready` 帧通知 Rust。
- React 每次请求、重连通过 `agent_connection` 获取当前端口与 token，刷新不依赖 `window.eval()` 注入。
- 正式版校验 Bearer token 与显式 Origin 白名单；只有 WebSocket upgrade 可用查询参数 token。HTTP 预检不要求 token，实际请求仍要求认证。
- Rust 使用 `desktop.lock` 阻止同一数据目录的桌面实例重复运行；Agent 使用独立的 `agent.lock.sqlite` 排他事务防止任何两个 Agent 打开同一 session。
- sidecar 持续失败最多尝试三次；稳定运行一分钟后重置失败计数。应用退出先请求关闭 Harness，三秒后仍未退出才强制终止。
- Rust 持有 sidecar 的 stdin 管道，壳崩溃后 EOF 会触发 Agent 关闭，避免孤儿进程长期占用存储。

## 2. 目录

```text
apps/agent/src/
  harness.ts                  内核与供应商装配
  config.ts                   CredentialStore
  custom-providers.ts         供应商定义持久化与注册
  storage/{sqlite,ownership,files}.ts
  server/{http,ws,projection,access}.ts
  extensions/{research,synthesize,narrate,render}/
apps/agent/test/               存储契约、接口、进程恢复回归测试
apps/desktop/src-tauri/        原生壳
apps/desktop/ui/               React 客户端
packages/protocol/src/         协议类型和运行时请求 schema
scripts/                      开发、编译与二进制验证
```

当前规模不需要把业务拆成更多公共包。随着供应商和工作流增长，再拆分 `harness.ts` 的装配与应用服务。

## 3. pi-durable 约束

依赖固定为 `pi-durable / pi-ai / chord 1.1.0`。升级须同时检查包内文档、类型和测试；GitHub `main` 不等同于锁定版本。

- 对话通过 `submit()` 接收输入；会话模型、思考级别和指令通过 `configure()` 持久化到 `pi.agent`。
- UI 展示来自 committed state；视图用 `watch()` 串行订阅，终态失败从持久化 submission receipt 获取。
- 不在数据库之外重复维护任务完成状态。重启调用 `resume()`；关闭调用 `harness.close()` 保留未完成工作。
- SQLite adapter 串行化无关操作，事务只能使用其句柄；回调结束后句柄失效。存储一致性套件及句柄回归测试纳入仓库。
- WAL + `synchronous=NORMAL` 保证普通进程崩溃恢复；不承诺最近写入一定抵抗断电。
- 内核不会自动保证外部付费请求或文件生成恰好执行一次。未来工具必须明确 replay 策略、幂等键、检查点与任务 ownership。

## 4. 扩展与业务管线

四个扩展显式安装；提示词使用不同 section key，避免后装扩展覆盖前面的角色。当前 root 选择所有内置扩展，扩展只有提示词，没有研究或视频工具。

业务管线仍待实现：Discover → Synthesize → Narrate → Generate → Produce。

后续设计原则：

1. 用 durable task 表达阶段转换、等待、重试和取消，不依靠提示词文字判断完成。
2. 用 typed documents 保存项目、研究来源、报告、脚本、分镜、审核决定和产物元数据。
3. 阶段可用独立 conversation 并显式选择扩展；不强制每阶段都使用 Agent。
4. 图片、音频和视频存文件系统；数据库记录路径、版本和生成任务 ID。
5. 外部生成任务提交前记录意图和幂等键，恢复时查询已有任务，避免重复扣费。
6. 审核步骤与修改版本持久化；发布、取消与退出具有不同语义。

## 5. 配置与协议

- `auth.json` 保存密钥（Unix `0600`）；`providers.json` 保存非密钥定义。
- 文件不存在使用默认值；损坏、权限或格式问题报错，不静默覆盖。
- 文件通过独立临时文件、flush、rename 替换；单宿主内配置变更串行处理。
- 两个配置文件和 session 数据库不是一个原子事务。捕获到的供应商更新失败尝试回滚定义，但进程崩溃仍可能发生在跨文件写入之间。
- 自定义供应商 ID 必须符合 `custom-` slug，禁止覆盖内置提供商；当前模型使用的供应商不能直接删除。
- 协议 ID 统一编码为字符串；请求采用 TypeBox runtime schema 验证，限制字段、长度和 URL 形状。
- HTTP `/api/chat` 返回 admission receipt；终态失败通过 WS 显示。客户端失败保留草稿，同一内容重试沿用 requestId。
- WS 快照最多包含最近 200 条文本消息；更早历史经 `/api/history?before=...` 分页读取。慢连接保留最新快照，重连重新获取当前状态。

## 6. 启动、构建与验证

根工作区包含 agent、desktop、ui 和 protocol。常用命令见根 README。

- `bun run dev`：假模型 sidecar + 固定 5173 的 Vite，数据目录 `apps/agent/.data`。
- `bun run dev:desktop`：先编当前平台 sidecar，再启动开发服务和 Tauri debug 壳。
- `bun run build:desktop`：构建钩子生成前端和 Tauri 目标 sidecar，再打包。
- `managed-sidecar` feature 可在 debug 检查正式版 supervisor 分支。
- 测试覆盖官方存储契约、配置损坏、重复提交、Origin/token、WebSocket 终态错误、强杀进程后续跑和父进程管道关闭。
- CI 运行三平台检查；本地验证不代替三平台安装包验证、签名和 macOS 公证。

## 7. 数据与备份

release 数据目录由 Tauri `app_data_dir()` 解析，标识符为 `ai.appchain.siftory`。锁文件可以在退出后保留，OS 锁会自动释放，运行时不可删锁文件。

备份应先停止 Agent 再复制目录，或采用 SQLite 在线备份。不能仅复制正在写入的主数据库文件而忽略 WAL。

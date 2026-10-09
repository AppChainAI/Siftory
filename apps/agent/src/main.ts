import { mkdir } from "node:fs/promises";
import { DEV_AGENT_PORT } from "@siftory/protocol";
import { createAgentHost } from "./harness";
import { handleHttp } from "./server/http";
import { createWsHandler } from "./server/ws";

/** 参数：--dev（假模型 + 固定端口 + 免 token）、--port N、--data-dir PATH */
const args = process.argv.slice(2);
const dev = args.includes("--dev");
const flag = (name: string) => {
	const i = args.indexOf(name);
	return i >= 0 ? args[i + 1] : undefined;
};

const dataDir = flag("--data-dir") ?? ".data";
const port = Number(flag("--port") ?? (dev ? DEV_AGENT_PORT : 0));
const token = process.env.SIFTORY_TOKEN ?? (dev ? undefined : crypto.randomUUID());
if (!dev && !process.env.SIFTORY_TOKEN) {
	// 独立运行时生成一次性 token 并打印；Tauri 托管时由 Rust 经 env 注入
	console.log(`siftory-agent token: ${token}`);
}

const authed = (req: Request): boolean => {
	if (!token) return true;
	if (req.headers.get("authorization") === `Bearer ${token}`) return true;
	return new URL(req.url).searchParams.get("token") === token; // WS 无法带 header
};

await mkdir(dataDir, { recursive: true });
const host = await createAgentHost(dataDir, { dev });

const server = Bun.serve({
	port,
	hostname: "127.0.0.1",
	async fetch(req, server) {
		if (!authed(req)) return new Response("unauthorized", { status: 401 });
		if (new URL(req.url).pathname === "/ws") {
			return server.upgrade(req) ? undefined : new Response("upgrade required", { status: 426 });
		}
		return handleHttp(host, req);
	},
	websocket: createWsHandler(host),
});

console.log(`siftory-agent listening on 127.0.0.1:${server.port} (dev=${dev}, data=${dataDir})`);

const shutdown = async () => {
	server.stop(true);
	await host.close();
	process.exit(0);
};
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

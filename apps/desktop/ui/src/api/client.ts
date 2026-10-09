import {
	DEV_AGENT_PORT,
	type ChatSnapshot,
	type ChatSubmitResult,
	type ConfigUpdate,
	type ConfigView,
	type CustomProviderUpsert,
} from "@siftory/protocol";

/** dev 下经 Vite 代理到 sidecar；Tauri 下由 Rust 注入端口/token 到 window.__SIFTORY__ */
declare global {
	interface Window {
		__SIFTORY__?: { port: number; token: string };
	}
}

const injected = window.__SIFTORY__;
const base = injected ? `http://127.0.0.1:${injected.port}` : "";
const authHeaders = (): Record<string, string> =>
	injected ? { authorization: `Bearer ${injected.token}` } : {};

export async function getConfig(): Promise<ConfigView> {
	const res = await fetch(`${base}/api/config`, { headers: authHeaders() });
	return res.json();
}

export async function putConfig(update: ConfigUpdate): Promise<void> {
	await fetch(`${base}/api/config`, {
		method: "PUT",
		headers: { "content-type": "application/json", ...authHeaders() },
		body: JSON.stringify(update),
	});
}

export async function sendChat(content: string): Promise<ChatSubmitResult> {
	const res = await fetch(`${base}/api/chat`, {
		method: "POST",
		headers: { "content-type": "application/json", ...authHeaders() },
		body: JSON.stringify({ content, requestId: crypto.randomUUID() }),
	});
	return res.json();
}

export async function abortChat(): Promise<void> {
	await fetch(`${base}/api/abort`, { method: "POST", headers: authHeaders() });
}

export async function upsertCustomProvider(input: CustomProviderUpsert): Promise<void> {
	await fetch(`${base}/api/custom-providers`, {
		method: "PUT",
		headers: { "content-type": "application/json", ...authHeaders() },
		body: JSON.stringify(input),
	});
}

export async function deleteCustomProvider(id: string): Promise<void> {
	await fetch(`${base}/api/custom-providers/${encodeURIComponent(id)}`, {
		method: "DELETE",
		headers: authHeaders(),
	});
}

/** 订阅会话快照；返回关闭函数。断线自动重连。 */
export function subscribeChat(onSnapshot: (snapshot: ChatSnapshot) => void): () => void {
	let ws: WebSocket | undefined;
	let closed = false;
	let retry: ReturnType<typeof setTimeout> | undefined;

	const connect = () => {
		// dev 下直连 sidecar，不经 Vite 代理：代理中转会让客户端断开时刷 EPIPE 噪音
		const url = injected
			? `ws://127.0.0.1:${injected.port}/ws?token=${encodeURIComponent(injected.token)}`
			: `ws://127.0.0.1:${DEV_AGENT_PORT}/ws`;
		ws = new WebSocket(url);
		ws.onmessage = (e) => onSnapshot(JSON.parse(String(e.data)));
		ws.onclose = () => {
			if (!closed) retry = setTimeout(connect, 1000);
		};
	};
	connect();

	return () => {
		closed = true;
		clearTimeout(retry);
		ws?.close();
	};
}

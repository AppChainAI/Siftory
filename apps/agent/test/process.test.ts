import { expect, it } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import type { ChatSnapshot } from "@siftory/protocol";

async function start(directory: string, dev = false, watchParent = false) {
	const binary = process.env.SIFTORY_TEST_BINARY;
	const entry = fileURLToPath(new URL("../src/main.ts", import.meta.url));
	const child = Bun.spawn(
		[
			...(binary ? [binary] : [process.execPath, entry]),
			"--port",
			"0",
			"--data-dir",
			directory,
			...(dev ? ["--dev"] : []),
		],
		{
			env: {
				...process.env,
				SIFTORY_TOKEN: "test-token",
				SIFTORY_PARENT_WATCH: watchParent ? "1" : "0",
			},
			stdin: "pipe",
			stdout: "pipe",
			stderr: "pipe",
		},
	);
	const reader = child.stdout.getReader();
	let buffer = "";
	const ready = async (): Promise<number> => {
		while (true) {
			const { done, value } = await reader.read();
			if (done)
				throw new Error(
					`Agent exited before readiness: ${await new Response(child.stderr).text()}`,
				);
			buffer += new TextDecoder().decode(value);
			let end: number;
			while ((end = buffer.indexOf("\n")) >= 0) {
				const line = buffer.slice(0, end);
				buffer = buffer.slice(end + 1);
				try {
					const value = JSON.parse(line);
					if (value.type === "ready") return value.port;
				} catch {}
			}
		}
	};
	let timer: ReturnType<typeof setTimeout> | undefined;
	try {
		const port = await Promise.race([
			ready(),
			new Promise<never>((_, reject) => {
				timer = setTimeout(
					() => reject(new Error("Readiness timed out")),
					10_000,
				);
			}),
		]);
		// Continue draining output so the process cannot block on a full pipe.
		void (async () => {
			while (!(await reader.read()).done) {}
		})().catch(() => {});
		return { child, port, base: `http://127.0.0.1:${port}` };
	} catch (error) {
		child.kill();
		await child.exited;
		throw error;
	} finally {
		clearTimeout(timer);
	}
}
const headers = {
	authorization: "Bearer test-token",
	"content-type": "application/json",
	origin: "tauri://localhost",
};
function watch(port: number, predicate: (snapshot: ChatSnapshot) => boolean) {
	const socket = new WebSocket(`ws://127.0.0.1:${port}/ws?token=test-token`);
	let timer: ReturnType<typeof setTimeout>;
	const result = new Promise<ChatSnapshot>((resolve, reject) => {
		timer = setTimeout(() => {
			socket.close();
			reject(new Error("Snapshot timed out"));
		}, 10_000);
		socket.onmessage = (event) => {
			const snapshot = JSON.parse(String(event.data));
			if (predicate(snapshot)) {
				clearTimeout(timer);
				socket.close();
				resolve(snapshot);
			}
		};
		socket.onerror = () => {
			clearTimeout(timer);
			reject(new Error("WebSocket failed"));
		};
	});
	return {
		result,
		close: () => {
			clearTimeout(timer);
			socket.close();
		},
	};
}
it("serves authenticated desktop preflight, durable terminal errors and graceful shutdown", async () => {
	const directory = await mkdtemp(join(tmpdir(), "siftory-http-"));
	const agent = await start(directory);
	let stream: ReturnType<typeof watch> | undefined;
	try {
		const preflight = await fetch(`${agent.base}/api/chat`, {
			method: "OPTIONS",
			headers: {
				origin: "tauri://localhost",
				"access-control-request-method": "POST",
				"access-control-request-headers": "authorization,content-type",
			},
		});
		expect(preflight.status).toBe(204);
		expect(preflight.headers.get("access-control-allow-origin")).toBe(
			"tauri://localhost",
		);
		expect((await fetch(`${agent.base}/api/config`)).status).toBe(401);
		expect(
			(
				await fetch(`${agent.base}/api/config`, {
					headers: { ...headers, origin: "https://untrusted.invalid" },
				})
			).status,
		).toBe(403);
		stream = watch(agent.port, (snapshot) => snapshot.lastError === "no_model");
		const response = await fetch(`${agent.base}/api/chat`, {
			method: "POST",
			headers,
			body: JSON.stringify({ content: "hello", requestId: "one" }),
		});
		expect(response.ok).toBe(true);
		expect(typeof (await response.json()).submissionId).toBe("string");
		expect((await stream.result).busy).toBe(false);
		stream = watch(agent.port, (snapshot) => snapshot.lastError === "no_model");
		expect((await stream.result).messages.length).toBe(1);
		await fetch(`${agent.base}/api/shutdown`, { method: "POST", headers });
		expect(await agent.child.exited).toBe(0);
	} finally {
		stream?.close();
		agent.child.kill();
		await agent.child.exited;
		await rm(directory, { recursive: true, force: true });
	}
}, 20_000);

it("resumes an interrupted generation after process death and releases storage ownership", async () => {
	const directory = await mkdtemp(join(tmpdir(), "siftory-recovery-"));
	let agent = await start(directory, true);
	let stream: ReturnType<typeof watch> | undefined;
	try {
		stream = watch(
			agent.port,
			(snapshot) => snapshot.busy && !!snapshot.streamingText,
		);
		const input = { content: "recovery checkpoint", requestId: "recover-once" };
		const response = await fetch(`${agent.base}/api/chat`, {
			method: "POST",
			headers,
			body: JSON.stringify(input),
		});
		const receipt = await response.json();
		await stream.result;
		agent.child.kill("SIGKILL");
		await agent.child.exited;
		agent = await start(directory, true);
		stream = watch(
			agent.port,
			(snapshot) =>
				!snapshot.busy &&
				snapshot.messages.some((message) => message.role === "assistant"),
		);
		const completed = await stream.result;
		expect(
			completed.messages.filter((message) => message.role === "user"),
		).toHaveLength(1);
		const repeated = await fetch(`${agent.base}/api/chat`, {
			method: "POST",
			headers,
			body: JSON.stringify(input),
		});
		expect((await repeated.json()).submissionId).toBe(receipt.submissionId);
	} finally {
		stream?.close();
		agent.child.kill();
		await agent.child.exited;
		await rm(directory, { recursive: true, force: true });
	}
}, 20_000);

it("closes when its desktop owner's pipe disappears", async () => {
	const directory = await mkdtemp(join(tmpdir(), "siftory-parent-"));
	const agent = await start(directory, false, true);
	try {
		agent.child.stdin.end();
		expect(await agent.child.exited).toBe(0);
	} finally {
		agent.child.kill();
		await agent.child.exited;
		await rm(directory, { recursive: true, force: true });
	}
}, 15_000);

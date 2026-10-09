import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { Credential, CredentialInfo, CredentialStore } from "@earendil-works/pi-ai/models";

/**
 * 提供商密钥存储：`<data-dir>/auth.json`，形状与 pi 的 auth.json 相同
 * （每提供商一条 type-tagged credential）。实现 pi-ai 的 CredentialStore。
 * 单进程内用 promise 链串行化写（modify 契约要求）。
 */
export class FileCredentialStore implements CredentialStore {
	private queue: Promise<unknown> = Promise.resolve();

	constructor(private readonly file: string) {}

	private async readAll(): Promise<Record<string, Credential>> {
		try {
			return JSON.parse(await readFile(this.file, "utf8"));
		} catch {
			return {}; // 文件不存在或损坏都按空处理
		}
	}

	private async writeAll(data: Record<string, Credential>): Promise<void> {
		await mkdir(dirname(this.file), { recursive: true });
		const tmp = `${this.file}.tmp`;
		await writeFile(tmp, JSON.stringify(data, null, 2), { mode: 0o600 });
		await rename(tmp, this.file);
	}

	private enqueue<T>(fn: () => Promise<T>): Promise<T> {
		const result = this.queue.then(fn);
		this.queue = result.catch(() => {});
		return result;
	}

	read(providerId: string): Promise<Credential | undefined> {
		return this.enqueue(async () => (await this.readAll())[providerId]);
	}

	async list(): Promise<readonly CredentialInfo[]> {
		const all = await this.readAll();
		return Object.entries(all).map(([providerId, c]) => ({ providerId, type: c.type }));
	}

	modify(providerId: string, fn: (current: Credential | undefined) => Promise<Credential | undefined>): Promise<Credential | undefined> {
		return this.enqueue(async () => {
			const all = await this.readAll();
			const next = await fn(all[providerId]);
			if (next !== undefined) {
				all[providerId] = next;
				await this.writeAll(all);
			}
			return next;
		});
	}

	delete(providerId: string): Promise<void> {
		return this.enqueue(async () => {
			const all = await this.readAll();
			delete all[providerId];
			await this.writeAll(all);
		});
	}
}

export const authFile = (dataDir: string) => join(dataDir, "auth.json");


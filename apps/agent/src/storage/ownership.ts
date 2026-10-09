import { Database } from "bun:sqlite";
import { mkdirSync } from "node:fs";
import { join } from "node:path";

/** A separate SQLite file supplies an OS-released process lock without locking the session database. */
export function acquireOwnership(directory: string): () => void {
	mkdirSync(directory, { recursive: true });
	const lock = new Database(join(directory, "agent.lock.sqlite"));
	try {
		lock.exec("PRAGMA busy_timeout = 0; BEGIN EXCLUSIVE;");
	} catch (cause) {
		lock.close();
		throw new Error("Another Agent owns this data directory", { cause });
	}
	return () => lock.close();
}

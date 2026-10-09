import { describe, expect, it } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
	SqliteStorage,
	type SqliteExecutor,
} from "@earendil-works/pi-durable/storage/sqlite";
import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import { registerStorageConformance } from "@earendil-works/pi-durable/testing";
import { openBunSqlite } from "../src/storage/sqlite";

registerStorageConformance(
	{ describe, expect, it },
	"Bun SQLite",
	async (use) => {
		const directory = await mkdtemp(join(tmpdir(), "siftory-storage-"));
		const storage = await SqliteStorage.open(
			openBunSqlite(join(directory, "session.sqlite")),
		);
		try {
			await use(storage);
		} finally {
			await storage.close(BACKGROUND_CONTEXT);
			await rm(directory, { recursive: true, force: true });
		}
	},
);

it("invalidates settled transaction handles and rolls failed transactions back", async () => {
	const database = openBunSqlite(":memory:");
	try {
		let escaped!: SqliteExecutor;
		await database.transaction(async (tx) => {
			escaped = tx;
			await tx.exec("CREATE TABLE example (value TEXT)");
		});
		await expect(
			escaped.run("INSERT INTO example VALUES (?)", "escaped"),
		).rejects.toThrow("no longer active");
		await expect(
			database.transaction(async (tx) => {
				await tx.run("INSERT INTO example VALUES (?)", "rollback");
				throw new Error("expected failure");
			}),
		).rejects.toThrow("expected failure");
		expect(await database.all("SELECT * FROM example")).toEqual([]);
	} finally {
		await database.close();
	}
});

import { Database } from "bun:sqlite";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import type { SqliteDatabase, SqliteExecutor, SqliteValue } from "@earendil-works/pi-durable/storage/sqlite";

/**
 * bun:sqlite → pi-durable 的 SqliteDatabase facade。
 * bun:sqlite 是同步 API；用一条 promise 链串行化所有操作，
 * 满足契约"事务期间无关操作必须排队"。
 */
export function openBunSqlite(file: string): SqliteDatabase {
	mkdirSync(dirname(file), { recursive: true });
	const db = new Database(file);
	db.exec("PRAGMA journal_mode = WAL; PRAGMA synchronous = NORMAL;");

	let queue: Promise<unknown> = Promise.resolve();
	const enqueue = <T>(fn: () => T): Promise<T> => {
		const result = queue.then(fn);
		queue = result.catch(() => {});
		return result;
	};

	const run = (sql: string, params: SqliteValue[]) => db.run(sql, ...params);
	const get = (sql: string, params: SqliteValue[]) => db.query(sql).get(...params) ?? undefined;
	const all = (sql: string, params: SqliteValue[]) => db.query(sql).all(...params);

	return {
		exec: (sql) => enqueue(() => db.exec(sql)),
		run: (sql, ...params) => enqueue(() => void run(sql, params)),
		get: (sql, ...params) => enqueue(() => get(sql, params) as object | undefined),
		all: (sql, ...params) => enqueue(() => all(sql, params) as object[]),
		transaction<T>(callback: (tx: SqliteExecutor) => Promise<T>): Promise<T> {
			return enqueue(async () => {
				db.exec("BEGIN");
				// 事务句柄直接同步执行：队列已保证独占，回调内不再入队
				const tx: SqliteExecutor = {
					exec: async (sql) => db.exec(sql),
					run: async (sql, ...params) => void run(sql, params),
					get: async (sql, ...params) => get(sql, params) as object | undefined,
					all: async (sql, ...params) => all(sql, params) as object[],
				};
				try {
					const result = await callback(tx);
					db.exec("COMMIT");
					return result;
				} catch (error) {
					try {
						db.exec("ROLLBACK");
					} catch (rollbackError) {
						throw new AggregateError([error, rollbackError], "transaction failed and rollback failed");
					}
					throw error;
				}
			});
		},
		close: () => enqueue(() => db.close()),
	};
}

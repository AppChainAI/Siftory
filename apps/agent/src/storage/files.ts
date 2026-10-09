import { mkdir, readFile, rename, open, rm } from "node:fs/promises";
import { dirname } from "node:path";

/** Missing files have defaults; damaged or unreadable files must never be silently overwritten. */
export async function readJson(
	file: string,
	fallback: unknown,
): Promise<unknown> {
	try {
		return JSON.parse(await readFile(file, "utf8"));
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ENOENT") return fallback;
		throw new Error(`Cannot read configuration ${file}`, { cause: error });
	}
}

export async function writeJson(
	file: string,
	value: unknown,
	mode = 0o600,
): Promise<void> {
	await mkdir(dirname(file), { recursive: true });
	const temporary = `${file}.${crypto.randomUUID()}.tmp`;
	try {
		const handle = await open(temporary, "wx", mode);
		try {
			await handle.writeFile(JSON.stringify(value, null, 2));
			await handle.sync();
		} finally {
			await handle.close();
		}
		await rename(temporary, file);
	} finally {
		await rm(temporary, { force: true });
	}
}

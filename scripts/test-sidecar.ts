#!/usr/bin/env bun
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
process.chdir(fileURLToPath(new URL("..", import.meta.url)));
const triple = Bun.spawnSync(["rustc", "--print", "host-tuple"])
	.stdout.toString()
	.trim();
if (!triple) throw new Error("Cannot determine host target");
const binary = resolve(
	`apps/desktop/bin/siftory-agent-${triple}${process.platform === "win32" ? ".exe" : ""}`,
);
const native = process.argv.includes("--native");
const tests = Bun.spawn(
	native
		? [
				"cargo",
				"test",
				"--locked",
				"--manifest-path",
				"apps/desktop/src-tauri/Cargo.toml",
				"--features",
				"managed-sidecar",
			]
		: ["bun", "test", "test/process.test.ts"],
	{
		cwd: native ? "." : "apps/agent",
		env: {
			...process.env,
			SIFTORY_TEST_BINARY: binary,
			SIFTORY_TEST_AGENT: binary,
		},
		stdout: "inherit",
		stderr: "inherit",
	},
);
process.exit(await tests.exited);

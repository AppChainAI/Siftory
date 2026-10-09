#!/usr/bin/env bun
/** 编译 sidecar 到 apps/desktop/bin/，文件名带 target triple（Tauri externalBin 约定）。 */
import { mkdirSync } from "node:fs";

const targets = [
	["bun-darwin-arm64", "aarch64-apple-darwin"],
	["bun-darwin-x64", "x86_64-apple-darwin"],
	["bun-windows-x64", "x86_64-pc-windows-msvc"],
	["bun-linux-x64", "x86_64-unknown-linux-gnu"],
] as const;

const outDir = "apps/desktop/bin";
mkdirSync(outDir, { recursive: true });

const only = process.argv[2]; // 可选：只编一个 bun target，如 bun-darwin-arm64
for (const [bunTarget, triple] of targets) {
	if (only && bunTarget !== only) continue;
	const suffix = triple.includes("windows") ? ".exe" : "";
	const outfile = `${outDir}/siftory-agent-${triple}${suffix}`;
	console.log(`→ ${bunTarget} → ${outfile}`);
	const result = await Bun.build({
		entrypoints: ["apps/agent/src/main.ts"],
		compile: { target: bunTarget as never, outfile },
	});
	if (!result.success) {
		console.error(result.logs);
		process.exit(1);
	}
}
console.log("done");

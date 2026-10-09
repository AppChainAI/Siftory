#!/usr/bin/env bun
/** 编译 sidecar 到 apps/desktop/bin/，文件名带 target triple（Tauri externalBin 约定）。 */
import { fileURLToPath } from "node:url";
import { mkdirSync } from "node:fs";

process.chdir(fileURLToPath(new URL("..", import.meta.url)));

const targets = [
	["bun-darwin-arm64", "aarch64-apple-darwin"],
	["bun-darwin-x64", "x86_64-apple-darwin"],
	["bun-windows-x64", "x86_64-pc-windows-msvc"],
	["bun-linux-x64", "x86_64-unknown-linux-gnu"],
] as const;

const outDir = "apps/desktop/bin";
mkdirSync(outDir, { recursive: true });

const requested = process.argv[2];
const tauriTarget = process.env.TAURI_ENV_TARGET_TRIPLE;
const only =
	requested === "--current"
		? tauriTarget
			? (targets.find(([, triple]) => triple === tauriTarget)?.[0] ??
				tauriTarget)
			: `bun-${process.platform === "win32" ? "windows" : process.platform}-${process.arch}`
		: requested;
if (only && !targets.some(([target]) => target === only))
	throw new Error(`Unsupported target: ${only}`);
// An explicit target can cross-compile the sidecar; Tauri supplies its target during bundling.
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

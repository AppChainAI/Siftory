#!/usr/bin/env bun
/** 桌面端开发编排：sidecar（--dev）+ Vite + Tauri dev。Ctrl-C 一起退出。 */
const build = Bun.spawn(["bun", "scripts/build-sidecar.ts", "--current"], {
	stdout: "inherit",
	stderr: "inherit",
});
if ((await build.exited) !== 0) process.exit(1);
const processes = [
	Bun.spawn(["bun", "run", "--cwd", "apps/agent", "dev"], {
		stdout: "inherit",
		stderr: "inherit",
	}),
	Bun.spawn(["bun", "run", "--cwd", "apps/desktop/ui", "dev"], {
		stdout: "inherit",
		stderr: "inherit",
	}),
	Bun.spawn(["bunx", "tauri", "dev"], {
		cwd: "apps/desktop",
		stdout: "inherit",
		stderr: "inherit",
	}),
];

const killAll = () => {
	for (const p of processes) p.kill();
	process.exit(0);
};
process.on("SIGINT", killAll);
process.on("SIGTERM", killAll);

await Promise.race(processes.map((p) => p.exited));
killAll();

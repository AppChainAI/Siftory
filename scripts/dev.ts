#!/usr/bin/env bun
/** 开发编排：并行拉起 sidecar（--dev 假模型）+ Vite dev server。Ctrl-C 一起退出。 */
const processes = [
	Bun.spawn(["bun", "run", "--cwd", "apps/agent", "dev"], { stdout: "inherit", stderr: "inherit" }),
	Bun.spawn(["bun", "run", "--cwd", "apps/desktop/ui", "dev"], { stdout: "inherit", stderr: "inherit" }),
];

const killAll = () => {
	for (const p of processes) p.kill();
	process.exit(0);
};
process.on("SIGINT", killAll);
process.on("SIGTERM", killAll);

await Promise.race(processes.map((p) => p.exited));
killAll();

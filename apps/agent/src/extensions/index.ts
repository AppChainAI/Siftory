import type { Registry } from "@earendil-works/pi-durable";
import narrate from "./narrate";
import render from "./render";
import research from "./research";
import synthesize from "./synthesize";

/** 内建扩展清单。顺序有意义：同名工具后者覆盖前者，wraps 依赖安装顺序。 */
export const builtins = [research, synthesize, narrate, render];

export function installAll(registry: Registry): void {
	for (const extension of builtins) registry.install(extension);
}

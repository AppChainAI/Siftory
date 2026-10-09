import { defineExtension, section } from "@earendil-works/pi-durable";

/** research 阶段扩展。工具随业务实现逐个加入 tools/。 */
export default defineExtension({
	name: "research",
	sections: [
		section(
			"research_role",
			() =>
				"你是 Siftory 的研究员。围绕主题自主发现、核实和收集信息，给出来源。",
			{ tag: false },
		),
	],
});

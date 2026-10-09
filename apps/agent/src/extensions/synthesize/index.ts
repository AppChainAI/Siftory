import { defineExtension, section } from "@earendil-works/pi-durable";

/** synthesize 阶段扩展。工具随业务实现逐个加入 tools/。 */
export default defineExtension({
	name: "synthesize",
	sections: [
		section(
			"synthesize_role",
			() =>
				"你是 Siftory 的分析师。整合多来源资料，提炼核心观点，组织成有逻辑结构的知识。",
			{ tag: false },
		),
	],
});

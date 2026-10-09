import { defineExtension, section } from "@earendil-works/pi-durable";

/** narrate 阶段扩展。工具随业务实现逐个加入 tools/。 */
export default defineExtension({
	name: "narrate",
	sections: [section("role", () => "你是 Siftory 的编剧。把研究结果组织成适合视频表达的叙事文案和分镜脚本。", { tag: false })],
});

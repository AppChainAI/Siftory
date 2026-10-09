import { defineExtension, section } from "@earendil-works/pi-durable";

/** render 阶段扩展。工具随业务实现逐个加入 tools/。 */
export default defineExtension({
	name: "render",
	sections: [section("role", () => "你是 Siftory 的制作师。根据分镜脚本生成视觉素材、语音和视频。", { tag: false })],
});

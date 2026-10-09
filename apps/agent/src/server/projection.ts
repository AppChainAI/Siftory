import type { ConversationView } from "@earendil-works/pi-durable";
import type { ChatMessage, ChatSnapshot, ModelRef } from "@siftory/protocol";

type ContentBlock = { type: string; text?: string };
type Message = { role: string; content: string | ContentBlock[] };

function extractText(message: Message | undefined): string {
	if (!message) return "";
	if (typeof message.content === "string") return message.content;
	return message.content
		.filter((block) => block.type === "text" && typeof block.text === "string")
		.map((block) => block.text)
		.join("");
}

/** ConversationView（pi-durable 原始结构）→ UI 协议快照。UI 不感知 pi-durable 的 API 形状。 */
export function projectChatView(view: ConversationView): ChatSnapshot {
	const messages: ChatMessage[] = [];
	for (const entry of view.entries) {
		const role = entry.kind === "pi.user" ? "user" : entry.kind === "pi.assistant" ? "assistant" : undefined;
		if (!role) continue;
		const text = extractText(entry.model?.[0] as Message | undefined);
		if (text) messages.push({ id: entry.id, role, text });
	}

	const live = view.docs["pi.live"] as
		| { run?: unknown; generation?: { message?: Message; retry?: { error: string } } }
		| undefined;
	const agent = view.docs["pi.agent"] as { model?: ModelRef } | undefined;

	return {
		type: "chat",
		messages,
		busy: live?.run !== undefined,
		streamingText: extractText(live?.generation?.message) || undefined,
		lastError: live?.generation?.retry?.error,
		model: agent?.model,
	};
}

import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import type { ServerWebSocket } from "bun";
import type { AgentHost } from "../harness";
import { projectChatView } from "./projection";

const context = BACKGROUND_CONTEXT;

/** 每个 WS 连接订阅一次 root 会话视图，每个 commit 推一帧投影后的快照。 */
export function createWsHandler(host: AgentHost) {
	return {
		async open(ws: ServerWebSocket<unknown>) {
			const view = await host.root.viewState(context);
			const send = () => {
				if (view.value) ws.send(JSON.stringify(projectChatView(view.value)));
			};
			const unsubscribe = view.subscribe(send);
			ws.data = { dispose: () => (unsubscribe(), view.dispose()) };
			send(); // 首帧
		},
		close(ws: ServerWebSocket<unknown>) {
			(ws.data as { dispose?: () => void })?.dispose?.();
		},
		message() {}, // 客户端→服务端走 HTTP，WS 只推
	};
}

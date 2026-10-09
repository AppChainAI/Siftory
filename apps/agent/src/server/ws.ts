import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import type { ServerWebSocket } from "bun";
import type { AgentHost } from "../harness";
import type { ConversationView } from "@earendil-works/pi-durable";
import { projectChatView } from "./projection";

const context = BACKGROUND_CONTEXT;
type Connection = {
	closed: boolean;
	stop?: () => Promise<unknown>;
	pending?: string;
};

/** Serialized committed watches coalesce slow consumers to the latest full snapshot. */
export function createWsHandler(host: AgentHost) {
	const send = (ws: ServerWebSocket<Connection>, frame: string) => {
		if (ws.data.closed) return;
		if (ws.getBufferedAmount() > 0) {
			ws.data.pending = frame;
			return;
		}
		ws.send(frame);
	};
	return {
		async open(ws: ServerWebSocket<Connection>) {
			try {
				const watch = await host.root.watch(context);
				ws.data.stop = () => watch.stop();
				if (ws.data.closed) {
					await watch.stop();
					return;
				}
				const publish = async (value: ConversationView) => {
					const latest = await host.latestSubmission();
					const user = value.entries.findLast((e) => e.kind === "pi.user");
					const error =
						latest?.status === "unanswered" &&
						latest.reason !== "aborted" &&
						latest.entry === user?.id
							? latest.reason
							: undefined;
					send(ws, JSON.stringify(projectChatView(value, error)));
				};
				await publish(watch.value);
				if (!ws.data.closed) watch.start(publish);
			} catch {
				ws.close(1011, "Cannot watch conversation");
			}
		},
		drain(ws: ServerWebSocket<Connection>) {
			if (ws.data.pending) {
				const frame = ws.data.pending;
				ws.data.pending = undefined;
				send(ws, frame);
			}
		},
		close(ws: ServerWebSocket<Connection>) {
			ws.data.closed = true;
			void ws.data.stop?.().catch(() => {});
		},
		message() {},
	};
}

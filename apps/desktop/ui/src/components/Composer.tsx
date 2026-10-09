import { useState } from "react";

/** 输入框：Enter 发送，Shift+Enter 换行；busy 时变为可停止 */
export function Composer(props: { busy: boolean; onSend: (text: string) => void; onStop: () => void }) {
	const [text, setText] = useState("");

	const send = () => {
		const value = text.trim();
		if (!value) return;
		props.onSend(value);
		setText("");
	};

	return (
		<div className="composer">
			<textarea
				value={text}
				placeholder="给 Siftory 一个主题或任务…"
				rows={3}
				onChange={(e) => setText(e.target.value)}
				onKeyDown={(e) => {
					if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
						e.preventDefault();
						send();
					}
				}}
			/>
			{props.busy ? (
				<button className="stop" onClick={props.onStop}>
					停止
				</button>
			) : (
				<button onClick={send} disabled={!text.trim()}>
					发送
				</button>
			)}
		</div>
	);
}

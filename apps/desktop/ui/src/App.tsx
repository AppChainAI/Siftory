import { useEffect, useRef, useState } from "react";
import type { ChatSnapshot } from "@siftory/protocol";
import { abortChat, sendChat, subscribeChat } from "./api/client";
import { Composer } from "./components/Composer";
import { SettingsPanel } from "./components/SettingsPanel";

export function App() {
	const [snapshot, setSnapshot] = useState<ChatSnapshot>();
	const [showSettings, setShowSettings] = useState(false);
	const bottomRef = useRef<HTMLDivElement>(null);

	useEffect(() => subscribeChat(setSnapshot), []);
	useEffect(() => {
		// 花括号必需：表达式体会把 scrollIntoView 的返回值当 cleanup，React 报 "destroy is not a function"
		bottomRef.current?.scrollIntoView({ behavior: "smooth" });
	}, [snapshot]);

	const busy = snapshot?.busy ?? false;

	return (
		<div className="app">
			<header>
				<h1>Siftory</h1>
				<span className="model">
					{snapshot?.model ? `${snapshot.model.provider}/${snapshot.model.modelId}` : "未配置模型"}
				</span>
				<button className="link" onClick={() => setShowSettings(!showSettings)}>
					{showSettings ? "返回对话" : "设置"}
				</button>
			</header>

			{showSettings ? (
				<SettingsPanel onSaved={() => {}} />
			) : (
				<>
					<main>
						{snapshot?.messages.map((m) => (
							<div key={m.id} className={`message ${m.role}`}>
								<div className="bubble">{m.text}</div>
							</div>
						))}
						{busy && (
							<div className="message assistant">
								<div className="bubble pending">{snapshot?.streamingText || "思考中…"}</div>
							</div>
						)}
						{snapshot?.lastError && <div className="error">出错：{snapshot.lastError}</div>}
						<div ref={bottomRef} />
					</main>
					<Composer busy={busy} onSend={sendChat} onStop={abortChat} />
				</>
			)}
		</div>
	);
}

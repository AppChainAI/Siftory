import { useEffect, useState } from "react";
import type { ConfigView, ThinkingLevel } from "@siftory/protocol";
import { getConfig, putConfig } from "../api/client";
import { CustomProvidersSection } from "./CustomProvidersSection";

const THINKING_LEVELS: { value: ThinkingLevel; label: string }[] = [
	{ value: "off", label: "关闭思考" },
	{ value: "minimal", label: "minimal" },
	{ value: "low", label: "low" },
	{ value: "medium", label: "medium" },
	{ value: "high", label: "high" },
	{ value: "xhigh", label: "xhigh" },
	{ value: "max", label: "max" },
];

/** 提供商 + 会话级 LLM 配置面板。model/thinkingLevel/instructions 存会话的 pi.agent（SQLite），key 存 auth.json */
export function SettingsPanel(props: { onSaved: () => void }) {
	const [config, setConfig] = useState<ConfigView>();
	const [provider, setProvider] = useState("openai");
	const [apiKey, setApiKey] = useState("");
	const [modelId, setModelId] = useState("");
	const [thinkingLevel, setThinkingLevel] = useState<ThinkingLevel>("off");
	const [instructions, setInstructions] = useState("");
	const [error, setError] = useState<string>();
	const [saving, setSaving] = useState(false);

	const reload = async () => {
		const next = await getConfig();
		setConfig(next);
		setThinkingLevel(next.agent.thinkingLevel);
		setInstructions(next.agent.instructions ?? "");
		if (next.agent.model) {
			setProvider(next.agent.model.provider);
			setModelId(next.agent.model.modelId);
		}
	};
	useEffect(() => {
		void reload().catch((error) => setError(String(error)));
	}, []);

	const models = config?.models[provider] ?? [];
	const current = config?.providers.find((p) => p.id === provider);

	const save = async () => {
		setSaving(true);
		setError(undefined);
		try {
			await putConfig({
				...(apiKey ? { provider: { id: provider, apiKey } } : {}),
				agent: {
					...(modelId ? { model: { provider, modelId } } : {}),
					thinkingLevel,
					instructions,
				},
			});
			setApiKey("");
			await reload();
			props.onSaved();
		} catch (error) {
			setError(error instanceof Error ? error.message : "保存失败，请重试");
		} finally {
			setSaving(false);
		}
	};

	if (!config)
		return (
			<div className="settings">
				{error ?? "加载中…"}
				<button
					onClick={() =>
						void reload().catch((error) => setError(String(error)))
					}
				>
					重新加载
				</button>
			</div>
		);

	return (
		<div className="settings">
			{error && (
				<div className="error" role="alert">
					{error}
				</div>
			)}
			<h2>模型提供商</h2>
			<label>
				提供商
				<select
					value={provider}
					onChange={(e) => (
						setProvider(e.target.value),
						setModelId(""),
						setApiKey("")
					)}
				>
					{config.providers.map((p) => (
						<option key={p.id} value={p.id}>
							{p.id}
							{p.configured ? " ✓" : ""}
						</option>
					))}
				</select>
			</label>
			<label>
				API Key{current?.configured ? "（已配置，输入即替换）" : ""}
				<input
					type="password"
					value={apiKey}
					placeholder={current?.configured ? "••••••" : "sk-…"}
					onChange={(e) => setApiKey(e.target.value)}
				/>
			</label>

			<h2>会话配置</h2>
			<label>
				模型
				<select value={modelId} onChange={(e) => setModelId(e.target.value)}>
					<option value="">选择模型…</option>
					{models.map((id) => (
						<option key={id} value={id}>
							{id}
						</option>
					))}
				</select>
			</label>
			<label>
				思考级别
				<select
					value={thinkingLevel}
					onChange={(e) => setThinkingLevel(e.target.value as ThinkingLevel)}
				>
					{THINKING_LEVELS.map((t) => (
						<option key={t.value} value={t.value}>
							{t.label}
						</option>
					))}
				</select>
			</label>
			<label>
				附加指令（追加到系统提示词末尾）
				<textarea
					rows={4}
					value={instructions}
					placeholder="例：总是用中文回答；回答保持简短"
					onChange={(e) => setInstructions(e.target.value)}
				/>
			</label>
			<button onClick={save} disabled={saving}>
				{saving ? "保存中…" : "保存"}
			</button>

			<CustomProvidersSection
				providers={config.customProviders}
				onChanged={reload}
			/>
		</div>
	);
}

import { useState } from "react";
import type { CustomProvider } from "@siftory/protocol";
import { deleteCustomProvider, upsertCustomProvider } from "../api/client";

/** 自定义 OpenAI 兼容供应商：baseUrl + 模型列表 + key，upsert 到 providers.json / auth.json */
export function CustomProvidersSection(props: { providers: CustomProvider[]; onChanged: () => Promise<void> }) {
	const [name, setName] = useState("");
	const [baseUrl, setBaseUrl] = useState("");
	const [models, setModels] = useState("");
	const [apiKey, setApiKey] = useState("");
	const [saving, setSaving] = useState(false);

	const add = async () => {
		const id = `custom-${name.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")}`;
		const modelList = models.split(/[,，\s]+/).map((s) => s.trim()).filter(Boolean);
		if (!id.replace("custom-", "") || !baseUrl.trim() || modelList.length === 0) return;
		setSaving(true);
		try {
			await upsertCustomProvider({ id, name: name.trim(), baseUrl: baseUrl.trim(), models: modelList, apiKey: apiKey || undefined });
			setName(""); setBaseUrl(""); setModels(""); setApiKey("");
			await props.onChanged();
		} finally {
			setSaving(false);
		}
	};

	const remove = async (id: string) => {
		await deleteCustomProvider(id);
		await props.onChanged();
	};

	return (
		<>
			<h2>自定义供应商（OpenAI 兼容）</h2>
			{props.providers.map((p) => (
				<div key={p.id} className="custom-provider">
					<div className="info">
						<strong>{p.name}</strong>
						<span>{p.baseUrl}</span>
						<span className="hint">{p.models.join("、")}</span>
					</div>
					<button className="link danger" onClick={() => remove(p.id)}>删除</button>
				</div>
			))}
			<label>
				名称
				<input value={name} placeholder="例：我的中转站" onChange={(e) => setName(e.target.value)} />
			</label>
			<label>
				Base URL
				<input value={baseUrl} placeholder="https://api.example.com/v1" onChange={(e) => setBaseUrl(e.target.value)} />
			</label>
			<label>
				模型列表（逗号或空格分隔）
				<input value={models} placeholder="gpt-4o-mini, deepseek-chat" onChange={(e) => setModels(e.target.value)} />
			</label>
			<label>
				API Key
				<input type="password" value={apiKey} placeholder="sk-…" onChange={(e) => setApiKey(e.target.value)} />
			</label>
			<button onClick={add} disabled={saving || !name.trim() || !baseUrl.trim() || !models.trim()}>
				{saving ? "添加中…" : "添加供应商"}
			</button>
		</>
	);
}

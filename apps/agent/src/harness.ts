import { join } from "node:path";
import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import { createModels, type MutableModels } from "@earendil-works/pi-ai/models";
import { anthropicProvider } from "@earendil-works/pi-ai/providers/anthropic";
import { deepseekProvider } from "@earendil-works/pi-ai/providers/deepseek";
import { fauxAssistantMessage, fauxProvider, type FauxResponseFactory } from "@earendil-works/pi-ai/providers/faux";
import { googleProvider } from "@earendil-works/pi-ai/providers/google";
import { openaiProvider } from "@earendil-works/pi-ai/providers/openai";
import { openrouterProvider } from "@earendil-works/pi-ai/providers/openrouter";
import { createRegistry, Harness, type AgentChange, type Conversation } from "@earendil-works/pi-durable";
import { SqliteStorage } from "@earendil-works/pi-durable/storage/sqlite";
import type { AgentConfigView, CustomProvider } from "@siftory/protocol";
import { authFile, FileCredentialStore } from "./config";
import {
	loadCustomProviders,
	registerCustomProvider,
	saveCustomProviders,
	unregisterCustomProvider,
} from "./custom-providers";
import { installAll } from "./extensions";
import { openBunSqlite } from "./storage/sqlite";

export interface AgentHost {
	harness: Harness;
	root: Conversation;
	models: MutableModels;
	credentials: FileCredentialStore;
	/** 已注册的提供商 id（含 dev 的 faux），供配置界面枚举 */
	providerIds: string[];
	/** 提供商的模型目录（静态目录直读，不需要密钥；动态目录为上次刷新结果） */
	catalogModels(providerId: string): string[];
	/** 自定义供应商 CRUD：写 providers.json + live 注册/注销，无需重启 */
	listCustomProviders(): CustomProvider[];
	upsertCustomProvider(custom: CustomProvider, apiKey?: string): Promise<void>;
	deleteCustomProvider(id: string): Promise<void>;
	/** 会话级 LLM 配置：改的是 root 的 pi.agent 文档（SQLite 持久） */
	getAgent(): Promise<AgentConfigView>;
	configureAgent(change: AgentChange): Promise<void>;
	close(): Promise<void>;
}

const context = BACKGROUND_CONTEXT;

export async function createAgentHost(dataDir: string, options: { dev?: boolean } = {}): Promise<AgentHost> {
	const credentials = new FileCredentialStore(authFile(dataDir));

	const models = createModels({ credentials });
	// 提供商目录：env 变量也可作为密钥来源（pi-ai 的 resolve 合并 stored credential 与环境变量）。
	// catalogs 保留 Provider 引用：模型目录与 auth 解耦，下拉列表不需要先存密钥。
	const catalogs = new Map<string, () => readonly { id: string }[]>();
	const register = (id: string, provider: { getModels(): readonly { id: string }[] }) => {
		models.setProvider(provider as never);
		catalogs.set(id, () => provider.getModels());
	};
	register("openai", openaiProvider());
	register("anthropic", anthropicProvider());
	register("google", googleProvider());
	register("deepseek", deepseekProvider());
	register("openrouter", openrouterProvider());
	const providerIds = ["openai", "anthropic", "google", "deepseek", "openrouter"];
	if (options.dev) {
		// 开发用假模型：无密钥也能跑通全链路（faux/faux-1）
		const faux = fauxProvider({ tokensPerSecond: 40 });
		register("faux", faux.provider);
		// 自我补充的回声响应：每次被消费后重新入队，队列永不空
		const respond: FauxResponseFactory = (ctx) => {
			faux.appendResponses([respond]);
			const last = ctx.messages.findLast((m) => m.role === "user");
			const text = typeof last?.content === "string" ? last.content : "";
			// 加长尾巴让 dev 下能看到流式效果（faux 40 tokens/s）
			return fauxAssistantMessage(
				`[faux] 收到：${text || "（空）"}\n\n这是一段用于演示流式输出的占位回答。`.repeat(3),
			);
		};
		faux.setResponses([respond]);
		providerIds.push("faux");
	}

	const registry = createRegistry();
	installAll(registry);

	// 自定义 OpenAI 兼容供应商（providers.json）
	const customProviders = await loadCustomProviders(dataDir);
	for (const custom of customProviders) {
		const provider = registerCustomProvider(models, custom);
		catalogs.set(custom.id, () => provider.getModels());
		providerIds.push(custom.id);
	}

	const storage = await SqliteStorage.open(openBunSqlite(join(dataDir, "siftory.sqlite")));
	const harness = await Harness.open(storage, { models, registry }, context);
	const root = await harness.root(context);
	harness.resume(); // 续跑上次进程未完成的工作

	// 模型选择存在 root 的 pi.agent 里，重启自动保留；只有从未配置过时 dev 才兜底 faux
	const resolved = await root.agent(context);
	if (!resolved.model && options.dev) {
		await root.configure({ model: { provider: "faux", modelId: "faux-1" } }, context);
	}

	return {
		harness,
		root,
		models,
		credentials,
		providerIds,
		catalogModels: (id) => catalogs.get(id)?.().map((m) => m.id) ?? [],
		listCustomProviders: () => customProviders,
		upsertCustomProvider: async (custom, apiKey) => {
			const index = customProviders.findIndex((p) => p.id === custom.id);
			if (index >= 0) customProviders[index] = custom;
			else customProviders.push(custom);
			await saveCustomProviders(dataDir, customProviders);
			if (apiKey) await credentials.modify(custom.id, async () => ({ type: "api_key", key: apiKey }));
			if (!providerIds.includes(custom.id)) providerIds.push(custom.id);
			catalogs.set(custom.id, () => registerCustomProvider(models, custom).getModels()); // setProvider 同名即替换
		},
		deleteCustomProvider: async (id) => {
			const index = customProviders.findIndex((p) => p.id === id);
			if (index >= 0) customProviders.splice(index, 1);
			await saveCustomProviders(dataDir, customProviders);
			await credentials.delete(id);
			const i = providerIds.indexOf(id);
			if (i >= 0) providerIds.splice(i, 1);
			catalogs.delete(id);
			unregisterCustomProvider(models, id);
		},
		getAgent: async () => {
			const agent = await root.agent(context);
			return {
				model: agent.model,
				thinkingLevel: agent.thinkingLevel,
				instructions: agent.instructions,
			};
		},
		configureAgent: (change) => root.configure(change, context),
		close: () => harness.close(context),
	};
}

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { openAICompletionsApi } from "@earendil-works/pi-ai/api/openai-completions.lazy";
import { createProvider, type MutableModels, type Provider } from "@earendil-works/pi-ai/models";
import type { CustomProvider } from "@siftory/protocol";

/**
 * 自定义 OpenAI 兼容供应商：定义存 providers.json，apiKey 存 auth.json。
 * 与内置 deepseek 同款构造：createProvider + openAICompletionsApi。
 */

export const providersFile = (dataDir: string) => join(dataDir, "providers.json");

export async function loadCustomProviders(dataDir: string): Promise<CustomProvider[]> {
	try {
		return JSON.parse(await readFile(providersFile(dataDir), "utf8"));
	} catch {
		return [];
	}
}

export async function saveCustomProviders(dataDir: string, providers: CustomProvider[]): Promise<void> {
	await mkdir(dirname(providersFile(dataDir)), { recursive: true });
	await writeFile(providersFile(dataDir), JSON.stringify(providers, null, 2));
}

/** 注册一个自定义供应商到 models（live，无需重启）；返回 Provider 供目录查询。 */
export function registerCustomProvider(models: MutableModels, custom: CustomProvider): Provider {
	const provider = createProvider({
			id: custom.id,
			name: custom.name,
			baseUrl: custom.baseUrl,
			// 密钥只认 auth.json 里存的 credential（自定义 id 无约定俗成的 env 变量）。
			// auth/helpers 不是 pi-ai 的公共导出，ApiKeyAuth 形状自己写。
			auth: {
				apiKey: {
					name: `${custom.name} API key`,
					resolve: async ({ credential }) =>
						credential?.key ? { auth: { apiKey: credential.key }, source: "auth.json" } : undefined,
				},
			},
			models: custom.models.map((id) => ({
				id,
				name: id,
				api: "openai-completions" as const,
				provider: custom.id,
				baseUrl: custom.baseUrl,
				input: ["text" as const],
				reasoning: false,
				contextWindow: 128000,
				maxTokens: 8192,
				cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
				// compat 不设：pi-ai 会从 baseUrl 自动探测 OpenAI 兼容差异
			})),
		api: openAICompletionsApi(),
	});
	models.setProvider(provider);
	return provider;
}

export function unregisterCustomProvider(models: MutableModels, id: string): void {
	models.deleteProvider(id);
}

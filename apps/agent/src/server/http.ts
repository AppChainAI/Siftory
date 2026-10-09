import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import type { ChatSubmit, ChatSubmitResult, ConfigUpdate, ConfigView, CustomProviderUpsert } from "@siftory/protocol";
import type { AgentHost } from "../harness";

const context = BACKGROUND_CONTEXT;

const json = (data: unknown, status = 200) =>
	new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json" } });

const bad = (message: string, status = 400) => json({ error: message }, status);

/** HTTP 路由。WS 在 ws.ts。 */
export async function handleHttp(host: AgentHost, req: Request): Promise<Response> {
	const url = new URL(req.url);
	const path = url.pathname;

	if (req.method === "GET" && path === "/api/health") return json({ ok: true });

	if (req.method === "GET" && path === "/api/config") {
		const statuses = await Promise.all(
			host.providerIds.map(async (id) => {
				const auth = await host.models.getAuth(id).catch(() => undefined);
				return {
					status: { id, name: id, configured: auth !== undefined },
					// 目录直读，与 auth 解耦：没存密钥也能列出模型（静态目录内置；动态目录为上次刷新）
					models: host.catalogModels(id),
				};
			}),
		);
		const view: ConfigView = {
			providers: statuses.map((s) => s.status),
			models: Object.fromEntries(statuses.map((s) => [s.status.id, s.models])),
			agent: await host.getAgent(),
			customProviders: host.listCustomProviders(),
		};
		return json(view);
	}

	if (req.method === "PUT" && path === "/api/config") {
		const body = (await req.json().catch(() => undefined)) as ConfigUpdate | undefined;
		if (!body) return bad("invalid json");
		if (body.provider) {
			const { id, apiKey } = body.provider;
			if (!id || !apiKey) return bad("provider.id and provider.apiKey required");
			await host.credentials.modify(id, async () => ({ type: "api_key", key: apiKey }));
		}
		if (body.agent) {
			const { model, thinkingLevel, instructions } = body.agent;
			const change: Record<string, unknown> = {};
			if (model) change.model = model;
			if (thinkingLevel) change.thinkingLevel = thinkingLevel;
			if (instructions !== undefined) change.instructions = instructions || null; // 空串 = 清除
			await host.configureAgent(change);
		}
		return json({ ok: true });
	}

	if (req.method === "POST" && path === "/api/chat") {
		const body = (await req.json().catch(() => undefined)) as ChatSubmit | undefined;
		if (!body?.content?.trim()) return bad("content required");
		const submission = await host.root.submit(
			{ type: "input", content: body.content, requestId: body.requestId },
			context,
		);
		return json({ submissionId: submission.id } satisfies ChatSubmitResult);
	}

	if (req.method === "POST" && path === "/api/abort") {
		await host.root.abort(context);
		return json({ ok: true });
	}

	// 自定义 OpenAI 兼容供应商：upsert（apiKey 给了才更新）
	if (req.method === "PUT" && path === "/api/custom-providers") {
		const body = (await req.json().catch(() => undefined)) as CustomProviderUpsert | undefined;
		if (!body?.id || !body.baseUrl || !body.models?.length) return bad("id, baseUrl, models required");
		await host.upsertCustomProvider(
			{ id: body.id, name: body.name || body.id, baseUrl: body.baseUrl, models: body.models },
			body.apiKey || undefined,
		);
		return json({ ok: true });
	}

	if (req.method === "DELETE" && path.startsWith("/api/custom-providers/")) {
		const id = decodeURIComponent(path.slice("/api/custom-providers/".length));
		if (!id) return bad("id required");
		await host.deleteCustomProvider(id);
		return json({ ok: true });
	}

	return bad("not found", 404);
}

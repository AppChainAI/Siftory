const releaseOrigins = new Set([
	"tauri://localhost",
	"http://tauri.localhost",
	"https://tauri.localhost",
]);
export function allowedOrigin(req: Request, dev: boolean): boolean {
	const origin = req.headers.get("origin");
	return (
		!origin ||
		releaseOrigins.has(origin) ||
		(dev && ["http://localhost:5173", "http://127.0.0.1:5173"].includes(origin))
	);
}
export function authorized(req: Request, token: string | undefined): boolean {
	if (!token) return true;
	if (req.headers.get("authorization") === `Bearer ${token}`) return true;
	const url = new URL(req.url);
	return (
		url.pathname === "/ws" &&
		req.headers.get("upgrade")?.toLowerCase() === "websocket" &&
		url.searchParams.get("token") === token
	);
}
export function cors(req: Request, response: Response): Response {
	const headers = new Headers(response.headers);
	const origin = req.headers.get("origin");
	if (origin) {
		headers.set("access-control-allow-origin", origin);
		headers.set("vary", "Origin");
		headers.set(
			"access-control-allow-methods",
			"GET, POST, PUT, DELETE, OPTIONS",
		);
		headers.set("access-control-allow-headers", "authorization, content-type");
	}
	return new Response(response.body, { status: response.status, headers });
}

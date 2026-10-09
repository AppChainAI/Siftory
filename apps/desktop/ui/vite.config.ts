import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
	plugins: [react()],
	server: {
		// 只代理 HTTP；WS 由浏览器直连 sidecar（见 client.ts）
		proxy: {
			"/api": "http://127.0.0.1:47911",
		},
	},
});

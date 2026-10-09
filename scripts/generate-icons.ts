import sharp from "sharp";
import { copyFile, mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

// Keep the approved artwork intact; masks/padding belong to platform exports.
const root = resolve(import.meta.dir, "..");
const desktop = join(root, "apps/desktop/src-tauri");
const source = join(desktop, "icon-src.png");
const icons = join(desktop, "icons");
const web = join(root, "apps/desktop/ui/public");
const temporary = await mkdtemp(join(tmpdir(), "siftory-icons-"));
const windowsSizes = [32, 16, 20, 24, 30, 36, 40, 48, 60, 64, 72, 80, 96, 128, 256];

async function tauriIcons(input: string, output: string) {
	const process = Bun.spawn(["bun", "x", "tauri", "icon", input, "--output", output], {
		cwd: root,
		stdout: "inherit",
		stderr: "inherit",
	});
	if ((await process.exited) !== 0) throw new Error("Tauri icon generation failed");
}

async function plate(side: number, inset: number, radius: number) {
	const artwork = await sharp(source).resize(side, side).ensureAlpha().toBuffer();
	const mask = Buffer.from(`<svg width="${side}" height="${side}" xmlns="http://www.w3.org/2000/svg"><rect width="${side}" height="${side}" rx="${radius}" fill="white"/></svg>`);
	const rounded = await sharp(artwork)
		.composite([{ input: mask, blend: "dest-in" }])
		.png().toBuffer();
	return sharp({ create: { width: 1024, height: 1024, channels: 4, background: "#00000000" } })
		.composite([{ input: rounded, left: inset, top: inset }])
		.png().toBuffer();
}

// Windows Vista+ accepts PNG-compressed ICO entries. Put 32px first for Tauri's
// development window icon, then include Windows 11's fractional-DPI sizes.
async function ico(master: Buffer) {
	const images = await Promise.all(windowsSizes.map(size => sharp(master).resize(size, size).png().toBuffer()));
	const header = Buffer.alloc(6 + 16 * images.length);
	header.writeUInt16LE(1, 2);
	header.writeUInt16LE(images.length, 4);
	let offset = header.length;
	images.forEach((image, index) => {
		const entry = 6 + 16 * index;
		const size = windowsSizes[index]!;
		header[entry] = size === 256 ? 0 : size;
		header[entry + 1] = size === 256 ? 0 : size;
		header.writeUInt16LE(1, entry + 4);
		header.writeUInt16LE(32, entry + 6);
		header.writeUInt32LE(image.length, entry + 8);
		header.writeUInt32LE(offset, entry + 12);
		offset += image.length;
	});
	return Buffer.concat([header, ...images]);
}

async function desktopPngs(master: Buffer, directory: string) {
	await mkdir(directory, { recursive: true });
	for (const [name, size] of [["32x32.png", 32], ["64x64.png", 64], ["128x128.png", 128], ["128x128@2x.png", 256], ["icon.png", 512]] as const) {
		await sharp(master).resize(size, size).png().toFile(join(directory, name));
	}
}

try {
	await mkdir(web, { recursive: true });
	// Refresh every existing Tauri export, including the legacy store/mobile set.
	await tauriIcons(source, icons);
	const mac = await plate(832, 96, 185);
	const windows = await plate(896, 64, 196);
	await Bun.write(join(icons, "macos-source.png"), mac);
	await Bun.write(join(icons, "windows-source.png"), windows);
	await tauriIcons(join(icons, "macos-source.png"), join(temporary, "macos"));
	await copyFile(join(temporary, "macos/icon.icns"), join(icons, "icon.icns"));
	await desktopPngs(mac, join(icons, "macos"));
	await desktopPngs(windows, icons);
	await Bun.write(join(icons, "icon.ico"), await ico(windows));
	await sharp(source).resize(256, 256).png().toFile(join(web, "logo.png"));
	await sharp(source).resize(180, 180).png().toFile(join(web, "apple-touch-icon.png"));
	await sharp(windows).resize(32, 32).png().toFile(join(web, "favicon-32.png"));
	await copyFile(join(icons, "icon.ico"), join(web, "favicon.ico"));
	console.log("Siftory icons generated from the approved icon-src.png");
} finally {
	await rm(temporary, { recursive: true, force: true });
}

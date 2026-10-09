# Siftory artwork and desktop icons

The approved B2 pelican artwork is stored unchanged at
`apps/desktop/src-tauri/icon-src.png` (1254 × 1254). This is the source of truth;
the creative exploration files in `output/` are not required to build the app.

Run `bun run icons` after replacing that source. It uses Sharp for deterministic
resizing and platform masks, and the installed Tauri CLI for the native ICNS and
standard Tauri asset set. Generated files are kept in the project, so normal builds do not
need to regenerate them.

## Desktop exports

- **macOS:** `icons/icon.icns` contains the Tauri-generated standard and Retina
  representations through 1024px. The compatible raster artwork uses an 832px
  rounded plate centered on a 1024px transparent canvas, with 96px surrounding
  space. This keeps the legacy ICNS presentation proportionate in the Dock.
  `tauri.macos.conf.json` selects matching macOS PNGs for the development/runtime
  icon as well as the ICNS bundle icon. These are raster compatibility assets,
  not Icon Composer layers or custom Liquid Glass/dark/tinted variants.
- **Windows 11:** `icons/icon.ico` contains 16, 20, 24, 30, 32, 36, 40, 48, 60,
  64, 72, 80, 96, 128, and 256px RGBA images. The first entry is 32px for Tauri.
  A rounded teal plate has transparent outer corners and 64px surrounding space
  on its 1024px master. The extra sizes cover fractional DPI scaling in the title
  bar, taskbar, Start, and Explorer. The default desktop PNGs use this same plate.
  The project currently ships Win32 MSI/NSIS bundles; MSIX AppList theme variants
  are not configured. Tauri's legacy Square/Store assets are refreshed from the
  source but do not by themselves provide Microsoft Store packaging support.
- **Web/UI:** `public/logo.png` is the 256px square artwork, rounded by CSS in the
  app header. The browser uses a multi-resolution ICO and 32px PNG; a full-bleed
  180px Apple touch icon is supplied separately.

The platform exports apply only resizing, clipping, and transparent margins.
They do not redraw or recolor the approved character. The macOS margin and plate
radius are design choices for the legacy raster path, not a claim of exact
Icon Composer template geometry.

## Reference documentation

- [Tauri app icon formats and required layers](https://v2.tauri.app/develop/icons/)
- [Tauri platform configuration overrides](https://v2.tauri.app/reference/config/)
- [Apple app icon guidance](https://developer.apple.com/design/human-interface-guidelines/app-icons/)
- [Microsoft Windows 11 icon sizes and scaling](https://learn.microsoft.com/en-us/windows/apps/design/iconography/app-icon-construction)

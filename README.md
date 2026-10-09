# HABrowser

HABrowser is a fork of [HADecompiled](https://github.com/Segually/HADecompiled) to make Hybrid Animals run in the browser.

## Browser features

- WebGL compatibility fixes for loading assets and starting the game.
- Browser performance improvements: fewer loaded terrain chunks, idle item-icon cache cleanup, and lighter graphics settings.
- A working mutant market and local automatic success for in-game purchases, without real payments.
- A Node server that serves the game and bridges browser WebSockets to the original TCP protocol through `/api/relay`.
- Friend connections, public and private server joins, and private-world hosting through the relay. The relay permits game connections only to exact endpoints announced by the trusted friend server; public joins must also match its server list.
- A minimal landing page with local ZIP import/export for all saved data or only `General/general_`, which includes login and purchases.
- Optional server activity logging, disabled by default.

See [WorkingServer/README.md](WorkingServer/README.md) for server configuration and save-transfer details.

The original HADecompiled (short for Hybrid Animals Decompiled) project is a decompilation of the Hybrid Animals mobile game, starting specifically at version v200613.

Game versions above v185 were compiled with IL2CPP, which leaves the C# scripts as empty dummy stubs. To get them working again, the project required reverse engineering `libil2cpp.so`. Most of the conversion of the decompiled C code back into proper C# was done by Claude using [Claude Code](https://claude.com/product/claude-code), which I wholeheartedly endorse.

## Getting Started

### Prerequisites

- Unity 2021.3.45f1

> **Note:** This Unity version has a [known security vulnerability](https://unity.com/security/sept-2025-01), but it is the engine version the game uses.

### Building

1. Add the project to your Unity Editor.
2. Select WebGL in Build Settings and use the `BrowserOptimized` WebGL template.
3. Build the game into `Builds/HA_WASM`. For release builds, disable Development Build and use Brotli compression with decompression fallback disabled; WorkingServer serves the required compression headers.
4. In `WorkingServer`, run `npm ci`, `npm run sync-game`, then `npm start`.
5. Open http://localhost:8001/.

Generated Unity build files are not stored in Git. The tracked `WorkingServer/public/style.css` is preserved when copying a build.

## Getting upstream updates

This is a fork of my own repository. Fetch and integrate updates from HADecompiled manually from the command line.

Use two remotes: `origin` for HABrowser (fetch and push), and `upstream` for HADecompiled (fetch only). For a fresh clone:

```sh
git clone https://github.com/Segually/HABrowser.git
cd HABrowser
git remote add upstream https://github.com/Segually/HADecompiled.git
git remote set-url --push upstream DISABLED
git config remote.pushDefault origin
git fetch --all
```

The published history was cleaned, so its commit IDs differ from HADecompiled's history. To preserve the cleaned history, select new upstream changes and cherry-pick them:

```sh
git fetch upstream
git log --reverse --oneline 509d3189a650c6217e57b3b7a9926da8903d1409..upstream/main
git cherry-pick <upstream-commit-id>
git push origin main
```

`509d3189a650c6217e57b3b7a9926da8903d1409` is the upstream revision this browser fork started from. On later updates, inspect only commits after the last upstream revision you integrated. Resolve conflicts with the browser changes and review incoming files for private settings before committing. To fetch updates to HABrowser itself, use `git fetch origin` (or `git pull --ff-only` on an unmodified checkout).

### Asset bundles for mods

Asset GUIDs were fixed to make this project run properly in Unity. Loading this project to build asset bundles for a mod will likely produce bundles that do not work with the original game, especially for UI assets, because the GUIDs may no longer match the original references.

The project is still a great source for shaders and code.

## License

This project has no license. The code is shared solely for interoperability purposes with the [HAModLoader](https://github.com/eris-webserv/HAModHelper) project.

All game assets and code belong to © [Abstract Software Inc.](https://www.abstractsoftwares.com/)

This project is not affiliated with or endorsed by Abstract Software Inc.

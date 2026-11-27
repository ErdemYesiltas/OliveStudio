# OliveStudio for VS Code

Open a project JSON file from Explorer. OliveStudio recognizes saved scene and project formats and opens the scene tab automatically. Use **Open Project JSON as Text** from the editor tab menu to read or edit the JSON directly. Disable **OliveStudio: Auto Open Projects** in VS Code settings to choose the editor manually.

The OliveStudio project tab contains the game canvas and its Edit/Live controls. Hierarchy and Scenes are native views in the Primary Sidebar, Inspector is in the Secondary Sidebar, and Assets, Asset Bundles, Timeline, Scripts, and other tools each have a named native panel tab. Use VS Code’s **View: Open View…** to find a view or **OliveStudio: Show Project Panels** to bring back the default views.

Click an Inspector property to edit it with VS Code Quick Input. Open a script from its tree to edit it in VS Code’s TypeScript editor, save to apply the script change to the project, then save the project to persist it. Export, search, project settings, and draft save are available as OliveStudio commands in the Command Palette.

Use the eye icon in **Assets** to open an image in VS Code Image Preview or play an animation in the scene tab. Audio previews use the scene's audio engine. Timeline clips play on the canvas. Audio Studio displays bus levels and Diagnostics shows frame-time history while the profiler is recording.

Panels with an **Edit … as JSON** row open a validated section editor. Save the section to apply it, then save the project tab to persist the change. Shader Library also opens GLSL source directly. The bundled `PANEL-PARITY.md` tracks implemented workflows and remaining differences.

Install a new VSIX to update an installed extension. Reload Window reloads the files VS Code already installed. For an unpacked development extension, rebuild and reload the Extension Development Host.

Version 0.4 registers the native views under new IDs so placements saved by older versions do not carry over. After updating from an older version, use **Developer: Reload Window** to replace already-open editor content.

OliveStudio uses the renderer and native project services from this repository. Scene edits use VS Code save and undo. Keep the sibling `*.config.json` with projects that already use one.

This extension targets VS Code Desktop 1.106 or later and local files. Multiplayer Play Preview requires a local socket. LocalHub support is bundled when the LocalHub TypeScript client is available during the build. Set `LOCALHUB_DIR` to its checkout to include it. VS Code stores pairing credentials in SecretStorage.

From the OliveStudio repository, run `pnpm package:vscode` and install the VSIX in `release/` with **Extensions: Install from VSIX…**. Run `pnpm build:vscode` to build an unpacked extension in `apps/vscode/dist`. Launch it with `code --extensionDevelopmentPath="<path to apps/vscode/dist>"`.

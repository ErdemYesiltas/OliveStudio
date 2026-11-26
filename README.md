<p align="center">
  <img src="assets/brand/olivestudio-logo.png" alt="OliveStudio logo" width="170">
</p>

# OliveStudio

[English](#english) · [Türkçe](#türkçe)

## English

OliveStudio is a desktop 2D game editor for macOS built with Electron, TypeScript, React, and PixiJS. It was developed with AI under human direction as an independent learning and experimentation project.

- Organize game objects in Hierarchy, arrange dockable panels, and edit reusable prefabs and scene links.
- Import images, audio, spritesheets, and Spine assets, then organize them into AssetPack bundles.
- Animate objects with timelines and particles. Attach camera and object effects in Inspector.
- Play in the Live canvas, pause, step through frames, or preview animations with the separate Edit clock.
- Export supported projects as HTML games.

Open **Object Gallery** from the Hub to see supported game objects in context. Save projects as portable JSON files with embedded assets.

### Run from source

Use Node.js 22.12+ and pnpm 10.34.6.

```sh
pnpm install --frozen-lockfile
pnpm dev
```

The optional LocalHub integration uses the TypeScript client from a sibling `localhub` checkout or the directory in `LOCALHUB_DIR`. The desktop editor and its offline tools run independently of the LocalHub service.

Run `pnpm check` for type checking, linting, unit tests, and a build. Run `pnpm test:desktop` for the Electron suite or `pnpm test:e2e` for browser-based renderer checks.

Run `pnpm package:mac` to update `/Applications/OliveStudio.app` after quitting the running application. Run `pnpm release:mac:check` to check signing and notarization readiness.

### Source layout

- [Desktop editor](apps/editor/) contains the Electron host, preload bridge, and editor interface.
- [Pixi engine](modules/engine/) contains the standalone runtime and game clock.
- [Modules](modules/) and [packages](packages/) contain shared features and the editor SDK.
- [Object Gallery](examples/object-gallery/) is the example project bundled into the Hub.

## Türkçe

OliveStudio, Electron, TypeScript, React ve PixiJS ile geliştirilen bir macOS 2B oyun editörüdür. İnsan yönlendirmesiyle, yapay zekâ kullanılarak bağımsız bir öğrenme ve deneme projesi olarak geliştirildi.

- Hierarchy’de oyun objelerini düzenleyebilir, panelleri gruplandırabilir, prefab ve sahne bağlantıları oluşturabilirsin.
- Görsel, ses, spritesheet ve Spine dosyalarını AssetPack paketlerinde toplayabilirsin.
- Timeline ve parçacıklarla animasyon hazırlayabilir, Inspector’dan kamera ve nesne efektleri ekleyebilirsin.
- Oyunu Live görünümünde çalıştırabilir, duraklatabilir ve kare kare ilerletebilirsin. Edit görünümünün ayrı bir saati var.
- Desteklenen projeleri HTML oyunu olarak dışa aktarabilirsin.

Desteklenen oyun objelerini görmek için Hub’dan **Object Gallery** örneğini aç. Projeler varlıklarıyla birlikte taşınabilir JSON dosyası olarak kaydedilir.

### Kaynak koddan çalıştırma

Node.js 22.12+ ve pnpm 10.34.6 kullan.

```sh
pnpm install --frozen-lockfile
pnpm dev
```

İsteğe bağlı LocalHub entegrasyonu, komşu `localhub` klasöründeki veya `LOCALHUB_DIR` ile belirtilen TypeScript istemcisini kullanır.

`pnpm check` tür denetimi, lint, birim testleri ve derlemeyi çalıştırır. Electron testleri için `pnpm test:desktop`, tarayıcı tabanlı kontroller için `pnpm test:e2e` kullan.

Uygulamayı kapattıktan sonra `pnpm package:mac` komutuyla `/Applications/OliveStudio.app` paketini güncelleyebilirsin. İmzalama ve noter onayı hazırlığını `pnpm release:mac:check` ile kontrol edebilirsin.

## License / Lisans

OliveStudio source code uses the [MIT License](LICENSE). Third-party dependencies retain their original terms. Builds and exports that include Spine Runtimes are subject to the [included Spine Runtimes license](third-party/SPINE-RUNTIMES-LICENSE.txt). See [Esoteric Software’s license terms](https://esotericsoftware.com/spine-runtimes-license).

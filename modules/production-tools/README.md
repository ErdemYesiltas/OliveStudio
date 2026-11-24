# Production Tools

OliveStudio’nun mevcut sahne, prefab, script, input, runtime ve export sözleşmelerini kullanan üretim araçları. Ayrı bir oyun motoru veya ikinci belge modeli oluşturmaz. Paket aynı workspace içindedir; özellikler ayrı `EditorModule` manifest’leriyle açılır.

## Kullanım ve modüller

| Panel | Modül | İlk sürümde çalışan akış |
| --- | --- | --- |
| World | `production.world` | Odaları sürükleyerek konumlandırma, sahne açma, portal/oyuncu/spawn bağları, erişilebilirlik tanısı |
| Brushes | `production.brushes` | Seed/spacing/jitter/scale/rotation ile prefab dağıtımı; N/E/S/W maskeli terrain boyama/silme |
| Behavior Graph | `production.graphs` | İç içe/parallel state, initial state, entry action, event/delay/guard geçişleri; XState derleme ve entity’ye bağlama |
| Gameplay Lab | `production.lab` | Kinematik platformer/top-down kontrolcü, jump/dash A/B eğrileri, preset ve seçili nesneye uygulama |
| Game Data | `production.data` | Tipli tablolar, satır/hücre düzenleme, kolon ekleme, foreign key/asset doğrulama, CSV ve component bağları |
| Test Studio | `production.tests` | Klavye kaydı, sabit frame replay, konum/rotation/active assertion, iptal, kayıtlı pozlardan ghost |
| Visual Review | `production.reviews` | Beş yerel baseline, stable-ID değişiklikleri, sahne diyagramları, asset/prefab metadata farkı, Git okuma köprüsü |
| Build Quality | `production.quality` | Entity/texture/audio/final HTML byte bütçeleri, gerekli testlerin güncel başarılı sonuçları |
| Starter Kits & Search | `production.kits` | Parametreli platformer/top-down kitleri, spawn nesnesi, entity/component/reference/table/script graph/test/asset arama |

`production.core`, belge servisini ve temizlenen UI/runtime portlarını sağlar. Her panel mevcut geçici/sabit panel altyapısını kullanır. `Graphite`, `Light`, `Warm` yüzey token’ları tüketilir; sahne asset renkleri değiştirilmez.

### Hızlı deneme

1. Starter Kits & Search → oyuncu adı/ölçüleri → Platformer kit.
2. Gameplay Lab → değerleri değiştir → A/B jump veya dash eğrisini karşılaştır → Apply B.
3. Behavior Graph → Behavior → state ve transition oluştur → Attach to selected object.
4. Game Data → Table/Field/Row → public Inspector property’sine binding ekle. Apply authoring belgesini değiştirir; Apply olmadan da binding Preview/export’un izole dünyasına uygulanır.
5. World → ikinci sahneyi oluştur → iki sahneye root oyuncu ve spawn nesnesi koy → Connect rooms formuyla portalı bağla.
6. Test Studio → senaryo/tuş frame’leri ve assertion’lar → Run scenario. Başarılı sonuç `production.tests.proofs` içinde kaynak fingerprint’iyle saklanır.
7. Build Quality → requiredTests içine senaryo ID’lerini koy → Enforce → testleri yeniden çalıştır → HTML export.

Tablo/default/binding ve statechart verileri Advanced JSON alanından da tam şemayla düzenlenebilir. Bu alan silme, yeniden adlandırma ve toplu değişiklikleri de destekler. Değişiklikler normal transaction/Undo yolundan geçer.

## Runtime ve export

`runtime.ts` Preview ve HTML player tarafından ortaktır. Yalnız kullanılan projeler `production` runtime chunk’ını yükler. Portal geçişi, scene yeniden oluşturulurken hedef spawn’a varışı korur. Click portalı mevcut pointer/interaction gözleminden; proximity portalı sabit oyun adımından çalışır. Input action isteğe bağlıdır.

Tablo değerleri sistemler başlamadan önce klon component verisine uygulanır. Editörde public Inspector alanları ve component parser’ı doğrulanır. Script/machine kimliğini tablolarla değiştirmek desteklenmez. Asset kolonları `target` olarak asset türünü belirtir; bu asset’ler export toplamasına katılır.

Kinematik karakterler root nesne olmalı; aynı nesnede Matter body veya Nav Agent bulunmamalı. X/Y kanalları tween/animation doğrulamasına sahiplik olarak verilir. `production.platform` root, axis-aligned statik sınırdır. Bu sınırlar Matter collision event’i üretmez. Top-down modu basit serbest harekettir; navmesh/terrain fizik motoru değildir.

Editor-only brush/graph/preset/test/review/quality kayıtları HTML oyununa girmez. Derlenmiş behavior script’i, runtime data/world kayıtları ve gerekli asset’ler gider. React, Dockview, Electron ve AI paneli game bundle’ına girmez; mevcut runtime-only build kontrolü bunu doğrular.

## MCP

`automation.capabilities` sorgusunda `production` kullan. Ayrıntı için `automation.describe_tool`; çalıştırma için güncel generation/revision/scene context’iyle `automation.execute` kullanılır. Özellikler **36 araç** kaydeder.

- Her belge: `production.<feature>.read/save`.
- Dünya: `production.world.move_room`, `.diagnostics`.
- Fırça: `production.brushes.stroke` — prefab için world pixels, terrain için tilemap local pixels.
- Grafik: `production.graphs.compile` — isteğe bağlı `entityId`; yalnız graph’ın sahip olduğu script’i yeniden yazar.
- Veri: `production.data.apply`, `.export_csv`, `.import_csv`.
- Test: `production.tests.run`, `.results`, `.samples` (sayfalı), `.record_start`, `.record_finish`, `.record_cancel`.
- İnceleme: `production.reviews.capture`, `.compare`, `.git`.
- Diğerleri: `production.lab.apply`, `production.quality.report`, `production.kits.create`, `.search`.

`tests.run` bir cancellable job’dır. Sonuç assertion özeti/sampleCount döndürür; büyük izler `.samples` ile sayfalanır. `record_start` sıfırıncı frame’de paused Preview açar. Resume ile oyna; Preview bitmeden `record_finish` ile taslağı al. Stop sonrasında assertion ekleyip `tests.save` ile kaydet. 30 saniye / 512 event aşılırsa eksik bir kayıt sessizce kaydedilmez.

## Sınırlar

- Bu teslim, dokuz iş akışının çalışan ilk sürümüdür; büyük dünya streaming’i, WFC terrain, görsel rig editorü veya ortak canlı düzenleme değildir.
- Brush prefab instance’larını scene nesnelerine bake eder; yeni kopyalar prefab instance link’i taşımaz. Tek tamamlanan stroke tek undo; Escape mevcut stroke’u iptal eder.
- Graph → script tek yönlüdür. Rastgele TypeScript’ten graph çıkarılmaz; elle düzenlenmiş generated script üstüne yazılmaz. Graph guard sonucu ve aktif state’ler canlı okunabilir.
- Test maksimum 1800 frame (30 sn), 512 key edge, 100 assertion, 10 gözlenen entity içerir. Tek scene içindir; scene değişirse açıklamalı olarak durur. Fizik rollback/rewind yoktur. Step ses üretmez. Ağ, gerçek zaman ve dış I/O için bit düzeyinde determinizm iddiası yoktur. Seed, sandbox `game.random` / `Math.random` içindir.
- Assertion’lar X/Y/rotation/active içindir. Script state veya fizik contact assertion’ları ayrı genişlemedir. Assertion’sız test başarılı sayılmaz.
- Fingerprint cache tazeliği içindir; kriptografik test imzası değildir. Baseline/proof ve türetilmiş spawn cache’i kapsam dışıdır; provider varsayılanları normalize edilir.
- Texture bütçesi base RGBA tahminidir; mipmap/driver overhead dahil değildir. Audio kaynak dosyası byte’ıdır; final folder byte’ı native export sonunda ölçülür.
- Görsel inceleme diyagram/JSON farkıdır; piksel bazında asset diff veya otomatik merge yoktur. Git okuma mevcut native servisi kullanır; proje kaydedilmiş ve ilgili revision’da bulunmalıdır.
- Yeni panellerin iç metinleri ilk ürün dili İngilizcedir; panel başlıklarının İngilizce/Türkçe anahtarları vardır. Tam panel içi yerelleştirme ileriki UX paketidir.

## Doğrulama — 20 Kasım 2026

- `pnpm typecheck`, `pnpm lint`, `pnpm test`: **114 dosyada 546 test**, 20 model/servis + 2 export entegrasyon testi.
- Host namespace/activation ve MCP şemaları, seeded stroke, terrain komşulukları/erase, graph sahipliği ve gerçek QuickJS/XState guard/action çalışması, CSV/typed references/bindings, undo, controller/room arrival, stale proof, asset toplama, bütçe ve seeded script replay testleri.
- Native macOS QA: 47 aktif modül, 36 Production aracı, iki room, üç prefab stroke kopyası + undo/redo, data-bound hız, portal arrival `(70,120)`, frame-60 hareket assertion’ı `x=474.5 > 400`, save/reopen, fresh-test gate ve gerçek HTML export.
- Editor dışında HTML: Start → klavyeyle hareket → click portal → Room Two/spawn `(70,120)`; tarayıcı hata/uyarı kaydı boş. Runtime listesi `scripts`, `behavior`, `input`, `production`; editor-only bölümler yok.
- Yerel kanıtlar (gitignore): `outputs/backlog-qa/production-*.json/png`, `fixtures/Production Tools QA.pixieditor`, `fixtures/production-html/`.
- Yeni imzalı/notarized uygulama paketi üretilmedi. Windows/Linux ve mobil cihaz kabulü bu teslimde yapılmadı.

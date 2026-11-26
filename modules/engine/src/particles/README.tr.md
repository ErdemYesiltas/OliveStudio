# Particles

> Bu dosya [`README.md`](./README.md)'nin Türkçe çevirisidir. Bir tutarsızlık görürsen İngilizce sürüm esastır.

PixiJS 8 parçacıklarının emitter yarısı. Render yarısını Pixi veriyor: bir `ParticleContainer`,
binlerce `Particle` örneğini **tek** bir draw call'da, **tek** bir `TextureSource` üzerinden çiziyor
ve her kare neyin yeniden yüklendiğine `dynamicProperties` karar veriyor. Bu modül Pixi'nin
vermediğini veriyor — spawn zamanlaması, yaşam süreleri, havuzlanmış bir parçacık listesi ve
değerleri parçacığın ömrü boyunca birer eğri olan **behavior**'lar.

Bir emitter JSON olarak yazılır (`EmitterConfigV3`). Emitter'ın kendi alanları parçacıkların *ne
zaman* göründüğünü ve ne kadar yaşadığını söyler; bir parçacığın nasıl göründüğüne ya da nasıl
hareket ettiğine dair her şey `behaviors` içindeki isimli bir kayıttır. O kayıt defteri açık, yani
bir oyun emitter'ı fork etmeden kendi behavior'ını ekleyebilir.

Kökeni `@pixi/particle-emitter`; Pixi 8'in `Particle` / `ParticleContainer`'ına port edildi ve
budandı: V1/V2 config yükseltme yolu ile `new Function` ile derlenen `movePath` behavior'ı kaldırıldı,
emitter'ın saati de global'den okunmak yerine enjekte ediliyor.

---

## Kurulum

Kaydedilecek bir şey yok — paketten import edilecek bir şey de yok. `particles` **ne** `app.*`
üzerinde, **ne de** `src/index.ts`'ten yeniden export ediliyor. Bir oyun buraya diğerleri gibi bir
`particle:*` animasyonu kaydederek ulaşır; animation modülünün particle driver'ı bu modülün tek
çağıranı.

```ts
app.animations.set('particle:coin-burst', { config: coinBurstJson, duration: 1500 });
await app.animations.apply('particle:coin-burst', fxLayer).finished;
```

Engine'in içinden doğrudan modülden import edilir:

```ts
import { Emitter, createParticleEmitter } from '../particles';
```

`particle:*` yüzeyi (`duration`, `loop`, `dynamicProperties`) için `animation/README.md`'ye, bir
emitter'ı composition adımı olarak oynatmak için `director/README.md`'ye bak.

---

## Kullanım

### Baştan sona bir config

`behaviors` dışındaki her alan emitter'ı yönetir; her görsel karar bir behavior'dır.

```ts
import type { EmitterConfigV3 } from '../particles';

const coinBurst: EmitterConfigV3 = {
  lifetime: { min: 0.6, max: 1.2 },
  frequency: 0.05,
  particlesPerWave: 4,
  emitterLifetime: 0.4,
  maxParticles: 200,
  pos: { x: 0, y: 0 },
  behaviors: [
    { type: 'spawnBurst', config: { spacing: 0, start: 0, distance: 20 } },
    { type: 'textureRandom', config: { textures: ['coin1', 'coin2', 'coin3'] } },
    {
      type: 'moveAcceleration',
      config: { accel: { x: 0, y: 1400 }, minStart: 500, maxStart: 800 },
    },
    {
      type: 'alpha',
      config: {
        alpha: {
          list: [
            { value: 1, time: 0 },
            { value: 1, time: 0.7 },
            { value: 0, time: 1 },
          ],
        },
      },
    },
    { type: 'scaleStatic', config: { min: 0.6, max: 1 } },
    {
      type: 'rotation',
      config: { minStart: 0, maxStart: 360, minSpeed: 90, maxSpeed: 220, accel: 0 },
    },
  ],
};
```

`frequency` **dalgalar arasındaki saniye sayısı**, yani `0.05` saniyede yirmi dalga demek;
`particlesPerWave: 4` ve `emitterLifetime: 0.4` ile bu kabaca 32 parçacık eder ve emitter kendi
kendine durur. `emitterLifetime`'ı atlarsan durdurulana kadar çalışır.

TypeScript'te yazarken `BehaviorEntry` yerine `BehaviorConfigs`'e uzan: kayıtlı her behavior'ın
`{ type, config }` çiftini birleştiren bir discriminated union olduğu için bir config bir
behavior'ın adını verip başkasını yapılandıramaz.

```ts
import type { BehaviorConfigs } from '../particles';

const speed: BehaviorConfigs = { type: 'moveSpeedStatic', config: { min: 100, max: 200 } };
```

### Bir emitter'ı doğrudan sürmek

`new Emitter(parent, config)` bir `ParticleContainer` ve bir saat ister. `update` **saniye** alır;
`updateByTicker` ise ticker biçimli adaptör — çünkü Pixi 8 bir callback'e delta değil `Ticker`'ın
kendisini veriyor.

```ts
import { ParticleContainer } from 'pixi.js';
import { Emitter } from '../particles';

const container = fxLayer.addChild(
  new ParticleContainer({ dynamicProperties: { position: true, vertex: true, color: true } })
);

const emitter = new Emitter(container, coinBurst);
emitter.emit = true;

app.ticker.add((t) => emitter.update(t.elapsedMS / 1000));
```

`autoUpdate: true` yerine emitter'ı yukarıdaki gibi uygulamanın kendi ticker'ından sürmeyi tercih
et: `app.speed()`'in ölçeklediği ve `app.pause()`'un dondurduğu saat o ticker'dır, `autoUpdate` ise
constructor'a verilen `Ticker`'a (varsayılan `Ticker.shared`) bağlanır ve o iki kontrolün ikisi de
oraya dokunmaz.

İki tek seferlik yardımcı, kendi ticker satırını yazmadan yaygın durumu karşılar — ikisi de
emit'i başlatır ve kendini günceller:

```ts
emitter.playOnce(() => console.log('son parçacık öldü')); // emitter kullanılabilir kalır
emitter.playOnceAndDestroy(() => onFxDone());             // sonrasında kendini yok eder
```

`emitNow()` spawn ritminin dışında tek bir dalga bırakır. `spawnChance`, `particlesPerWave` ve
`maxParticles`'a uyar; `frequency` ile `emit`'i yok sayar, ön yaşlandırma ile pozisyon
interpolasyonunu da atlar — tanımı gereği anlık bir dalga.

### `createParticleEmitter` — driver adaptörü

Particle driver'ın çağırdığı şey bu; engine içinde başka bir yerin emitter'a ihtiyacı olursa
tekrar kullanılacak şekil de bu: `start` / `update` / `stopEmitting` / `destroy` / `isComplete`.

```ts
const handle = createParticleEmitter(fxLayer, coinBurst);

handle.start();
// her kare
handle.update(dtSec);
// efekt sönmeye başlayacağı zaman
handle.stopEmitting();
if (handle.isComplete()) handle.destroy();
```

**`target` tipine göre iki şekilde okunur.**

- Bir **`ParticleContainer`** doğrudan içine çizilir ve senin kalır — parent'ı, z-order'ı,
  `dynamicProperties`'i ve yaşam süresi. `destroy` onu ayakta ve boş bırakır, yani aynı container
  bir sonraki emitter'ı da barındırır. Efektin sahnedeki yeri önemliyse ya da birkaç emitter tek
  container'ı — dolayısıyla tek draw call'u — paylaşacaksa bunu kullan.
- **Başka herhangi bir `Container`** parent olarak görülür: altına `dynamicProperties`'ten bir
  `ParticleContainer` oluşturulur, `destroy` onu geri kaldırır. Rahat olan varsayılan.

Config ne derse desin `autoUpdate` **kapatılır**, çünkü saatin sahibi çağıran taraftır. Ve
`dynamicProperties` yalnızca container'ı bu fonksiyon oluşturduğunda dikkate alınır — bir
`ParticleContainer` hedefiyle birlikte verilirse bir uyarı loglanır ve yok sayılır, çünkü Pixi bu
flag'leri container kurulurken buffer düzenine gömer ve bir setter sunmaz.

Dördüncü parametre `ticker`, `Emitter`'a veriliyor ve emitter'ın kendi saatini kullanan tek yol için
anlamlı: `playOnceAndDestroy`. Particle driver oraya `app.ticker`'ı geçiyor; verilmezse `Emitter`
constructor'ının varsayılanı (`Ticker.shared`) geçerli olur.

```ts
// Bilinçli olarak daraltıldı: hiçbir texture behavior'ı kare animasyonu oynatmıyor, `uvs` bedava değil.
createParticleEmitter(fxLayer, coinBurst, {
  position: true,
  vertex: true,
  rotation: true,
  color: true,
  uvs: false,
});
```

### Parçacığın ömrü boyunca değişen değerler

`alpha`, `scale`, `color` ve `moveSpeed` bir `ValueList` alır — `time`'a göre artan keyframe'ler,
burada `time` parçacığın kendi ömrünün bir kesri. `isStepped` her değeri bir sonraki keyframe'e
kadar tutar, aralarını harmanlamaz; renk süzülmesi ile flaş arasındaki fark budur.

```ts
{
  type: 'color',
  config: {
    color: {
      list: [
        { value: '#ff0000', time: 0 },
        { value: '#00ff00', time: 0.5 },
        { value: '#0000ff', time: 1 },
      ],
      isStepped: false,
      ease: (t) => t * t,
    },
  },
}
```

Bilmeye değer üç kısayol var. Değerleri hiç değişmeyen bir liste tek düğüme indirgenir, böylece
interpolatör en ucuz yolunu seçer. Emitter seviyesindeki `ease` interpolasyona giren *her* değere
uygulanır, yani tek bir eğri her listeyi tek tek düzenlemeden efektin bütününü yeniden şekillendirir.
Ve her `*Static` behavior varyantının `updateParticle`'ı hiç yoktur — `alpha` yerine `alphaStatic`
kare başına bir maliyeti azaltmak değil, tamamen kaldırmaktır.

Uzun bir gradyanın maliyetini karşılanabilir tutmak gerekiyorsa
`ParticleUtils.createSteppedGradient` onu baştan sabit sayıda adıma düzleştirir.

### Spawn şekilleri

**`noRotation` bir bayrak değil, kilitlenmiş bir açıdır.** Config'i **derece** cinsinden
`{ rotation }` alır, varsayılanı `0`'dır (sağa bakar) ve diğer rotation behavior'larını *ezmek için*
`Late`'in bir adım sonrasında çalışır. `@pixi/particle-emitter`'dan taşınan bir config — orada aynı
isim "sprite'ı döndürme" demektir ve `{ value: true }` alır — bu yüzden "her parçacığı 0°'ye kilitle"
diye okunur; `moveSpeed` de parçacığın rotation'ı boyunca ilerlediği için tüm efekt hiçbir şey
loglanmadan sessizce yana uçar. Sabit bir açı istemiyorsanız bu behavior'ı kullanmayın.

Ayrıca bir parçacığın `rotation`'ı hem yönü **hem de** sprite açısıdır: artwork dönsün diye bir
`rotation` behavior'ı eklemek yörüngeyi de büker. Sanat dönsün ama yörünge düz kalsın isteniyorsa
kareleri animasyonlayın (`animatedSingle`).

`spawnShape` yerleştirmeyi config'inde adı verilen bir şekle devreder. `rect`, `torus` (aynı zamanda
`circle` olarak da kayıtlı) ve `polygonalChain` kayıtlı olarak geliyor.

```ts
// Bir sembol hücresi ya da tüm board
{ type: 'spawnShape', config: { type: 'rect', data: { x: -60, y: -60, w: 120, h: 120 } } }

// Bir halka, her parçacık dışa nişanlanmış
{
  type: 'spawnShape',
  config: { type: 'torus', data: { radius: 80, x: 0, y: 0, innerRadius: 70, affectRotation: true } },
}

// Bir yol boyunca; segmentler uzunluklarına göre ağırlıklandığı için yoğunluk eşit
{
  type: 'spawnShape',
  config: { type: 'polygonalChain', data: [{ x: 0, y: 0 }, { x: 120, y: 40 }, { x: 240, y: 0 }] },
}
```

Spawn behavior'ları `BehaviorOrder.Spawn` (`0`) sırasında koşar; bu, özel olarak ele alınan tek
sıra değeri: emitter kendi pozisyon ve rotasyonunu uygulamadan **önce** koşarlar, böylece bir şekil
emitter'a göre yerel koordinatlarda çalışır. Geri kalan her şey sonra koşar ve dünya
koordinatlarını görür.

### Genişletme: kendi behavior'ın

Bir behavior, statik bir `type`'ı ve bir `order`'ı olan tek bir izole meseledir. `initParticles`
zorunlu; `updateParticle` ve `recycleParticle` opsiyonel, yani yalnızca spawn yapan bir behavior
kare başına hiçbir şeye mal olmaz. Parçacıklar **bağlı liste** olarak gelir — `particle.next`
üzerinden yürü; emitter asla bir dizi ayırmaz.

```ts
import { Emitter, type IEmitterBehavior, BehaviorOrder, type Particle } from '../particles';

class MagnetBehavior implements IEmitterBehavior {
  public static type = 'magnet' as const;

  public order = BehaviorOrder.Late;
  private strength: number;

  constructor(config: { strength: number }) {
    this.strength = config.strength;
  }

  initParticles(first: Particle): void {
    let next: Particle | undefined = first;

    while (next) {
      next.config.magnetPhase = Math.random();
      next = next.next;
    }
  }

  updateParticle(particle: Particle, deltaSec: number): void {
    particle.x -= particle.x * this.strength * deltaSec;
    particle.y -= particle.y * this.strength * deltaSec;
  }
}

Emitter.registerBehavior(MagnetBehavior);
```

Kayıtta son yazan kazanır; bir oyunun hazır gelen bir behavior'ı **değiştirme** yolu da bu: kendi
sınıfını aynı `type` altında kaydet. Şekiller de aynı şekilde
`ShapeSpawnBehavior.registerShape(cls, typeOverride?)` üzerinden çalışır — override, tek bir sınıfın
birkaç isme hizmet etmesinin yolu (`Torus` aynı zamanda `circle`).

`Particle.config` parçacık başına state için ayrılmış karalama torbasıdır ve geri dönüşümde
bilinçli olarak **temizlenmez**; böylece bir behavior geçen sefer ayırdığı nesneyi yeniden
kullanabilir. Madalyonun öbür yüzü: oradan okuduğun şeyi tanımsız varsaymak yerine üzerine yaz.

### Hareket eden emitter'lar

Hızlı hareket eden bir emitter, aksi hâlde her karenin dalgasını tek bir noktada yığardı. Emitter
spawn pozisyonlarını kat edilen yol boyunca interpolasyonla dağıtır; sahibin hareketinin bir alan
değil bir metot üzerinden geçmesinin sebebi bu:

```ts
emitter.updateOwnerPos(rocket.x, rocket.y); // sahip hareket etti
emitter.updateSpawnPos(-50, 0);             // alevleri arkadan bırak
emitter.rotate(rocket.angle);               // hem offset'i hem parçacık yönünü döndürür
emitter.resetPositionTracking();            // ışınlanmadan sonra; yoksa sonraki dalga yayılır
```

---

## Yerleşik behavior'lar

Yirmi bir tane; `index.ts` hepsini import anında kaydediyor. `*Static` varyantlarının kare başına
kancası yoktur.

### Spawn — `BehaviorOrder.Spawn` (`0`)

| `type` | Config | Ne yapar |
|---|---|---|
| `spawnPoint` | `{}` | Her parçacığı emitter'ın pozisyonunda bırakır. No-op olan varsayılan. |
| `spawnBurst` | `{ spacing, start, distance }` (derece, birim) | Bir dalgayı `start`'tan itibaren eşit aralıklı açılara yayar. `spacing: 0` açıyı rastgeleleştirir — yıldız patlaması ile puf arasındaki fark. Sıfır olmayan bir `distance` onları bir halkaya taşır. |
| `spawnShape` | `{ type, data }` | Kayıtlı bir şekle devreder. Bilinmeyen bir `type`'ta kurulum anında throw eder. |

### Hareket — `BehaviorOrder.Late` (`5`)

| `type` | Config | Ne yapar |
|---|---|---|
| `moveSpeed` | `{ speed: ValueList<number>, minMult? }` | Spawn yönü boyunca keyframe'li hız. Yön hiç değişmez — yalnızca büyüklük — yani nişanı şekil alır, tempoyu bu behavior verir. `minMult` spawn'da parçacık başına bir çarpan çeker. |
| `moveSpeedStatic` | `{ min, max }` | Tüm ömür boyunca tek bir rastgele sabit hız; kare başına adım düz bir toplama. |
| `moveAcceleration` | `{ minStart, maxStart, accel: { x, y }, rotate?, maxSpeed? }` | Sabit ivme — yer çekimi, rüzgâr, bir mıknatıs. Hızın **orta noktasına** göre integre eder, böylece düşen bir yay hedefi aşmaz. `rotate: true` her parçacığı gittiği yöne çevirir ve herhangi bir rotation behavior'ını ezer. `maxSpeed: 0` sınırsız demek. |

### Ömür boyunca görünüm — `BehaviorOrder.Normal` (`2`)

| `type` | Config | Ne yapar |
|---|---|---|
| `alpha` | `{ alpha: ValueList<number> }` | Keyframe'li opaklık. |
| `alphaStatic` | `{ alpha }` | Spawn'da tek bir sabit opaklık. |
| `scale` | `{ scale: ValueList<number>, minMult? }` | Keyframe'li tek biçimli ölçek. `minMult`, bir dalganın birlikte büyüyüp küçülürken boy çeşitliliği kazanmasını sağlar. |
| `scaleStatic` | `{ min, max }` | Parçacık başına tek bir rastgele ölçek. |
| `color` | `{ color: ValueList<string> }` | Keyframe'li tint; 6 haneli hex'ten, kanal kanal interpolasyonla. |
| `colorStatic` | `{ color }` | Tek bir sabit tint, kurulumda bir kez parse edilir. |
| `rotation` | `{ minStart, maxStart, minSpeed, maxSpeed, accel }` (derece) | Spawn rotasyonuna **eklenen** rastgele başlangıç açısı, rastgele dönme hızı ve isteğe bağlı açısal ivme (orta noktaya göre integre edilir). |
| `rotationStatic` | `{ min, max }` | Yalnızca rastgele başlangıç açısı; bu da spawn rotasyonuna eklenir. |
| `noRotation` | `{ rotation? }` | Her parçacığı tek bir açıya sabitler ve spawn rotasyonunu **atar**. Sırası tam da diğer rotation behavior'larının üzerine yazsın diye `Late + 1` — bir şekil parçacıkları dışa nişanlarken sanatın dik durması gerekiyorsa kullanılacak olan bu. |
| `anchorStatic` | `{ x, y }` | Sabit anchor. `Particle` zaten Pixi'nin `0, 0`'ı yerine `0.5, 0.5` ile başlar. |

### Texture — `BehaviorOrder.Normal` (`2`)

| `type` | Config | Ne yapar |
|---|---|---|
| `textureSingle` | `{ texture: Texture \| string }` | Her parçacığa aynı texture; bir kez çözülür. |
| `textureRandom` | `{ textures: (Texture \| string)[] }` | Parçacık başına listeden rastgele biri. |
| `textureOrdered` | `{ textures: (Texture \| string)[] }` | Listeyi sırayla, parçacık başına bir adım gezer; imleç dalgalar arasında taşındığı için dört texture'lık bir liste, dalga boyutları ne olursa olsun eşit döner. |
| `animatedSingle` | `{ anim: AnimatedParticleArt }` | Her parçacık paylaşılan tek bir kare animasyonunu oynatır. |
| `animatedRandom` | `{ anims: AnimatedParticleArt[] }` | Her parçacık havuzdan bir animasyon çeker. |

`AnimatedParticleArt` şu: `{ framerate, loop?, textures }`. `-1` olan bir `framerate` oynatmayı
parçacığın ömrüne bağlar, böylece ömür rastgele olsa da klip her zaman son karesinde biter; bir kare
kaydı `{ texture, count }` olabilir, böylece bir kare listede tekrarlanmadan birkaç tik boyunca
tutulur. İki animasyonlu behavior da `dynamicProperties.uvs` ister, ki bu her parçacık için kare
başına bir GPU yüklemesi demek — aşağıdaki notlara bak.

## Spawn şekilleri

| `type` | Config (`data`) | Ne yapar |
|---|---|---|
| `rect` | `{ x, y, w, h }` | Eksene hizalı bir dikdörtgenin içinde düzgün rastgele bir nokta. `w`/`h` en az `1`'e kırpılır, böylece sıfır boyutlu bir dikdörtgen `NaN` üretmek yerine dejenere olur. |
| `torus` / `circle` | `{ radius, x, y, innerRadius?, affectRotation? }` | Dolu bir daire ya da `innerRadius` verildiğinde bir halka. `affectRotation` her parçacığın rotasyonunu kendi açısı kadar kaydırır ve yönlü sanatı merkezden dışa çevirir. |
| `polygonalChain` | `PointData[]` veya `PointData[][]` | Segment zinciri boyunca rastgele bir nokta — zinciri kapatırsan bir çokgenin çevresi olur. Segmentler uzunluğa göre ağırlıklandığı için eşitsiz bir zincir kısa kenarlarında yığılmaz. |

---

## API

### `Emitter`

```ts
new Emitter(
  particleParent: ParticleContainer,
  config: EmitterConfigV3,
  particleImages?: Texture | Texture[] | string | string[],
  ticker: Ticker = Ticker.shared,
)
```

`particleImages` havuzu tohumlar; verilmezse config'in texture behavior'larından türetilir, çünkü
gerçek texture zaten spawn'da parçacık başına atanıyor. `ticker`, `autoUpdate`'in bağlandığı saat —
kendi saatini koşturan bir uygulamanın emitter'a ulaşabilmesi ve bir testin onu elle
ilerletebilmesi için enjekte ediliyor.

| Üye | Açıklama |
|---|---|
| `static registerBehavior(cls)` | Bir behavior sınıfını statik `type`'ıyla kaydeder. Son yazan kazanır; tip sayısında sınır yok. |
| `init(config)` | Canlı parçacıkları atarak yeniden yapılandırır. Behavior'ları kurar, sıralar, sonra kare başına ve geri dönüşüm başına alt kümelere bir kez böler. |
| `update(deltaSec)` | Parçacıkları ilerletir ve zamanı gelen dalgaları spawn eder. **Saniye.** |
| `updateByTicker(ticker)` | Pixi'nin milisaniyesini çeviren ticker biçimli adaptör. |
| `emit` | Yeni parçacıkların spawn edilip edilmediği. `false` canlıların bitmesine izin verir. **Hangi** değeri yazarsan yaz emitter ömür sayacı sıfırlanır. |
| `autoUpdate` | Emitter'ın kendini ticker'ından sürüp sürmediği. |
| `emitNow()` | Spawn ritminin dışında tek bir dalga bırakır. |
| `playOnce(cb?)` / `playOnceAndDestroy(cb?)` | Emit'i başlatır, kendini günceller ve son parçacık öldüğünde haber verir. İkincisi sonrasında emitter'ı yok eder. |
| `parent` | İçine çizilen `ParticleContainer`. Atama **her canlı parçacığı öldürür** — onlar eski container'a ait. |
| `particleImages` | Tohum texture'lar. Atama string'leri çözer ve paylaşılan kaynak kuralını uygular. |
| `getBehavior(type)` | Bu emitter'ın bir behavior tipine ait canlı örneği ya da `null`. |
| `fillPool(count)` | Parçacıkları önceden ayırır, böylece ilk patlama kare ortasında ayırma bedeli ödemez. |
| `recycle(particle, fromCleanup?)` | Bir parçacığı havuza döndürür. `@internal` — behavior'lar ve `Particle.kill()` buraya uzanır. |
| `cleanup()` | Canlı tüm parçacıkları bir kerede geri dönüştürür; behavior'lar `natural: false` görür. |
| `destroy()` | Ticker'dan ayrılır, canlı ve havuzdaki parçacıkları öldürür, referansları bırakır. |
| `destroyed` | Yok edilmiş olup olmadığı. Yok edilmiş bir emitter **yeniden kullanılabilir**: yeni bir `parent` ver ve `init()` çağır. |
| `rotate(deg)` / `updateSpawnPos(x, y)` / `updateOwnerPos(x, y)` / `resetPositionTracking()` | Emitter yerleşimi; [Hareket eden emitter'lar](#hareket-eden-emitterlar) bölümüne bak. |
| `frequency` | Spawn'lar arası saniye. `0`'dan büyük olmayan her değer `1`'e çevrilir, çünkü `0` spawn döngüsünün hiç bitmemesine yol açardı. |
| `spawnChance`, `maxParticles`, `emitterLifetime`, `particlesPerWave`, `addAtBack`, `spawnPos`, `minLifetime`, `maxLifetime`, `customEase`, `particleCount` | Config alanlarının canlı karşılıkları. |

### `createParticleEmitter(target, config, dynamicProperties?, ticker?)`

`{ start, update, stopEmitting, destroy, isComplete }` döner. `config` tipi `unknown`, çünkü driver
onu opak biçimde geçiriyor; `isComplete()` ise `particleCount === 0 && !emit`. `ticker` `Emitter`
constructor'ına gidiyor, dolayısıyla yalnızca `playOnceAndDestroy` yolunu etkiliyor — `autoUpdate`
burada zorla kapatılıyor.

### `EmitterConfigV3`

| Alan | Tip | Varsayılan | Açıklama |
|---|---|---|---|
| `lifetime` | `{ min, max }` | — | Her parçacığın ömrünün çekildiği aralık, saniye. Zorunlu. |
| `frequency` | `number` | — | Spawn'lar arası saniye. Zorunlu; `0`'dan büyük değilse `1`'e çevrilir. |
| `pos` | `{ x, y }` | `0, 0` | Parent container içindeki spawn orijini. |
| `behaviors` | `BehaviorEntry[]` | — | Her parçacığa uygulanan behavior'lar. Zorunlu. |
| `particlesPerWave` | `number` | `1` | Spawn başına bırakılan parçacık sayısı. |
| `spawnChance` | `number` | `1` | Zamanı gelen bir spawn'ın gerçekleşme olasılığı, `0`–`1`. `1`'in altında ritmi dağıtır. |
| `emitterLifetime` | `number` | `-1` (sınırsız) | Kaç saniye spawn etmeye devam edileceği. |
| `maxParticles` | `number` | `1000` | Canlı parçacık üst sınırı; sınırda spawn kuyruğa alınmaz, durur. |
| `addAtBack` | `boolean` | `false` | Yeni parçacıkları mevcutların arkasına ekler, böylece ortaya çıkarken daha az göze batarlar. |
| `emit` | `boolean` | `true` | Hemen emit'e başla. |
| `autoUpdate` | `boolean` | `false` | Emitter'ın ticker'ına bağlan. `createParticleEmitter` bunu zorla kapatır. |
| `ease` | `SimpleEase \| EaseSegment[]` | — | Parçacığın ömrü boyunca interpolasyona giren her değere uygulanır. Başka bir şey verilirse uyarılır ve düşürülür. |

### `BehaviorEntry` / `BehaviorConfigs`

`BehaviorEntry` `{ type: string; config: any }` — JSON şekli. `BehaviorConfigs` ise denetlenen
biçim: kayıtlı her behavior'ın `type`'ını, constructor'ının kabul ettiği config ile eşleyen bir
discriminated union. `BehaviorType` yalnızca `type` string'lerinin birleşimi; `ShapeConfigs` /
`ShapeType` spawn şekilleri için aynı çift.

### `IEmitterBehavior` / `IEmitterBehaviorClass` / `BehaviorOrder`

| Üye | Açıklama |
|---|---|
| `order` | Bu behavior'ın ne zaman koştuğu. Küçük olan önce koşar; `0` (`BehaviorOrder.Spawn`) emitter'ın kendi dönüşümünden önce koşar. |
| `initParticles(first)` | Bir dalgayı ilklendirir. Zorunlu. `particle.next` üzerinden yürü. |
| `updateParticle?(particle, deltaSec)` | Kare başına. Parçacığı hemen geri dönüştürmek için `true` dön. |
| `recycleParticle?(particle, natural)` | Parçacık başına state tutan behavior'lar için. `natural: false` ömrün sonu değil, emitter teardown'ı demek. |

`BehaviorOrder` şu: `Spawn = 0`, `Normal = 2`, `Late = 5` — kapalı bir küme değil, alışılmış
konumlar. Aynı değeri paylaşan behavior'ların birbirine karışmadığı varsayılır, yani aralarındaki
sıra tanımsızdır.

### `Particle`

Pixi'nin `Particle`'ını emitter ile behavior'ların okuduğu alanlarla genişletir: `maxLife`, `age`,
`agePercent`, `oneOverLife`, `next` / `prev` (çift bağlı liste) ve `config` karalama torbası.
`init(maxLife)` önceki kullanımın bıraktığı dönüşümü, tint'i ve alpha'yı sıfırlar — behavior'lar
ondan sonra koştuğu için spawn'da yazdıkları ayakta kalır. `kill()` parçacığı havuza döndürür;
`destroy()` ise geri dönüşü olmayan teardown.

### `PropertyNode` / `PropertyList`

`PropertyNode.createList(data)` bağlı keyframe listesini bir `ValueList`'ten (ya da `0` ve `1`
zamanlarına açılan eski `{ start, end }` çiftinden) kurar ve string değerleri `{ r, g, b }`'ye
parse eder. `PropertyList.reset(first)` bir listeyi o zincire yönlendirir ve interpolasyon
fonksiyonunu listenin şeklinden — iki düğüm, stepped ya da çok segmentli — **bir kez** seçer;
böylece parçacık ve kare başına yapılan çağrı, liste şekline dallanmayan doğrudan bir çağrı olur.
`reset()` koşmadan önce `interpolate` `undefined`'dır.

### `ParticleUtils`

Bir namespace olarak export edilir (`ParticleUtils.rotatePoint`, …).

| Export | Açıklama |
|---|---|
| `GetTextureFromString` | Behavior'ların bir string'i `Texture`'a çevirme yolu. `Texture.from`'a alias, ve yeniden atanabilir — texture çözümlemesini host'un kendi loader'ına yöneltmenin kancası. |
| `parseTextures(textures)` | Texture ve alias'ları çözer; tek bir `TextureSource`'u paylaşmıyorlarsa **throw eder**. |
| `getTexturesFromConfig(config)` | Bir config'in referans verdiği texture'lar; texture behavior'larını inceleyerek bulur — emitter'ı kurmadan bir efektin sanatını ısıtmak ya da doğrulamak için. |
| `generateEase(segments)` | GreenSock CustomEase segmentlerini bir `SimpleEase`'e derler. |
| `createSteppedGradient(list, numSteps?)` | Bir renk gradyanını eşit aralıklı stepped listeye düzleştirir. |
| `hexToRGB(color)` | `#AARRGGBB` / `#RRGGBB` / `0x…` / çıplak hex'i `0`–`255` kanallarına parse eder. |
| `combineRGBComponents(r, g, b)` | Kanalları `0xRRGGBB`'ye paketler. |
| `rotatePoint`, `length`, `normalize`, `scaleBy` | Sıcak döngü için yerinde vektör matematiği. `rotatePoint` sıfır açıda hemen döner. |
| `getBlendMode(name)` | Bir blend mode adını doğrular, `'normal'`a düşer. Çağıranı yok — notlara bak. |
| `DEG_TO_RADS`, `Color`, `EaseSegment`, `SimpleEase` | Sabit ve tipler. |

---

## Notlar

- **Ne `app.*` üzerinde, ne engine barrel'ında.** `src/index.ts` bu modülü yeniden export etmiyor,
  yani `Emitter` `@aperion-gaming/engine`'den import edilemez. Bir oyunun giriş yolu bir `particle:*`
  animasyonu; kaçış kapısı ise `app.animations.registerDriver('particle', …)` — parçacık davranışını
  bütünüyle değiştirmenin tek yolu bu.
- **Container başına tek `TextureSource`.** `ParticleContainer` tek bir kaynak üzerinden batch'ler,
  yani karışık bir texture listesi her geçişte sessizce bir draw call'a mal olurdu. `parseTextures`
  bunun yerine throw ediyor ve durumu bir yazım hatasına çeviriyor. *Dışarıdan verilen* bir
  container'da bu kısıt o container'ı paylaşan her emitter'ı kapsar ve kaynak, ilk parçacığın
  getirdiği kaynaktır.
- **`dynamicProperties` isimlerinin çağrıştırdığı şey değil.** `vertex` **ölçek ve anchor**'ı taşır —
  ayrı bir `scale` flag'i yok — `color` ise **alpha**'yı taşır, çünkü `aColor` `Particle.color`'dan
  paketlenir. Pixi bunları container kurulurken buffer düzenine gömer ve bir setter sunmaz, yani
  yanlış bir `false` sessizce başarısız olur: parçacıklar sadece ölçeklenmez ya da tint almaz.
  `createParticleEmitter`'ın beşini de **açık** varsaymasının, daraltmayı ise opt-in bırakmasının
  sebebi bu.
- **Saat çağıranın, ve o saat `app.ticker`.** `createParticleEmitter`, config ne derse desin
  `autoUpdate = false` yapar — `autoUpdate: true` emitter'ı ayrıca kendi `Ticker`'ına bağlardı ve
  kare başına iki kez ilerletirdi. Emitter'ı fiilen ilerleten saat, çağıranın `update(dtSec)`
  pompaladığı saattir; particle driver onu `ctx.ticker`'dan (`app.ticker`) alıyor, çünkü
  `app.speed()` ve `app.pause()` o örneği ölçekliyor/durduruyor, `Ticker.shared`'ı zorunlu olarak
  değil. `boot()` `sharedTicker: true`'yu zorladığı için ikisi çakışıyor, ama elle kurulmuş bir
  `Application` ayrışabilir.
- **Bilinmeyen bir behavior tipi loglanır ve düşürülür, throw edilmez** — tek bir bozuk kayıt tüm
  efekti götürmez, ama bir yazım hatası efektin bir parçasını sessizce kaybettirir. `spawnShape`
  içindeki bilinmeyen bir *şekil* tipi ise kurulum anında throw eder.
- **`Particle.config` geri dönüşümde temizlenmez.** Bir behavior'ın spawn başına ayırmak yerine
  geçen sefer ayırdığı vektörü yeniden kullanabilmesinin sebebi bu; bedeli ise behavior'ın oradan
  okuduğunu tanımsız varsaymak yerine üzerine yazmak zorunda olması.
- **`ColorBehavior` `Color.shared` üzerinden yazar.** Değer atama sırasında hemen tüketilir; elde
  tutulmamalı.
- **`torus` yarıçapı iki sınır arasında alana göre değil, düzgün dağılımla seçilir**, yani dolu bir
  daire merkeze doğru daha yoğun olur. Bu tarihsel davranış ve çoğu efekt için iyi duruyor; eşit
  kaplama önemliyse ince bir halka kullan.
- **Blend mode behavior'ı yok.** Pixi 8'de blend mode parçacığın değil `ParticleContainer`'ın bir
  özelliği, yani parçacık başına harmanlama burada ifade edilemiyor — container üzerinde ayarla.
  `ParticleUtils.getBlendMode` o dönemden kalan doğrulayıcı ve şu anda çağıranı yok.
- **Ayırma bütçesi bir demo'nun değil, bir slot oyununun bütçesi.** Bir `updateParticle` içinde
  parçacık ve kare başına oluşan `Point`'ler ve nesne literalleri dikkat edilecek şey; hazır gelen
  behavior'lar ya `particle.config` depolamasını yeniden kullanıyor ya da update kancasını hiç
  kullanmıyor.
- **Test yok.** Bu pakette Vitest kurulu, ama bu modül için henüz hiç test yok.
- **Bu modülü küçültmek:** bir behavior
  dosyasını kaldırmak, `index.ts`'teki `registerBehavior` satırını da kaldırmak demektir —
  kayıt eager olduğu için burada hiçbir şey tree-shake edilmiyor — ayrıca geçersiz bir config'in
  spawn anında değil derleme anında patlaması için `BehaviorTypes.ts` / `shapes/ShapeType.ts`'teki
  ilgili üyeyi de düşürmek gerekir.

---

## Kaynak

```
src/particles/
├── Emitter.ts                  Emitter: spawn zamanlaması, havuzlama, canlı bağlı liste, update döngüsü
├── EmitterConfig.ts            EmitterConfigV3 — yazılan yüzey — artı BehaviorEntry, RandNumber
├── Particle.ts                 Pixi'nin Particle'ı + ömür, liste üyeliği, config karalama torbası
├── ParticleUtils.ts            Texture çözümleme, renk matematiği, easing, yerinde vektör yardımcıları
├── PropertyNode.ts             ValueList → bağlı keyframe listesi
├── PropertyList.ts             O liste üzerinde interpolasyon; fonksiyon bir kez, reset()'te seçilir
├── createParticleEmitter.ts    Driver adaptörü — start/update/stopEmitting/destroy/isComplete
├── index.ts                    Eager registerBehavior çağrıları, ardından public export'lar
└── behaviors/
    ├── Behaviors.ts            IEmitterBehavior, IEmitterBehaviorClass, BehaviorOrder
    ├── BehaviorTypes.ts        BehaviorType / BehaviorConfigs — tip ↔ config eşlemesi
    ├── PointSpawn.ts           BurstSpawn.ts     ShapeSpawn.ts
    ├── SpeedMovement.ts        AccelerationMovement.ts
    ├── Alpha.ts                Scale.ts          Color.ts       Rotation.ts    Anchor.ts
    ├── SingleTexture.ts        RandomTexture.ts  OrderedTexture.ts   AnimatedTexture.ts
    └── shapes/
        ├── SpawnShape.ts       Şekil sözleşmesi
        ├── ShapeType.ts        ShapeType / ShapeConfigs
        └── Rectangle.ts        Torus.ts          PolygonalChain.ts
```

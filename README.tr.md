# Drift

**İki görüntü arasında ne kaydığını bulur.** Aynı sahnenin iki fotoğrafını
bırakın; Drift birinin ne kadar kaydığını ölçer, ikisini üst üste oturtur ve
gerçek farkların hepsini kırmızıya boyar.

**[Aç →](https://onuryildirim26.github.io/drift/)** ·
[Örnekler](https://onuryildirim26.github.io/drift/examples.html) ·
[English readme](README.md)

Hiçbir şey yüklenmiyor. Sunucu yok, hesap yok, derleme adımı yok — tamamı,
açtığınız sekmede çalışan üç JavaScript dosyası.

---

## Ne yapar

Aynı sahnenin iki karesi neredeyse hiçbir zaman tam olarak aynı yerden
çekilmez. Kamera kayar, kâğıt tarayıcıya eğri girer, ölçüm uçuşu bir yıl sonra
biraz daha alçaktan geçer. Böyle bir çifti piksel piksel karşılaştırdığınızda
*her şey* farklı çıkar ve bu size hiçbir şey söylemez.

Drift bu karşılaştırmada birbirine karışan iki şeyi ayırır:

1. **Karenin nasıl hareket ettiği** — yatay ve dikey kayma, istenirse dönme ve
   ölçek.
2. **Gerçekte neyin değiştiği** — hareket geri alındıktan sonra kalan şey.

Birincisi sayı olarak yazılır. İkincisi kırmızıya boyanır.

## Nasıl çalışır

**Kaymanın ölçülmesi.** İki görüntü de Fourier dönüşümünden geçer. Genlik bölme
yoluyla atıldığında yalnız faz kalır; bunun ters dönüşümü de tam olarak iki
görüntü arasındaki kaymanın bulunduğu yerde tek ve keskin bir tepe verir. Buna
[faz korelasyonu](https://en.wikipedia.org/wiki/Phase_correlation) denir ve
genlik atıldığı için bir fotoğrafın diğerinden parlak olması onu etkilemez.
Tepe, komşularına parabol oturtularak incelenir; bu da tahmini piksel altına
indirir.

**Dönme ve ölçek.** Bu seçenek açıldığında önce ikinci bir geçiş çalışır: her
spektrumun log-polar yeniden örneklemesi üzerinde. Bu koordinatlarda bir dönme
yatay kaymaya, bir yakınlaşma da dikey kaymaya dönüşür; böylece aynı faz
korelasyonu ikisini de geri verir —
[Fourier–Mellin](https://en.wikipedia.org/wiki/Fourier%E2%80%93Mellin_transform)
yaklaşımı. Kayma ölçülmeden önce ikinci görüntünün dönmesi ve ölçeği geri
alınır.

**Farkın işaretlenmesi.** Hizalamadan sonra kalan şey gerçek değişimdir.
Duyarlılık eşiğinden fazla ayrılan pikseller kırmızıya boyanır, 3×3'lük bir
çoğunluk süzgeci de tek piksellik gürültüyü temizler. Süzgeç dokuz komşunun
beşini değil altısını ister: piksel altı hizalama hatası, yüksek kontrastlı her
kenar boyunca bir piksellik bir çerçeve bırakır ve beş, o çerçeveleri geçirir.

### Kolayca yanlış yapılan iki ayrıntı

FFT kare ve ikinin kuvveti bir ızgara ister, bu yüzden her görüntü 512×512'ye
yeniden örneklenir — **gerilerek değil, siyah bantla**. Germek eksenleri farklı
oranlarda ölçekler ve düzgün olmayan ölçekleme açıları korumaz: 640×480 bir
fotoğraf kareye sıkıştırıldığında gerçek 6,5°'lik bir dönme
`atan(1,067/0,8 · tan 6,5°)` = 8,6° olarak geri gelir. Bant eklemek iki eksen
için tek bir ölçek katsayısı bırakır, böylece yazılan sayılar kaynak
görüntünün kendi biriminde olur.

Bandın kendisi içerikle birlikte hareket etmediği için karşılaştırmanın dışında
tutulur; yoksa ekleme yerleri boyunca kırmızı şeritler çıkardı. Aynı maske,
dönmenin köşelerde açtığı üçgenleri de kaldırır — orada karşılaştıracak ikinci
bir görüntü yoktur.

## Doğruluk

Dönüşümleri bilerek uygulandığı için tam olarak bilinen dört
[üretilmiş örneğe](ornek/_uret.py) karşı:

| Çift | Uygulanan | Ölçülen |
|---|---|---|
| Otopark | +23, +11 px | +22,9, +11,1 px |
| Devre kartı | −14, +7 px | −13,9, +7,1 px |
| Taranmış sayfa | 6,5° saat yönü | 6,41° saat yönü |
| Havadan ölçüm | +9, −6 px, ×1,18 | +8,7, −6,1 px, ×1,184 |

## Nerede çalışır, nerede çalışmaz

İki karenin **aynı sahneyi** göstermesi ve **karenin büyük kısmının
değişmemiş** olması gerekir — hizalama, aynı kalan şeyden okunur; kabaca
yarıdan fazlası değiştiğinde bulunacak baskın bir kayma kalmaz.

İlgisiz iki fotoğraf, kazananı belli olmayan bir korelasyon yüzeyi verir. Drift
bunu tepe-yan lob oranıyla ölçer — tepenin yüzeyin geri kalanından kaç standart
sapma yükseldiği — ve 42'nin altına düştüğünde uyarır. Bu sayı ölçümden geliyor:
26 vakada gerçek çiftler hiç 50'nin altına, ilgisiz çiftler hiç 36'nın üstüne
çıkmadı. Kesin bir kanıt değil, sezgisel bir ölçüt; bu yüzden sonucu
gizlemek yerine yanına uyarı koyar.

Parlaklık ve pozlama farkları sorun değil. Perspektif değişimi sorun: Drift
kayma, dönme ve düzgün ölçeği modeller, dolayısıyla çevrilmek yerine *yana*
kaymış bir kamera oturmaz.

## Yerelde çalıştırma

Kurulacak bir şey yok, ama örnekler sayfası bir JSON dosyası çektiği için
diskten açmak yerine HTTP üzerinden sunulması gerekir:

```bash
python -m http.server 8000
```

Sonra `http://localhost:8000/` adresini açın.

Testler için Node 20 veya üstü:

```bash
node --test tests/*.test.js
```

Örnek çiftlerini yeniden üretmek için Pillow'lu Python:

```bash
python ornek/_uret.py
```

Bütün örnekler sentetik — fotoğraf değil, o betiğin çizdiği şeyler. Bu da bu
depoyu her türlü lisans ve gizlilik sorusundan uzak tutuyor.

## Dosya düzeni

```
index.html        araç
examples.html     cevabı bilinen dört çift
js/fft.js         radix-2 FFT, bağımlılık yok
js/register.js    motor: faz korelasyonu, log-polar, warp, fark maskesi
js/app.js         bağlantılar, çizim, bantlama
js/theme.js       açık/koyu: sistem ayarı, günün saati ve buton
ornek/_uret.py    örnek çiftleri ve gerçek değerlerini üretir
tests/            node --test
```

`js/register.js` DOM'a bağlı değil ve hem CommonJS hem tarayıcı global'i olarak
dışa aktarılıyor, yani tek başına da kullanılabilir:

```js
const R = require("./js/register.js");
const res = R.align(grayA, grayB, 512, 512, { rotation: true });
// res.dx, res.dy kaymayı geri alan düzeltmedir.
// res.angle, res.scale B'nin A'ya göre nasıl durduğunu anlatır.
const diff = R.differenceMask(grayA, res.aligned, 512, 512, 42);
```

## Lisans

[MIT](LICENSE). [Onur Yıldırım](https://github.com/onuryildirim26) yaptı.
İşinize yaradıysa
[bir kahve ısmarlayabilirsiniz](https://buymeacoffee.com/onuryildirim26).

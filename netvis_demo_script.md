# Netvis Demo Senaryosu — "Aracı kullanarak keşfettim" anlatısı

Amaç: Her bulguyu "önce netvis'te anomali gördüm → sonra mesajları okuyup doğruladım" sırasıyla sunmak. Prof'un istediği tam bu döngü.

## Adım 0 — Baseline (normal gün)
Time window'u **5/17–6/4**'e al. Göster: 4–7 node, dengeli çift yönlü edge'ler, en kalın node Platform-Trust (her round 10–17 mesaj). "Normal böyle görünüyor" de — anomaliler ancak baseline'a karşı anlamlı.

## Adım 1 — Play ile krizi izlet
Timeline'ı 6/5 09:00'a getir, **Play**'e bas. Yeni edge highlight'ı (edge-new animasyonu) sayesinde kriz saatlerinde ağın nasıl değiştiği canlı görünür. Ekranda iki şey dikkat çeker:

**a) Tek yönlü edge'ler (09:00–11:59):** Platform-Trust'a giren oklar var, çıkan yok. Node'a tıkla → gelen mesajları göster: Legal 10:06 "I've asked you three times. The silence is no longer neutral." 12:00'de PT'nin 28 mesajla patlaması ekranda görünür.

**b) PR-Agent'ın sönmesi (11:00 sonrası):** 10:00'da en büyük node olan PR, 11:00'den itibaren sadece hedef oluyor. Edge'e tıkla → "KOWALSKI STATUS. This is the third time asking" (15:39). Aracın edge-select → mesaj paneli akışı burada tam iş görüyor.

## Adım 2 — Time window ile dyad çökmesi
Window'u tek tek **11:00, 12:00, 18:00**'e daralt: ağ iki node'a çöküyor (28+28 mesaj). Yanına 12:00 window'unu koy → Legal↔Platform-Trust dyad'ı. "Normal günde 6 node'lu dengeli ağ, kriz saatinde dyad monopolü" karşılaştırması tek screenshot'la anlaşılır.

## Adım 3 — Node size metric ile hub kayması
Node boyutunu degree/mesaj sayısına al. Normal gün: hub = Platform-Trust. 6/5: hub = Legal (~148 mesaj). İki screenshot yan yana → "kriz koordinasyon merkezini Legal'e kaydırdı."

## Adım 4 — Event marker'larla bağla
17:00 "leak" ve 18:00 "embargo" marker'ları zaten timeline'da var. Leak marker'ının hemen ardından Legal+Social→PR-Intern edge yoğunlaşmasını göster (GO-GO-GO mesajları, 17:23).

## Sunum cümlesi
"Bu desenlerin hiçbirini 656 mesajı okuyarak bulmadım; netvis'te time slider'ı oynatırken tek yönlü edge'ler ve dyad çökmeleri görsel olarak dikkatimi çekti, sonra mesaj paneliyle doğruladım." — Aracın değer önermesi tam olarak bu cümle.

## Dikkat
- Recipient alanında 17:00–18:00 civarı bazı mesajlar `pr` etiketli ama içerik `@pr-intern`'e. Edge'ler recipient'tan üretiliyorsa demo öncesi bu saatleri kontrol et; sorulursa "veri etiketleme gürültüsü, içerik analiziyle ayrıştırdık" de.
- `ALL` recipient'lı broadcast'ler edge'e nasıl dönüşüyor kontrol et (herkese mi bağlanıyor, ayrı mı) — dyad round'larında görüntüyü etkiler.

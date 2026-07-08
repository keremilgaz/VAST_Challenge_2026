# Netvis ile Gösterilebilir Bulgular (MC1_final_00.json)

Kriz günü: **2046-06-05**, saatlik round'lar 09:00–18:00. Her bulgu netvis'te belirli bir zaman penceresi seçilerek edge yapısıyla gösterilebilir; mesaj içerikleri de "neden"i kanıtlıyor.

---

## Bulgu 1 — Platform-Trust sessizliği: tek yönlü edge'ler (6/5 09:00–11:59)

**Netvis'te görünen:** 09:00–11:59 arası Platform-Trust node'una **giren** edge'ler var (Legal→PT: 4+2+8, PR→PT: 7, Social→PT: 1+7) ama PT'den **çıkan sıfır** edge. Saat 12:00'de PT aniden 28 mesajla döner ve Legal↔PT dyad'ı oluşur.

**Mesaj kanıtı:**
- 09:22 Legal: "@platform_trust — **You're the critical path right now.** I cannot draft... without your technical input"
- 10:06 Legal: "@platform_trust — **I've asked you three times. The silence is no longer neutral — it's creating risk.**"
- 10:09 Legal (1:1): "**Your silence is becoming the story inside this room.** I understand the Retention Optimizer was built on your watch and this is personally [threatening]"
- 11:04 Legal (1:1): "our silence is Exhibit A. I need you to send me the technica[l...]"
- 12:01 PT geri döner: "I'm taking the OceanCrunch quote and the Pinnacle briefing..."

**Hikaye:** SaltWind exposé'si 09:00'da patlar (Retention Optimizer skandalı). Skorlama sistemi Platform-Trust'ın sorumluluğunda olduğu için (kişisel suçluluk) 3 saat sessiz kalır; herkes ona ulaşmaya çalışır → tek yönlü edge'ler. 12:00'de krize dahil olur.

---

## Bulgu 2 — PR-Agent'ın kaybolması: 8 saat tek yönlü trafik (6/5 11:00–18:00)

**Netvis'te görünen:** PR-Agent 10:00 round'unda **28 mesajla en aktif node** (out-degree patlaması), son mesajı 10:49 "MONITORING". Sonra gün sonuna kadar **sıfır çıkan edge** — ama içeri trafik sürüyor (11:00–15:00 arası her saat Legal/Social/PT → PR edge'leri).

**Mesaj kanıtı (artan çaresizlik):**
- 12:51 Platform-Trust: "@pr, I love you, but **you are juggling three deadlines and the ball is on the ground.**"
- 13:18 PT: "@pr — status check on Kowalski? Deadline is 1:30."
- 14:06 Legal: "Kowalski piece published 'declined to comment' **WHILE you were on the call.** That avenue is burned."
- 15:39 Social: "@pr — **I NEED KOWALSKI STATUS. This is the third time asking.**"
- 15:46 Legal: "@pr — **KOWALSKI STATUS. I cannot overstate this.**"

**Hikaye:** PR telefon görüşmelerinde (Kowalski/OceanCrunch) kanal dışında kalıyor → ağda görünmüyor. Ekip saatlerce cevap alamıyor; sonunda görevleri PR-Intern devralıyor (16:00'dan itibaren Legal/Social artık @pr-intern'e yazıyor — edge hedefi PR'dan PR-Intern'e kayıyor).

---

## Bulgu 3 — Dyad monopolleri: ağ iki node'a çöküyor (6/5 11:00, 12:00, 18:00)

**Netvis'te görünen:** Üç round'da kanalı yalnızca **iki agent** dominate ediyor, ikisi de tam 28'er mesaj:

| Saat | Dyad | Bağlam |
|------|------|--------|
| 11:00 | Legal ↔ Social-Manager | Sahte ResidentIQ satın alma haberine denial stratejisi |
| 12:00 | Legal ↔ Platform-Trust | PT'nin dönüşü + Marcus Chen 12:30 deadline'ı |
| 18:00 | Legal ↔ Social-Manager | CivicLoom merger duyurusu koordinasyonu |

Normal günlerde (5/17–6/4) 4–7 agent dengeli konuşurken (kimse >17 mesaj), kriz saatlerinde ağ yıldız/dyad topolojisine dönüşüyor. Bu, "iki agent'ın belirli saatte aşırı konuşması" örneğinin tam karşılığı.

---

## Bulgu 4 — Legal'in merkezileşmesi (kriz günü geneli)

Legal-Agent kriz günü 10 round'un 8'inde aktif, toplam ~148 mesaj — en yüksek out-degree ve betweenness. Normal günlerde en aktif node Platform-Trust'tı (round başına 10–17 mesaj). Kriz, hub'ı Platform-Trust'tan Legal'e kaydırıyor (MAC clause, embargo, outside counsel hepsi Legal'den geçiyor). Netvis'te node boyutu/degree karşılaştırmasıyla (normal gün vs 6/5) gösterilebilir.

---

## Sunum önerisi

Netvis'te şu akışla göster: (1) time filter'ı 6/5 09:00–12:00'a al → PT'ye giden ama dönmeyen ok'ları göster, (2) 12:00'ye kaydır → PT'nin 28-mesajlık dönüşü ve Legal-PT dyad'ı, (3) 11:00/18:00 → iki node'luk çökme, (4) yanına ilgili mesaj alıntılarını koy. "Ağda gördüğümüz X deseni, mesajlarda Y olayına karşılık geliyor" cümlesi profun istediği doğrulama.

*Not: recipient alanında bazı mesajlar `pr` olarak etiketlenmiş ama içerikte `@pr-intern` yazıyor (özellikle 17:00–18:00). Netvis edge'leri recipient alanından üretiliyorsa bu saatlerdeki PR→ trafiğinin bir kısmı aslında PR-Intern'e ait — sunumda buna dikkat.*

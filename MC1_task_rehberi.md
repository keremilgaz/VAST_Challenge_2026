# VAST 2026 MC1 — Network Visualization ile Task Çözüm Rehberi

Bu rehber, MC1'in 3 sorusunu bu uygulamadaki network görselleştirmesi (+ heatmap ve timeline) ile nasıl cevaplayacağını adım adım anlatır.

Kısa hatırlatma (senaryo): "Project HarborCrest" birleşmesi 5 Haziran 2046 saat 18:00'e kadar ambargolu. Saat ~17:00'de bilgi FleX'te sızıyor. Soru: kasıtlı sızıntı mı, sistem çöküşü mü?

---

## Task 1 — Sızıntıya giden olay zinciri ve ilişkiler

Amaç: kilit aksiyonları, nedensel ilişkileri ve karar noktalarını görselleştirmek.

1. **Merger-only filtreyi aç** (heatmap panelinde "Merger-related only"). Heatmap'te merger trafiğinin hangi ajanlarda ve saatlerde yoğunlaştığını gör — bu senin olay iskeletin.
2. Network'te **"Follow timeline"** kutusunu işaretle ve timeline'da **Play**'e bas. Reply grafiğinin round round nasıl büyüdüğünü izle: hangi edge'ler geç ortaya çıkıyor? Son gün (5 Haziran) aniden beliren edge'ler = yeni davranış adayları.
3. Şüpheli bir edge'e **tıkla** → altta o bağlantının gerçek mesajları açılır. Bir mesaja tıklayıp **Conversation Flow** ile thread'i baştan sona oku. `responding_to` + `recipients` çözümlemesi sayesinde "@pr" gibi rol-hedefli mesajlar da doğru zincire bağlanır — nedensel zinciri buradan kurarsın.
4. **Karar noktaları**: Judge (compliance) node'una gelen/giden edge'lere odaklan. Judge'ın onayladığı/reddettiği mesajlar ve buna rağmen `official_post` / `public_post` kanalına düşen içerik, "ambargo denetimini geçen karar"ın kendisidir. Edge renkleri kanal bazlı olduğu için Judge → PR hattında hangi kanalın kullanıldığı doğrudan okunur.
5. **Ajay (inferred) toggle'ını aç** ve **"Ajay's hints timeline"** butonunu kullan: CEO'nun imaları kronolojik okunur ("strategic developments" → "stays among the senior team" → "career-defining good"). Bu, üstten gelen baskı/işaret zincirini kanıtlar.

Sunum için: timeline'ın belirli round'larında network'ün ekran görüntülerini alıp "storyboard" olarak dizmek, Task 1'in "sequence of events" beklentisini birebir karşılar.

## Task 2 — Tipik davranış vs. sızıntı davranışı

Amaç: normal dönem davranış profilini çıkarıp son günle karşılaştırmak.

1. **Baseline penceresi kur**: Network panelinde "Follow timeline" kapalıyken **Time range**'e ilk hafta(ları) gir (ör. 22 Mayıs – 3 Haziran). Node boyutları, edge kalınlıkları ve kanal dağılımını not et: kim kiminle, hangi kanalda, ne sıklıkta konuşuyor?
2. Aynı grafiği **son 24–48 saat** için tekrar çiz (5 Haziran). Farklar tipik-vs-yeni davranışın kendisidir: yeni edge'ler, kanal değişimi (comms_huddle → side_huddle / one_on_one / anonymous_post), edge kalınlığı sıçramaları.
3. **Side-by-side** modunu aç: heatmap (tüm dönem) + network (dar pencere) aynı ekranda — jüriye karşılaştırmayı tek görüntüde verirsin.
4. Heatmap'te **Semantic change** modu: bir ajanın bir saatteki mesaj içeriği önceki saatten ne kadar sapmış? Koyu mor hücreler = konuşma konusunun aniden değiştiği anlar. **Sort agent rows → Total/Sentiment** ile en anormal ajanları üste al; "Mirror heatmap filters" açıkken network node'larındaki #1…#N rozetleri bu sıralamayı takip eder.
5. **BERT sentiment** modu + line chart (stock price & market sentiment): iç iletişim tonunun piyasa olaylarıyla (SaltWind haberleri, #AlgorithmicEviction) nasıl korele olduğunu göster.

## Task 3 — Öncü göstergeler (leading indicators)

Amaç: "beklenen davranış"tan sapan önceki olayları bulmak ve neden aksiyon alınmadığını açıklamak.

1. **anonymous_post kanalı**: Network'te kırmızı (anon_post) edge'leri filtrele (Network filters → Message type). Somut bulgu: veri setindeki 12 anonim postun tamamı **legal_agent**'tan geliyor — resmi rolü "hukuki koruma" olan bir ajanın anonim kanal kullanması, beklenen davranıştan sapmanın en net örneği ve erken bir sinyal.
2. **side_huddle / one_on_one trafiği**: erken tarihlerde de bu kanallarda merger-keyword'lü mesaj var mı? Keyword search'e `embargo`, `harborcrest`, `civicloom` yazıp timeline'ı erken round'lara çek. Erken eşleşmeler = "önceki benzer davranış" kanıtı.
3. **Ajay hints timeline**: imaların şiddeti zamanla artıyor; erken imalar da vardı ama muğlaktı. Bu, "neden önceki olaylar fark edilmedi?" sorusunun cevabının bir parçası: sinyaller tek tek zayıf, ancak kronolojik dizildiğinde örüntü net.
4. **Judge'ın geçmiş kararları**: Judge'a giden edge'lerin mesajlarını erken dönemde oku. Judge'ın benzer içeriği daha önce yakalayıp yakaladığı, ya da sınırda içeriğe onay verdiği durumlar "sistem neden son olayda da durdurmadı"nın açıklamasıdır (ör. kelime bazlı denetimin ima/parafraz karşısında körlüğü).
5. **Semantic change + sentiment birleşimi**: sızıntıdan önceki günlerde aynı ajanda tekrarlayan "içerik sapması + negatif ton" hücreleri = tekrar eden ama eskale edilmemiş anomaliler. "Prior occasions didn't result in action" argümanını bu hücrelere tıklayıp mesajları göstererek desteklersin.

## Önerilen anlatı iskeleti

Baseline (normal reply-graph) → erken sinyaller (anonim postlar, erken merger sohbeti, Ajay imaları) → eskalasyon (side_huddle yoğunlaşması, semantic sapma) → karar noktası (Judge'ı geçen mesaj) → sızıntı (public_post, 5 Haziran ~17:00) → sonuç: kasıt mı arıza mı sorusuna kanıta dayalı cevap.

Cevap formu: https://docs.google.com/forms/d/e/1FAIpQLSd60Qz4rzitnhdlEJRDjuwyDrI09K61D3fs4cOLkC48IujAoQ/viewform

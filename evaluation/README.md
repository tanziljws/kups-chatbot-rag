# Evaluasi chatbot

`questions.jsonl` saat ini berisi 20 kasus untuk memeriksa sumber, parafrasa/typo, jawaban dasar, konteks lanjutan, ambiguitas, dan pertanyaan yang harus ditahan. Jalankan API chatbot terlebih dahulu, lalu `npm run evaluate`; evaluator menguji endpoint UI `/api/chat`, termasuk riwayat percakapan bila tersedia. Jika terkena rate limit, evaluator menunggu sebelum mencoba ulang.

Setiap baris dapat memeriksa `expectedSourceId`, `expectedResponseKind` (`answer`, `clarification`, `catalog`, atau `handoff`), `expectedCatalogType`, `expectNoSources`, dan `mustNotInclude`, selain sumber URL, frasa konsep, serta status klarifikasi. `clarification` berarti chatbot menandai bahwa konteks/jawaban belum final; jawaban tersebut tetap boleh memuat sumber yang relevan. Hasil katalog harus menyertakan tipe dan URL sumber pada setiap item.

Smoke evaluation lulus bukan bukti otomatis bahwa jawaban benar secara substansi. Sebelum pilot, perluas menjadi 50–100 pertanyaan yang ditinjau orang yang memahami Perhutanan Sosial. Setiap kasus sebaiknya memuat jawaban acuan dan alasan penilaian, serta mencakup typo, singkatan, data dinamis, pertanyaan di luar cakupan, dan sumber yang berbeda versi. Tinjau jawaban secara manual.

# Chatbot informasi KUPS

Service chatbot berbasis alur deterministik. Tidak memakai LLM untuk memahami pertanyaan maupun membuat jawaban. Intent dikenali dengan normalisasi teks, aturan, kata kunci dan sinonim; pertanyaan yang belum jelas diarahkan ke klarifikasi. Jawaban informasi memakai FAQ/aturan yang dikurasi dan pencarian dokumen klasik, sedangkan profil KUPS, produk, wisata, publikasi, dan statistik dicari langsung melalui API publik KUPS-Web.

## Menjalankan lokal

1. Salin `.env.example` ke `.env.local`, lalu isi `KUPS_WEB_API_KEY` dengan nilai yang sama dengan `CHATBOT_API_KEY` di KUPS-Web.
2. Jalankan KUPS-Web di port 3000 dan pastikan `CHATBOT_API_BASE_URL=http://127.0.0.1:4001` di konfigurasi KUPS-Web.
3. Jalankan `npm install`, lalu `npm run ingest` untuk membangun indeks dokumen lokal.
4. Jalankan `npm run dev`. Service tersedia di `http://127.0.0.1:4001`; widget KUPS-Web meneruskan permintaan lewat BFF same-origin.

## Cara kerja

- Sapaan, identitas, definisi KUPS/KPS/PS, panduan pendaftaran, manfaat, kelayakan awal, dan triase konsultasi ditangani oleh intent/rule engine serta jawaban terkurasi.
- Kamus kata kunci dan sinonim di `src/lib/chatbot/catalog.ts` membantu menangani variasi bahasa untuk pencarian katalog.
- Data publik diproses sebagai pencarian terstruktur ke API KUPS-Web. Kartu listing dan sumber berasal langsung dari hasil API.
- `Xenova/all-MiniLM-L6-v2` ONNX opsional dipakai hanya untuk mencari potongan FAQ/dokumen yang relevan. Encoder tidak membuat atau mengubah jawaban. Bila retrieval tidak yakin, bot meminta konteks tambahan.
- Riwayat singkat dipakai untuk beberapa jawaban lanjutan; tidak ada panggilan ke Ollama, llama.cpp, OpenAI, atau layanan generatif.
- Service tidak menerima URI database dan tidak tersambung langsung ke MongoDB. Data katalog diambil melalui endpoint server KUPS-Web.

Materi hanya boleh ditambahkan ke `knowledge/approved` setelah sumbernya dipastikan publik dan layak dipakai. Dokumen KUPS-COMPASS tidak menjadi materi jawaban publik.

## Konfigurasi dan batasan

`KUPS_WEB_CATALOG_URL` dan `KUPS_WEB_API_KEY` menghubungkan service ke endpoint katalog internal KUPS-Web. API key hanya disimpan di server. `EMBEDDING_MODEL` dapat dihilangkan jika hanya ingin memakai aturan dan FAQ terkurasi, tetapi pencarian potongan dokumen membutuhkan indeks serta model encoder yang tersedia.

Bot menjawab berdasarkan cakupan aturan/FAQ dan data publik yang disediakan endpoint. Ia tidak menetapkan status resmi KUPS, menjamin bantuan, atau menebak ketika data tidak tersedia. Perluas sinonim dan FAQ terkurasi jika variasi pertanyaan nyata belum dikenali.

Percakapan disimpan sementara di RAM per sesi. Batas awal endpoint adalah 12 permintaan per IP/session per menit dan 1.000 karakter per pertanyaan.

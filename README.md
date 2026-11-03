# Chatbot informasi KUPS

Service RAG ringan untuk menjawab informasi publik KUPS. LangChain mengatur retrieval dan jawaban; embedding dan indeks vektor berjalan lokal. Pencarian profil KUPS, produk, wisata, publikasi, dan statistik membaca data publik KUPS-Web melalui API internalnya. Aturan dan definisi resmi tetap memakai indeks RAG lokal. Service ini tidak memakai MongoDB Atlas atau pgvector.

## Prasyarat

- Node.js 20.9 atau lebih baru.
- KUPS-Web berjalan di `http://127.0.0.1:3000` dan punya `CHATBOT_API_KEY` di `.env.local`.
- LLM lokal yang menyediakan OpenAI-compatible API. Untuk target server 2 GB, gunakan model kecil Q4 melalui `llama.cpp`, satu slot, dan konteks 2.048 token.
- RAM gabungan aplikasi dan model harus diukur pada server target. Batas rilis tetap sekitar 1,6 GiB; hentikan peluncuran bila melebihi batas atau OOM.

## Menjalankan lokal

1. Salin `.env.example` ke `.env.local`. Isi `KUPS_WEB_API_KEY` dengan nilai `CHATBOT_API_KEY` yang sama dari KUPS-Web. Simpan semua secret di env server saja.
2. Jalankan KUPS-Web di port 3000 dan pastikan `CHATBOT_API_BASE_URL=http://127.0.0.1:4001` pada env KUPS-Web.
3. Untuk development, jalankan `ollama serve` dan `ollama pull qwen3:0.6b`; `.env.local` memakai endpoint Ollama di port 11434. Untuk server produksi 2 GB, gunakan model Q4 lewat `llama.cpp` dengan launcher `LLAMA_MODEL_PATH=./models/qwen3-0.6b-q4.gguf npm run model`, lalu ubah `LOCAL_LLM_BASE_URL` ke port 8081.
4. Jalankan `npm install` lalu `npm run ingest`. Perintah ini mengunduh encoder ONNX 8-bit saat pertama kali, membagi materi yang disetujui, lalu menyimpan vektor ke `.cache/kups-knowledge-index.json`.
5. Jalankan `npm run retrieval:check` untuk melihat hasil pencarian, kemudian `npm run dev`. Chatbot akan tersedia di `http://127.0.0.1:4001`; widget pada KUPS-Web mengirim request melalui BFF same-origin-nya.

Sebelum ingest, materi hanya boleh dimasukkan ke `knowledge/approved` setelah sumbernya dipastikan publik dan layak dipakai. Dokumen KUPS-COMPASS tidak dimasukkan sebagai materi jawaban publik.

## Komponen

- `Xenova/all-MiniLM-L6-v2` memakai ONNX `uint8` melalui Transformers.js dan menghasilkan vektor 384 dimensi. Cache model berada di `.cache/huggingface`.
- Indeks vektor lokal adalah JSON berisi teks, metadata sumber, dan embedding. Ia dimuat ke memori ketika retrieval pertama kali dijalankan; ingestion perlu dijalankan ulang setelah materi atau encoder berubah.
- LLM lokal menjawab berdasarkan potongan sumber yang lolos ambang kemiripan. Jika bukti tidak cukup, chatbot meminta klarifikasi.
- Pertanyaan tentang profil, produk, wisata, publikasi, dan statistik diarahkan ke API internal KUPS-Web. API itu memakai layanan query situs yang menyaring profil KUPS publik, produk approved, wisata published, publikasi published, serta statistik agregat.
- Pertanyaan usaha yang masih ambigu akan diklarifikasi dulu. Jika konteksnya cukup, chatbot dapat menampilkan contoh listing publik yang relevan dan bertanya satu hal lanjut untuk mengarahkan bantuan.
- Website tetap memakai database miliknya untuk katalog; service chatbot tidak menerima URI database dan tidak membuat koneksi langsung ke MongoDB.

`all-MiniLM-L6-v2` awalnya dilatih terutama pada data bahasa Inggris. Karena pertanyaan pengguna KUPS berbahasa Indonesia, hasil retrieval perlu dievaluasi dengan istilah, typo, singkatan, dan nama daerah yang nyata. Jangan menganggap target kualitas tercapai hanya karena indeks berhasil dibuat.

## Integrasi KUPS-Web

Widget memanggil `/api/chatbot/ask` di KUPS-Web. BFF server KUPS-Web meneruskan permintaan ke `http://127.0.0.1:4001/api/chat/ask`; API key katalog hanya digunakan dari service chatbot ke `/api/chatbot/catalog` dan tidak dikirim ke browser.

Untuk produksi, arahkan BFF ke upstream HTTPS internal dan isi URL katalog yang bisa dijangkau server chatbot. Jangan menaruh URL berkredensial atau API key di variabel `NEXT_PUBLIC_*`.

## Evaluasi dan batasan

Jalankan `npm test`, `npm run typecheck`, `npm run retrieval:check`, lalu `npm run evaluate` dengan LLM dan website aktif. `evaluation/questions.jsonl` masih berupa seed set; lengkapi menjadi 50–100 pertanyaan acuan dan tinjau jawaban beserta sumber secara manual sebelum pilot. Target awal tetap sedikitnya 85% jawaban faktual tepat dan tersumber. Jalankan `npm run memory:check` di host target; layanan model dan web bersama-sama harus berada di bawah sekitar 1,6 GiB.

Chat tidak menyimpan riwayat ke database. Sampai enam giliran percakapan disimpan sementara di RAM per session selama maksimal 30 menit. Batas awal endpoint adalah 12 permintaan per IP/session per menit dan 1.000 karakter per pertanyaan. Konfigurasikan ulang bila jumlah instance atau reverse proxy berbeda.

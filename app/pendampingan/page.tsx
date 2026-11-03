export default function MentoringPage() {
  return (
    <main className="app-shell">
      <header className="topbar">
        <a className="wordmark" href="/">
          KUPS Konsultasi
        </a>
        <nav className="topbar-links" aria-label="Navigasi utama">
          <a href="/">Semua layanan</a>
          <a href="/riwayat">Riwayat konsultasi</a>
        </nav>
      </header>

      <div className="service-detail-page">
        <a className="back-link" href="/">
          ← Kembali ke layanan
        </a>
        <div className="service-detail-grid">
          <section>
            <p className="eyebrow">DUKUNGAN BERKELANJUTAN</p>
            <h1>Hubungi Pendamping</h1>
            <p className="service-detail-lead">
              Ceritakan perkembangan atau kendala kelompok. Pendamping dapat
              membantu meninjau langkah yang sesuai dengan kondisi dan wilayah
              KUPS.
            </p>
            <div className="service-detail-note">
              <span>01</span>
              <p>
                Bagikan nama kelompok, kabupaten/kota, dan hal yang ingin
                dibantu.
              </p>
            </div>
            <div className="service-detail-note">
              <span>02</span>
              <p>
                Permintaan masuk ke antrean tim. Pendamping membalas melalui
                chat privat.
              </p>
            </div>
            <div className="service-detail-note">
              <span>03</span>
              <p>
                Catatan dan langkah tindak lanjut disimpan di riwayat pada
                browser ini.
              </p>
            </div>
            <a
              className="send-button service-detail-button"
              href="/chat?service=mentor&new=1"
            >
              Ceritakan kebutuhan kelompok <span aria-hidden="true">→</span>
            </a>
          </section>
          <aside className="service-detail-aside">
            <span className="one-to-one-mark" aria-hidden="true">
              1:1
            </span>
            <h2>Pendampingan berangkat dari situasi kelompok.</h2>
            <p>
              Bidang, identitas pendamping, dan cakupan wilayah akan ditampilkan
              sesuai data tim yang tersedia.
            </p>
          </aside>
        </div>
      </div>
    </main>
  );
}

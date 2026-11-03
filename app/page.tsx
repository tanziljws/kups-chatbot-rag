export default function ServiceHomePage() {
  return (
    <main className="app-shell">
      <header className="topbar">
        <a className="wordmark" href="/">
          KUPS Konsultasi
        </a>
        <nav className="topbar-links" aria-label="Navigasi utama">
          <a href="/chatbot">Chatbot informasi</a>
          <a href="/riwayat">Riwayat konsultasi</a>
          <a href="/operator">
            Masuk konsultan <span aria-hidden="true">↗</span>
          </a>
        </nav>
      </header>

      <div className="service-home">
        <section className="service-home-intro">
          <p className="eyebrow">LAYANAN KONSULTASI & PENDAMPINGAN</p>
          <h1>Arahan usaha yang nyambung dengan kondisi KUPS-mu.</h1>
          <p>
            Pilih bantuan sesuai kebutuhan: bahas kasus khusus dengan ahli, atau
            hubungi pendamping untuk dukungan kelompok.
          </p>
        </section>

        <section className="service-option-grid" aria-label="Pilih layanan">
          <a className="service-option expert-option" href="/konsultasi">
            <div className="service-option-top">
              <span className="service-number">01 / KEAHLIAN SPESIFIK</span>
              <span className="service-option-arrow" aria-hidden="true">
                ↗
              </span>
            </div>
            <div>
              <h2>Konsultasi dengan Ahli</h2>
              <p>
                Untuk pertanyaan teknis dan kasus usaha yang butuh arahan
                spesifik.
              </p>
            </div>
            <ul>
              <li>Pilih bidang ahli</li>
              <li>Ajukan waktu konsultasi</li>
              <li>Chat 1-on-1 dan terima catatan tindak lanjut</li>
            </ul>
            <span className="service-option-cta">
              Jelajahi bidang ahli <span aria-hidden="true">→</span>
            </span>
          </a>

          <a className="service-option mentor-option" href="/pendampingan">
            <div className="service-option-top">
              <span className="service-number">
                02 / DUKUNGAN BERKELANJUTAN
              </span>
              <span className="service-option-arrow" aria-hidden="true">
                ↗
              </span>
            </div>
            <div>
              <h2>Hubungi Pendamping</h2>
              <p>
                Untuk dukungan yang mengikuti kebutuhan kelompok dan wilayahnya.
              </p>
            </div>
            <ul>
              <li>Ceritakan kondisi dan lokasi KUPS</li>
              <li>Terhubung lewat chat 1-on-1</li>
              <li>Susun langkah tindak lanjut bersama</li>
            </ul>
            <span className="service-option-cta">
              Minta dihubungi <span aria-hidden="true">→</span>
            </span>
          </a>
        </section>

        <section className="service-home-footer">
          <div>
            <span className="service-dot" aria-hidden="true" />
            <p>Belum yakin mulai dari mana?</p>
          </div>
          <a href="/chatbot">
            Tanya chatbot informasi KUPS <span aria-hidden="true">↗</span>
          </a>
        </section>
      </div>
    </main>
  );
}

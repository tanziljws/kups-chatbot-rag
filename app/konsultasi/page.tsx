"use client";

import { useEffect, useState } from "react";
import { expertDirectory, type ExpertProfile } from "@/lib/live-chat/directory";

const chatbotSpecialtyToProfile: Record<string, string> = {
  kelembagaan: "kelembagaan-legalitas",
  legalitas: "kelembagaan-legalitas",
  produksi_mutu: "produksi-mutu",
  keuangan: "pengembangan-usaha",
  pembiayaan: "pengembangan-usaha",
  branding: "pemasaran-akses-pasar",
  pemasaran: "pemasaran-akses-pasar",
  digitalisasi: "pemasaran-akses-pasar",
  sdm: "kelembagaan-legalitas",
  iklim: "produksi-mutu",
};
const HANDOFF_KEY = "kups-live-chat-handoff";

function requestUrl(expert: ExpertProfile, summary: string) {
  const params = new URLSearchParams({
    service: "expert",
    expertId: expert.id,
    topic: expert.relatedTopics[0],
    new: "1",
  });
  if (summary) params.set("handoff", "1");
  return `/chat?${params.toString()}`;
}

export default function ConsultationDirectoryPage() {
  const [selectedId, setSelectedId] = useState(expertDirectory[0]?.id ?? "");
  const [summary, setSummary] = useState("");
  const selected =
    expertDirectory.find((expert) => expert.id === selectedId) ??
    expertDirectory[0];

  useEffect(() => {
    const url = new URL(window.location.href);
    const mapped =
      chatbotSpecialtyToProfile[url.searchParams.get("specialty") ?? ""];
    if (mapped) setSelectedId(mapped);
    const querySummary = url.searchParams.get("summary") ?? "";
    const storedSummary =
      url.searchParams.get("handoff") === "1"
        ? (sessionStorage.getItem(HANDOFF_KEY) ?? "")
        : "";
    setSummary((querySummary || storedSummary).slice(0, 1200));
  }, []);

  return (
    <main className="app-shell">
      <header className="topbar">
        <a className="wordmark" href="/">
          KUPS Konsultasi
        </a>
        <nav className="topbar-links" aria-label="Navigasi utama">
          <a href="/">Semua layanan</a>
          <a href="/riwayat">Riwayat konsultasi</a>
          <a href="/chatbot">Chatbot informasi</a>
        </nav>
      </header>

      <div className="directory-page">
        <a className="back-link" href="/">
          ← Kembali ke layanan
        </a>
        <section className="directory-intro">
          <div>
            <p className="eyebrow">KONSULTASI DENGAN AHLI</p>
            <h1>Temukan bidang yang sesuai dengan kebutuhan KUPS.</h1>
          </div>
          <p>
            Pilih bidang konsultasi untuk melihat cakupan bantuan dan mengajukan
            waktu. Tim akan mengonfirmasi ahli serta jadwal sebelum sesi
            berlangsung.
          </p>
        </section>

        {summary && (
          <aside className="handoff-context">
            <span className="handoff-context-mark" aria-hidden="true">
              ↗
            </span>
            <div>
              <strong>Ringkasan dari chatbot</strong>
              <p>{summary}</p>
            </div>
            <button
              type="button"
              className="quiet-button"
              onClick={() => setSummary("")}
            >
              Hapus
            </button>
          </aside>
        )}

        <section
          className="directory-layout"
          aria-label="Bidang konsultasi ahli"
        >
          <div className="directory-list">
            <div className="directory-list-heading">
              <span>Bidang keahlian</span>
              <span>04 pilihan</span>
            </div>
            {expertDirectory.map((expert, index) => (
              <button
                type="button"
                key={expert.id}
                className={`directory-card${selected?.id === expert.id ? " is-selected" : ""}`}
                aria-pressed={selected?.id === expert.id}
                onClick={() => setSelectedId(expert.id)}
              >
                <span className="directory-index">0{index + 1}</span>
                <span className="directory-card-copy">
                  <strong>{expert.title}</strong>
                  <small>{expert.specialties.slice(0, 2).join(" · ")}</small>
                </span>
                <span className="directory-card-arrow" aria-hidden="true">
                  ↗
                </span>
              </button>
            ))}
            <p className="directory-data-note">
              Katalog ini menunjukkan bidang layanan. Data nama ahli,
              pengalaman, wilayah, dan jam konsultasi belum terhubung.
            </p>
          </div>

          {selected && (
            <article className="expert-profile">
              <div className="profile-topline">
                <span className="profile-monogram" aria-hidden="true">
                  K
                </span>
                <span className="profile-type">PROFIL BIDANG</span>
              </div>
              <p className="eyebrow">KONSULTASI SESUAI PERMINTAAN</p>
              <h2>{selected.title}</h2>
              <p className="expert-description">{selected.description}</p>
              <div className="profile-divider" />
              <h3>Topik yang bisa dibahas</h3>
              <ul className="expert-specialties">
                {selected.specialties.map((specialty) => (
                  <li key={specialty}>{specialty}</li>
                ))}
              </ul>
              <div className="profile-facts">
                <div>
                  <span>Wilayah layanan</span>
                  <strong>Dikonfirmasi oleh tim</strong>
                </div>
                <div>
                  <span>Jadwal</span>
                  <strong>Diajukan oleh pengguna</strong>
                </div>
              </div>
              <p className="profile-availability-note">
                Belum ada jadwal real-time. Waktu yang kamu pilih akan diminta
                kepada tim dan dikonfirmasi di ruang chat.
              </p>
              <a
                className="send-button profile-cta"
                href={requestUrl(selected, summary)}
              >
                Ajukan konsultasi <span aria-hidden="true">→</span>
              </a>
            </article>
          )}
        </section>
      </div>
    </main>
  );
}

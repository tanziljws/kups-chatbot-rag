"use client";

import { useEffect, useState } from "react";
import type { LiveChatSession } from "@/lib/live-chat/store";

type SavedSession = { sessionId: string; token: string; savedAt?: string };
const HISTORY_KEY = "kups-live-chat-history";
const SESSION_KEY = "kups-live-chat-session";

function formatDate(value: string) {
  return new Intl.DateTimeFormat("id-ID", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

export default function ConsultationHistoryPage() {
  const [sessions, setSessions] = useState<LiveChatSession[]>([]);
  const [hasSavedItems, setHasSavedItems] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let records: SavedSession[] = [];
    try {
      records = JSON.parse(
        sessionStorage.getItem(HISTORY_KEY) ?? "[]",
      ) as SavedSession[];
      records = records
        .filter((record) => record.sessionId && record.token)
        .slice(0, 30);
    } catch {
      sessionStorage.removeItem(HISTORY_KEY);
    }
    setHasSavedItems(records.length > 0);
    if (!records.length) {
      setLoading(false);
      return;
    }

    const controller = new AbortController();
    void fetch("/api/live-chat/sessions/history", {
      method: "POST",
      headers: { "content-type": "application/json" },
      cache: "no-store",
      signal: controller.signal,
      body: JSON.stringify({ sessions: records }),
    })
      .then(async (response) => {
        if (!response.ok) throw new Error("Riwayat belum bisa dimuat.");
        setSessions((await response.json()) as LiveChatSession[]);
      })
      .catch(() => setSessions([]))
      .finally(() => setLoading(false));
    return () => controller.abort();
  }, []);

  function reopen(session: LiveChatSession) {
    const history = (() => {
      try {
        return JSON.parse(
          sessionStorage.getItem(HISTORY_KEY) ?? "[]",
        ) as SavedSession[];
      } catch {
        return [];
      }
    })();
    const record = history.find((item) => item.sessionId === session.id);
    if (!record) return;
    sessionStorage.setItem(SESSION_KEY, JSON.stringify(record));
    window.location.href = "/chat";
  }

  return (
    <main className="app-shell">
      <header className="topbar">
        <a className="wordmark" href="/">
          KUPS Konsultasi
        </a>
        <nav className="topbar-links" aria-label="Navigasi utama">
          <a href="/">Semua layanan</a>
          <a href="/konsultasi">Konsultasi ahli</a>
          <a href="/chatbot">Chatbot informasi</a>
        </nav>
      </header>

      <div className="history-page">
        <a className="back-link" href="/">
          ← Kembali ke layanan
        </a>
        <section className="history-heading">
          <div>
            <p className="eyebrow">RUANG PRIBADI</p>
            <h1>Riwayat konsultasi</h1>
          </div>
          <p>
            Permintaan, percakapan, dan catatan tindak lanjut yang tersimpan di
            browser ini.
          </p>
        </section>

        {loading ? (
          <p className="history-empty" role="status">
            Memuat riwayat…
          </p>
        ) : sessions.length ? (
          <div className="history-list">
            {[...sessions]
              .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
              .map((session) => (
                <article className="history-item" key={session.id}>
                  <div className="history-item-top">
                    <span className={`session-status status-${session.status}`}>
                      <span className="service-dot" />
                      {session.status === "closed"
                        ? "Selesai"
                        : session.status === "active"
                          ? "Sedang chat"
                          : "Menunggu"}
                    </span>
                    <time dateTime={session.createdAt}>
                      {formatDate(session.createdAt)}
                    </time>
                  </div>
                  <p className="eyebrow">
                    {session.serviceType === "expert"
                      ? "KONSULTASI AHLI"
                      : "PENDAMPINGAN KUPS"}
                  </p>
                  <h2>{session.topic}</h2>
                  <p className="history-item-summary">
                    {session.intakeSummary}
                  </p>
                  {session.closeSummary && (
                    <div className="history-recommendation">
                      <span>CATATAN & TINDAK LANJUT</span>
                      <p>{session.closeSummary}</p>
                    </div>
                  )}
                  <div className="history-item-footer">
                    <span>
                      {session.expertName ??
                        session.consultantName ??
                        "Tim KUPS"}
                      {session.preferredAt
                        ? ` · Waktu diminta ${formatDate(session.preferredAt)}`
                        : ""}
                    </span>
                    <button
                      className="quiet-button"
                      type="button"
                      onClick={() => reopen(session)}
                    >
                      {session.status === "closed"
                        ? "Lihat percakapan"
                        : "Lanjutkan chat"}{" "}
                      <span aria-hidden="true">→</span>
                    </button>
                  </div>
                </article>
              ))}
          </div>
        ) : (
          <div className="history-empty">
            <span className="empty-index" aria-hidden="true">
              00
            </span>
            <h2>
              {hasSavedItems
                ? "Sesi belum tersedia di server."
                : "Belum ada konsultasi."}
            </h2>
            <p>
              {hasSavedItems
                ? "Riwayat disimpan sementara di browser dan server pengembangan. Sesi yang sudah kedaluwarsa atau hilang saat server dimulai ulang tidak bisa dibuka lagi."
                : "Setelah mengajukan konsultasi atau menghubungi pendamping, percakapan dan catatan tindak lanjut akan muncul di sini."}
            </p>
            <a className="send-button" href="/">
              Pilih layanan <span aria-hidden="true">→</span>
            </a>
          </div>
        )}
        <p className="history-storage-note">
          Untuk prototipe ini, riwayat terikat ke browser dan proses server yang
          sedang berjalan.
        </p>
      </div>
    </main>
  );
}

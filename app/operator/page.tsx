"use client";

import { FormEvent, useEffect, useRef, useState } from "react";
import { followSse, type LiveChatWireEvent } from "@/lib/live-chat/client";
import type {
  LiveChatSession,
  LiveChatSessionSummary,
} from "@/lib/live-chat/store";

const OPERATOR_KEY = "kups-live-chat-operator-token";
const LOCAL_TOKEN =
  process.env.NODE_ENV === "development" ? "local-kups-dev" : "";

function mergeQueueEvent(
  event: LiveChatWireEvent,
  setQueue: (
    value: (current: LiveChatSessionSummary[]) => LiveChatSessionSummary[],
  ) => void,
) {
  if (event.type === "queue" && event.sessions)
    setQueue(() => event.sessions ?? []);
}

export default function OperatorPage() {
  const [token, setToken] = useState("");
  const [tokenDraft, setTokenDraft] = useState("");
  const [ready, setReady] = useState(false);
  const [queue, setQueue] = useState<LiveChatSessionSummary[]>([]);
  const [selectedId, setSelectedId] = useState("");
  const [session, setSession] = useState<LiveChatSession | null>(null);
  const [draft, setDraft] = useState("");
  const [closeSummary, setCloseSummary] = useState("");
  const [showCloseForm, setShowCloseForm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [connected, setConnected] = useState(false);
  const [error, setError] = useState("");
  const messagesRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const saved = sessionStorage.getItem(OPERATOR_KEY) || LOCAL_TOKEN;
    if (saved) {
      setToken(saved);
      setTokenDraft(saved);
      setReady(true);
    }
  }, []);

  useEffect(() => {
    if (!ready || !token) return;
    const controller = new AbortController();
    setConnected(false);
    void fetch("/api/live-chat/operator/queue", {
      headers: { authorization: `Bearer ${token}` },
      cache: "no-store",
      signal: controller.signal,
    })
      .then(async (response) => {
        if (!response.ok) throw new Error("Token konsultan tidak valid.");
        setQueue((await response.json()) as LiveChatSessionSummary[]);
        setError("");
        setConnected(true);
        await followSse(
          (signal) =>
            fetch("/api/live-chat/operator/queue", {
              method: "POST",
              headers: {
                authorization: `Bearer ${token}`,
                accept: "text/event-stream",
              },
              signal,
            }),
          (event) => {
            setConnected(true);
            mergeQueueEvent(event, setQueue);
          },
          () => setConnected(false),
          controller.signal,
        );
      })
      .catch((reason) => {
        if (!controller.signal.aborted) {
          setConnected(false);
          setError(
            reason instanceof Error
              ? reason.message
              : "Antrean belum bisa dimuat.",
          );
        }
      });
    return () => controller.abort();
  }, [ready, token]);

  useEffect(() => {
    if (!ready || !token || !selectedId) {
      setSession(null);
      return;
    }
    const controller = new AbortController();
    setSession(null);
    void followSse(
      (signal) =>
        fetch(`/api/live-chat/sessions/${selectedId}/events`, {
          method: "POST",
          headers: {
            authorization: `Bearer ${token}`,
            accept: "text/event-stream",
          },
          signal,
        }),
      (event) => {
        if (
          (event.type === "snapshot" || event.type === "status") &&
          event.session
        ) {
          setSession(event.session);
          if (event.session.status === "closed") controller.abort();
        }
        if (event.type === "message" && event.message) {
          const message = event.message;
          setSession((current) =>
            current && current.messages.some((item) => item.id === message.id)
              ? current
              : current
                ? { ...current, messages: [...current.messages, message] }
                : current,
          );
        }
      },
      () =>
        setError("Koneksi percakapan terputus. Sedang menyambungkan ulang…"),
      controller.signal,
    ).catch((reason) => {
      if (!controller.signal.aborted)
        setError(
          reason instanceof Error
            ? reason.message
            : "Percakapan tidak tersedia.",
        );
    });
    return () => controller.abort();
  }, [ready, selectedId, token]);

  useEffect(() => {
    const container = messagesRef.current;
    if (container) container.scrollTop = container.scrollHeight;
  }, [session?.messages, session?.status]);

  async function enterOperator(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const value = tokenDraft.trim();
    if (!value) return;
    sessionStorage.setItem(OPERATOR_KEY, value);
    setToken(value);
    setReady(true);
    setError("");
  }

  async function updateStatus(action: "claim" | "close") {
    if (!session) return;
    if (action === "close" && closeSummary.trim().length < 12) {
      setError(
        "Tulis ringkasan dan langkah lanjut sebelum menyelesaikan konsultasi.",
      );
      return;
    }
    setBusy(true);
    setError("");
    try {
      const response = await fetch(
        `/api/live-chat/operator/sessions/${session.id}?action=${action}`,
        {
          method: "POST",
          headers: {
            authorization: `Bearer ${token}`,
            ...(action === "close"
              ? { "content-type": "application/json" }
              : {}),
          },
          ...(action === "close"
            ? { body: JSON.stringify({ summary: closeSummary.trim() }) }
            : {}),
        },
      );
      const payload = (await response.json()) as LiveChatSession & {
        error?: string;
      };
      if (!response.ok)
        throw new Error(payload.error ?? "Status konsultasi belum berubah.");
      setSession(payload);
      if (action === "close") setShowCloseForm(false);
    } catch (reason) {
      setError(
        reason instanceof Error
          ? reason.message
          : "Status konsultasi belum berubah.",
      );
    } finally {
      setBusy(false);
    }
  }

  async function sendMessage(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const text = draft.trim();
    if (!session || !text || session.status !== "active" || busy) return;
    setBusy(true);
    try {
      const response = await fetch(
        `/api/live-chat/sessions/${session.id}/messages`,
        {
          method: "POST",
          headers: {
            "content-type": "application/json",
            authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({ text }),
        },
      );
      const payload = (await response.json()) as { error?: string };
      if (!response.ok)
        throw new Error(payload.error ?? "Pesan belum terkirim.");
      setDraft("");
      setError("");
    } catch (reason) {
      setError(
        reason instanceof Error ? reason.message : "Pesan belum terkirim.",
      );
    } finally {
      setBusy(false);
    }
  }

  function signOut() {
    sessionStorage.removeItem(OPERATOR_KEY);
    setReady(false);
    setToken("");
    setTokenDraft("");
    setQueue([]);
    setSelectedId("");
    setSession(null);
  }

  if (!ready) {
    return (
      <main className="app-shell">
        <header className="topbar">
          <a className="wordmark" href="/">
            KUPS Konsultasi
          </a>
          <span className="topbar-caption">Panel konsultan</span>
        </header>
        <section className="operator-login">
          <p className="eyebrow">AREA KONSULTAN</p>
          <h1>Masuk ke antrean.</h1>
          <p className="intro-lead">
            Gunakan token akses konsultan untuk melihat dan menangani konsultasi
            pengunjung.
          </p>
          <form className="start-form" onSubmit={enterOperator}>
            <label htmlFor="operator-token">Token akses</label>
            <input
              id="operator-token"
              type="password"
              autoComplete="current-password"
              value={tokenDraft}
              onChange={(event) => setTokenDraft(event.target.value)}
              required
            />
            {error && (
              <p className="live-error" role="alert">
                {error}
              </p>
            )}
            <button className="send-button start-chat-button" type="submit">
              Masuk konsultan <span aria-hidden="true">→</span>
            </button>
          </form>
        </section>
      </main>
    );
  }

  const waiting = queue.filter((item) => item.status === "waiting");
  const active = queue.filter((item) => item.status === "active");

  return (
    <main className="operator-shell">
      <header className="topbar operator-topbar">
        <a className="wordmark" href="/">
          KUPS Konsultasi
        </a>
        <div className="operator-topbar-actions">
          <span className="connection-state">
            <span
              className={`service-dot${connected ? " is-online" : " is-offline"}`}
            />
            {connected ? "Antrean live" : "Menyambungkan"}
          </span>
          <button className="quiet-button" type="button" onClick={signOut}>
            Keluar
          </button>
        </div>
      </header>
      <div className="operator-layout">
        <aside className="queue-panel">
          <div className="queue-heading">
            <div>
              <p className="eyebrow">KONSULTASI MASUK</p>
              <h1>Antrean</h1>
            </div>
            <span className="queue-count">{waiting.length}</span>
          </div>
          <p className="queue-description">
            Ambil sesi untuk menghubungkan pengunjung satu lawan satu.
          </p>
          {!!error && (
            <p className="live-error" role="alert">
              {error}
            </p>
          )}
          <div className="queue-section">
            <h2>
              Menunggu <span>{waiting.length}</span>
            </h2>
            {waiting.length ? (
              waiting.map((item) => (
                <button
                  type="button"
                  className={`queue-item${selectedId === item.id ? " is-selected" : ""}`}
                  key={item.id}
                  onClick={() => setSelectedId(item.id)}
                >
                  <span className="queue-item-top">
                    <strong>{item.visitorName}</strong>
                    <time>
                      {new Intl.DateTimeFormat("id-ID", {
                        hour: "2-digit",
                        minute: "2-digit",
                      }).format(new Date(item.createdAt))}
                    </time>
                  </span>
                  <span className="queue-service-label">
                    {item.serviceType === "expert"
                      ? (item.expertName ?? "Konsultasi ahli")
                      : "Pendampingan KUPS"}
                    {item.preferredAt &&
                      ` · ${new Intl.DateTimeFormat("id-ID", { dateStyle: "short", timeStyle: "short" }).format(new Date(item.preferredAt))}`}
                  </span>
                  <span>{item.topic}</span>
                  <span className="queue-last-message">
                    {item.lastMessage?.text ?? "Belum ada pesan"}
                  </span>
                </button>
              ))
            ) : (
              <p className="queue-empty">Belum ada pengunjung yang menunggu.</p>
            )}
          </div>
          <div className="queue-section active-queue-section">
            <h2>
              Sedang ditangani <span>{active.length}</span>
            </h2>
            {active.length ? (
              active.map((item) => (
                <button
                  type="button"
                  className={`queue-item${selectedId === item.id ? " is-selected" : ""}`}
                  key={item.id}
                  onClick={() => setSelectedId(item.id)}
                >
                  <span className="queue-item-top">
                    <strong>{item.visitorName}</strong>
                    <span className="active-indicator">Aktif</span>
                  </span>
                  <span className="queue-service-label">
                    {item.serviceType === "expert"
                      ? (item.expertName ?? "Konsultasi ahli")
                      : "Pendampingan KUPS"}
                    {item.preferredAt &&
                      ` · ${new Intl.DateTimeFormat("id-ID", { dateStyle: "short", timeStyle: "short" }).format(new Date(item.preferredAt))}`}
                  </span>
                  <span>{item.topic}</span>
                  <span className="queue-last-message">
                    {item.lastMessage?.text ?? "Percakapan berjalan"}
                  </span>
                </button>
              ))
            ) : (
              <p className="queue-empty">Belum ada sesi aktif.</p>
            )}
          </div>
        </aside>

        <section className="operator-chat" aria-label="Percakapan konsultan">
          {!selectedId || !session ? (
            <div className="operator-empty">
              <div className="operator-empty-mark" aria-hidden="true">
                ↗
              </div>
              <h2>Pilih konsultasi</h2>
              <p>
                Pilih pengunjung dari antrean untuk membuka percakapan langsung.
              </p>
            </div>
          ) : (
            <>
              <div className="operator-chat-heading">
                <div>
                  <p className="eyebrow">{session.topic}</p>
                  <h2>{session.visitorName}</h2>
                  <p>
                    {[
                      session.serviceType === "expert"
                        ? (session.expertName ?? "Konsultasi ahli")
                        : "Pendampingan KUPS",
                      session.groupName,
                      session.area,
                      session.preferredAt
                        ? `Waktu diminta ${new Intl.DateTimeFormat("id-ID", { dateStyle: "medium", timeStyle: "short" }).format(new Date(session.preferredAt))}`
                        : undefined,
                    ]
                      .filter(Boolean)
                      .join(" · ") ||
                      (session.status === "waiting"
                        ? "Menunggu konsultan mengambil sesi"
                        : session.status === "active"
                          ? "Percakapan satu lawan satu"
                          : "Konsultasi selesai")}
                  </p>
                </div>
                {session.status === "waiting" && (
                  <button
                    type="button"
                    className="send-button"
                    onClick={() => void updateStatus("claim")}
                    disabled={busy}
                  >
                    Ambil konsultasi <span aria-hidden="true">→</span>
                  </button>
                )}
                {session.status === "active" && !showCloseForm && (
                  <button
                    type="button"
                    className="quiet-button"
                    onClick={() => setShowCloseForm(true)}
                    disabled={busy}
                  >
                    Selesaikan sesi
                  </button>
                )}
              </div>
              {session.status === "waiting" && (
                <div className="queue-notice">
                  <strong>Ringkasan kebutuhan</strong>
                  <span>{session.intakeSummary}</span>
                </div>
              )}
              <div
                className="live-messages operator-messages"
                ref={messagesRef}
                role="log"
                aria-live="polite"
                aria-relevant="additions text"
              >
                {session.messages.length === 0 && (
                  <div className="empty-chat">
                    <p>
                      Pengunjung belum mengirim pesan. Mulai percakapan dengan
                      menyapanya.
                    </p>
                  </div>
                )}
                {session.messages.map((message) => (
                  <article
                    className={`live-message ${message.sender === "consultant" ? "from-visitor" : "from-consultant"}`}
                    key={message.id}
                  >
                    <p className="message-label">
                      {message.sender === "consultant"
                        ? "Kamu · konsultan"
                        : session.visitorName}
                      <time>
                        {new Intl.DateTimeFormat("id-ID", {
                          hour: "2-digit",
                          minute: "2-digit",
                        }).format(new Date(message.sentAt))}
                      </time>
                    </p>
                    <p className="message-content">{message.text}</p>
                  </article>
                ))}
              </div>
              {showCloseForm && session.status === "active" && (
                <form
                  className="close-session-form"
                  onSubmit={(event) => {
                    event.preventDefault();
                    void updateStatus("close");
                  }}
                >
                  <label htmlFor="close-summary">
                    Ringkasan konsultasi dan langkah lanjut
                  </label>
                  <textarea
                    id="close-summary"
                    value={closeSummary}
                    onChange={(event) => setCloseSummary(event.target.value)}
                    maxLength={1200}
                    rows={3}
                    placeholder="Tulis poin yang disepakati dan siapa melakukan apa…"
                    required
                    minLength={12}
                  />
                  <div>
                    <button
                      className="quiet-button"
                      type="button"
                      onClick={() => setShowCloseForm(false)}
                    >
                      Kembali ke chat
                    </button>
                    <button
                      className="send-button"
                      type="submit"
                      disabled={busy}
                    >
                      {busy ? "Menyimpan…" : "Selesaikan & kirim ringkasan"}
                    </button>
                  </div>
                </form>
              )}
              {session.status === "closed" && session.closeSummary && (
                <div className="consultation-outcome">
                  <p className="eyebrow">RINGKASAN & TINDAK LANJUT</p>
                  <p>{session.closeSummary}</p>
                </div>
              )}
              {session.status === "active" && (
                <form className="live-composer" onSubmit={sendMessage}>
                  <label className="visually-hidden" htmlFor="operator-message">
                    Balas pengunjung
                  </label>
                  <textarea
                    id="operator-message"
                    value={draft}
                    onChange={(event) => setDraft(event.target.value)}
                    placeholder="Tulis balasan…"
                    rows={2}
                    maxLength={2000}
                    disabled={busy}
                    onKeyDown={(event) => {
                      if (event.key === "Enter" && !event.shiftKey) {
                        event.preventDefault();
                        event.currentTarget.form?.requestSubmit();
                      }
                    }}
                  />
                  <div className="live-composer-footer">
                    <span>
                      Enter untuk kirim · Shift + Enter untuk baris baru
                    </span>
                    <button
                      className="send-button"
                      type="submit"
                      disabled={!draft.trim() || busy}
                    >
                      {busy ? "Mengirim…" : "Kirim"}
                    </button>
                  </div>
                </form>
              )}
            </>
          )}
        </section>
      </div>
      {process.env.NODE_ENV === "development" && (
        <p className="dev-note">
          Sesi lokal disimpan di memori server. Token konsultan lokal:{" "}
          <code>local-kups-dev</code>.
        </p>
      )}
    </main>
  );
}

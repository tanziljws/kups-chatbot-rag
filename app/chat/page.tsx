"use client";

import { FormEvent, useEffect, useRef, useState } from "react";
import { followSse, type LiveChatWireEvent } from "@/lib/live-chat/client";
import { findExpert } from "@/lib/live-chat/directory";
import type { LiveChatService, LiveChatSession } from "@/lib/live-chat/store";

type SavedSession = { sessionId: string; token: string };
type SavedHistoryItem = SavedSession & { savedAt: string };
const SESSION_KEY = "kups-live-chat-session";
const HISTORY_KEY = "kups-live-chat-history";
const HANDOFF_KEY = "kups-live-chat-handoff";
const topics = [
  {
    label: "Pemasaran & akses pasar",
    detail: "Menemukan pembeli, kanal jual, dan strategi pemasaran.",
  },
  {
    label: "Produksi & mutu",
    detail: "Meningkatkan kapasitas, kualitas, dan konsistensi produk.",
  },
  {
    label: "Kelembagaan KUPS",
    detail: "Menguatkan peran anggota dan pengelolaan kelompok.",
  },
  {
    label: "Modal & rencana usaha",
    detail: "Menyusun kebutuhan modal dan langkah pengembangan.",
  },
  {
    label: "Merek & kemasan",
    detail: "Membuat produk lebih siap dikenalkan ke pasar.",
  },
  {
    label: "Belum yakin",
    detail: "Ceritakan situasinya, kita petakan bersama.",
  },
];

function localDateTimeValue(timestamp: number) {
  const date = new Date(timestamp);
  date.setMinutes(date.getMinutes() - date.getTimezoneOffset());
  return date.toISOString().slice(0, 16);
}

function applySessionEvent(
  event: LiveChatWireEvent,
  setSession: (
    value: (current: LiveChatSession | null) => LiveChatSession | null,
  ) => void,
) {
  if ((event.type === "snapshot" || event.type === "status") && event.session) {
    setSession(() => event.session ?? null);
  } else if (event.type === "message" && event.message) {
    const message = event.message;
    setSession((current) =>
      current && current.messages.some((item) => item.id === message.id)
        ? current
        : current
          ? { ...current, messages: [...current.messages, message] }
          : current,
    );
  }
}

export default function HomePage() {
  const [visitorName, setVisitorName] = useState("");
  const [topic, setTopic] = useState(topics[0].label);
  const [serviceType, setServiceType] = useState<LiveChatService>("mentor");
  const [expertId, setExpertId] = useState("");
  const [preferredTime, setPreferredTime] = useState("");
  const [minimumPreferredTime, setMinimumPreferredTime] = useState("");
  const [area, setArea] = useState("");
  const [groupName, setGroupName] = useState("");
  const [intakeSummary, setIntakeSummary] = useState("");
  const [startStep, setStartStep] = useState<"topic" | "details">("topic");
  const [session, setSession] = useState<LiveChatSession | null>(null);
  const [sessionToken, setSessionToken] = useState("");
  const [draft, setDraft] = useState("");
  const [isStarting, setIsStarting] = useState(false);
  const [isSending, setIsSending] = useState(false);
  const [connection, setConnection] = useState<
    "connecting" | "online" | "offline"
  >("connecting");
  const [error, setError] = useState("");
  const messagesRef = useRef<HTMLDivElement>(null);
  const stickToBottomRef = useRef(true);

  useEffect(() => {
    setMinimumPreferredTime(localDateTimeValue(Date.now() + 60 * 60 * 1000));
    const url = new URL(window.location.href);
    const linkedService = url.searchParams.get("service");
    const linkedExpertId = url.searchParams.get("expertId") ?? "";
    const linkedTopic = url.searchParams.get("topic") ?? "";
    const linkedSummary =
      url.searchParams.get("summary") ??
      (url.searchParams.get("handoff") === "1"
        ? (sessionStorage.getItem(HANDOFF_KEY) ?? "")
        : "");
    const isNewRequest = url.searchParams.get("new") === "1";

    if (linkedService === "expert" || linkedService === "mentor")
      setServiceType(linkedService);
    if (findExpert(linkedExpertId)) {
      setExpertId(linkedExpertId);
      setServiceType("expert");
    }
    if (linkedTopic) setTopic(linkedTopic.slice(0, 120));
    if (linkedSummary) setIntakeSummary(linkedSummary.slice(0, 1200));
    if (linkedService || linkedExpertId || linkedSummary)
      setStartStep("details");

    if (isNewRequest) {
      sessionStorage.removeItem(HANDOFF_KEY);
      url.searchParams.delete("handoff");
      url.searchParams.delete("new");
      window.history.replaceState(null, "", `${url.pathname}${url.search}`);
      return;
    }

    const raw = sessionStorage.getItem(SESSION_KEY);
    if (!raw) return;
    try {
      const saved = JSON.parse(raw) as SavedSession;
      if (!saved.sessionId || !saved.token) throw new Error("Invalid session");
      const controller = new AbortController();
      void fetch(`/api/live-chat/sessions/${saved.sessionId}`, {
        headers: { authorization: `Bearer ${saved.token}` },
        cache: "no-store",
        signal: controller.signal,
      })
        .then(async (response) => {
          if (!response.ok) throw new Error("Sesi lama sudah tidak tersedia.");
          const restored = (await response.json()) as LiveChatSession;
          setSession(restored);
          setSessionToken(saved.token);
        })
        .catch(() => {
          if (!controller.signal.aborted)
            sessionStorage.removeItem(SESSION_KEY);
        });
      return () => controller.abort();
    } catch {
      sessionStorage.removeItem(SESSION_KEY);
    }
  }, []);

  useEffect(() => {
    if (!session || !sessionToken) return;
    const controller = new AbortController();
    setConnection("connecting");
    void followSse(
      (signal) =>
        fetch(`/api/live-chat/sessions/${session.id}/events`, {
          method: "POST",
          headers: {
            authorization: `Bearer ${sessionToken}`,
            accept: "text/event-stream",
          },
          signal,
        }),
      (event) => {
        setConnection("online");
        if (
          (event.type === "snapshot" || event.type === "status") &&
          event.session?.status === "closed"
        ) {
          controller.abort();
        }
        applySessionEvent(event, setSession);
      },
      () => setConnection("offline"),
      controller.signal,
    ).catch(() => {
      if (!controller.signal.aborted) setConnection("offline");
    });
    return () => controller.abort();
  }, [session?.id, sessionToken]);

  useEffect(() => {
    if (!stickToBottomRef.current) return;
    const container = messagesRef.current;
    if (container) container.scrollTop = container.scrollHeight;
  }, [session?.messages, session?.status]);

  async function startChat(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (isStarting) return;
    setError("");
    setIsStarting(true);
    try {
      const response = await fetch("/api/live-chat/sessions", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          visitorName,
          topic,
          serviceType,
          expertId: serviceType === "expert" ? expertId : undefined,
          preferredAt: preferredTime
            ? new Date(preferredTime).toISOString()
            : undefined,
          area,
          groupName,
          summary: intakeSummary,
        }),
      });
      const payload = (await response.json()) as {
        token?: string;
        session?: LiveChatSession;
        error?: string;
      };
      if (!response.ok || !payload.session)
        throw new Error(payload.error ?? "Sesi konsultasi belum bisa dibuat.");
      const saved = {
        sessionId: payload.session.id,
        token: payload.token ?? "",
      };
      sessionStorage.setItem(SESSION_KEY, JSON.stringify(saved));
      const previousHistory = (() => {
        try {
          return JSON.parse(
            sessionStorage.getItem(HISTORY_KEY) ?? "[]",
          ) as SavedHistoryItem[];
        } catch {
          return [];
        }
      })();
      sessionStorage.setItem(
        HISTORY_KEY,
        JSON.stringify(
          [
            { ...saved, savedAt: new Date().toISOString() },
            ...previousHistory.filter(
              (item) => item.sessionId !== saved.sessionId,
            ),
          ].slice(0, 30),
        ),
      );
      setSessionToken(saved.token);
      setSession(payload.session);
    } catch (reason) {
      setError(
        reason instanceof Error
          ? reason.message
          : "Koneksi terputus. Coba lagi.",
      );
    } finally {
      setIsStarting(false);
    }
  }

  async function sendMessage(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const text = draft.trim();
    if (
      !text ||
      !session ||
      !sessionToken ||
      isSending ||
      session.status === "closed"
    )
      return;
    setIsSending(true);
    setError("");
    try {
      const response = await fetch(
        `/api/live-chat/sessions/${session.id}/messages`,
        {
          method: "POST",
          headers: {
            "content-type": "application/json",
            authorization: `Bearer ${sessionToken}`,
          },
          body: JSON.stringify({ text }),
        },
      );
      const payload = (await response.json()) as {
        id?: string;
        sender?: "visitor" | "consultant";
        text?: string;
        sentAt?: string;
        error?: string;
      };
      if (!response.ok)
        throw new Error(payload.error ?? "Pesan belum terkirim.");
      if (payload.id && payload.sender && payload.text && payload.sentAt) {
        const message = {
          id: payload.id,
          sender: payload.sender,
          text: payload.text,
          sentAt: payload.sentAt,
        };
        setSession((current) =>
          current && current.messages.some((item) => item.id === message.id)
            ? current
            : current
              ? { ...current, messages: [...current.messages, message] }
              : current,
        );
      }
      setDraft("");
    } catch (reason) {
      setError(
        reason instanceof Error ? reason.message : "Pesan belum terkirim.",
      );
    } finally {
      setIsSending(false);
    }
  }

  function startAnotherChat() {
    sessionStorage.removeItem(SESSION_KEY);
    setSession(null);
    setSessionToken("");
    setDraft("");
    setError("");
  }

  return (
    <main className="app-shell">
      <header className="topbar">
        <a className="wordmark" href="/">
          KUPS Konsultasi
        </a>
        <nav className="topbar-links" aria-label="Navigasi">
          <a href="/">Layanan</a>
          <a href="/riwayat">Riwayat</a>
          <a href="/chatbot">Chatbot informasi</a>
          <a href="/operator">
            Masuk konsultan <span aria-hidden="true">↗</span>
          </a>
        </nav>
      </header>

      <div className="consultation-page" id="main">
        <div className="consultation-intro">
          <div>
            <p className="eyebrow">PENDAMPINGAN USAHA PERHUTANAN SOSIAL</p>
            <h1>
              {session
                ? "Ruang konsultasimu"
                : serviceType === "expert"
                  ? "Ajukan konsultasi dengan ahli."
                  : "Hubungi pendamping KUPS."}
            </h1>
          </div>
          <p>
            {session
              ? "Percakapan langsung dengan satu konsultan KUPS."
              : serviceType === "expert"
                ? "Ceritakan masalah dan waktu yang kamu inginkan. Tim akan mengonfirmasi kecocokan ahli serta jadwal melalui chat."
                : "Ceritakan kondisi kelompok. Permintaanmu masuk ke antrean pendamping untuk ditanggapi lewat chat privat."}
          </p>
        </div>

        <div className="consultation-layout">
          <aside className="consultation-aside">
            <div className="consultation-promise">
              <span className="one-to-one-mark" aria-hidden="true">
                1:1
              </span>
              <div>
                <strong>Satu ruang. Satu konsultan.</strong>
                <p>
                  Konsultasi berlangsung melalui chat langsung, bukan jawaban
                  otomatis.
                </p>
              </div>
            </div>
            <ol className="consultation-steps" aria-label="Tahapan konsultasi">
              <li
                className={
                  session
                    ? "is-complete"
                    : startStep === "topic"
                      ? "is-current"
                      : "is-complete"
                }
              >
                <span>01</span>
                <div>
                  <strong>Pilih kebutuhan</strong>
                  <small>Tentukan fokus konsultasi</small>
                </div>
              </li>
              <li
                className={
                  session
                    ? "is-complete"
                    : startStep === "details"
                      ? "is-current"
                      : ""
                }
              >
                <span>02</span>
                <div>
                  <strong>Ceritakan situasi</strong>
                  <small>Tambahkan konteks kelompok</small>
                </div>
              </li>
              <li className={session ? "is-current" : ""}>
                <span>03</span>
                <div>
                  <strong>Konsultasi</strong>
                  <small>Chat dengan konsultan</small>
                </div>
              </li>
            </ol>
            <a
              className="consultation-resource"
              href="https://gokups.hutsos.kehutanan.go.id/"
              target="_blank"
              rel="noreferrer"
            >
              <span>Informasi kelompok dan usaha</span>
              <strong>
                Portal GoKUPS <span aria-hidden="true">↗</span>
              </strong>
            </a>
          </aside>

          <section
            className="consultation-card"
            aria-label="Layanan konsultasi KUPS"
          >
            {!session ? (
              <>
                <div className="consultation-card-heading">
                  <div>
                    <p className="eyebrow">
                      {startStep === "topic"
                        ? "LANGKAH 1 DARI 2"
                        : "LANGKAH 2 DARI 2"}
                    </p>
                    <h2>
                      {startStep === "topic"
                        ? "Apa yang ingin kamu bahas?"
                        : "Bantu konsultan memahami konteksmu."}
                    </h2>
                  </div>
                  <span className="channel-label">
                    <span className="channel-mark" aria-hidden="true">
                      ↗
                    </span>{" "}
                    Chat langsung
                  </span>
                </div>

                {startStep === "topic" ? (
                  <>
                    <p className="card-description">
                      Pilih topik utama. Kamu bisa membahas kebutuhan lain
                      selama sesi konsultasi.
                    </p>
                    <div
                      className="topic-cards"
                      role="group"
                      aria-label="Pilih bidang konsultasi"
                    >
                      {topics.map((item, index) => (
                        <button
                          type="button"
                          key={item.label}
                          className={`topic-card${topic === item.label ? " is-selected" : ""}`}
                          aria-pressed={topic === item.label}
                          onClick={() => setTopic(item.label)}
                        >
                          <span className="topic-number">0{index + 1}</span>
                          <span className="topic-check" aria-hidden="true">
                            {topic === item.label ? "✓" : "＋"}
                          </span>
                          <strong>{item.label}</strong>
                          <small>{item.detail}</small>
                        </button>
                      ))}
                    </div>
                    <div className="card-actions">
                      <span className="selection-note">
                        Topik terpilih: <strong>{topic}</strong>
                      </span>
                      <button
                        className="send-button"
                        type="button"
                        onClick={() => {
                          setStartStep("details");
                          setError("");
                        }}
                      >
                        Lanjut <span aria-hidden="true">→</span>
                      </button>
                    </div>
                  </>
                ) : (
                  <form className="start-form intake-form" onSubmit={startChat}>
                    <div className="selected-topic-row">
                      <span>Bidang konsultasi</span>
                      <strong>{topic}</strong>
                      {serviceType !== "expert" && (
                        <button
                          type="button"
                          onClick={() => setStartStep("topic")}
                        >
                          Ubah
                        </button>
                      )}
                    </div>
                    {serviceType === "expert" && findExpert(expertId) && (
                      <div className="request-expert-note">
                        <strong>{findExpert(expertId)?.title}</strong>
                        <span>
                          Permintaan ahli akan dikonfirmasi oleh tim KUPS.
                        </span>
                      </div>
                    )}
                    <div className="intake-fields">
                      <div>
                        <label htmlFor="visitor-name">Nama panggilan</label>
                        <input
                          id="visitor-name"
                          value={visitorName}
                          onChange={(event) =>
                            setVisitorName(event.target.value)
                          }
                          maxLength={80}
                          placeholder="Nama yang ingin digunakan konsultan"
                          required
                        />
                      </div>
                      <div>
                        <label htmlFor="visitor-area">
                          Kabupaten/kota <span>(opsional)</span>
                        </label>
                        <input
                          id="visitor-area"
                          value={area}
                          onChange={(event) => setArea(event.target.value)}
                          maxLength={100}
                          placeholder="Contoh: Kabupaten Garut"
                        />
                      </div>
                      {serviceType === "expert" && (
                        <div className="intake-wide">
                          <label htmlFor="preferred-time">
                            Waktu konsultasi yang diinginkan{" "}
                            <span>(opsional)</span>
                          </label>
                          <input
                            id="preferred-time"
                            type="datetime-local"
                            value={preferredTime}
                            min={minimumPreferredTime}
                            onChange={(event) =>
                              setPreferredTime(event.target.value)
                            }
                          />
                          <small className="field-hint">
                            Ini permintaan waktu, bukan jadwal terkonfirmasi.
                            Tim akan membalas lewat chat.
                          </small>
                        </div>
                      )}
                      <div className="intake-wide">
                        <label htmlFor="group-name">
                          Nama KUPS atau kelompok <span>(opsional)</span>
                        </label>
                        <input
                          id="group-name"
                          value={groupName}
                          onChange={(event) => setGroupName(event.target.value)}
                          maxLength={100}
                          placeholder="Nama kelompok usaha"
                        />
                      </div>
                      <div className="intake-wide">
                        <label htmlFor="case-summary">
                          Apa kendala atau tujuan kelompokmu?
                        </label>
                        <textarea
                          id="case-summary"
                          value={intakeSummary}
                          onChange={(event) =>
                            setIntakeSummary(event.target.value)
                          }
                          maxLength={1200}
                          rows={4}
                          placeholder="Ceritakan singkat kondisinya dan bantuan yang kamu harapkan…"
                          required
                          minLength={10}
                        />
                        <small className="field-hint">
                          Ringkasan ini menjadi pesan pembuka untuk konsultan.
                        </small>
                      </div>
                    </div>
                    {error && (
                      <p className="live-error" role="alert">
                        {error}
                      </p>
                    )}
                    <div className="card-actions intake-actions">
                      <button
                        className="quiet-button"
                        type="button"
                        onClick={() => setStartStep("topic")}
                      >
                        Kembali
                      </button>
                      <button
                        className="send-button"
                        type="submit"
                        disabled={isStarting}
                      >
                        {isStarting
                          ? "Menghubungkan…"
                          : serviceType === "expert"
                            ? "Kirim permintaan konsultasi"
                            : "Hubungi pendamping"}
                        <span aria-hidden="true">→</span>
                      </button>
                    </div>
                    <p className="privacy-note">
                      Hindari mengirim kata sandi, nomor identitas, atau
                      informasi keuangan pribadi.
                    </p>
                  </form>
                )}
              </>
            ) : (
              <>
                <div className="consultation-card-heading session-heading">
                  <div>
                    <p className="eyebrow">
                      {session.status === "waiting"
                        ? "PERMINTAAN DITERIMA"
                        : session.status === "closed"
                          ? "SESI SELESAI"
                          : "KONSULTASI BERLANGSUNG"}
                    </p>
                    <h2>
                      {session.status === "active"
                        ? session.consultantName || "Konsultan KUPS"
                        : session.status === "closed"
                          ? "Terima kasih sudah berkonsultasi"
                          : "Menunggu konsultan menerima sesi"}
                    </h2>
                  </div>
                  <span className={`session-status status-${session.status}`}>
                    <span className="service-dot" />
                    {session.status === "waiting"
                      ? "Menunggu"
                      : session.status === "closed"
                        ? "Selesai"
                        : "Sedang chat"}
                  </span>
                </div>
                <div className="session-context">
                  <span>
                    {session.serviceType === "expert"
                      ? session.expertName || "Konsultasi ahli"
                      : "Pendampingan KUPS"}
                  </span>
                  <span>{session.topic}</span>
                  {session.preferredAt && (
                    <span>
                      Waktu diminta:{" "}
                      {new Intl.DateTimeFormat("id-ID", {
                        dateStyle: "medium",
                        timeStyle: "short",
                      }).format(new Date(session.preferredAt))}
                    </span>
                  )}
                  {session.groupName && <span>{session.groupName}</span>}
                  {session.area && <span>{session.area}</span>}
                  <span className="connection-state">
                    <span
                      className={`service-dot${connection === "online" ? " is-online" : connection === "offline" ? " is-offline" : ""}`}
                    />
                    {connection === "online"
                      ? "Live"
                      : connection === "offline"
                        ? "Menyambungkan ulang"
                        : "Menghubungkan"}
                  </span>
                </div>
                {session.status === "waiting" && (
                  <div className="queue-notice" role="status">
                    <strong>Kamu sudah masuk antrean.</strong>
                    <span>
                      Konsultan akan bergabung di sini saat menerima permintaan.
                      Kamu bisa menambahkan pesan sambil menunggu.
                    </span>
                  </div>
                )}
                <div
                  className="live-messages"
                  ref={messagesRef}
                  role="log"
                  aria-live="polite"
                  aria-relevant="additions text"
                  onScroll={(event) => {
                    const node = event.currentTarget;
                    stickToBottomRef.current =
                      node.scrollHeight - node.scrollTop - node.clientHeight <
                      72;
                  }}
                >
                  {session.messages.map((message) => (
                    <article
                      className={`live-message ${message.sender === "visitor" ? "from-visitor" : "from-consultant"}`}
                      key={message.id}
                    >
                      <p className="message-label">
                        {message.sender === "visitor"
                          ? session.visitorName
                          : session.consultantName || "Konsultan KUPS"}
                        <time dateTime={message.sentAt}>
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
                {session.status === "closed" ? (
                  <div className="consultation-outcome">
                    {session.closeSummary && (
                      <div>
                        <p className="eyebrow">RINGKASAN & TINDAK LANJUT</p>
                        <p>{session.closeSummary}</p>
                      </div>
                    )}
                    <button
                      className="quiet-button"
                      type="button"
                      onClick={startAnotherChat}
                    >
                      Konsultasi baru
                    </button>
                  </div>
                ) : (
                  <form className="live-composer" onSubmit={sendMessage}>
                    <label className="visually-hidden" htmlFor="live-message">
                      Tulis pesan ke konsultan
                    </label>
                    <textarea
                      id="live-message"
                      value={draft}
                      onChange={(event) => setDraft(event.target.value)}
                      placeholder={
                        session.status === "waiting"
                          ? "Tambahkan detail untuk konsultan…"
                          : "Tulis pesan ke konsultan…"
                      }
                      rows={2}
                      maxLength={2000}
                      disabled={!sessionToken || isSending}
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
                        disabled={!draft.trim() || isSending}
                      >
                        {isSending ? "Mengirim…" : "Kirim"}
                      </button>
                    </div>
                    {error && (
                      <p className="live-error" role="alert">
                        {error}
                      </p>
                    )}
                  </form>
                )}
              </>
            )}
          </section>
        </div>
      </div>
    </main>
  );
}

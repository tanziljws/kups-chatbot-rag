"use client";

import { FormEvent, KeyboardEvent, useRef, useState } from "react";
import type { ExpertHandoff } from "@/lib/chatbot/types";

type Source = {
  title: string;
  url: string;
  checkedAt: string;
  authority?: string;
};

type Message = {
  id: string;
  role: "assistant" | "user";
  content: string;
  sources?: Source[];
  handoff?: ExpertHandoff | null;
  kind?: "normal" | "error";
};

const suggestions = ["Apa arti KUPS?", "Cek data KUPS", "Sulit akses pasar"];
const HANDOFF_KEY = "kups-live-chat-handoff";

const firstMessage: Message = {
  id: "welcome",
  role: "assistant",
  content:
    "Halo. Saya bisa membantu mencari informasi KUPS dari sumber publik yang disetujui, atau membantu merumuskan langkah awal untuk masalah kelompok.",
};

function formatDate(dateValue: string) {
  const date = new Date(dateValue);
  if (Number.isNaN(date.getTime())) return dateValue;
  return new Intl.DateTimeFormat("id-ID", {
    day: "numeric",
    month: "short",
    year: "numeric",
  }).format(date);
}

export default function HomePage() {
  const [messages, setMessages] = useState<Message[]>([firstMessage]);
  const [draft, setDraft] = useState("");
  const [isSending, setIsSending] = useState(false);
  const [formError, setFormError] = useState("");
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  async function sendMessage(value = draft) {
    const question = value.trim();
    if (isSending) return;
    if (!question) {
      setFormError("Tulis pertanyaan sebelum mengirim.");
      textareaRef.current?.focus();
      return;
    }
    if (question.length > 1000) {
      setFormError("Pertanyaan terlalu panjang. Batasnya 1.000 karakter.");
      return;
    }

    setFormError("");
    setDraft("");
    setMessages((current) => [
      ...current,
      { id: crypto.randomUUID(), role: "user", content: question },
    ]);
    setIsSending(true);

    try {
      const history = messages
        .filter((message) => message.id !== "welcome")
        .slice(-6)
        .map(({ role, content }) => ({ role, content }));
      const response = await fetch("/api/chat", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ message: question, history }),
      });
      const payload = (await response.json()) as {
        answer?: string;
        sources?: Source[];
        handoff?: ExpertHandoff | null;
        error?: string;
      };

      if (!response.ok || !payload.answer) {
        throw new Error(
          payload.error ?? "Chat belum bisa menjawab. Coba lagi sebentar.",
        );
      }

      setMessages((current) => [
        ...current,
        {
          id: crypto.randomUUID(),
          role: "assistant",
          content: payload.answer!,
          sources: payload.sources ?? [],
          handoff: payload.handoff ?? null,
        },
      ]);
    } catch (error) {
      const explanation =
        error instanceof Error
          ? error.message
          : "Koneksi terputus. Coba lagi sebentar.";
      setMessages((current) => [
        ...current,
        {
          id: crypto.randomUUID(),
          role: "assistant",
          content: explanation,
          kind: "error",
        },
      ]);
    } finally {
      setIsSending(false);
      requestAnimationFrame(() => textareaRef.current?.focus());
    }
  }

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void sendMessage();
  }

  function onComposerKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      void sendMessage();
    }
  }

  function resetConversation() {
    setMessages([firstMessage]);
    setDraft("");
    setFormError("");
    textareaRef.current?.focus();
  }

  return (
    <main className="app-shell">
      <header className="topbar">
        <a
          className="wordmark"
          href="#main"
          aria-label="Tanya KUPS, halaman utama"
        >
          Tanya KUPS
        </a>
        <span className="topbar-caption">Informasi Perhutanan Sosial</span>
      </header>

      <div className="workspace" id="main">
        <aside className="intro-panel" aria-labelledby="page-title">
          <div className="intro-copy">
            <h1 id="page-title">Tanya soal KUPS</h1>
            <p className="intro-lead">
              Cari informasi yang bersumber jelas atau ceritakan kebutuhan
              kelompokmu.
            </p>
          </div>

          <section className="topic-list" aria-labelledby="topic-title">
            <h2 id="topic-title">Topik yang bisa ditanyakan</h2>
            <ul>
              <li>
                <span>Aturan dan pengertian KUPS</span>
                <span aria-hidden="true">01</span>
              </li>
              <li>
                <span>Data dan informasi publik</span>
                <span aria-hidden="true">02</span>
              </li>
              <li>
                <span>Langkah awal mengembangkan usaha</span>
                <span aria-hidden="true">03</span>
              </li>
            </ul>
          </section>

          <section className="official-links" aria-labelledby="sources-title">
            <h2 id="sources-title">Sumber resmi</h2>
            <a
              href="https://gokups.hutsos.kehutanan.go.id/"
              target="_blank"
              rel="noreferrer"
            >
              Portal GoKUPS <span aria-hidden="true">↗</span>
            </a>
            <a
              href="https://jdih.kehutanan.go.id/new2/home/portfolioDetails3/2021pmlhk009_menlhk_06102021150537.pdf/9/2021/4/1067"
              target="_blank"
              rel="noreferrer"
            >
              Permen LHK 9/2021 <span aria-hidden="true">↗</span>
            </a>
          </section>
        </aside>

        <section className="chat-panel" aria-label="Percakapan chatbot KUPS">
          <div className="chat-heading">
            <div>
              <h2>Ruang tanya</h2>
              <p>Jawaban merujuk ke sumber publik yang sudah ditinjau.</p>
            </div>
            <button
              className="quiet-button reset-button"
              type="button"
              onClick={resetConversation}
            >
              Reset
            </button>
          </div>

          <div
            className="conversation"
            role="log"
            aria-live="polite"
            aria-relevant="additions"
          >
            {messages.map((message) => (
              <article
                className={`message message-${message.role}${message.kind === "error" ? " message-error" : ""}`}
                key={message.id}
              >
                <p className="message-label">
                  {message.role === "assistant" ? "Asisten KUPS" : "Kamu"}
                </p>
                <p className="message-content">{message.content}</p>
                {!!message.sources?.length && (
                  <div className="message-sources">
                    <p className="source-heading">Sumber yang digunakan</p>
                    <ul>
                      {message.sources.map((source) => (
                        <li key={`${source.url}-${source.title}`}>
                          <a href={source.url} target="_blank" rel="noreferrer">
                            {source.title} <span aria-hidden="true">↗</span>
                          </a>
                          <span className="source-date">
                            Dicek {formatDate(source.checkedAt)}
                          </span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
                {message.handoff && (
                  <a
                    className="chat-handoff-card"
                    href={`/konsultasi?${new URLSearchParams({ specialty: message.handoff.specialty }).toString()}`}
                    onClick={() =>
                      sessionStorage.setItem(
                        HANDOFF_KEY,
                        message.handoff!.summary,
                      )
                    }
                  >
                    <span className="handoff-context-mark" aria-hidden="true">
                      ↗
                    </span>
                    <span>
                      <strong>Butuh arahan yang lebih spesifik?</strong>
                      <small>
                        {message.handoff.reason} · Lihat bidang ahli yang sesuai
                      </small>
                    </span>
                    <span className="directory-card-arrow" aria-hidden="true">
                      →
                    </span>
                  </a>
                )}
              </article>
            ))}
            {isSending && (
              <div
                className="message message-assistant pending-message"
                role="status"
              >
                <p className="message-label">Asisten KUPS</p>
                <p className="message-content">
                  Mencari sumber dan menyusun jawaban…
                </p>
              </div>
            )}
          </div>

          {messages.length === 1 && (
            <div className="suggestions" aria-label="Contoh pertanyaan">
              {suggestions.map((suggestion) => (
                <button
                  className="suggestion-button"
                  type="button"
                  key={suggestion}
                  onClick={() => void sendMessage(suggestion)}
                  disabled={isSending}
                >
                  {suggestion}
                </button>
              ))}
            </div>
          )}

          <form className="composer" onSubmit={onSubmit}>
            <label className="visually-hidden" htmlFor="question-input">
              Tulis pertanyaan
            </label>
            <textarea
              id="question-input"
              ref={textareaRef}
              value={draft}
              onChange={(event) => {
                setDraft(event.target.value);
                if (formError) setFormError("");
              }}
              onKeyDown={onComposerKeyDown}
              placeholder="Tulis pertanyaan tentang KUPS…"
              maxLength={1000}
              rows={2}
              aria-describedby="composer-help composer-error"
              aria-invalid={Boolean(formError)}
              disabled={isSending}
            />
            <div className="composer-footer">
              <p id="composer-help">
                Enter untuk kirim; Shift + Enter untuk baris baru.
              </p>
              <span className="character-count" aria-live="off">
                {draft.length}/1000
              </span>
              <button
                className="send-button"
                type="submit"
                disabled={isSending}
                aria-busy={isSending}
              >
                {isSending ? "Mengirim" : "Kirim"}
              </button>
            </div>
            <p
              className="composer-error"
              id="composer-error"
              aria-live="polite"
            >
              {formError}
            </p>
          </form>
          <p className="privacy-note">
            Jangan kirim data pribadi atau informasi internal kelompok.
          </p>
        </section>
      </div>
    </main>
  );
}

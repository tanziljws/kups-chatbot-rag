import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Tanya KUPS | Informasi Perhutanan Sosial",
  description:
    "Temukan informasi KUPS dari sumber resmi dan dapatkan arahan awal untuk kebutuhan kelompok usaha.",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="id">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          href="https://fonts.googleapis.com/css2?family=Bricolage+Grotesque:opsz,wght@12..96,400;12..96,500;12..96,600;12..96,700;12..96,800&family=Source+Serif+4:opsz,wght@8..60,400;8..60,500&display=swap"
          rel="stylesheet"
        />
      </head>
      <body>{children}</body>
    </html>
  );
}

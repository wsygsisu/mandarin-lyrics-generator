import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "词曲生成器 | Mandarin Lyrics Generator",
  description: "AI-powered Mandarin Chinese song lyrics generator",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="zh-CN">
      <body>{children}</body>
    </html>
  );
}

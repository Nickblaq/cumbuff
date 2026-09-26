import "./globals.css";
import { Inter, JetBrains_Mono } from "next/font/google";

const inter = Inter({ subsets: ["latin"], variable: "--font-inter", display: "swap" });
const mono = JetBrains_Mono({ subsets: ["latin"], variable: "--font-mono-src", display: "swap" });

const title = "cumbuff — media toolkit";
const description =
  "Inspect and download video and audio with yt-dlp, then transform images with sharp. One endpoint, one service.";

export const metadata = {
  title,
  description,
  applicationName: "cumbuff",
  manifest: "/manifest.webmanifest",
  openGraph: {
    title,
    description,
    type: "website",
    siteName: "cumbuff",
    images: [{ url: "/og.png", width: 1200, height: 630, alt: "cumbuff — one endpoint for video and image work" }],
  },
  twitter: {
    card: "summary_large_image",
    title,
    description,
    images: ["/og.png"],
  },
};

export const viewport = {
  themeColor: "#08080b",
  colorScheme: "dark",
};

export default function RootLayout({ children }) {
  return (
    <html lang="en" className={`${inter.variable} ${mono.variable}`}>
      <body className="min-h-screen antialiased">{children}</body>
    </html>
  );
}

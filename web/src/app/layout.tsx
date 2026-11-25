import type { Metadata, Viewport } from "next";
import Script from "next/script";
import { Noto_Sans, Noto_Sans_Devanagari, Noto_Serif } from "next/font/google";
import "./globals.css";

const noto = Noto_Sans({ variable: "--font-noto", subsets: ["latin"], display: "swap" });
const deva = Noto_Sans_Devanagari({ variable: "--font-deva", subsets: ["devanagari"], weight: ["400", "500", "600"], display: "swap" });
const serif = Noto_Serif({ variable: "--font-display-serif", subsets: ["latin"], weight: ["500", "600"], display: "swap" });

export const metadata: Metadata = {
  title: "VivaahMesh: one wedding plan for two families",
  description: "Both families, one plan, each in their own language. Start on Telegram in a minute.",
  applicationName: "VivaahMesh",
  appleWebApp: { capable: true, title: "VivaahMesh", statusBarStyle: "default" },
};

export const viewport: Viewport = {
  themeColor: "#FBF6EC",
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${noto.variable} ${deva.variable} ${serif.variable} h-full antialiased`}>
      <body className="min-h-full">
        {/* Telegram Mini App SDK. Harmless outside Telegram (initData is empty there). */}
        <Script src="https://telegram.org/js/telegram-web-app.js" strategy="beforeInteractive" />
        {children}
      </body>
    </html>
  );
}

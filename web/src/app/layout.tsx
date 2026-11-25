import type { Metadata, Viewport } from "next";
import { Gloock, Noto_Sans, Noto_Sans_Devanagari, Noto_Serif, Tiro_Devanagari_Marathi } from "next/font/google";
import "./globals.css";

const noto = Noto_Sans({ variable: "--font-noto", subsets: ["latin"], display: "swap" });
const deva = Noto_Sans_Devanagari({ variable: "--font-deva", subsets: ["devanagari"], weight: ["400", "500", "600"], display: "swap" });
const serif = Noto_Serif({ variable: "--font-display-serif", subsets: ["latin"], weight: ["500", "600"], display: "swap" });
// Landing page display faces: Gloock for Latin headlines, Tiro for Devanagari.
const gloock = Gloock({ variable: "--font-gloock", subsets: ["latin"], weight: "400", display: "swap" });
const tiro = Tiro_Devanagari_Marathi({ variable: "--font-tiro", subsets: ["devanagari", "latin"], weight: "400", display: "swap" });

export const metadata: Metadata = {
  title: "MahiWay: one wedding plan for two families",
  description: "Both families, one plan, each in their own language. Start on Telegram in a minute.",
  applicationName: "MahiWay",
  appleWebApp: { capable: true, title: "MahiWay", statusBarStyle: "default" },
};

export const viewport: Viewport = {
  themeColor: "#FBF6EC",
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" suppressHydrationWarning className={`${noto.variable} ${deva.variable} ${serif.variable} ${gloock.variable} ${tiro.variable} h-full antialiased`}>
      <body className="min-h-full">
        {children}
      </body>
    </html>
  );
}

import type { ReactNode } from "react";
import { Bricolage_Grotesque, Shantell_Sans } from "next/font/google";
import "./globals.css";

export const metadata = { title: "Predictle", icons: { icon: "/logo.svg" } };

const bricolage = Bricolage_Grotesque({ subsets: ["latin"], variable: "--font-bricolage" });
const shantell = Shantell_Sans({ subsets: ["latin"], style: ["italic"], weight: ["700", "800"], variable: "--font-shantell" });

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className={`${bricolage.variable} ${shantell.variable}`}>
      <body>{children}</body>
    </html>
  );
}

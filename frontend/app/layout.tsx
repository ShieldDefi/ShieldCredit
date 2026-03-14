import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";

const inter = Inter({ subsets: ["latin"] });

export const metadata: Metadata = {
  title: "ShieldCredit | Confidential RWA-Backed Lending",
  description:
    "A confidential RWA-backed lending protocol powered by Zama fhEVM. Borrow stablecoins against real-world assets with fully encrypted loan terms.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body className={inter.className}>{children}</body>
    </html>
  );
}

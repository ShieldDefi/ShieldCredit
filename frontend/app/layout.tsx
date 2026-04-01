import type { Metadata } from "next";
import AppProviders from "../components/AppProviders";
import "./globals.css";

export const metadata: Metadata = {
  title: "ShieldCredit",
  description:
    "Confidential RWA-backed lending powered by Zama fhEVM on Sepolia.",
  icons: {
    icon: [{ url: "/shieldcredit-favicon.svg", type: "image/svg+xml" }],
    shortcut: ["/shieldcredit-favicon.svg"],
  },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>
        <AppProviders>{children}</AppProviders>
      </body>
    </html>
  );
}

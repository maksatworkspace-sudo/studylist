import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "MAXBALL EDTECH | Кері байланыс",
  description: "MAXBALL EDTECH оқу орталығының кері байланыс алаңы.",
  icons: { icon: "/maxball-logo.png" },
};
export default function Layout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="kk">
      <body>{children}</body>
    </html>
  );
}

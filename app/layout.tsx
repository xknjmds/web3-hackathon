import type { Metadata } from "next";
import "./globals.css";
export const metadata: Metadata = {
  title: "Hati — send support home",
  description: "A thoughtful way to send family support.",
};
export default function Layout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}

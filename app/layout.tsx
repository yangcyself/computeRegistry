import type { ReactNode } from "react";
import "./globals.css";

export const metadata = {
  title: "Compute Registry",
  description: "Personal compute registry and AI-agent session lease service",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}

import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Control de Campamentos",
  description: "Panel para seguimiento diario de campamentos"
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="es">
      <body>{children}</body>
    </html>
  );
}

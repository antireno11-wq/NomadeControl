import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Nomade Control",
  description: "Plataforma de control operativo para campamentos, vehículos y operaciones de Nomade",
  icons: {
    icon: "/nomade-logo-v2.png",
    shortcut: "/nomade-logo-v2.png",
    apple: "/nomade-logo-v2.png"
  }
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="es">
      <body>{children}</body>
    </html>
  );
}

import type { Metadata } from "next";
import "./globals.css";
import AppShell from "./components/AppShell";

export const metadata: Metadata = {
  title: "LOGI-RED | Gestión de Riesgo y Red de Emergencias",
  description:
    "Panel de control para despacho, logística crítica y gestión del riesgo - Cali.",
};

// `layout.tsx` se mantiene como Server Component para poder exportar
// `metadata`. La estructura visual interactiva (header, sidebar, toasts
// RF-16) vive en `AppShell`, que sí necesita 'use client' para leer el
// store de Zustand y manejar estado local.
export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="es">
      <body className="font-sans antialiased">
        <AppShell>{children}</AppShell>
      </body>
    </html>
  );
}

import type { Metadata } from "next";
import "./globals.css";
import AppShell from "@/components/layout/AppShell";
import AlertProvider from "@/components/layout/AlertProvider";

export const metadata: Metadata = {
  title: "LOGI-RED | Gestión de Riesgo y Red de Emergencias",
  description:
    "Panel de control para despacho, logística crítica y gestión del riesgo - Cali.",
};

// `layout.tsx` se mantiene como Server Component para poder exportar
// `metadata`. La estructura visual interactiva (header, sidebar) vive en
// `AppShell`, y el emulador de WebSocket + toasts/sonido de alertas (RF-16)
// vive en `AlertProvider` — ambos son Client Components porque leen el store
// de Zustand y manejan estado local.
export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="es">
      <body className="font-sans antialiased">
        <AlertProvider>
          <AppShell>{children}</AppShell>
        </AlertProvider>
      </body>
    </html>
  );
}

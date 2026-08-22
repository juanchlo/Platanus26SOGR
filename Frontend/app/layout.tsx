import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "SOGR | Gestión de Riesgo y Red de Emergencias",
  description:
    "Panel de control para despacho, logística crítica y gestión del riesgo - Cali.",
};

// Ítems de navegación del panel lateral. Cada módulo aquí corresponde a un
// requisito funcional del documento de proyecto; se completan con rutas reales
// a medida que se implementa cada CRUD/vista (RF-01, RF-04, RF-10, etc.).
const NAV_ITEMS = [
  { label: "Panel principal", href: "/" },
  { label: "Publicaciones oficiales", href: "/posts" }, // RF-01
  { label: "Mapa de operaciones", href: "/mapa" }, // RF-04 / RF-05
  { label: "Necesidades civiles", href: "/necesidades" }, // RF-10 / RF-12
  { label: "Logística y despachos", href: "/logistica" }, // RF-07 / RF-09
  { label: "Alertas", href: "/alertas" }, // RF-16
];

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="es">
      <body className="min-h-screen bg-background text-slate-900">
        <div className="flex min-h-screen flex-col">
          {/* Barra superior */}
          <header className="flex h-16 shrink-0 items-center justify-between border-b border-dark-teal/10 bg-dark-teal px-6 text-ghost-white shadow-sm">
            <div className="flex items-center gap-3">
              <span className="text-lg font-semibold tracking-tight">
                SOGR
              </span>
              <span className="hidden text-sm text-ghost-white/70 sm:inline">
                Gestión de Riesgo y Red de Emergencias · Cali
              </span>
            </div>

            <div className="flex items-center gap-4">
              {/* TODO(RF-16): slot de alertas críticas (visuales/sonoras) en tiempo real */}
              <div
                aria-live="polite"
                className="hidden items-center rounded-md border border-rosy-copper/40 bg-rosy-copper/10 px-3 py-1 text-xs font-medium text-rosy-copper sm:flex"
              >
                Sin alertas críticas
              </div>

              {/* TODO: reemplazar por usuario/rol autenticado (RBAC - RF-14) */}
              <div className="flex items-center gap-2 text-sm">
                <span className="h-8 w-8 rounded-full bg-muted-teal/80" />
                <span className="hidden sm:inline">Usuario</span>
              </div>
            </div>
          </header>

          <div className="flex flex-1">
            {/* Panel lateral */}
            <aside className="hidden w-60 shrink-0 border-r border-dark-teal/10 bg-white px-3 py-4 md:block">
              <nav className="flex flex-col gap-1">
                {NAV_ITEMS.map((item) => (
                  <a
                    key={item.href}
                    href={item.href}
                    className="rounded-md px-3 py-2 text-sm font-medium text-slate-700 transition-colors hover:bg-dark-teal/5 hover:text-dark-teal"
                  >
                    {item.label}
                  </a>
                ))}
              </nav>
            </aside>

            {/* Contenido principal */}
            <main className="flex-1 overflow-y-auto p-6">{children}</main>
          </div>
        </div>
      </body>
    </html>
  );
}

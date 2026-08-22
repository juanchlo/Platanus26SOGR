'use client';

import { useEffect } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { useAppStore } from '@/store/useAppStore';
import { useAlerts } from './AlertProvider';
import { getSessionCookie, clearSessionCookie } from '@/lib/auth';
import { puedeGestionar, ROLES_CON_GESTION } from '@/lib/rbac';
import type { UserRole } from '@/types';

// Estructura visual completa del layout (header, sidebar, contenido y
// alertas RF-16). Vive en un componente cliente aparte porque necesita leer
// el store de Zustand y manejar estado local de toasts; `app/layout.tsx`
// permanece como Server Component para poder exportar `metadata`.

// `requiredRoles` ausente = visible para cualquier rol autenticado.
// Presente = RBAC de interfaz (ver lib/rbac.ts): solo se muestra si el rol
// activo está en la lista (gestión de usuarios y comunicados oficiales,
// restringido para 'civil' y 'operador_campo').
const NAV_ITEMS: Array<{
  label: string;
  href: string;
  requiredRoles?: readonly UserRole[];
  icon: React.ReactNode;
}> = [
  {
    label: 'Mapa Operativo',
    href: '/mapa',
    icon: (
      <svg
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth={1.75}
        strokeLinecap="round"
        strokeLinejoin="round"
        className="h-5 w-5"
      >
        <path d="M9 20l-5-2V6l5 2m0 12l6-2m-6 2V8m6 10l5 2V8l-5-2m0 14V6m0 0L9 8" />
      </svg>
    ),
  },
  {
    label: 'Publicaciones Oficiales',
    href: '/posts',
    // Creación de comunicados/avisos oficiales: solo roles de gestión.
    requiredRoles: ROLES_CON_GESTION,
    icon: (
      <svg
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth={1.75}
        strokeLinecap="round"
        strokeLinejoin="round"
        className="h-5 w-5"
      >
        <path d="M9 3h6l4 4v14H5V3h4Z" />
        <path d="M9 3v4H5" />
        <path d="M9 12h6M9 16h6" />
      </svg>
    ),
  },
  {
    label: 'Necesidades Civiles',
    href: '/necesidades',
    icon: (
      <svg
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth={1.75}
        strokeLinecap="round"
        strokeLinejoin="round"
        className="h-5 w-5"
      >
        <path d="M17 20v-1a4 4 0 0 0-4-4H7a4 4 0 0 0-4 4v1" />
        <circle cx="10" cy="7" r="3.25" />
        <path d="M21 20v-1a3.5 3.5 0 0 0-2.5-3.36" />
        <path d="M15.5 3.62A3.5 3.5 0 0 1 18 7a3.5 3.5 0 0 1-2.5 3.37" />
      </svg>
    ),
  },
  {
    label: 'Gestión de Usuarios',
    href: '/admin/usuarios',
    // Administración de cuentas/roles: solo roles de gestión.
    requiredRoles: ROLES_CON_GESTION,
    icon: (
      <svg
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth={1.75}
        strokeLinecap="round"
        strokeLinejoin="round"
        className="h-5 w-5"
      >
        <circle cx="9" cy="7" r="3.25" />
        <path d="M3 20v-1a5 5 0 0 1 5-5h2a5 5 0 0 1 5 5v1" />
        <path d="M17.5 4.5a3 3 0 0 1 0 5.9" />
        <path d="M21 20v-1a4.5 4.5 0 0 0-3-4.24" />
      </svg>
    ),
  },
];

const ROLE_LABELS: Record<UserRole, string> = {
  admin_gubernamental: 'Admin Gubernamental',
  ente_publico: 'Ente Público',
  operador_campo: 'Operador de Campo',
  civil: 'Civil',
};

// Widget "Traslados Urgentes de Ayuda": lee `misionesPriorizadas` del store
// (datos exactos del pitch, ver store/useAppStore.ts) y muestra el campo
// `razon` de cada una en texto plano. Sin mención a la función SQL que
// calcula esto en el backend — de cara al usuario final es lenguaje de
// dominio operativo, no un detalle de implementación.
function MisionesPriorizadasWidget() {
  const misiones = useAppStore((state) => state.misionesPriorizadas);
  const ordenadas = [...misiones].sort(
    (a, b) => (b.urgencia ?? 0) - (a.urgencia ?? 0)
  );

  return (
    <div className="rounded-lg border border-dark-teal/10 bg-white p-4 shadow-sm">
      <h2 className="text-sm font-semibold text-dark-teal">
        Traslados Urgentes de Ayuda
      </h2>
      <p className="mt-1 text-xs text-slate-500">
        Excedentes de un punto de acopio asignados a los lugares que más los
        necesitan ahora mismo.
      </p>

      {ordenadas.length === 0 ? (
        <p className="mt-3 text-xs text-slate-400">
          Sin misiones pendientes.
        </p>
      ) : (
        <ol className="mt-3 flex flex-col gap-2">
          {ordenadas.map((mision, index) => (
            <li
              key={`${mision.origen_id}-${mision.destino_id}-${mision.insumo_id}`}
              className="rounded-md border border-dark-teal/10 bg-ghost-white/60 p-2.5"
            >
              <div className="flex items-center justify-between gap-2">
                <span className="text-[10px] font-bold uppercase tracking-wide text-dark-teal/60">
                  Misión {index + 1}
                </span>
                {mision.urgencia !== null ? (
                  <span className="rounded-full bg-rosy-copper/10 px-2 py-0.5 text-[10px] font-semibold text-rosy-copper">
                    Urgencia {mision.urgencia}
                  </span>
                ) : null}
              </div>
              {/* Campo `razon` consumido en texto plano, sin transformar */}
              <p className="mt-1 text-sm text-slate-700">{mision.razon}</p>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}

export default function AppShell({
  children,
}: {
  children: React.ReactNode;
}) {
  const userSession = useAppStore((state) => state.userSession);
  const setSession = useAppStore((state) => state.setSession);
  const logout = useAppStore((state) => state.logout);
  // Toasts, sonido y el emulador de WebSocket (RF-16) viven en AlertProvider,
  // que envuelve este componente en app/layout.tsx.
  const { triggerTestAlert } = useAlerts();
  const router = useRouter();
  const pathname = usePathname();

  // Hidrata el store con lo que haya en la cookie de sesión al montar: el
  // store de Zustand es puro en memoria (sin `persist`), así que sin esto
  // un refresh perdería el login y volvería al usuario mock por defecto.
  useEffect(() => {
    const cookieSession = getSessionCookie();
    if (cookieSession) {
      setSession(cookieSession);
    }
  }, [setSession]);

  function handleLogout() {
    clearSessionCookie();
    logout();
    router.push('/login');
  }

  // /login es una pantalla completa sin chrome de la app (sin header/sidebar):
  // los hooks de arriba igual corren (hidratación de cookie es inofensiva ahí).
  if (pathname === '/login') {
    return <>{children}</>;
  }

  return (
    <div className="flex min-h-screen flex-col bg-background text-slate-900">
      {/* Header superior */}
      <header className="flex h-16 shrink-0 items-center justify-between border-b border-dark-teal/10 bg-dark-teal px-6 text-ghost-white shadow-sm">
        <div className="flex items-center gap-3">
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth={1.75}
            strokeLinecap="round"
            strokeLinejoin="round"
            className="h-7 w-7 text-ghost-white"
          >
            <path d="M12 3l8 4v5c0 4.5-3.2 8.2-8 9-4.8-.8-8-4.5-8-9V7l8-4Z" />
            <path d="M9.5 12.5l1.75 1.75L15 10.5" />
          </svg>
          <div className="flex flex-col leading-tight">
            <span className="text-base font-bold tracking-tight">
              LOGI-RED
            </span>
            <span className="hidden text-xs text-ghost-white/70 sm:inline">
              Gestión de Riesgo y Red de Emergencias · Cali
            </span>
          </div>
        </div>

        <div className="flex items-center gap-4">
          {/* Indicador de estado en tiempo real */}
          <div className="hidden items-center gap-2 rounded-md border border-muted-teal/40 bg-muted-teal/10 px-3 py-1 text-xs font-medium text-muted-teal sm:flex">
            <span className="relative flex h-2 w-2">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-muted-teal opacity-75" />
              <span className="relative inline-flex h-2 w-2 rounded-full bg-muted-teal" />
            </span>
            En línea · Tiempo real
          </div>

          {/* Botón de prueba: Alertas Sonoras y Toasts globales (RF-16) */}
          <button
            type="button"
            onClick={triggerTestAlert}
            className="flex items-center gap-1.5 rounded-md border border-rosy-copper/50 bg-rosy-copper/10 px-3 py-1.5 text-xs font-semibold text-rosy-copper transition-colors hover:bg-rosy-copper/20"
          >
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth={1.75}
              strokeLinecap="round"
              strokeLinejoin="round"
              className="h-4 w-4"
            >
              <path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9" />
              <path d="M13.73 21a2 2 0 0 1-3.46 0" />
            </svg>
            Probar alerta
          </button>

          {/* Sesión activa */}
          {userSession ? (
            <div className="flex items-center gap-3">
              <div className="flex items-center gap-2 text-sm">
                <span className="flex h-8 w-8 items-center justify-center rounded-full bg-ghost-white/15 text-xs font-semibold uppercase">
                  {userSession.nombre
                    .split(' ')
                    .map((part) => part[0])
                    .slice(0, 2)
                    .join('')}
                </span>
                <div className="hidden flex-col leading-tight sm:flex">
                  <span className="font-medium">{userSession.nombre}</span>
                  <span className="text-xs text-ghost-white/70">
                    {ROLE_LABELS[userSession.role]}
                  </span>
                </div>
              </div>
              <button
                type="button"
                onClick={handleLogout}
                title="Cerrar sesión"
                className="flex items-center gap-1.5 rounded-md border border-ghost-white/20 px-2.5 py-1.5 text-xs font-medium text-ghost-white/90 transition-colors hover:border-ghost-white/40 hover:bg-ghost-white/10"
              >
                <svg
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth={1.75}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  className="h-4 w-4"
                >
                  <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
                  <path d="M16 17l5-5-5-5" />
                  <path d="M21 12H9" />
                </svg>
                <span className="hidden sm:inline">Cerrar sesión</span>
              </button>
            </div>
          ) : (
            <span className="text-sm text-ghost-white/70">Sin sesión</span>
          )}
        </div>
      </header>

      <div className="flex flex-1">
        {/* Panel lateral */}
        <aside className="hidden w-64 shrink-0 border-r border-dark-teal/10 bg-white px-3 py-4 md:block">
          <nav className="flex flex-col gap-1">
            {NAV_ITEMS.filter(
              (item) =>
                !item.requiredRoles ||
                (userSession && item.requiredRoles.includes(userSession.role))
            ).map((item) => (
              <a
                key={item.href}
                href={item.href}
                className="flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium text-slate-700 transition-colors hover:bg-dark-teal/5 hover:text-dark-teal"
              >
                <span className="text-dark-teal/70">{item.icon}</span>
                {item.label}
              </a>
            ))}
          </nav>
        </aside>

        {/* Área principal: lienzo del mapa + paneles laterales */}
        <main className="flex flex-1 flex-col gap-4 overflow-y-auto p-6 lg:flex-row">
          <div className="min-h-[60vh] flex-1 rounded-lg border border-dark-teal/10 bg-white shadow-sm">
            {children}
          </div>
          <div className="flex w-full flex-col gap-4 lg:w-80 lg:shrink-0">
            <div className="rounded-lg border border-dark-teal/10 bg-white p-4 shadow-sm">
              <h2 className="text-sm font-semibold text-dark-teal">
                Panel de detalle
              </h2>
              <p className="mt-1 text-xs text-slate-500">
                Información contextual del nodo/reporte seleccionado en el
                mapa.
              </p>

              {/* RBAC: edición de nodos solo para roles de gestión. Sin
                  mensaje/banner para el resto — el control simplemente no
                  se renderiza. */}
              {userSession && puedeGestionar(userSession.role) ? (
                <button
                  type="button"
                  disabled
                  title="Selecciona un nodo en el mapa para editarlo"
                  className="mt-3 w-full rounded-md border border-dark-teal/20 px-3 py-1.5 text-xs font-medium text-dark-teal/70 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  Editar nodo
                </button>
              ) : null}
            </div>

            <MisionesPriorizadasWidget />
          </div>
        </main>
      </div>
    </div>
  );
}

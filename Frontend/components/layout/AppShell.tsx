'use client';

import { useEffect, useRef, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { useAppStore } from '@/store/useAppStore';
import { useAlerts } from '@/components/layout/AlertProvider';
import { getSessionCookie, clearSessionCookie } from '@/lib/auth';
import { puedeLevantarNodos, ROLES_CON_GESTION, normalizeRole } from '@/lib/rbac';
import CrearNodoModal from '@/components/map/CrearNodoModal';
import type { UserRole } from '@/types';

const NAV_ITEMS: Array<{
  label: string;
  href: string;
  requiredRoles?: readonly string[];
  icon: React.ReactNode;
}> = [
  {
    label: 'Mapa Operativo (Cali)',
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
  // próximamente: "Publicaciones Oficiales" (/posts) y "Necesidades Civiles"
  // (/necesidades) — se sacaron del nav porque esas páginas todavía no existen.
  {
    label: 'Mis Nodos Asignados',
    href: '/mis-nodos',
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
        <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
        <path d="M9 12l2 2 4-4" />
      </svg>
    ),
  },
  {
    label: 'Reporte de Campo (GPS / IA)',
    href: '/operador/reporte',
    requiredRoles: ['operador_campo'],
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
        <path d="M12 21a9 9 0 0 0 9-9c0-4.97-4.03-9-9-9s-9 4.03-9 9a9 9 0 0 0 9 9Z" />
        <path d="M12 8v4" />
        <path d="M12 16h.01" />
      </svg>
    ),
  },
  {
    label: 'Gestión de Usuarios',
    href: '/admin/usuarios',
    requiredRoles: ['admin_gubernamental'],
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

const ROLE_LABELS: Record<string, string> = {
  admin_gubernamental: 'Admin Gubernamental',
  ente_publico: 'Ente Público',
  operador_campo: 'Operador de Campo',
  civil: 'Civil (Ciudadano)',
};

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
        Excedentes de un punto de acopio asignados a los lugares con mayor prioridad en Cali.
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
                  <span className="flex items-center gap-1 rounded-full bg-rosy-copper px-2 py-0.5 text-[10px] font-bold text-white shadow-sm">
                    <span
                      className={`h-1.5 w-1.5 rounded-full bg-white/90 ${
                        mision.urgencia >= 4 ? 'animate-pulse' : ''
                      }`}
                    />
                    Urgencia {mision.urgencia}
                  </span>
                ) : null}
              </div>
              <p className="mt-1 text-sm text-slate-700">{mision.razon}</p>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}

function DetalleNodoWidget() {
  const activePunto = useAppStore((state) => state.activePunto);
  const setActivePunto = useAppStore((state) => state.setActivePunto);

  if (!activePunto) {
    return (
      <div className="rounded-lg border border-dark-teal/10 bg-white p-4 shadow-sm">
        <h2 className="text-sm font-semibold text-dark-teal">
          Panel de Detalle
        </h2>
        <p className="mt-2 text-xs text-slate-500">
          Haz clic en cualquier nodo o punto de control del mapa de Cali para ver su información en tiempo real.
        </p>
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-dark-teal/15 bg-white p-4 shadow-sm">
      <div className="flex items-start justify-between gap-2">
        <h2 className="text-sm font-bold text-dark-teal leading-snug">
          {activePunto.nombre}
        </h2>
        <button
          type="button"
          onClick={() => setActivePunto(null)}
          className="text-slate-400 hover:text-slate-600 text-xs"
        >
          ✕
        </button>
      </div>

      <div className="mt-2 flex flex-wrap gap-1.5">
        <span className="rounded-md bg-dark-teal/10 px-2 py-0.5 text-[11px] font-semibold text-dark-teal capitalize">
          {activePunto.tipo || 'Nodo'}
        </span>
        <span className={`rounded-md px-2 py-0.5 text-[11px] font-semibold capitalize ${
          activePunto.estado === 'activo'
            ? 'bg-emerald-100 text-emerald-800'
            : activePunto.estado === 'saturado'
            ? 'bg-rose-100 text-rose-800'
            : 'bg-amber-100 text-amber-800'
        }`}>
          {activePunto.estado || 'Activo'}
        </span>
      </div>

      <div className="mt-3 flex flex-col gap-1.5 text-xs text-slate-600 border-t border-slate-100 pt-2">
        {activePunto.responsable && (
          <div>
            <span className="font-semibold text-slate-700">Ente Responsable:</span>{' '}
            <span className="text-dark-teal font-medium">{activePunto.responsable}</span>
          </div>
        )}
        <div>
          <span className="font-semibold text-slate-700">Coordenadas:</span>{' '}
          {activePunto.lat.toFixed(4)}, {activePunto.lng.toFixed(4)}
        </div>
        {activePunto.direccion && (
          <div>
            <span className="font-semibold text-slate-700">Dirección:</span>{' '}
            {activePunto.direccion}
          </div>
        )}
        {activePunto.horario && (
          <div>
            <span className="font-semibold text-slate-700">Horario:</span>{' '}
            {activePunto.horario}
          </div>
        )}
        {activePunto.telefono && (
          <div>
            <span className="font-semibold text-slate-700">Teléfono:</span>{' '}
            {activePunto.telefono}
          </div>
        )}
      </div>
    </div>
  );
}

// Menú de notificaciones (RF-16): reemplaza el botón "Alerta" con texto por
// un ícono de campana que abre un panel con las alertas de inactividad
// activas + una acción para disparar una alerta de prueba.
function NotificationsMenu() {
  const { alertasInactivos, muted, toggleMuted, triggerTestAlert } = useAlerts();
  const [isOpen, setIsOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const count = alertasInactivos.length;

  useEffect(() => {
    if (!isOpen) return;
    function handleClickOutside(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    }
    function handleEscape(e: KeyboardEvent) {
      if (e.key === 'Escape') setIsOpen(false);
    }
    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('keydown', handleEscape);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleEscape);
    };
  }, [isOpen]);

  return (
    <div className="relative" ref={menuRef}>
      <button
        type="button"
        onClick={() => setIsOpen((v) => !v)}
        aria-expanded={isOpen}
        aria-haspopup="true"
        title="Notificaciones de alertas"
        className={`relative flex h-10 w-10 items-center justify-center rounded-md border-2 transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white ${
          count > 0
            ? 'border-rosy-copper bg-rosy-copper text-white'
            : 'border-white/25 bg-white/10 text-white hover:bg-white/20'
        }`}
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} className="h-5 w-5">
          <path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9" />
          <path d="M13.73 21a2 2 0 0 1-3.46 0" />
        </svg>
        {count > 0 && (
          <span className="absolute -top-1.5 -right-1.5 flex h-5 min-w-[20px] items-center justify-center rounded-full border-2 border-dark-teal bg-saffron px-1 text-[11px] font-extrabold text-slate-900">
            {count}
          </span>
        )}
      </button>

      {isOpen && (
        <div className="absolute right-0 top-full z-50 mt-2 w-80 overflow-hidden rounded-lg border-2 border-slate-200 bg-white text-slate-900 shadow-2xl">
          <div className="flex items-center justify-between border-b-2 border-slate-100 px-4 py-3">
            <span className="text-sm font-extrabold text-dark-teal">Notificaciones</span>
            <button
              type="button"
              onClick={toggleMuted}
              aria-pressed={muted}
              className="text-xs font-bold text-slate-500 hover:text-dark-teal"
            >
              {muted ? '🔇 Silenciadas' : '🔊 Sonido activo'}
            </button>
          </div>

          <div className="max-h-72 overflow-y-auto">
            {count === 0 ? (
              <p className="px-4 py-6 text-center text-sm font-semibold text-slate-400">
                Sin alertas activas.
              </p>
            ) : (
              alertasInactivos.map((a) => (
                <div key={a.id} className="flex flex-col gap-0.5 border-b border-slate-100 px-4 py-3 last:border-0">
                  <span className="text-sm font-bold text-rosy-copper">{a.nombre}</span>
                  <span className="text-xs font-semibold text-slate-600">
                    {a.horas_sin_reporte}h sin reportar · {a.responsable || 'Ente Público'}
                  </span>
                </div>
              ))
            )}
          </div>

          <button
            type="button"
            onClick={() => {
              triggerTestAlert();
              setIsOpen(false);
            }}
            className="flex w-full items-center justify-center gap-1.5 border-t-2 border-slate-100 px-4 py-2.5 text-xs font-bold text-dark-teal transition hover:bg-dark-teal/5"
          >
            Enviar alerta de prueba (RF-16)
          </button>
        </div>
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
  const setCrearNodoModalOpen = useAppStore((state) => state.setCrearNodoModalOpen);
  const router = useRouter();
  const pathname = usePathname();

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

  if (pathname === '/login') {
    return <>{children}</>;
  }

  const normRole = normalizeRole(userSession?.role);
  const roleLabel = ROLE_LABELS[normRole] || (normRole ? normRole : 'Civil');

  return (
    <div className="flex min-h-screen flex-col bg-background text-slate-900">
      {/* Modal global para creación de nodos (ADMIN_GUBERNAMENTAL) */}
      <CrearNodoModal />

      {/* Header superior */}
      <header className="flex h-16 shrink-0 items-center justify-between border-b border-dark-teal/10 bg-dark-teal px-6 text-ghost-white shadow-sm">
        <div className="flex items-center gap-3">
          <a href="/" className="flex items-center gap-3 hover:opacity-95 transition">
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
              <span className="text-lg font-extrabold tracking-tight">
                LOGI-RED CALI
              </span>
              <span className="hidden text-[13px] font-semibold text-on-dark-muted sm:inline">
                Gestión de Riesgo y Red de Emergencias
              </span>
            </div>
          </a>
        </div>

        <div className="flex items-center gap-3">
          {/* Menú de notificaciones (RF-16) — solo admin gubernamental */}
          {userSession && puedeLevantarNodos(userSession.role) && <NotificationsMenu />}

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
                  <span className="font-bold">{userSession.nombre}</span>
                  <span className="text-[13px] font-semibold text-on-dark-muted">
                    {roleLabel}
                  </span>
                </div>
              </div>
              <button
                type="button"
                onClick={handleLogout}
                title="Cerrar sesión"
                className="flex items-center gap-1 rounded-md border-2 border-ghost-white/40 px-2 py-1 text-xs font-bold text-white transition-colors hover:bg-ghost-white/10"
              >
                <svg
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth={1.75}
                  className="h-3.5 w-3.5"
                >
                  <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
                  <path d="M16 17l5-5-5-5" />
                  <path d="M21 12H9" />
                </svg>
                <span className="hidden sm:inline">Salir</span>
              </button>
            </div>
          ) : (
            <div className="flex items-center gap-3 text-sm">
              <span className="text-[13px] font-bold uppercase tracking-wide text-on-dark-muted">
                Modo Civil (Consulta)
              </span>
              <a
                href="/login"
                className="rounded-md bg-ghost-white px-3.5 py-1.5 text-xs font-extrabold text-dark-teal shadow-sm transition-colors hover:bg-ghost-white/90"
              >
                Iniciar Sesión
              </a>
            </div>
          )}
        </div>
      </header>

      <div className="flex flex-1">
        {/* Panel lateral */}
        <aside className="hidden w-60 shrink-0 border-r border-dark-teal/10 bg-white px-3 py-4 md:block">
          <nav className="flex flex-col gap-1">
            {NAV_ITEMS.filter(
              (item) =>
                !item.requiredRoles ||
                (userSession && item.requiredRoles.includes(normalizeRole(userSession.role)))
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

            {userSession && puedeLevantarNodos(userSession.role) && (
              <div className="mt-4 border-t border-slate-100 pt-3">
                <button
                  type="button"
                  onClick={() => setCrearNodoModalOpen(true)}
                  className="flex w-full items-center justify-center gap-2 rounded-lg bg-dark-teal px-4 py-3.5 text-sm font-extrabold text-white shadow-md transition active:scale-[0.98] hover:bg-[#0a5e78] active:bg-[#063848]"
                >
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} className="h-5 w-5">
                    <line x1="12" y1="5" x2="12" y2="19" />
                    <line x1="5" y1="12" x2="19" y2="12" />
                  </svg>
                  Levantar Nodo
                </button>
              </div>
            )}
          </nav>
        </aside>

        {/* Área principal */}
        <main className="flex flex-1 flex-col gap-4 overflow-y-auto p-4 lg:flex-row">
          <div className="min-h-[70vh] flex-1 rounded-lg border border-dark-teal/10 bg-white shadow-sm overflow-hidden flex flex-col">
            {children}
          </div>
          <div className="flex w-full flex-col gap-4 lg:w-80 lg:shrink-0">
            <DetalleNodoWidget />
            <MisionesPriorizadasWidget />
          </div>
        </main>
      </div>
    </div>
  );
}

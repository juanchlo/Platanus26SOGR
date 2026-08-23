'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from 'react';
import { usePathname } from 'next/navigation';
import { getAlertasNodosInactivosApi } from '@/lib/api';
import { puedeLevantarNodos } from '@/lib/rbac';
import { useAppStore } from '@/store/useAppStore';
import type { AlertaNodoInactivo } from '@/types';

type AlertSeverity = 'critica' | 'alta';

interface AlertToast {
  id: string;
  tag: string;
  text: string;
  severity: AlertSeverity;
}

const TOAST_LIFETIME_MS = 7_000;
const POLLING_INTERVAL_MS = 30_000;

// Estilos por severidad, usando la paleta institucional (Rosy Copper / Saffron).
// Ambas variantes usan fondo SÓLIDO: la versión anterior de "alta" pintaba texto
// saffron sobre saffron/10 (~1.9:1 de contraste, muy por debajo del 4.5:1 de WCAG AA).
// El objetivo aquí es doble: cumplir contraste Y que una alerta se LEA como alerta,
// no como una notificación pastel más.
const TOAST_STYLES: Record<
  AlertSeverity,
  { toast: string; icon: string; tag: string }
> = {
  critica: {
    toast:
      'border-2 border-rosy-copper bg-rosy-copper text-white shadow-[0_0_0_1px_rgba(219,80,74,0.35),0_22px_45px_-14px_rgba(219,80,74,0.65)]',
    icon: 'text-white animate-pulse',
    tag: 'text-white/95',
  },
  alta: {
    toast:
      'border-2 border-saffron bg-saffron text-slate-900 shadow-[0_0_0_1px_rgba(227,181,5,0.35),0_18px_38px_-14px_rgba(227,181,5,0.55)]',
    icon: 'text-slate-900',
    tag: 'text-slate-900/80',
  },
};

// Web Audio API sintetizador de beep discreto para alertas críticas
function playCriticalAlertSound() {
  try {
    const AudioCtx =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext: typeof AudioContext })
        .webkitAudioContext;
    const ctx = new AudioCtx();
    const oscillator = ctx.createOscillator();
    const gain = ctx.createGain();
    oscillator.type = 'sine';
    oscillator.frequency.value = 880;
    gain.gain.setValueAtTime(0.15, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.6);
    oscillator.connect(gain);
    gain.connect(ctx.destination);
    oscillator.start();
    oscillator.stop(ctx.currentTime + 0.6);
  } catch {
    // SSR o entorno sin audio soportado
  }
}

interface AlertContextValue {
  muted: boolean;
  toggleMuted: () => void;
  triggerTestAlert: () => void;
  alertasInactivos: AlertaNodoInactivo[];
}

const AlertContext = createContext<AlertContextValue | null>(null);

export function useAlerts(): AlertContextValue {
  const ctx = useContext(AlertContext);
  if (!ctx) {
    throw new Error('useAlerts debe usarse dentro de <AlertProvider>');
  }
  return ctx;
}

export default function AlertProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const [toasts, setToasts] = useState<AlertToast[]>([]);
  const [muted, setMuted] = useState(false);
  const [alertasInactivos, setAlertasInactivos] = useState<AlertaNodoInactivo[]>([]);
  const mutedRef = useRef(muted);
  mutedRef.current = muted;

  const pathname = usePathname();
  const userSession = useAppStore((state) => state.userSession);
  const isAdmin = puedeLevantarNodos(userSession?.role) && pathname !== '/login';

  const pushToast = useCallback((tag: string, text: string, severity: AlertSeverity) => {
    const toastId = `alert-${Date.now()}-${Math.random().toString(36).substr(2, 4)}`;
    setToasts((prev) => [...prev, { id: toastId, tag, text, severity }]);

    if (severity === 'critica' && !mutedRef.current) {
      playCriticalAlertSound();
    }

    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== toastId));
    }, TOAST_LIFETIME_MS);
  }, []);

  // Consultar alertas reales de inactividad (>3h) desde el backend FastAPI.
  // El backend ya filtra por el usuario autenticado (ente_publico solo ve
  // sus propios nodos; admin_gubernamental ve todos), así que basta con
  // mandar el token — ver RequirePublicEntity en /alertas/nodos-inactivos.
  const checkLiveAlertas = useCallback(async () => {
    const token = useAppStore.getState().userSession?.token;
    if (!token) return;
    try {
      const liveAlertas = await getAlertasNodosInactivosApi(token);
      setAlertasInactivos(liveAlertas);

      if (liveAlertas.length > 0) {
        const nodo = liveAlertas[0];
        pushToast(
          'NODO INACTIVO (>3H)',
          `${nodo.nombre} lleva ${nodo.horas_sin_reporte}h sin reportar inventario. Resp: ${nodo.responsable || 'Ente Público'}`,
          'critica'
        );
      }
    } catch {
      // Ignorar si el backend aún no está levantado o no hay conexión temporal
    }
  }, [pushToast]);

  useEffect(() => {
    if (!isAdmin) return;
    checkLiveAlertas();
    const interval = setInterval(checkLiveAlertas, POLLING_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [isAdmin, checkLiveAlertas]);

  const triggerTestAlert = useCallback(() => {
    pushToast(
      'NODO INACTIVO (>3H)',
      'Cruz Roja Seccional Valle lleva 3.2h sin reportar inventario en Cali',
      'critica'
    );
  }, [pushToast]);

  const toggleMuted = useCallback(() => setMuted((prev) => !prev), []);

  return (
    <AlertContext.Provider value={{ muted, toggleMuted, triggerTestAlert, alertasInactivos }}>
      {children}

      {isAdmin && (
        <>
          {/* Botón flotante para silenciar/activar alertas sonoras */}
          <button
            type="button"
            onClick={toggleMuted}
            aria-pressed={muted}
            title={muted ? 'Activar alertas sonoras' : 'Silenciar alertas sonoras'}
            className="fixed bottom-4 left-4 z-50 flex h-10 w-10 items-center justify-center rounded-full border border-dark-teal/15 bg-white text-dark-teal shadow-md transition-colors hover:bg-dark-teal/5"
          >
            {muted ? (
              <svg
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth={1.75}
                strokeLinecap="round"
                strokeLinejoin="round"
                className="h-5 w-5"
              >
                <path d="M11 5 6 9H2v6h4l5 4V5Z" />
                <path d="m22 9-6 6M16 9l6 6" />
              </svg>
            ) : (
              <svg
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth={1.75}
                strokeLinecap="round"
                strokeLinejoin="round"
                className="h-5 w-5"
              >
                <path d="M11 5 6 9H2v6h4l5 4V5Z" />
                <path d="M19.07 4.93a10 10 0 0 1 0 14.14M15.54 8.46a5 5 0 0 1 0 7.08" />
              </svg>
            )}
          </button>

          {/* Toasts globales de alertas (RF-16, RF-17) */}
          <div className="pointer-events-none fixed bottom-4 right-4 z-50 flex flex-col gap-2.5">
            {toasts.map((toast) => {
              const style = TOAST_STYLES[toast.severity];
              return (
                <div
                  key={toast.id}
                  role="alert"
                  className={`animate-alert-in pointer-events-auto flex min-w-[280px] max-w-sm items-start gap-3 rounded-lg px-4 py-3.5 text-sm ${style.toast}`}
                >
                  <svg
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth={2.25}
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    className={`mt-0.5 h-5 w-5 shrink-0 ${style.icon}`}
                  >
                    <path d="M12 9v4m0 4h.01" />
                    <path d="M10.29 3.86 1.82 18a1.5 1.5 0 0 0 1.29 2.25h17.78A1.5 1.5 0 0 0 22.18 18L13.71 3.86a1.5 1.5 0 0 0-2.42 0Z" />
                  </svg>
                  <div className="flex flex-col leading-tight">
                    <span className={`text-[10px] font-extrabold uppercase tracking-wider ${style.tag}`}>
                      {toast.tag}
                    </span>
                    <span className="font-bold text-xs mt-0.5">{toast.text}</span>
                  </div>
                </div>
              );
            })}
          </div>
        </>
      )}
    </AlertContext.Provider>
  );
}

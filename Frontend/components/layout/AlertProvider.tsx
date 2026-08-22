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
const TOAST_STYLES: Record<AlertSeverity, string> = {
  critica: 'border-rosy-copper/60 bg-rosy-copper text-ghost-white shadow-xl',
  alta: 'border-saffron/50 bg-saffron/10 text-saffron shadow-lg',
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

  // Consultar alertas reales de inactividad (>3h) desde el backend FastAPI
  const checkLiveAlertas = useCallback(async () => {
    try {
      const liveAlertas = await getAlertasNodosInactivosApi();
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
          <div className="pointer-events-none fixed bottom-4 right-4 z-50 flex flex-col gap-2">
            {toasts.map((toast) => (
              <div
                key={toast.id}
                role="alert"
                className={`pointer-events-auto flex min-w-[280px] max-w-sm items-start gap-2.5 rounded-lg border px-4 py-3 text-sm shadow-xl backdrop-blur-xs ${TOAST_STYLES[toast.severity]}`}
              >
                <svg
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth={2}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  className="mt-0.5 h-4 w-4 shrink-0"
                >
                  <path d="M12 9v4m0 4h.01" />
                  <path d="M10.29 3.86 1.82 18a1.5 1.5 0 0 0 1.29 2.25h17.78A1.5 1.5 0 0 0 22.18 18L13.71 3.86a1.5 1.5 0 0 0-2.42 0Z" />
                </svg>
                <div className="flex flex-col leading-tight">
                  <span className="text-[10px] font-bold uppercase tracking-wider opacity-90">
                    {toast.tag}
                  </span>
                  <span className="font-semibold text-xs mt-0.5">{toast.text}</span>
                </div>
              </div>
            ))}
          </div>
        </>
      )}
    </AlertContext.Provider>
  );
}

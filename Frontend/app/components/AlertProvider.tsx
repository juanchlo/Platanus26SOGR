'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from 'react';
import { useAppStore } from '@/store/useAppStore';
import type { Reporte, UrgenciaType } from '@/types';

// -----------------------------------------------------------------------
// Emulador local de un canal de WebSocket (RF-16).
//
// En producción esto sería un cliente WS/SSE conectado al backend
// (ej. `new WebSocket(...)` recibiendo eventos de nuevos reportes). Acá se
// emula con un `setInterval` que dispara eventos aleatorios cada cierto
// tiempo, más un disparo manual (botón "Probar alerta" en el header de
// AppShell, vía `useAlerts().triggerTestAlert()`).
//
// Cada evento entra al store como un `Reporte` nuevo (`addReporte`) y
// dispara un toast + alerta sonora (solo para urgencia "critica",
// silenciable con el botón flotante de mute).
// -----------------------------------------------------------------------

const SIMULATED_EVENTS: ReadonlyArray<{
  titulo: string;
  descripcion: string;
  type: string;
  urgency: UrgenciaType;
  comuna: string;
  lat: number;
  lng: number;
}> = [
  {
    titulo: 'Corte total de agua potable',
    descripcion:
      'Reporte entrante vía red de sensores: interrupción total del suministro en la zona.',
    type: 'agua',
    urgency: 'critica',
    comuna: 'Comuna 6',
    lat: 3.4783,
    lng: -76.5297,
  },
  {
    titulo: 'Incendio estructural reportado',
    descripcion:
      'Aviso ciudadano confirmado por dos fuentes: incendio activo cerca de vivienda.',
    type: 'incendio',
    urgency: 'critica',
    comuna: 'Comuna 20',
    lat: 3.4235,
    lng: -76.5559,
  },
  {
    titulo: 'Vía principal bloqueada por deslizamiento',
    descripcion:
      'Deslizamiento de tierra bloquea acceso a corredor logístico principal.',
    type: 'via',
    urgency: 'alta',
    comuna: 'Comuna 18',
    lat: 3.3691,
    lng: -76.5622,
  },
  {
    titulo: 'Bajo stock de medicinas en punto de salud',
    descripcion:
      'El puesto de salud comunitario reporta inventario crítico de insumos básicos.',
    type: 'medicinas',
    urgency: 'media',
    comuna: 'Comuna 10',
    lat: 3.4392,
    lng: -76.5218,
  },
];

// Intervalo del emulador (ms). Suficientemente espaciado para no saturar la
// demo, suficientemente corto para verse "vivo" durante el sprint.
const EMULATOR_INTERVAL_MS = 30_000;
const TOAST_LIFETIME_MS = 6_000;

interface AlertToast {
  id: string;
  titulo: string;
  urgency: UrgenciaType;
  comuna: string;
}

// Estilos por severidad, usando la paleta de marca (Rosy Copper / Saffron).
const TOAST_STYLES: Record<UrgenciaType, string> = {
  critica: 'border-rosy-copper/60 bg-rosy-copper text-ghost-white',
  alta: 'border-rosy-copper/50 bg-rosy-copper/10 text-rosy-copper',
  media: 'border-saffron/50 bg-saffron/10 text-saffron',
  baja: 'border-dark-teal/20 bg-white text-slate-600',
};

const URGENCY_LABELS: Record<UrgenciaType, string> = {
  critica: 'CRÍTICA',
  alta: 'ALTA',
  media: 'MEDIA',
  baja: 'BAJA',
};

// Beep discreto vía Web Audio API — solo para alertas de urgencia "critica".
// Sin assets externos; se omite silenciosamente si el navegador no soporta
// audio o si el usuario silenció las alertas.
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
    // Entorno sin soporte de audio (SSR, navegador restringido): se ignora.
  }
}

interface AlertContextValue {
  muted: boolean;
  toggleMuted: () => void;
  triggerTestAlert: () => void;
}

const AlertContext = createContext<AlertContextValue | null>(null);

// Hook de consumo para cualquier componente cliente bajo el provider
// (ej. el botón "Probar alerta" en el header de AppShell).
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
  const addReporte = useAppStore((state) => state.addReporte);
  const [toasts, setToasts] = useState<AlertToast[]>([]);
  const [muted, setMuted] = useState(false);
  const mutedRef = useRef(muted);
  mutedRef.current = muted;

  const emitAlert = useCallback(
    (forceCritical = false) => {
      const pool = forceCritical
        ? SIMULATED_EVENTS.filter((event) => event.urgency === 'critica')
        : SIMULATED_EVENTS;
      const event = pool[Math.floor(Math.random() * pool.length)];

      const reporte: Reporte = {
        id: `sim-${Date.now()}`,
        titulo: event.titulo,
        descripcion: event.descripcion,
        type: event.type,
        status: 'Pendiente',
        urgency: event.urgency,
        comuna: event.comuna,
        lat: event.lat,
        lng: event.lng,
      };

      addReporte(reporte);

      const toastId = reporte.id;
      setToasts((prev) => [
        ...prev,
        {
          id: toastId,
          titulo: reporte.titulo,
          urgency: reporte.urgency,
          comuna: reporte.comuna,
        },
      ]);
      setTimeout(() => {
        setToasts((prev) => prev.filter((toast) => toast.id !== toastId));
      }, TOAST_LIFETIME_MS);

      if (reporte.urgency === 'critica' && !mutedRef.current) {
        playCriticalAlertSound();
      }
    },
    [addReporte]
  );

  // Emulador de WebSocket: eventos periódicos "push" del servidor.
  useEffect(() => {
    const interval = setInterval(() => emitAlert(false), EMULATOR_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [emitAlert]);

  const triggerTestAlert = useCallback(() => emitAlert(true), [emitAlert]);
  const toggleMuted = useCallback(() => setMuted((prev) => !prev), []);

  return (
    <AlertContext.Provider value={{ muted, toggleMuted, triggerTestAlert }}>
      {children}

      {/* Toggle de silencio para las alertas sonoras */}
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

      {/* Toasts globales de alertas (RF-16) */}
      <div className="pointer-events-none fixed bottom-4 right-4 z-50 flex flex-col gap-2">
        {toasts.map((toast) => (
          <div
            key={toast.id}
            role="alert"
            className={`pointer-events-auto flex min-w-[260px] items-start gap-2 rounded-md border px-4 py-3 text-sm shadow-lg ${TOAST_STYLES[toast.urgency]}`}
          >
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth={1.75}
              strokeLinecap="round"
              strokeLinejoin="round"
              className="mt-0.5 h-4 w-4 shrink-0"
            >
              <path d="M12 9v4m0 4h.01" />
              <path d="M10.29 3.86 1.82 18a1.5 1.5 0 0 0 1.29 2.25h17.78A1.5 1.5 0 0 0 22.18 18L13.71 3.86a1.5 1.5 0 0 0-2.42 0Z" />
            </svg>
            <div className="flex flex-col">
              <span className="text-[10px] font-bold uppercase tracking-wide opacity-80">
                {URGENCY_LABELS[toast.urgency]} · {toast.comuna}
              </span>
              <span className="font-medium">{toast.titulo}</span>
            </div>
          </div>
        ))}
      </div>
    </AlertContext.Provider>
  );
}

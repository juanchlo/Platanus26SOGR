'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from 'react';

// -----------------------------------------------------------------------
// Emulador local de Supabase Realtime (RF-16 / RF-17).
//
// En producción esto sería el cliente `@supabase/supabase-js` suscrito a
// los canales `postgres_changes` que deja armados Backend/supabase/
// realtime.sql (ver Backend/realtime_config.py, sección a/b), más el
// endpoint que expone `alertas_nodos_inactivos()` (sección c). Acá se
// emula con un `setInterval` que dispara eventos aleatorios de esas DOS
// familias, más un disparo manual (botón "Probar alerta" del header de
// AppShell, vía `useAlerts().triggerTestAlert()`):
//
//   - "inventario": imita un evento UPDATE en la tabla `inventario`
//     (payload.new.nivel pasando a 'no_hay'/'poco') — RF-05/RF-16.
//   - "nodo_inactivo": imita un resultado de `alertas_nodos_inactivos()`
//     (RF-17), un punto de control activo que dejó de reportar inventario
//     hace más de 2h.
//
// Ninguno de los dos toca `reportes` en el store: son alertas operativas
// sobre `puntos_control`/`inventario`, un dominio distinto al de las
// necesidades civiles (`Reporte`) que ya vive ahí — mezclarlos rompería el
// contrato de `Reporte`. Cada evento solo dispara un toast + sonido.
// -----------------------------------------------------------------------

type InventarioEvent = {
  kind: 'inventario';
  puntoNombre: string;
  insumoNombre: string;
  nivel: 'no_hay' | 'poco';
};

type NodoInactivoEvent = {
  kind: 'nodo_inactivo';
  puntoNombre: string;
  horasSinReporte: number;
};

type SimulatedEvent = InventarioEvent | NodoInactivoEvent;

type AlertSeverity = 'critica' | 'alta';

// Puntos/insumos reales sembrados en Backend/supabase/seed.sql, para que la
// demo del pitch se sienta consistente entre el mapa, las misiones
// priorizadas y estas alertas simuladas.
const SIMULATED_EVENTS: ReadonlyArray<SimulatedEvent> = [
  {
    kind: 'inventario',
    puntoNombre: 'DEMO — Albergue Comuna 20',
    insumoNombre: 'agua',
    nivel: 'no_hay',
  },
  {
    kind: 'inventario',
    puntoNombre: 'DEMO — Albergue Comuna 13',
    insumoNombre: 'agua',
    nivel: 'poco',
  },
  {
    kind: 'inventario',
    puntoNombre: 'Banco de Alimentos de Cali',
    insumoNombre: 'pañales',
    nivel: 'no_hay',
  },
  {
    kind: 'nodo_inactivo',
    puntoNombre: 'Cruz Roja Seccional Valle',
    horasSinReporte: 2.3,
  },
  {
    kind: 'nodo_inactivo',
    puntoNombre: 'DEMO — Albergue Comuna 18',
    horasSinReporte: 3.1,
  },
];

function severityOf(event: SimulatedEvent): AlertSeverity {
  if (event.kind === 'nodo_inactivo') return 'critica'; // RF-17: nodo a oscuras siempre es crítico
  return event.nivel === 'no_hay' ? 'critica' : 'alta';
}

function messageOf(event: SimulatedEvent): { tag: string; text: string } {
  if (event.kind === 'nodo_inactivo') {
    return {
      tag: 'NODO INACTIVO',
      text: `${event.puntoNombre} sin reportar inventario hace ${event.horasSinReporte}h`,
    };
  }
  return {
    tag: 'INVENTARIO',
    text:
      event.nivel === 'no_hay'
        ? `${event.puntoNombre} se quedó sin ${event.insumoNombre}`
        : `${event.puntoNombre} con poco ${event.insumoNombre}`,
  };
}

// Intervalo del emulador (ms). Suficientemente espaciado para no saturar la
// demo, suficientemente corto para verse "vivo" durante el sprint.
const EMULATOR_INTERVAL_MS = 30_000;
const TOAST_LIFETIME_MS = 6_000;

interface AlertToast {
  id: string;
  tag: string;
  text: string;
  severity: AlertSeverity;
}

// Estilos por severidad, usando la paleta de marca (Rosy Copper / Saffron).
const TOAST_STYLES: Record<AlertSeverity, string> = {
  critica: 'border-rosy-copper/60 bg-rosy-copper text-ghost-white',
  alta: 'border-saffron/50 bg-saffron/10 text-saffron',
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
  const [toasts, setToasts] = useState<AlertToast[]>([]);
  const [muted, setMuted] = useState(false);
  const mutedRef = useRef(muted);
  mutedRef.current = muted;

  const emitAlert = useCallback((forceCritical = false) => {
    const pool = forceCritical
      ? SIMULATED_EVENTS.filter((event) => severityOf(event) === 'critica')
      : SIMULATED_EVENTS;
    const event = pool[Math.floor(Math.random() * pool.length)];
    const severity = severityOf(event);
    const { tag, text } = messageOf(event);

    const toastId = `sim-${Date.now()}`;
    setToasts((prev) => [...prev, { id: toastId, tag, text, severity }]);
    setTimeout(() => {
      setToasts((prev) => prev.filter((toast) => toast.id !== toastId));
    }, TOAST_LIFETIME_MS);

    if (severity === 'critica' && !mutedRef.current) {
      playCriticalAlertSound();
    }
  }, []);

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
            className={`pointer-events-auto flex min-w-[260px] items-start gap-2 rounded-md border px-4 py-3 text-sm shadow-lg ${TOAST_STYLES[toast.severity]}`}
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
                {toast.tag}
              </span>
              <span className="font-medium">{toast.text}</span>
            </div>
          </div>
        ))}
      </div>
    </AlertContext.Provider>
  );
}

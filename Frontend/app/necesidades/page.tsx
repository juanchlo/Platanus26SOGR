'use client';

import { useEffect, useMemo, useState } from 'react';
import { getAlertasDesabastecimientoApi } from '@/lib/api';
import type { AlertaDesabastecimiento } from '@/lib/api';
import { useAppStore } from '@/store/useAppStore';
import { isCivil } from '@/lib/rbac';

/** Distancia en metros entre dos coordenadas lat/lng (Haversine). Solo para
 *  ordenar el panel por cercanía real al civil -- no necesita la precisión
 *  geodésica de PostGIS que ya usa el backend para elegir el punto de entrega. */
function haversineMeters(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6_371_000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

function formatDistancia(metros: number): string {
  return metros < 1000 ? `${Math.round(metros)} m` : `${(metros / 1000).toFixed(1)} km`;
}

function googleMapsDirUrl(lat: number, lng: number): string {
  return `https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}`;
}

export default function NecesidadesComunidadPage() {
  const userSession = useAppStore((state) => state.userSession);
  const [alertas, setAlertas] = useState<AlertaDesabastecimiento[]>([]);
  const [loading, setLoading] = useState(true);
  // Solo para ordenar por cercanía -- nunca se envía al backend.
  const [civilPos, setCivilPos] = useState<{ lat: number; lng: number } | null>(null);
  const [geoEstado, setGeoEstado] = useState<'pidiendo' | 'concedido' | 'denegado' | 'no_soportado'>('pidiendo');

  useEffect(() => {
    let cancelled = false;
    async function fetchAlertas() {
      const data = await getAlertasDesabastecimientoApi();
      if (!cancelled) {
        setAlertas(data);
        setLoading(false);
      }
    }
    fetchAlertas();
    const interval = setInterval(fetchAlertas, 30_000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, []);

  useEffect(() => {
    if (typeof navigator === 'undefined' || !navigator.geolocation) {
      setGeoEstado('no_soportado');
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setCivilPos({ lat: pos.coords.latitude, lng: pos.coords.longitude });
        setGeoEstado('concedido');
      },
      () => setGeoEstado('denegado'), // se cae al orden de llegada que ya trae el backend
      { enableHighAccuracy: false, timeout: 8000, maximumAge: 5 * 60_000 }
    );
  }, []);

  // Sin GPS: se respeta el orden que ya trae el backend (creado_en ASC = orden
  // de llegada). Con GPS: se reordena por cercanía real al punto de entrega
  // (la ubicación accionable para el civil -- no el evento del desastre).
  const alertasOrdenadas = useMemo(() => {
    if (!civilPos) return alertas;
    return [...alertas].sort(
      (a, b) =>
        haversineMeters(civilPos.lat, civilPos.lng, a.punto_entrega_lat, a.punto_entrega_lng) -
        haversineMeters(civilPos.lat, civilPos.lng, b.punto_entrega_lat, b.punto_entrega_lng)
    );
  }, [alertas, civilPos]);

  // Esta vista es exclusiva del Civil (sin sesión, o rol 'civil'): el
  // personal autenticado gestiona el desabastecimiento desde el mapa
  // operativo, no desde acá.
  if (!isCivil(userSession?.role)) {
    return (
      <div className="rounded-lg border border-dark-teal/10 bg-white p-6 shadow-sm">
        <h1 className="text-lg font-bold text-rosy-copper">Acceso Restringido</h1>
        <p className="mt-2 text-sm text-slate-600">
          Esta vista es exclusiva del portal público (Civil). Cerrá sesión para consultarla, o
          volvé al <a href="/mapa" className="font-bold text-dark-teal hover:underline">mapa operativo</a>.
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6 p-2 sm:p-4">
      {/* Encabezado */}
      <div className="rounded-xl bg-dark-teal p-5 text-white shadow-md">
        <span className="text-[11px] font-semibold uppercase tracking-wider text-saffron">
          Portal Público · Ciudadano
        </span>
        <h1 className="text-xl font-bold">Necesidades de la Comunidad</h1>
        <p className="mt-1 text-sm text-on-dark-muted max-w-2xl">
          Insumos que hoy la red de ayuda no puede cubrir con lo que tiene disponible.
          Si podés donar alguno, llevalo al punto de entrega indicado.
        </p>
      </div>

      {/* Estelar: Necesidades sin cobertura — grande, accesible, protagonista */}
      <section>
        <div className="flex flex-wrap items-end justify-between gap-2 mb-3">
          <div className="flex items-center gap-2.5">
            <span
              className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-rosy-copper text-white text-lg"
              aria-hidden="true"
            >
              ⚠️
            </span>
            <h2 className="text-lg sm:text-xl font-extrabold text-rosy-copper">
              Necesidades sin cobertura
            </h2>
          </div>
          {!loading && alertasOrdenadas.length > 0 && (
            <span className="text-xs font-bold text-on-light-muted">
              {civilPos ? 'Ordenadas por cercanía a tu ubicación' : 'Ordenadas por orden de llegada'}
            </span>
          )}
        </div>

        {loading ? (
          <div className="rounded-2xl border-2 border-dashed border-slate-200 bg-white p-10 text-center text-sm font-semibold text-slate-400">
            Cargando necesidades…
          </div>
        ) : alertasOrdenadas.length === 0 ? (
          <div className="rounded-2xl border-2 border-muted-teal/40 bg-muted-teal/10 p-10 text-center">
            <span className="text-4xl" aria-hidden="true">✅</span>
            <p className="mt-2 text-base font-extrabold text-dark-teal">Sin escasez reportada</p>
            <p className="mt-1 text-sm text-on-light-muted">
              Ahora mismo la red de ayuda tiene stock suficiente para todo lo que se ha pedido.
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4">
            {alertasOrdenadas.map((a, i) => {
              const distancia = civilPos
                ? haversineMeters(civilPos.lat, civilPos.lng, a.punto_entrega_lat, a.punto_entrega_lng)
                : null;
              return (
                <div
                  key={`${a.insumo_nombre}-${a.punto_entrega_nombre}-${i}`}
                  className="flex flex-col rounded-2xl border-2 border-rosy-copper/25 bg-white p-5 shadow-sm hover:shadow-lg hover:border-rosy-copper/50 transition"
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-[11px] font-extrabold uppercase tracking-wider text-rosy-copper">
                      Se necesita
                    </span>
                    {distancia !== null && (
                      <span className="shrink-0 rounded-full bg-dark-teal/10 px-2.5 py-1 text-[11px] font-bold text-dark-teal">
                        {formatDistancia(distancia)}
                      </span>
                    )}
                  </div>

                  <div className="mt-2 flex items-baseline gap-1.5">
                    <span className="text-4xl font-extrabold text-dark-teal leading-none">
                      {a.deficit}
                    </span>
                    <span className="text-sm font-bold text-on-light-muted">{a.unidad}</span>
                  </div>
                  <div className="text-base font-bold text-slate-800 capitalize">
                    de {a.insumo_nombre}
                  </div>

                  <div className="mt-4 pt-4 border-t border-slate-100">
                    <div className="text-[11px] font-bold uppercase tracking-wide text-on-light-muted">
                      📍 Llevar a
                    </div>
                    <div className="text-sm font-bold text-dark-teal">
                      {a.punto_entrega_nombre}
                      {a.punto_entrega_tipo ? ` · ${a.punto_entrega_tipo}` : ''}
                    </div>
                    {a.punto_entrega_direccion && (
                      <div className="text-xs text-on-light-muted">{a.punto_entrega_direccion}</div>
                    )}

                    <a
                      href={googleMapsDirUrl(a.punto_entrega_lat, a.punto_entrega_lng)}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="mt-3 flex w-full items-center justify-center gap-1.5 rounded-lg bg-dark-teal py-2.5 text-sm font-extrabold text-white transition hover:bg-[#0a5e78] active:bg-[#063848]"
                    >
                      Cómo llegar →
                    </a>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>

      {/* Secundario: explicación de la lista, deliberadamente discreta -- lo
          protagonista es la lista de arriba, esto es solo contexto opcional. */}
      <details className="group rounded-lg border border-slate-200 bg-white px-4 py-3 text-sm">
        <summary className="cursor-pointer list-none font-semibold text-on-light-muted flex items-center gap-1.5 select-none">
          <span
            className="inline-block transition-transform group-open:rotate-90 text-slate-400"
            aria-hidden="true"
          >
            ▸
          </span>
          ¿Cómo funciona esta lista?
        </summary>
        <div className="mt-2.5 pl-5 text-sm text-slate-600 leading-relaxed">
          <p>
            Cada tarjeta representa un insumo que la red de <strong>Nodos de Ayuda</strong>{' '}
            (albergues, centros de acopio, puestos de salud) necesita hoy y que no alcanza a
            cubrir con el stock que tiene en toda la ciudad. No mostramos el sitio del desastre
            ni a quién ayuda: solo qué hace falta y a qué punto de la ciudad podés llevarlo —
            siempre el Nodo de Ayuda activo más cercano al evento que lo necesita.
          </p>
          <p className="mt-2">
            Si le damos permiso de ubicación a tu navegador, ordenamos la lista por cercanía a
            vos. Si no, queda en orden de llegada (lo más antiguo primero).
          </p>
          {geoEstado === 'denegado' && (
            <p className="mt-2 text-xs font-semibold text-amber-700 bg-amber-50 border border-amber-200 rounded-md px-3 py-2">
              No pudimos acceder a tu ubicación — la lista está ordenada por orden de llegada.
              Podés habilitar el permiso de ubicación en tu navegador y recargar la página.
            </p>
          )}
        </div>
      </details>

      <a
        href="/mapa"
        className="rounded-xl border border-dashed border-dark-teal/25 bg-dark-teal/5 p-4 text-sm font-semibold text-dark-teal hover:bg-dark-teal/10 transition text-center"
      >
        Ver el mapa completo de la ciudad →
      </a>
    </div>
  );
}

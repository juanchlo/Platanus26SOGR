'use client';

import { useState, useEffect, type FormEvent } from 'react';
import { useAppStore } from '@/store/useAppStore';
import { createIncidenteApi } from '@/lib/api';
import { puedeReportarIncidentes } from '@/lib/rbac';
import type { Incidente } from '@/types';

const RAPID_CHIPS = [
  'Derrumbe en ladera con familias atrapadas',
  'Inundación severa por desbordamiento',
  'Familias sin agua potable ni alimentos',
  'Heridos requieren primeros auxilios y traslado',
  'Incendio estructural con riesgo de propagación',
  'Colapso de vía y puente de acceso',
];

export default function OperadorReportePage() {
  const userSession = useAppStore((state) => state.userSession);

  // Estados de geolocalización
  const [lat, setLat] = useState<number | null>(null);
  const [lng, setLng] = useState<number | null>(null);
  const [accuracy, setAccuracy] = useState<number | null>(null);
  const [locating, setLocating] = useState(false);
  const [locationError, setLocationError] = useState<string | null>(null);

  // Formulario de campo
  const [testimonio, setTestimonio] = useState('');
  const [direccion, setDireccion] = useState('');
  const [barrio, setBarrio] = useState('');

  // Estados de envío y análisis IA
  const [submitting, setSubmitting] = useState(false);
  const [createdIncidente, setCreatedIncidente] = useState<Incidente | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // Función para capturar GPS del operador
  function handleCaptureGPS() {
    if (!navigator.geolocation) {
      setLocationError('Tu dispositivo o navegador no soporta geolocalización GPS.');
      return;
    }

    setLocating(true);
    setLocationError(null);

    navigator.geolocation.getCurrentPosition(
      (position) => {
        const latitude = Number(position.coords.latitude.toFixed(5));
        const longitude = Number(position.coords.longitude.toFixed(5));
        const acc = Math.round(position.coords.accuracy);

        setLat(latitude);
        setLng(longitude);
        setAccuracy(acc);
        setLocating(false);

        useAppStore.getState().setSelectedMapCoords([longitude, latitude]);
      },
      (err) => {
        console.warn('Error capturando GPS:', err);
        // Fallback en Cali si el usuario no tiene GPS activo
        setLat(3.4250);
        setLng(-76.5450);
        setAccuracy(50);
        setLocationError('No se pudo acceder al GPS satelital. Se asignó ubicación aproximada en Cali.');
        setLocating(false);
        useAppStore.getState().setSelectedMapCoords([-76.5450, 3.4250]);
      },
      {
        enableHighAccuracy: true,
        timeout: 10000,
        maximumAge: 0,
      }
    );
  }

  // Auto-capturar ubicación al montar para agilizar al operador
  useEffect(() => {
    handleCaptureGPS();
  }, []);

  function handleAddChip(chipText: string) {
    setTestimonio((prev) => (prev ? `${prev}. ${chipText}` : chipText));
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!userSession?.token) return;

    if (!testimonio.trim()) {
      setErrorMsg('Por favor describe la situación o testimonio de la emergencia.');
      return;
    }

    if (lat === null || lng === null) {
      setErrorMsg('Debes capturar tu ubicación GPS para georreferenciar el incidente.');
      return;
    }

    try {
      setSubmitting(true);
      setErrorMsg(null);
      setCreatedIncidente(null);

      const res = await createIncidenteApi(userSession.token, {
        testimonio: testimonio.trim(),
        lat,
        lng,
        direccion: direccion.trim() || undefined,
        barrio: barrio.trim() || undefined,
      });

      setCreatedIncidente(res);
      setTestimonio('');
    } catch (err: any) {
      console.error('Error transmitiendo incidente:', err);
      setErrorMsg(err.message || 'Error al transmitir el incidente.');
    } finally {
      setSubmitting(false);
    }
  }

  function handleReset() {
    setCreatedIncidente(null);
    setTestimonio('');
    handleCaptureGPS();
  }

  if (!userSession || !puedeReportarIncidentes(userSession.role)) {
    return (
      <div className="rounded-xl border border-dark-teal/10 bg-white p-6 shadow-sm">
        <h1 className="text-lg font-bold text-rosy-copper">Acceso Restringido</h1>
        <p className="mt-2 text-sm text-slate-600">
          Esta interfaz está destinada para el <strong>Operador de Campo</strong>, <strong>Ente Público</strong> o <strong>Administrador Gubernamental</strong>.
        </p>
        <a
          href="/login"
          className="mt-4 inline-block rounded-md bg-dark-teal px-4 py-2 text-xs font-bold text-white hover:bg-dark-teal/90"
        >
          Iniciar Sesión
        </a>
      </div>
    );
  }

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-4 p-2 sm:p-4">
      {/* Cabecera del Operador */}
      <div className="rounded-xl bg-dark-teal p-5 text-white shadow-md">
        <div className="flex items-center justify-between">
          <span className="rounded-md bg-rosy-copper px-2.5 py-0.5 text-[11px] font-bold uppercase tracking-wider text-white">
            🚨 Módulo de Campo · SOGR
          </span>
          <span className="text-xs text-ghost-white/80">
            {userSession.email || 'Operador en Terreno'}
          </span>
        </div>
        <h1 className="mt-2 text-xl font-bold">Registro Rápido de Incidente / Zona Afectada</h1>
        <p className="mt-1 text-xs text-ghost-white/80">
          Captura tu ubicación y transmite el testimonio. El motor IA analizará automáticamente la gravedad y calculará los insumos requeridos.
        </p>
      </div>

      {/* Tarjeta de Confirmación / Diagnóstico IA si ya fue transmitido */}
      {createdIncidente ? (
        <div className="flex flex-col gap-4 rounded-xl border border-emerald-300 bg-white p-5 shadow-lg">
          <div className="flex items-center justify-between border-b border-slate-100 pb-3">
            <div className="flex items-center gap-2">
              <span className="flex h-3 w-3 rounded-full bg-emerald-500 animate-ping" />
              <h2 className="text-base font-bold text-dark-teal">
                ✓ Incidente Transmitido y Procesado por IA
              </h2>
            </div>
            <span
              className={`rounded-md px-2.5 py-1 text-xs font-bold ${
                createdIncidente.urgencia >= 4
                  ? 'bg-rose-100 text-rose-800'
                  : createdIncidente.urgencia === 3
                  ? 'bg-amber-100 text-amber-800'
                  : 'bg-teal-100 text-teal-800'
              }`}
            >
              Prioridad IA: {createdIncidente.urgencia}/5
            </span>
          </div>

          <div className="rounded-lg bg-slate-50 p-3 text-xs text-slate-800 border border-slate-200">
            <div className="font-bold text-dark-teal mb-1">🏷️ Categoría Detectada: {createdIncidente.tipo}</div>
            <div className="text-slate-600 leading-relaxed">{createdIncidente.analisis_ia}</div>
            <div className="mt-2 text-[11px] text-slate-500">
              📍 Ubicación: {createdIncidente.barrio || 'Cali'} ({createdIncidente.lat.toFixed(4)}, {createdIncidente.lng.toFixed(4)})
            </div>
          </div>

          {/* Recursos asignados por el LLM */}
          <div>
            <h3 className="text-xs font-bold uppercase tracking-wider text-slate-700 mb-2">
              📦 Recursos y Servicios Sugeridos por el LLM ({createdIncidente.recursos_solicitados.length}):
            </h3>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              {createdIncidente.recursos_solicitados.map((rec, idx) => (
                <div
                  key={idx}
                  className="rounded-lg border border-dark-teal/15 bg-ghost-white p-2.5 text-xs flex flex-col justify-between"
                >
                  <div className="flex items-center justify-between">
                    <span className="font-bold text-slate-900">{rec.insumo_nombre}</span>
                    <span className="rounded bg-dark-teal/10 px-1.5 py-0.5 text-[10px] font-bold text-dark-teal">
                      {rec.cantidad_estimada} {rec.unidad}
                    </span>
                  </div>
                  <span className="text-[10px] text-slate-500 mt-1">{rec.razon}</span>
                </div>
              ))}
            </div>
          </div>

          <div className="flex items-center justify-end gap-3 pt-3 border-t border-slate-100">
            <a
              href="/mapa"
              className="rounded-md border border-slate-300 px-4 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50 transition"
            >
              Ver en el Mapa Operativo
            </a>
            <button
              type="button"
              onClick={handleReset}
              className="rounded-md bg-dark-teal px-4 py-2 text-xs font-bold text-white shadow hover:bg-dark-teal/90 transition"
            >
              + Reportar Nuevo Incidente
            </button>
          </div>
        </div>
      ) : (
        /* Formulario de Transmisión */
        <form onSubmit={handleSubmit} className="flex flex-col gap-4 rounded-xl border border-dark-teal/15 bg-white p-5 shadow-sm">
          {errorMsg && (
            <div className="rounded-lg bg-rose-50 border border-rose-200 p-3 text-xs font-semibold text-rose-700">
              {errorMsg}
            </div>
          )}

          {/* 1. SECCIÓN DE GEOLOCALIZACIÓN GPS */}
          <div className="rounded-xl border border-dark-teal/20 bg-slate-50/80 p-4 flex flex-col gap-3">
            <div className="flex items-center justify-between">
              <label className="text-xs font-bold uppercase tracking-wider text-dark-teal flex items-center gap-1.5">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="h-4 w-4 text-rosy-copper">
                  <path d="M12 21a9 9 0 0 0 9-9c0-4.97-4.03-9-9-9s-9 4.03-9 9a9 9 0 0 0 9 9Z" />
                  <circle cx="12" cy="12" r="3" />
                </svg>
                1. Geolocalización GPS del Operador en Cali
              </label>
              {accuracy && (
                <span className="text-[10px] font-semibold text-emerald-700 bg-emerald-50 border border-emerald-200 px-2 py-0.5 rounded">
                  📡 Precisión: ±{accuracy}m
                </span>
              )}
            </div>

            <div className="flex flex-col sm:flex-row items-center gap-3">
              <button
                type="button"
                onClick={handleCaptureGPS}
                disabled={locating}
                className="w-full sm:w-auto flex items-center justify-center gap-2 rounded-lg bg-dark-teal px-4 py-2.5 text-xs font-bold text-white shadow hover:bg-dark-teal/90 disabled:opacity-50 transition shrink-0"
              >
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className={`h-4 w-4 ${locating ? 'animate-spin' : ''}`}>
                  <path d="M12 2v20M2 12h20M12 7a5 5 0 1 0 0 10 5 5 0 0 0 0-10Z" />
                </svg>
                {locating ? 'Capturando Satélites...' : '📍 Actualizar Mi GPS'}
              </button>

              <div className="flex-1 w-full bg-white rounded-lg border border-slate-200 p-2 text-xs font-mono">
                {lat !== null && lng !== null ? (
                  <div className="flex items-center justify-between text-slate-800">
                    <span>Lat: <strong>{lat.toFixed(5)}</strong></span>
                    <span>Lng: <strong>{lng.toFixed(5)}</strong></span>
                    <span className="text-emerald-600 font-bold">✓ Fijado</span>
                  </div>
                ) : (
                  <span className="text-slate-400">Presiona el botón para capturar coordenadas...</span>
                )}
              </div>
            </div>

            {locationError && (
              <div className="text-[11px] font-semibold text-amber-700 bg-amber-50 rounded p-1.5 border border-amber-200">
                {locationError}
              </div>
            )}

            {/* Referencia o Barrio opcional */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 pt-1">
              <input
                type="text"
                value={barrio}
                onChange={(e) => setBarrio(e.target.value)}
                placeholder="Barrio o Sector (ej. Siloé, Terrón Colorado)"
                className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-xs focus:border-dark-teal outline-none"
              />
              <input
                type="text"
                value={direccion}
                onChange={(e) => setDireccion(e.target.value)}
                placeholder="Dirección o Referencia (ej. Calle 5 con Cra 40)"
                className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-xs focus:border-dark-teal outline-none"
              />
            </div>
          </div>

          {/* 2. SECCIÓN DE TESTIMONIO EN TERRENO */}
          <div className="flex flex-col gap-2">
            <div className="flex items-center justify-between">
              <label className="text-xs font-bold uppercase tracking-wider text-slate-800">
                2. Testimonio del Operador (Descripción de la Emergencia) *
              </label>
              <span className="text-[10px] text-slate-400">Analizado automáticamente por IA</span>
            </div>

            <textarea
              required
              rows={4}
              value={testimonio}
              onChange={(e) => setTestimonio(e.target.value)}
              placeholder="Describe lo que observas en el terreno: personas atrapadas, heridos, número de familias damnificadas, corte de agua potable, falta de alimentos, daños estructurales..."
              className="w-full rounded-xl border border-slate-300 p-3 text-xs leading-relaxed focus:border-dark-teal focus:ring-1 focus:ring-dark-teal outline-none"
            />

            {/* Chips de acceso rápido */}
            <div className="flex flex-wrap gap-1.5 pt-1">
              <span className="text-[10px] text-slate-400 self-center">Plantillas rápidas:</span>
              {RAPID_CHIPS.map((chip, idx) => (
                <button
                  key={idx}
                  type="button"
                  onClick={() => handleAddChip(chip)}
                  className="rounded-md border border-slate-200 bg-slate-50 px-2 py-1 text-[10px] font-medium text-slate-700 hover:border-dark-teal hover:bg-dark-teal/10 hover:text-dark-teal transition text-left"
                >
                  + {chip}
                </button>
              ))}
            </div>
          </div>

          {/* 3. BOTÓN DE TRANSMISIÓN */}
          <div className="pt-2 border-t border-slate-100 flex items-center justify-between">
            <span className="text-[11px] text-slate-500">
              Se registrará con tu usuario de operador.
            </span>

            <button
              type="submit"
              disabled={submitting || !testimonio.trim() || lat === null}
              className="flex items-center gap-2 rounded-xl bg-rosy-copper px-6 py-3 text-xs font-bold text-white shadow-lg hover:bg-rosy-copper/90 transition disabled:opacity-50"
            >
              {submitting ? (
                <>
                  <svg className="h-4 w-4 animate-spin" viewBox="0 0 24 24" fill="none">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                  </svg>
                  Analizando con IA y Transmitiendo...
                </>
              ) : (
                '🚨 Transmitir Incidente a Central'
              )}
            </button>
          </div>
        </form>
      )}
    </div>
  );
}

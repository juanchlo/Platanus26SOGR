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

const CALI_SECTORS_FAST = [
  { name: 'Siloé (La Estrella)', lat: 3.4250, lng: -76.5580 },
  { name: 'Terrón Colorado (Comuna 1)', lat: 3.4600, lng: -76.5550 },
  { name: 'Alfonso López (Comuna 7)', lat: 3.4580, lng: -76.4970 },
  { name: 'San Fernando / Pascual', lat: 3.4296, lng: -76.5414 },
  { name: 'Aguablanca / El Diamante', lat: 3.4180, lng: -76.5050 },
  { name: 'Meléndez / Alto Nápoles', lat: 3.3712, lng: -76.5450 },
];

export default function CrearIncidenteModal() {
  const isModalOpen = useAppStore((state) => state.isCrearIncidenteModalOpen);
  const setModalOpen = useAppStore((state) => state.setCrearIncidenteModalOpen);
  const userSession = useAppStore((state) => state.userSession);
  const addIncidente = useAppStore((state) => state.addIncidente);
  const selectedMapCoords = useAppStore((state) => state.selectedMapCoords);

  const [testimonio, setTestimonio] = useState('');
  const [lat, setLat] = useState<number | string>(3.4250);
  const [lng, setLng] = useState<number | string>(-76.5580);
  const [direccion, setDireccion] = useState('');
  const [barrio, setBarrio] = useState('Siloé');
  const [urgenciaManual, setUrgenciaManual] = useState<number | null>(null);

  const [submitting, setSubmitting] = useState(false);
  const [isGeocoding, setIsGeocoding] = useState(false);
  const [geocodeFeedback, setGeocodeFeedback] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [createdIncidente, setCreatedIncidente] = useState<Incidente | null>(null);

  // Sync coords from map click
  useEffect(() => {
    if (selectedMapCoords) {
      setLng(selectedMapCoords[0]);
      setLat(selectedMapCoords[1]);
    }
  }, [selectedMapCoords, isModalOpen]);

  useEffect(() => {
    if (isModalOpen) {
      setErrorMsg(null);
      setCreatedIncidente(null);
      setGeocodeFeedback(null);
    }
  }, [isModalOpen]);

  if (!isModalOpen) return null;

  if (!userSession || !puedeReportarIncidentes(userSession.role)) {
    return null;
  }

  function handleSelectSector(sector: (typeof CALI_SECTORS_FAST)[0]) {
    setLat(sector.lat);
    setLng(sector.lng);
    setBarrio(sector.name.split('(')[0].trim());
    useAppStore.getState().setSelectedMapCoords([sector.lng, sector.lat]);
    setGeocodeFeedback(`📍 Ubicado en: ${sector.name}`);
  }

  async function handleGeocodeAddress() {
    if (!direccion.trim()) {
      setGeocodeFeedback('Escribe una dirección para ubicar en Cali.');
      return;
    }

    setIsGeocoding(true);
    setGeocodeFeedback(null);

    try {
      const url = `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(
        `${direccion.trim()}, Cali, Valle del Cauca, Colombia`
      )}&viewbox=-76.59,3.53,-76.45,3.31&bounded=1&limit=3`;

      const res = await fetch(url, { headers: { 'Accept-Language': 'es' } });
      if (res.ok) {
        const data = await res.json();
        if (data && data.length > 0) {
          const first = data[0];
          const newLat = Number(parseFloat(first.lat).toFixed(5));
          const newLng = Number(parseFloat(first.lon).toFixed(5));
          setLat(newLat);
          setLng(newLng);
          useAppStore.getState().setSelectedMapCoords([newLng, newLat]);
          setGeocodeFeedback(`✓ Ubicado en mapa: Lat ${newLat}, Lng ${newLng}`);
          setIsGeocoding(false);
          return;
        }
      }
    } catch {
      // ignore
    }

    setGeocodeFeedback('⚠️ Coordenadas aproximadas asignadas en Cali.');
    setIsGeocoding(false);
  }

  function handleAddChip(chipText: string) {
    setTestimonio((prev) => (prev ? `${prev}. ${chipText}` : chipText));
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!userSession?.token) return;

    if (!testimonio.trim()) {
      setErrorMsg('Por favor describe la situación del incidente.');
      return;
    }

    const numLat = Number(lat);
    const numLng = Number(lng);
    if (isNaN(numLat) || isNaN(numLng)) {
      setErrorMsg('Coordenadas inválidas.');
      return;
    }

    try {
      setSubmitting(true);
      setErrorMsg(null);

      const res = await createIncidenteApi(userSession.token, {
        testimonio: testimonio.trim(),
        lat: numLat,
        lng: numLng,
        direccion: direccion.trim() || undefined,
        barrio: barrio.trim() || undefined,
        urgencia_manual: urgenciaManual ?? undefined,
      });

      addIncidente(res);
      setCreatedIncidente(res);
    } catch (err: any) {
      console.error('Error reportando incidente:', err);
      setErrorMsg(err.message || 'Error al transmitir el incidente.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xs p-4 overflow-y-auto">
      <div className="relative w-full max-w-xl rounded-xl border border-dark-teal/15 bg-white shadow-2xl overflow-hidden my-8">
        {/* Cabecera modal */}
        <div className="flex items-center justify-between bg-rosy-copper px-6 py-4 text-white">
          <div className="flex items-center gap-2.5">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-white/20">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="h-5 w-5">
                <path d="M12 9v4m0 4h.01" />
                <path d="M10.29 3.86 1.82 18a1.5 1.5 0 0 0 1.29 2.25h17.78A1.5 1.5 0 0 0 22.18 18L13.71 3.86a1.5 1.5 0 0 0-2.42 0Z" />
              </svg>
            </div>
            <div>
              <h2 className="text-base font-bold">Reportar Incidente / Nodo Afectado en Cali</h2>
              <p className="text-xs text-white/80">Procesamiento y Asignación de Recursos con IA (SOGR)</p>
            </div>
          </div>
          <button
            type="button"
            onClick={() => setModalOpen(false)}
            className="rounded-lg p-1 text-white/80 hover:bg-white/10 hover:text-white"
          >
            ✕
          </button>
        </div>

        {createdIncidente ? (
          <div className="p-6 flex flex-col gap-4">
            <div className="flex items-center gap-2 text-emerald-700 font-bold text-sm">
              <span className="flex h-3 w-3 rounded-full bg-emerald-500 animate-ping" />
              ✓ Incidente registrado con éxito y analizado por IA
            </div>

            <div className="rounded-lg bg-slate-50 p-4 border border-slate-200 text-xs flex flex-col gap-2">
              <div className="flex items-center justify-between">
                <span className="font-bold text-dark-teal">🏷️ {createdIncidente.tipo}</span>
                <span
                  className={`rounded px-2 py-0.5 font-bold shadow-sm ${
                    createdIncidente.urgencia >= 4
                      ? 'bg-rosy-copper text-white'
                      : 'bg-saffron text-slate-900'
                  }`}
                >
                  Urgencia IA: {createdIncidente.urgencia}/5
                </span>
              </div>
              <p className="text-slate-700">{createdIncidente.analisis_ia}</p>
              <div className="text-[11px] text-slate-500">
                📍 {createdIncidente.barrio} ({createdIncidente.lat.toFixed(4)}, {createdIncidente.lng.toFixed(4)})
              </div>
            </div>

            <div>
              <h4 className="text-xs font-bold uppercase text-slate-700 mb-2">
                📦 Insumos Requeridos Estimados ({createdIncidente.recursos_solicitados.length}):
              </h4>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                {createdIncidente.recursos_solicitados.map((rec, idx) => (
                  <div key={idx} className="rounded border border-dark-teal/15 p-2 bg-ghost-white text-xs">
                    <div className="font-bold text-slate-900">{rec.insumo_nombre}</div>
                    <div className="text-[11px] text-dark-teal font-semibold">
                      {rec.cantidad_estimada} {rec.unidad}
                    </div>
                    <div className="text-[10px] text-slate-500 mt-0.5">{rec.razon}</div>
                  </div>
                ))}
              </div>
            </div>

            <div className="flex justify-end pt-3 border-t border-slate-100">
              <button
                type="button"
                onClick={() => setModalOpen(false)}
                className="rounded-md bg-dark-teal px-5 py-2 text-xs font-bold text-white shadow hover:bg-dark-teal/90"
              >
                Cerrar y Ver en el Mapa
              </button>
            </div>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="p-6 flex flex-col gap-4 max-h-[80vh] overflow-y-auto">
            {errorMsg && (
              <div className="rounded-lg bg-rose-50 border border-rose-200 p-3 text-xs text-rose-700">
                {errorMsg}
              </div>
            )}

            {/* 1. Ubicación en el Mapa o Dirección */}
            <div className="rounded-lg border border-dark-teal/20 bg-slate-50/70 p-3.5 flex flex-col gap-2.5">
              <div className="flex items-center justify-between">
                <label className="text-xs font-bold text-dark-teal flex items-center gap-1.5">
                  📍 Ubicación del Incidente en Cali (Haz clic en el mapa o escribe dirección)
                </label>
                <span className="text-[10px] text-slate-500">Auto-sincronizado con mapa</span>
              </div>

              <div className="flex items-center gap-2">
                <input
                  type="text"
                  value={direccion}
                  onChange={(e) => setDireccion(e.target.value)}
                  placeholder="Ej. Ladera Siloé, Calle 5 con Cra 40, Alfonso López..."
                  className="flex-1 rounded-md border border-slate-300 bg-white px-3 py-2 text-xs focus:border-dark-teal outline-none font-medium"
                />
                <button
                  type="button"
                  onClick={handleGeocodeAddress}
                  disabled={isGeocoding || !direccion.trim()}
                  className="flex items-center gap-1.5 rounded-md bg-dark-teal px-3 py-2 text-xs font-bold text-white shadow hover:bg-dark-teal/90 disabled:opacity-50 transition shrink-0"
                >
                  {isGeocoding ? 'Buscando...' : 'Ubicar'}
                </button>
              </div>

              {geocodeFeedback && (
                <div className="text-[11px] font-semibold text-dark-teal bg-white border border-dark-teal/15 rounded p-1.5">
                  {geocodeFeedback}
                </div>
              )}

              {/* Sectores comunes */}
              <div className="flex flex-wrap items-center gap-1.5 pt-1">
                <span className="text-[10px] text-slate-400 font-semibold">Sectores frecuentes:</span>
                {CALI_SECTORS_FAST.map((sec) => (
                  <button
                    key={sec.name}
                    type="button"
                    onClick={() => handleSelectSector(sec)}
                    className="rounded border border-slate-200 bg-white px-2 py-0.5 text-[10px] font-medium text-dark-teal hover:border-dark-teal hover:bg-dark-teal/5 transition"
                  >
                    {sec.name.split('(')[0]}
                  </button>
                ))}
              </div>

              {/* Coordenadas numéricas */}
              <div className="grid grid-cols-2 gap-3 pt-1">
                <div>
                  <span className="text-[10px] text-slate-500">Latitud</span>
                  <input
                    type="number"
                    step="any"
                    required
                    value={lat}
                    onChange={(e) => {
                      const v = e.target.value;
                      setLat(v);
                      if (!isNaN(Number(v)) && !isNaN(Number(lng))) {
                        useAppStore.getState().setSelectedMapCoords([Number(lng), Number(v)]);
                      }
                    }}
                    className="w-full rounded border border-slate-300 px-2 py-1 text-xs font-mono font-bold"
                  />
                </div>
                <div>
                  <span className="text-[10px] text-slate-500">Longitud</span>
                  <input
                    type="number"
                    step="any"
                    required
                    value={lng}
                    onChange={(e) => {
                      const v = e.target.value;
                      setLng(v);
                      if (!isNaN(Number(v)) && !isNaN(Number(lat))) {
                        useAppStore.getState().setSelectedMapCoords([Number(v), Number(lat)]);
                      }
                    }}
                    className="w-full rounded border border-slate-300 px-2 py-1 text-xs font-mono font-bold"
                  />
                </div>
              </div>
            </div>

            {/* 2. Testimonio / Descripción de la Emergencia */}
            <div className="flex flex-col gap-2">
              <div className="flex items-center justify-between">
                <label className="text-xs font-bold uppercase tracking-wider text-slate-800">
                  Testimonio / Situación de Emergencia *
                </label>
                <span className="text-[10px] text-slate-400">El LLM analizará y asignará insumos</span>
              </div>

              <textarea
                required
                rows={4}
                value={testimonio}
                onChange={(e) => setTestimonio(e.target.value)}
                placeholder="Describe la situación: qué ocurrió, personas damnificadas, atrapados o lesionados, falta de agua, comida o medicinas..."
                className="w-full rounded-xl border border-slate-300 p-3 text-xs leading-relaxed focus:border-dark-teal outline-none"
              />

              {/* Plantillas rápidas */}
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

            {/* 3. Prioridad sugerida opcional */}
            <div className="flex flex-col gap-1">
              <label className="text-xs font-semibold text-slate-700">
                Urgencia Manual (Opcional — si se omite, la IA la calcula):
              </label>
              <div className="flex items-center gap-2">
                {[1, 2, 3, 4, 5].map((val) => (
                  <button
                    key={val}
                    type="button"
                    onClick={() => setUrgenciaManual(urgenciaManual === val ? null : val)}
                    className={`flex-1 py-1.5 rounded text-xs font-bold transition ${
                      urgenciaManual === val
                        ? 'bg-rosy-copper text-white shadow'
                        : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
                    }`}
                  >
                    {val}
                  </button>
                ))}
              </div>
            </div>

            {/* Acciones */}
            <div className="mt-2 flex items-center justify-end gap-2 pt-3 border-t border-slate-100">
              <button
                type="button"
                onClick={() => setModalOpen(false)}
                className="rounded-md border border-slate-200 px-4 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-50 transition"
              >
                Cancelar
              </button>
              <button
                type="submit"
                disabled={submitting || !testimonio.trim()}
                className="flex items-center gap-1.5 rounded-md bg-rosy-copper px-5 py-2 text-xs font-bold text-white shadow-md hover:bg-rosy-copper/90 transition disabled:opacity-50"
              >
                {submitting ? 'Analizando con IA...' : '🚨 Transmitir Incidente'}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}

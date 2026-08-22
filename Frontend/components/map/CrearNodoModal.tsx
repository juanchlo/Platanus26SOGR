'use client';

import { useState, useEffect, type FormEvent } from 'react';
import { useAppStore } from '@/store/useAppStore';
import {
  createPuntoControlApi,
  createIncidenteApi,
  getPuntosControlApi,
  getIncidentesApi,
  getUsersApi,
} from '@/lib/api';
import { puedeLevantarNodos } from '@/lib/rbac';
import type { UserResponseItem } from '@/types';

// Nombres amigables para los Entes Públicos responsables
const ENTE_NOMBRES_AMIGABLES: Record<string, string> = {
  'ente.alcaldia@sogr.gov.co': 'Alcaldía de Cali',
};

function nombreAmigableDeEmail(email: string): string {
  if (ENTE_NOMBRES_AMIGABLES[email]) return ENTE_NOMBRES_AMIGABLES[email];
  const parteLocal = email.split('@')[0] ?? email;
  return parteLocal
    .replace(/[._-]+/g, ' ')
    .split(' ')
    .filter(Boolean)
    .map((palabra) => palabra.charAt(0).toUpperCase() + palabra.slice(1))
    .join(' ');
}

// Puntos de referencia conocidos en Cali para facilitar el llenado
const CALI_LANDMARKS = [
  { name: 'CAM (Alcaldía de Cali)', lat: 3.4538, lng: -76.5332, direccion: 'Av. 2N # 10N-70, Centro', barrio: 'Comuna 3' },
  { name: 'Estadio Pascual Guerrero', lat: 3.4296, lng: -76.5414, direccion: 'Cra. 34 # 5B-10', barrio: 'San Fernando' },
  { name: 'Hospital Univ. del Valle (HUV)', lat: 3.4292, lng: -76.5463, direccion: 'Calle 5 # 36-08', barrio: 'San Fernando' },
  { name: 'Plazoleta Jairo Varela', lat: 3.4516, lng: -76.5320, direccion: 'Av. 2N con Calle 10', barrio: 'Centenario' },
  { name: 'Terminal de Transportes Cali', lat: 3.4682, lng: -76.5222, direccion: 'Calle 30N # 2AN-29', barrio: 'Comuna 2' },
  { name: 'Coliseo El Pueblo', lat: 3.4140, lng: -76.5510, direccion: 'Calle 5 con Cra 52', barrio: 'Comuna 19' },
  { name: 'Universidad del Valle', lat: 3.3712, lng: -76.5338, direccion: 'Calle 13 # 100-00', barrio: 'Meléndez' },
  { name: 'Centro de Salud Alfonso López', lat: 3.4580, lng: -76.4970, direccion: 'Calle 70 # 7A-15', barrio: 'Comuna 7' },
];

const RAPID_AFECTACION_CHIPS = [
  'Derrumbe en ladera con familias atrapadas',
  'Inundación severa por desbordamiento',
  'Familias sin agua potable ni alimentos',
  'Heridos requieren primeros auxilios y traslado',
  'Incendio estructural con riesgo de propagación',
  'Colapso de vía y puente de acceso',
];

export default function CrearNodoModal() {
  const isModalOpen = useAppStore((state) => state.isCrearNodoModalOpen);
  const setModalOpen = useAppStore((state) => state.setCrearNodoModalOpen);
  const userSession = useAppStore((state) => state.userSession);
  const addPuntoControl = useAppStore((state) => state.addPuntoControl);
  const setPuntosControl = useAppStore((state) => state.setPuntosControl);
  const addIncidente = useAppStore((state) => state.addIncidente);
  const setIncidentes = useAppStore((state) => state.setIncidentes);
  const setActivePunto = useAppStore((state) => state.setActivePunto);
  const selectedMapCoords = useAppStore((state) => state.selectedMapCoords);

  // Selector de categoría: Nodo de Ayuda vs Nodo de Afectado
  const [categoria, setCategoria] = useState<'ayuda' | 'afectado'>('ayuda');

  const [entesPublicos, setEntesPublicos] = useState<UserResponseItem[]>([]);
  const [loadingEntes, setLoadingEntes] = useState(false);

  // Campos Nodo de Ayuda
  const [nombre, setNombre] = useState('');
  const [tipo, setTipo] = useState<'acopio' | 'albergue' | 'hospital' | 'comando'>('acopio');
  const [estado, setEstado] = useState<'activo' | 'saturado' | 'cerrado' | 'pendiente'>('activo');
  const [responsableUserId, setResponsableUserId] = useState('');
  const [responsableNombre, setResponsableNombre] = useState('');
  const [horario, setHorario] = useState('24 Horas');
  const [telefono, setTelefono] = useState('');

  // Campos Nodo de Afectación
  const [testimonio, setTestimonio] = useState('');
  const [urgencia, setUrgencia] = useState<number>(3);
  const [barrio, setBarrio] = useState('');

  // Coordenadas y Dirección comunes
  const [lat, setLat] = useState<number | string>(3.4516);
  const [lng, setLng] = useState<number | string>(-76.5320);
  const [direccion, setDireccion] = useState('');

  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isGeocoding, setIsGeocoding] = useState(false);
  const [geocodeFeedback, setGeocodeFeedback] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  // Sync coords from map click / double-click
  useEffect(() => {
    if (selectedMapCoords) {
      setLng(selectedMapCoords[0]);
      setLat(selectedMapCoords[1]);
    }
  }, [selectedMapCoords, isModalOpen]);

  // Load ENTE_PUBLICO users when modal opens
  useEffect(() => {
    if (!isModalOpen) return;
    setError(null);
    setSuccessMsg(null);
    setGeocodeFeedback(null);

    if (selectedMapCoords) {
      setLng(selectedMapCoords[0]);
      setLat(selectedMapCoords[1]);
    }

    async function fetchEntes() {
      setLoadingEntes(true);
      try {
        const users = await getUsersApi('ENTE_PUBLICO');
        setEntesPublicos(users);
        if (users.length > 0 && !responsableUserId) {
          setResponsableUserId(users[0].id);
          setResponsableNombre(nombreAmigableDeEmail(users[0].email));
        }
      } catch (err: any) {
        console.error('Error cargando entes públicos:', err);
        setError('No se pudo cargar la lista de Entes Públicos desde el backend.');
      } finally {
        setLoadingEntes(false);
      }
    }

    fetchEntes();
  }, [isModalOpen, responsableUserId, selectedMapCoords]);

  if (!isModalOpen) return null;

  // RBAC validation: ADMIN_GUBERNAMENTAL y ENTE_PUBLICO
  if (!userSession || !puedeLevantarNodos(userSession.role)) {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
        <div className="w-full max-w-md rounded-xl bg-white p-6 shadow-xl">
          <h2 className="text-lg font-bold text-rosy-copper">Acceso Denegado</h2>
          <p className="mt-2 text-sm text-slate-600">
            Solo los usuarios con rol <strong>Administrador Gubernamental</strong> o <strong>Ente Público</strong> tienen autorización para crear nodos.
          </p>
          <button
            type="button"
            onClick={() => setModalOpen(false)}
            className="mt-4 w-full rounded-md bg-dark-teal py-2 text-sm font-semibold text-white hover:bg-dark-teal/90"
          >
            Entendido
          </button>
        </div>
      </div>
    );
  }

  function handleSelectLandmark(landmark: (typeof CALI_LANDMARKS)[0]) {
    setLat(landmark.lat);
    setLng(landmark.lng);
    setDireccion(landmark.direccion ? `${landmark.direccion}, ${landmark.barrio}` : `${landmark.name}, Cali`);
    setBarrio(landmark.barrio || '');
    useAppStore.getState().setSelectedMapCoords([landmark.lng, landmark.lat]);
    setGeocodeFeedback(`📍 Ubicado en: ${landmark.name}`);
  }

  async function handleGeocodeAddress() {
    if (!direccion.trim()) {
      setGeocodeFeedback('Por favor escribe una dirección o punto de referencia en Cali.');
      return;
    }

    setIsGeocoding(true);
    setGeocodeFeedback(null);

    const query = direccion.trim();
    const lowerQuery = query.toLowerCase();

    const landmarkMatch = CALI_LANDMARKS.find(
      (lm) =>
        lowerQuery.includes(lm.name.toLowerCase()) ||
        lowerQuery.includes(lm.barrio.toLowerCase()) ||
        (lm.direccion && lowerQuery.includes(lm.direccion.toLowerCase()))
    );

    if (landmarkMatch) {
      setLat(landmarkMatch.lat);
      setLng(landmarkMatch.lng);
      setBarrio(landmarkMatch.barrio || '');
      useAppStore.getState().setSelectedMapCoords([landmarkMatch.lng, landmarkMatch.lat]);
      setGeocodeFeedback(`✓ Ubicado en: ${landmarkMatch.name} [${landmarkMatch.lat}, ${landmarkMatch.lng}]`);
      setIsGeocoding(false);
      return;
    }

    try {
      const url = `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(
        `${query}, Cali, Valle del Cauca, Colombia`
      )}&viewbox=-76.59,3.53,-76.45,3.31&bounded=1&limit=3`;

      const res = await fetch(url, {
        headers: {
          'Accept-Language': 'es',
        },
      });

      if (res.ok) {
        const data = await res.json();
        if (data && data.length > 0) {
          const first = data[0];
          const newLat = Number(parseFloat(first.lat).toFixed(5));
          const newLng = Number(parseFloat(first.lon).toFixed(5));

          setLat(newLat);
          setLng(newLng);
          useAppStore.getState().setSelectedMapCoords([newLng, newLat]);
          setGeocodeFeedback(`✓ Dirección ubicada en el mapa: Lat ${newLat}, Lng ${newLng}`);
          setIsGeocoding(false);
          return;
        }
      }
    } catch (err) {
      console.warn('Geocodificación externa falló:', err);
    }

    setGeocodeFeedback('⚠️ No se encontró la numeración exacta. Puedes ajustar las coordenadas con clic en el mapa.');
    setIsGeocoding(false);
  }

  function handleEnteChange(userId: string) {
    setResponsableUserId(userId);
    const selected = entesPublicos.find((e) => e.id === userId);
    if (selected) {
      setResponsableNombre(nombreAmigableDeEmail(selected.email));
    }
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    const numLat = Number(lat);
    const numLng = Number(lng);

    if (isNaN(numLat) || isNaN(numLng)) {
      setError('Las coordenadas deben ser números válidos.');
      return;
    }

    setIsSubmitting(true);
    setError(null);

    try {
      if (categoria === 'ayuda') {
        if (!nombre.trim()) {
          setError('Por favor ingresa un nombre para el punto de ayuda.');
          setIsSubmitting(false);
          return;
        }

        const respId = responsableUserId || userSession?.userId;
        if (!respId) {
          setError('Debes asignar un Ente Público responsable para este punto de ayuda.');
          setIsSubmitting(false);
          return;
        }

        const created = await createPuntoControlApi(userSession!.token, {
          nombre: nombre.trim(),
          tipo,
          estado,
          lat: numLat,
          lng: numLng,
          responsable_user_id: respId,
          responsable: responsableNombre || userSession?.nombre || undefined,
          direccion: direccion.trim() || undefined,
          horario: horario.trim() || undefined,
          telefono: telefono.trim() || undefined,
          verificado: true,
        });

        addPuntoControl(created);
        setActivePunto(created);
        setSuccessMsg(`✓ Nodo de ayuda "${created.nombre}" creado exitosamente.`);
      } else {
        if (!testimonio.trim()) {
          setError('Por favor describe la situación de emergencia del nodo afectado.');
          setIsSubmitting(false);
          return;
        }

        const createdIncidente = await createIncidenteApi(userSession!.token, {
          testimonio: testimonio.trim(),
          lat: numLat,
          lng: numLng,
          direccion: direccion.trim() || undefined,
          barrio: barrio.trim() || undefined,
          urgencia_manual: urgencia,
        });

        setSuccessMsg('✓ Nodo de afectación registrado exitosamente en Cali.');
      }

      // Recargar datos sincronizados desde la base de datos (con fusión/agrupamiento aplicado)
      try {
        const [nodos, incs] = await Promise.all([
          getPuntosControlApi().catch(() => []),
          getIncidentesApi().catch(() => []),
        ]);
        if (nodos && nodos.length > 0) setPuntosControl(nodos);
        if (incs) setIncidentes(incs);
      } catch (syncErr) {
        console.warn('Error sincronizando mapa tras creación:', syncErr);
      }

      setTimeout(() => {
        setModalOpen(false);
      }, 1000);
    } catch (err: any) {
      console.error('Error creando nodo:', err);
      setError(err.message || 'Error al guardar el nodo.');
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xs p-4 overflow-y-auto">
      <div className="relative w-full max-w-xl rounded-xl border border-dark-teal/15 bg-white shadow-2xl overflow-hidden my-8">
        {/* Cabecera modal */}
        <div className="flex items-center justify-between bg-dark-teal px-6 py-4 text-ghost-white">
          <div className="flex items-center gap-2.5">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-white/10">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="h-5 w-5">
                <path d="M12 21a9 9 0 0 0 9-9c0-4.97-4.03-9-9-9s-9 4.03-9 9a9 9 0 0 0 9 9Z" />
                <path d="M12 8v8M8 12h8" />
              </svg>
            </div>
            <div>
              <h2 className="text-base font-bold">
                {categoria === 'ayuda' ? 'Levantar Nodo de Ayuda' : 'Reportar Nodo de Afectación'}
              </h2>
              <p className="text-xs text-ghost-white/75">
                Alcaldía de Santiago de Cali · SOGR ({userSession.role === 'admin_gubernamental' ? 'Admin' : 'Ente Público'})
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={() => setModalOpen(false)}
            className="rounded-lg p-1 text-ghost-white/75 hover:bg-white/10 hover:text-ghost-white"
          >
            ✕
          </button>
        </div>

        {/* SELECTOR DE TIPO: Nodo de Ayuda vs Nodo de Afectación */}
        <div className="bg-slate-100 p-2.5 border-b border-slate-200">
          <div className="grid grid-cols-2 gap-2 bg-white p-1 rounded-lg border border-slate-200">
            <button
              type="button"
              onClick={() => {
                setCategoria('ayuda');
                setError(null);
              }}
              className={`flex items-center justify-center gap-2 py-2 text-xs font-bold rounded-md transition ${
                categoria === 'ayuda'
                  ? 'bg-dark-teal text-white shadow-sm'
                  : 'text-slate-600 hover:bg-slate-50'
              }`}
            >
              <span>📍</span>
              <span>Nodo de Ayuda</span>
              <span className="text-[10px] opacity-80 font-normal hidden sm:inline">(Acopio/Albergue)</span>
            </button>

            <button
              type="button"
              onClick={() => {
                setCategoria('afectado');
                setError(null);
              }}
              className={`flex items-center justify-center gap-2 py-2 text-xs font-bold rounded-md transition ${
                categoria === 'afectado'
                  ? 'bg-rosy-copper text-white shadow-sm'
                  : 'text-slate-600 hover:bg-slate-50'
              }`}
            >
              <span>⚠️</span>
              <span>Nodo de Afectado</span>
              <span className="text-[10px] opacity-80 font-normal hidden sm:inline">(Emergencia/Incidente)</span>
            </button>
          </div>
        </div>

        <form onSubmit={handleSubmit} className="p-6 flex flex-col gap-4 max-h-[75vh] overflow-y-auto">
          {error && (
            <div className="rounded-lg bg-rose-50 border border-rose-200 p-3 text-xs text-rose-700">
              {error}
            </div>
          )}

          {successMsg && (
            <div className="rounded-lg bg-emerald-50 border border-emerald-200 p-3 text-xs text-emerald-700">
              {successMsg}
            </div>
          )}

          {/* FORMULARIO: NODO DE AYUDA */}
          {categoria === 'ayuda' ? (
            <>
              {/* Nombre y Tipo */}
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div className="flex flex-col gap-1 sm:col-span-2">
                  <label className="text-xs font-semibold text-slate-700">Nombre del Punto *</label>
                  <input
                    type="text"
                    required
                    value={nombre}
                    onChange={(e) => setNombre(e.target.value)}
                    placeholder="Ej. Centro de Acopio Estadio Pascual Guerrero"
                    className="rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-dark-teal focus:ring-1 focus:ring-dark-teal outline-none font-medium"
                  />
                </div>

                <div className="flex flex-col gap-1">
                  <label className="text-xs font-semibold text-slate-700">Tipo de Nodo *</label>
                  <select
                    value={tipo}
                    onChange={(e) => setTipo(e.target.value as any)}
                    className="rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-dark-teal focus:ring-1 focus:ring-dark-teal outline-none bg-white font-medium"
                  >
                    <option value="acopio">Centro de Acopio</option>
                    <option value="albergue">Albergue Temporal</option>
                    <option value="hospital">Puesto de Salud</option>
                    <option value="comando">Puesto de Mando (PMU)</option>
                  </select>
                </div>
              </div>

              {/* Responsable (ENTE_PUBLICO) */}
              <div className="flex flex-col gap-1">
                <label className="text-xs font-semibold text-slate-700">
                  Ente Público Responsable *
                </label>
                {loadingEntes ? (
                  <div className="text-xs text-slate-400 py-1">Cargando entidades públicas...</div>
                ) : entesPublicos.length === 0 ? (
                  <div className="rounded-md bg-amber-50 border border-amber-200 p-2.5 text-xs text-amber-800">
                    No hay usuarios con rol <strong>Ente Público</strong> activos. Se asignará tu usuario automáticamente.
                  </div>
                ) : (
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    <select
                      value={responsableUserId}
                      onChange={(e) => handleEnteChange(e.target.value)}
                      className="rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-dark-teal focus:ring-1 focus:ring-dark-teal outline-none bg-white font-medium"
                    >
                      {entesPublicos.map((ente) => (
                        <option key={ente.id} value={ente.id}>
                          {nombreAmigableDeEmail(ente.email)} (Ente Público)
                        </option>
                      ))}
                    </select>
                    <input
                      type="text"
                      value={responsableNombre}
                      onChange={(e) => setResponsableNombre(e.target.value)}
                      placeholder="Ej: Cruz Roja Seccional Valle"
                      className="rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-dark-teal focus:ring-1 focus:ring-dark-teal outline-none font-medium"
                    />
                  </div>
                )}
              </div>
            </>
          ) : (
            /* FORMULARIO: NODO DE AFECTACIÓN / INCIDENTE */
            <>
              {/* Testimonio / Descripción de la emergencia */}
              <div className="flex flex-col gap-1">
                <div className="flex items-center justify-between">
                  <label className="text-xs font-semibold text-slate-700">
                    Descripción / Situación de Emergencia *
                  </label>
                  <span className="text-[10px] text-slate-500">Procesado con IA</span>
                </div>
                <textarea
                  rows={3}
                  required
                  value={testimonio}
                  onChange={(e) => setTestimonio(e.target.value)}
                  placeholder="Describe la emergencia en terreno: familias afectadas, daños materiales, suministros urgentes..."
                  className="rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-rosy-copper focus:ring-1 focus:ring-rosy-copper outline-none font-medium resize-none"
                />

                {/* Chips rápidos de emergencias */}
                <div className="flex flex-wrap items-center gap-1.5 pt-1">
                  <span className="text-[10px] text-slate-400 font-semibold">Incidentes rápidos:</span>
                  {RAPID_AFECTACION_CHIPS.slice(0, 3).map((chip) => (
                    <button
                      key={chip}
                      type="button"
                      onClick={() => setTestimonio(chip)}
                      className="rounded border border-slate-200 bg-white px-2 py-0.5 text-[10px] font-medium text-rosy-copper hover:border-rosy-copper hover:bg-rose-50 transition"
                    >
                      {chip}
                    </button>
                  ))}
                </div>
              </div>

              {/* Nivel de Severidad / Urgencia */}
              <div className="flex flex-col gap-1">
                <label className="text-xs font-semibold text-slate-700">
                  Nivel de Urgencia / Severidad (1: Leve, 5: Crítico)
                </label>
                <div className="grid grid-cols-5 gap-2">
                  {[1, 2, 3, 4, 5].map((lvl) => (
                    <button
                      key={lvl}
                      type="button"
                      onClick={() => setUrgencia(lvl)}
                      className={`py-1.5 rounded-md text-xs font-bold border transition ${
                        urgencia === lvl
                          ? lvl >= 4
                            ? 'bg-rose-600 text-white border-rose-600 shadow'
                            : lvl === 3
                            ? 'bg-amber-500 text-white border-amber-500 shadow'
                            : 'bg-emerald-600 text-white border-emerald-600 shadow'
                          : 'bg-white text-slate-700 border-slate-200 hover:bg-slate-50'
                      }`}
                    >
                      Nivel {lvl}
                    </button>
                  ))}
                </div>
              </div>
            </>
          )}

          {/* DIRECCIÓN CON GEOCODIFICACIÓN DIRECTA AL MAPA */}
          <div className="rounded-lg border border-dark-teal/20 bg-slate-50/70 p-3.5 flex flex-col gap-2.5">
            <div className="flex items-center justify-between">
              <label className="text-xs font-bold text-dark-teal flex items-center gap-1.5">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="h-4 w-4 text-rosy-copper">
                  <path d="M12 21a9 9 0 0 0 9-9c0-4.97-4.03-9-9-9s-9 4.03-9 9a9 9 0 0 0 9 9Z" />
                  <circle cx="12" cy="12" r="3" />
                </svg>
                Dirección o Referencia en Cali (Ubicar en Mapa)
              </label>
              <span className="text-[10px] text-slate-500">Presiona Enter o clic en Ubicar</span>
            </div>

            <div className="flex items-center gap-2">
              <input
                type="text"
                value={direccion}
                onChange={(e) => setDireccion(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    handleGeocodeAddress();
                  }
                }}
                placeholder="Ej. Cra. 34 # 5B-10, San Fernando ó Siloé"
                className="flex-1 rounded-md border border-slate-300 bg-white px-3 py-2 text-xs focus:border-dark-teal outline-none font-medium"
              />
              <button
                type="button"
                onClick={handleGeocodeAddress}
                disabled={isGeocoding || !direccion.trim()}
                className="flex items-center gap-1.5 rounded-md bg-dark-teal px-3 py-2 text-xs font-bold text-white shadow hover:bg-dark-teal/90 disabled:opacity-50 transition shrink-0"
              >
                {isGeocoding ? (
                  <>
                    <svg className="h-3.5 w-3.5 animate-spin" viewBox="0 0 24 24" fill="none">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                    </svg>
                    Buscando...
                  </>
                ) : (
                  <>📍 Ubicar Dirección</>
                )}
              </button>
            </div>

            {geocodeFeedback && (
              <div className="text-[11px] font-semibold text-dark-teal bg-white/80 border border-dark-teal/15 rounded p-1.5">
                {geocodeFeedback}
              </div>
            )}

            {/* Accesos rápidos a puntos clave de Cali */}
            <div className="flex flex-wrap items-center gap-1.5 pt-1">
              <span className="text-[10px] text-slate-400 font-semibold">Lugares frecuentes en Cali:</span>
              {CALI_LANDMARKS.slice(0, 4).map((lm) => (
                <button
                  key={lm.name}
                  type="button"
                  onClick={() => handleSelectLandmark(lm)}
                  className="rounded border border-slate-200 bg-white px-2 py-0.5 text-[10px] font-medium text-dark-teal hover:border-dark-teal hover:bg-dark-teal/5 transition"
                >
                  {lm.name.split('(')[0]}
                </button>
              ))}
            </div>
          </div>

          {/* Coordenadas en Cali */}
          <div className="flex flex-col gap-2">
            <div className="flex items-center justify-between">
              <label className="text-xs font-semibold text-slate-700">
                Coordenadas Geográficas (Latitud / Longitud en Cali) *
              </label>
              <span className="text-[10px] text-slate-500">Auto-sincronizado con doble clic en mapa</span>
            </div>

            {selectedMapCoords && (
              <div className="flex items-center gap-1.5 rounded-md bg-dark-teal/10 px-2.5 py-1 text-[11px] font-semibold text-dark-teal border border-dark-teal/20">
                <span>🎯 Punto fijado en el mapa:</span>
                <span className="font-mono font-bold">Lat: {Number(lat).toFixed(5)}, Lng: {Number(lng).toFixed(5)}</span>
              </div>
            )}

            <div className="grid grid-cols-2 gap-3">
              <div>
                <span className="text-[10px] text-slate-500">Latitud (~3.4)</span>
                <input
                  type="number"
                  step="any"
                  required
                  value={lat}
                  onChange={(e) => {
                    const val = e.target.value;
                    setLat(val);
                    if (!isNaN(Number(val)) && !isNaN(Number(lng))) {
                      useAppStore.getState().setSelectedMapCoords([Number(lng), Number(val)]);
                    }
                  }}
                  placeholder="3.4516"
                  className="w-full rounded-md border border-slate-300 px-3 py-1.5 text-xs focus:border-dark-teal outline-none font-mono font-medium"
                />
              </div>
              <div>
                <span className="text-[10px] text-slate-500">Longitud (~-76.5)</span>
                <input
                  type="number"
                  step="any"
                  required
                  value={lng}
                  onChange={(e) => {
                    const val = e.target.value;
                    setLng(val);
                    if (!isNaN(Number(val)) && !isNaN(Number(lat))) {
                      useAppStore.getState().setSelectedMapCoords([Number(val), Number(lat)]);
                    }
                  }}
                  placeholder="-76.5320"
                  className="w-full rounded-md border border-slate-300 px-3 py-1.5 text-xs focus:border-dark-teal outline-none font-mono font-medium"
                />
              </div>
            </div>
          </div>

          {/* Detalles adicionales para Nodo de Ayuda */}
          {categoria === 'ayuda' && (
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div className="flex flex-col gap-1">
                <label className="text-xs font-semibold text-slate-700">Horario</label>
                <input
                  type="text"
                  value={horario}
                  onChange={(e) => setHorario(e.target.value)}
                  placeholder="24 Horas"
                  className="rounded-md border border-slate-300 px-3 py-1.5 text-xs focus:border-dark-teal outline-none"
                />
              </div>
              <div className="flex flex-col gap-1">
                <label className="text-xs font-semibold text-slate-700">Teléfono</label>
                <input
                  type="text"
                  value={telefono}
                  onChange={(e) => setTelefono(e.target.value)}
                  placeholder="+57 (2) 555-1234"
                  className="rounded-md border border-slate-300 px-3 py-1.5 text-xs focus:border-dark-teal outline-none"
                />
              </div>
              <div className="flex flex-col gap-1">
                <label className="text-xs font-semibold text-slate-700">Estado Inicial</label>
                <select
                  value={estado}
                  onChange={(e) => setEstado(e.target.value as any)}
                  className="rounded-md border border-slate-300 px-3 py-1.5 text-xs focus:border-dark-teal outline-none bg-white font-medium"
                >
                  <option value="activo">Activo</option>
                  <option value="pendiente">Pendiente</option>
                  <option value="saturado">Saturado</option>
                </select>
              </div>
            </div>
          )}

          {/* Botones de acción */}
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
              disabled={isSubmitting || (categoria === 'ayuda' && entesPublicos.length === 0 && !userSession)}
              className={`flex items-center gap-1.5 rounded-md px-5 py-2 text-xs font-bold text-white shadow-md transition disabled:opacity-50 ${
                categoria === 'ayuda' ? 'bg-dark-teal hover:bg-dark-teal/90' : 'bg-rosy-copper hover:bg-rosy-copper/90'
              }`}
            >
              {isSubmitting ? (
                <>
                  <svg className="h-3.5 w-3.5 animate-spin" viewBox="0 0 24 24" fill="none">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                  </svg>
                  Guardando Nodo...
                </>
              ) : categoria === 'ayuda' ? (
                'Levantar Nodo de Ayuda'
              ) : (
                'Reportar Nodo de Afectación'
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

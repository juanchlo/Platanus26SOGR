'use client';

import { useState, useEffect, type FormEvent } from 'react';
import { useAppStore } from '@/store/useAppStore';
import { createPuntoControlApi, getUsersApi } from '@/lib/api';
import { puedeLevantarNodos } from '@/lib/rbac';
import type { UserResponseItem } from '@/types';

// Puntos de referencia conocidos en Cali para facilitar el llenado de coordenadas
const CALI_LANDMARKS = [
  { name: 'CAM (Alcaldía de Cali)', lat: 3.4538, lng: -76.5332, barrio: 'Comuna 3' },
  { name: 'Estadio Pascual Guerrero', lat: 3.4296, lng: -76.5414, barrio: 'San Fernando' },
  { name: 'Hospital Universitario del Valle', lat: 3.4292, lng: -76.5463, barrio: 'San Fernando' },
  { name: 'Plazoleta Jairo Varela', lat: 3.4516, lng: -76.5320, barrio: 'Centenario' },
  { name: 'Terminal de Transportes Cali', lat: 3.4682, lng: -76.5222, barrio: 'Comuna 2' },
  { name: 'Coliseo El Pueblo (Comuna 19)', lat: 3.4140, lng: -76.5510, barrio: 'Comuna 19' },
  { name: 'Centro de Salud Alfonso López', lat: 3.4580, lng: -76.4970, barrio: 'Comuna 7' },
];

export default function CrearNodoModal() {
  const isModalOpen = useAppStore((state) => state.isCrearNodoModalOpen);
  const setModalOpen = useAppStore((state) => state.setCrearNodoModalOpen);
  const userSession = useAppStore((state) => state.userSession);
  const addPuntoControl = useAppStore((state) => state.addPuntoControl);
  const setActivePunto = useAppStore((state) => state.setActivePunto);
  const selectedMapCoords = useAppStore((state) => state.selectedMapCoords);

  const [entesPublicos, setEntesPublicos] = useState<UserResponseItem[]>([]);
  const [loadingEntes, setLoadingEntes] = useState(false);

  const [nombre, setNombre] = useState('');
  const [tipo, setTipo] = useState<'acopio' | 'albergue' | 'hospital' | 'comando'>('acopio');
  const [estado, setEstado] = useState<'activo' | 'saturado' | 'cerrado' | 'pendiente'>('activo');
  const [responsableUserId, setResponsableUserId] = useState('');
  const [responsableNombre, setResponsableNombre] = useState('');
  const [lat, setLat] = useState<number | string>(3.4516);
  const [lng, setLng] = useState<number | string>(-76.5320);
  const [direccion, setDireccion] = useState('');
  const [horario, setHorario] = useState('24 Horas');
  const [telefono, setTelefono] = useState('');

  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  // Sync coords from map click if available
  useEffect(() => {
    if (selectedMapCoords) {
      setLng(selectedMapCoords[0]);
      setLat(selectedMapCoords[1]);
    }
  }, [selectedMapCoords]);

  // Load ENTE_PUBLICO users when modal opens
  useEffect(() => {
    if (!isModalOpen) return;
    setError(null);
    setSuccessMsg(null);

    async function fetchEntes() {
      setLoadingEntes(true);
      try {
        const users = await getUsersApi('ENTE_PUBLICO');
        setEntesPublicos(users);
        if (users.length > 0 && !responsableUserId) {
          setResponsableUserId(users[0].id);
          setResponsableNombre(users[0].email);
        }
      } catch (err: any) {
        console.error('Error cargando entes públicos:', err);
        setError('No se pudo cargar la lista de Entes Públicos desde el backend.');
      } finally {
        setLoadingEntes(false);
      }
    }

    fetchEntes();
  }, [isModalOpen, responsableUserId]);

  if (!isModalOpen) return null;

  // RBAC validation: only ADMIN_GUBERNAMENTAL
  if (!userSession || !puedeLevantarNodos(userSession.role)) {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
        <div className="w-full max-w-md rounded-xl bg-white p-6 shadow-xl">
          <h2 className="text-lg font-bold text-rosy-copper">Acceso Denegado</h2>
          <p className="mt-2 text-sm text-slate-600">
            Solo los funcionarios con rol <strong>Administrador Gubernamental</strong> tienen autorización para levantar o crear nuevos nodos logísticos.
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
    setDireccion(`${landmark.name}, ${landmark.barrio}, Cali`);
  }

  function handleEnteChange(userId: string) {
    setResponsableUserId(userId);
    const selected = entesPublicos.find((e) => e.id === userId);
    if (selected) {
      setResponsableNombre(selected.email);
    }
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!nombre.trim()) {
      setError('Por favor ingresa un nombre para el nodo.');
      return;
    }
    if (!responsableUserId) {
      setError('Debes asignar un Ente Público responsable para este nodo.');
      return;
    }

    const numLat = Number(lat);
    const numLng = Number(lng);

    if (isNaN(numLat) || isNaN(numLng)) {
      setError('Las coordenadas deben ser números válidos.');
      return;
    }

    setIsSubmitting(true);
    setError(null);

    try {
      const created = await createPuntoControlApi(userSession!.token, {
        nombre: nombre.trim(),
        tipo,
        estado,
        lat: numLat,
        lng: numLng,
        responsable_user_id: responsableUserId,
        responsable: responsableNombre || undefined,
        direccion: direccion.trim() || undefined,
        horario: horario.trim() || undefined,
        telefono: telefono.trim() || undefined,
        verificado: true,
      });

      addPuntoControl(created);
      setActivePunto(created);
      setSuccessMsg(`✓ Nodo "${created.nombre}" creado exitosamente en Cali.`);

      setTimeout(() => {
        setModalOpen(false);
      }, 1200);
    } catch (err: any) {
      console.error('Error creando nodo:', err);
      setError(err.message || 'Error al guardar el nodo en Supabase.');
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
                <path d="M12 2v20M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6" />
              </svg>
            </div>
            <div>
              <h2 className="text-base font-bold">Levantar Nuevo Nodo Operativo</h2>
              <p className="text-xs text-ghost-white/75">
                Admin Gubernamental · Registro en Red Logística de Cali
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={() => setModalOpen(false)}
            className="rounded-md p-1 text-ghost-white/80 hover:bg-white/10 hover:text-white"
          >
            <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-6 flex flex-col gap-4 max-h-[80vh] overflow-y-auto">
          {/* Nombre y Tipo */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="flex flex-col gap-1">
              <label className="text-xs font-semibold text-slate-700">Nombre del Nodo *</label>
              <input
                type="text"
                required
                value={nombre}
                onChange={(e) => setNombre(e.target.value)}
                placeholder="Ej. Centro de Acopio Norte"
                className="rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-dark-teal focus:ring-1 focus:ring-dark-teal outline-none"
              />
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-xs font-semibold text-slate-700">Tipo de Nodo *</label>
              <select
                value={tipo}
                onChange={(e) => setTipo(e.target.value as any)}
                className="rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-dark-teal focus:ring-1 focus:ring-dark-teal outline-none bg-white"
              >
                <option value="acopio">Centro de Acopio (Alimentos/Insumos)</option>
                <option value="albergue">Albergue Temporal</option>
                <option value="hospital">Puesto de Salud / Hospital</option>
                <option value="comando">Puesto de Mando Unificado (PMU)</option>
              </select>
            </div>
          </div>

          {/* Responsable ENTE_PUBLICO (Requerimiento estricto) */}
          <div className="rounded-lg border border-dark-teal/20 bg-dark-teal/5 p-3 flex flex-col gap-2">
            <div className="flex items-center gap-1.5 text-xs font-bold text-dark-teal">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="h-4 w-4">
                <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v1" />
                <circle cx="9" cy="7" r="4" />
                <path d="M22 21v-2a4 4 0 0 0-3-3.87" />
                <path d="M16 3.13a4 4 0 0 1 0 7.75" />
              </svg>
              <span>Ente Público Responsable del Nodo (Obligatorio)</span>
            </div>

            {loadingEntes ? (
              <p className="text-xs text-slate-500">Cargando entes públicos autorizados...</p>
            ) : entesPublicos.length === 0 ? (
              <p className="text-xs text-rosy-copper font-medium">
                No hay usuarios con rol ENTE_PUBLICO registrados en el sistema.
              </p>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                <select
                  value={responsableUserId}
                  onChange={(e) => handleEnteChange(e.target.value)}
                  className="rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-dark-teal focus:ring-1 focus:ring-dark-teal outline-none bg-white"
                >
                  {entesPublicos.map((ente) => (
                    <option key={ente.id} value={ente.id}>
                      {ente.email} (Ente Público)
                    </option>
                  ))}
                </select>
                <input
                  type="text"
                  value={responsableNombre}
                  onChange={(e) => setResponsableNombre(e.target.value)}
                  placeholder="Nombre institucional (ej. Cruz Roja, Bomberos)"
                  className="rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-dark-teal focus:ring-1 focus:ring-dark-teal outline-none"
                />
              </div>
            )}
          </div>

          {/* Coordenadas en Cali */}
          <div className="flex flex-col gap-2">
            <div className="flex items-center justify-between">
              <label className="text-xs font-semibold text-slate-700">
                Ubicación Geográfica en Cali, Colombia *
              </label>
              <span className="text-[11px] text-slate-500">Formato decimal (WGS84)</span>
            </div>

            {/* Accesos rápidos a puntos clave de Cali */}
            <div className="flex flex-wrap gap-1.5 mb-1">
              <span className="text-[10px] text-slate-400 self-center">Puntos Cali:</span>
              {CALI_LANDMARKS.slice(0, 4).map((lm) => (
                <button
                  key={lm.name}
                  type="button"
                  onClick={() => handleSelectLandmark(lm)}
                  className="rounded border border-slate-200 bg-slate-50 px-2 py-0.5 text-[11px] text-dark-teal hover:border-dark-teal hover:bg-dark-teal/10 transition"
                >
                  {lm.name.split('(')[0]}
                </button>
              ))}
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <span className="text-[11px] text-slate-500">Latitud (Cali ~3.4)</span>
                <input
                  type="number"
                  step="any"
                  required
                  value={lat}
                  onChange={(e) => setLat(e.target.value)}
                  placeholder="3.4516"
                  className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-dark-teal outline-none"
                />
              </div>
              <div>
                <span className="text-[11px] text-slate-500">Longitud (Cali ~-76.5)</span>
                <input
                  type="number"
                  step="any"
                  required
                  value={lng}
                  onChange={(e) => setLng(e.target.value)}
                  placeholder="-76.5320"
                  className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-dark-teal outline-none"
                />
              </div>
            </div>
          </div>

          {/* Detalles adicionales */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div className="flex flex-col gap-1 sm:col-span-2">
              <label className="text-xs font-semibold text-slate-700">Dirección en Cali</label>
              <input
                type="text"
                value={direccion}
                onChange={(e) => setDireccion(e.target.value)}
                placeholder="Cra. 5 # 10-20, Cali"
                className="rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-dark-teal outline-none"
              />
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-xs font-semibold text-slate-700">Estado Inicial</label>
              <select
                value={estado}
                onChange={(e) => setEstado(e.target.value as any)}
                className="rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-dark-teal outline-none bg-white"
              >
                <option value="activo">Activo</option>
                <option value="pendiente">Pendiente</option>
                <option value="saturado">Saturado</option>
              </select>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="flex flex-col gap-1">
              <label className="text-xs font-semibold text-slate-700">Horario</label>
              <input
                type="text"
                value={horario}
                onChange={(e) => setHorario(e.target.value)}
                placeholder="24 Horas o 08:00 - 18:00"
                className="rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-dark-teal outline-none"
              />
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-xs font-semibold text-slate-700">Teléfono de Contacto</label>
              <input
                type="text"
                value={telefono}
                onChange={(e) => setTelefono(e.target.value)}
                placeholder="+57 (2) 555-1234"
                className="rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-dark-teal outline-none"
              />
            </div>
          </div>

          {error ? (
            <div className="rounded-md bg-rosy-copper/10 p-3 text-xs font-medium text-rosy-copper border border-rosy-copper/20">
              {error}
            </div>
          ) : null}

          {successMsg ? (
            <div className="rounded-md bg-emerald-50 p-3 text-xs font-medium text-emerald-800 border border-emerald-200">
              {successMsg}
            </div>
          ) : null}

          {/* Botones de acción */}
          <div className="mt-2 flex items-center justify-end gap-3 pt-3 border-t border-slate-200">
            <button
              type="button"
              onClick={() => setModalOpen(false)}
              className="rounded-md border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"
            >
              Cancelar
            </button>
            <button
              type="submit"
              disabled={isSubmitting || entesPublicos.length === 0}
              className="rounded-md bg-dark-teal px-5 py-2 text-sm font-semibold text-white shadow-sm hover:bg-dark-teal/90 disabled:opacity-50 flex items-center gap-2"
            >
              {isSubmitting ? (
                <>
                  <svg className="h-4 w-4 animate-spin text-white" viewBox="0 0 24 24" fill="none">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                  </svg>
                  Guardando en Supabase...
                </>
              ) : (
                'Levantar Nodo en Cali'
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

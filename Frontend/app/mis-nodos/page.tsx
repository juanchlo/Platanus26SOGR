'use client';

import { useEffect, useState, useCallback } from 'react';
import { useAppStore } from '@/store/useAppStore';
import {
  getMisNodosApi,
  getInventarioNodoApi,
  updateInventarioNodoApi,
  crearPeticionRecursoApi,
} from '@/lib/api';
import { puedeGestionar, normalizeRole } from '@/lib/rbac';
import type { InventarioItem, NivelInventario, PuntoControl } from '@/types';

const NIVEL_LABELS: Record<NivelInventario, { label: string; color: string; badge: string }> = {
  sobra: { label: 'Sobra', color: 'bg-emerald-600 text-white', badge: 'bg-emerald-100 text-emerald-800' },
  bien: { label: 'Bien (Abastecido)', color: 'bg-teal-600 text-white', badge: 'bg-teal-100 text-teal-800' },
  poco: { label: 'Poco (Escaso)', color: 'bg-amber-500 text-white', badge: 'bg-amber-100 text-amber-800' },
  no_hay: { label: 'No Hay (Crítico)', color: 'bg-rose-600 text-white', badge: 'bg-rose-100 text-rose-800' },
};

function calcularHorasInactivo(fechaStr?: string | null): number {
  if (!fechaStr) return 4.0;
  const fecha = new Date(fechaStr);
  const diffMs = Date.now() - fecha.getTime();
  return Number((diffMs / (1000 * 60 * 60)).toFixed(1));
}

function NodoCard({
  nodo,
  token,
  onUpdated,
}: {
  nodo: PuntoControl;
  token: string;
  onUpdated: () => void;
}) {
  const [inventario, setInventario] = useState<InventarioItem[]>([]);
  const [loadingInv, setLoadingInv] = useState(true);
  const [savingInv, setSavingInv] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // Modal para petición de recursos
  const [isPeticionOpen, setIsPeticionOpen] = useState(false);
  const [peticionTipo, setPeticionTipo] = useState('Agua Potable');
  const [peticionDesc, setPeticionDesc] = useState('');
  const [peticionUrgencia, setPeticionUrgencia] = useState(4);
  const [submittingPeticion, setSubmittingPeticion] = useState(false);
  const [peticionSuccess, setPeticionSuccess] = useState<string | null>(null);

  const horasInactivo = calcularHorasInactivo(nodo.actualizado_en || nodo.creado_en);
  const isInactivoCritico = horasInactivo >= 3.0;

  const loadInventario = useCallback(async () => {
    try {
      setLoadingInv(true);
      const data = await getInventarioNodoApi(nodo.id);
      setInventario(data);
    } catch (err: any) {
      console.error('Error cargando inventario del nodo:', err);
    } finally {
      setLoadingInv(false);
    }
  }, [nodo.id]);

  useEffect(() => {
    loadInventario();
  }, [loadInventario]);

  function handleNivelChange(insumoId: string, nuevoNivel: NivelInventario) {
    setInventario((prev) =>
      prev.map((item) =>
        item.insumo_id === insumoId ? { ...item, nivel: nuevoNivel } : item
      )
    );
  }

  async function handleGuardarInventario() {
    try {
      setSavingInv(true);
      setErrorMsg(null);
      setSaveSuccess(false);

      const itemsPayload = inventario.map((i) => ({
        insumo_id: i.insumo_id,
        nivel: i.nivel,
      }));

      const updated = await updateInventarioNodoApi(token, nodo.id, itemsPayload);
      setInventario(updated);
      setSaveSuccess(true);
      onUpdated();
      setTimeout(() => setSaveSuccess(false), 3000);
    } catch (err: any) {
      console.error('Error actualizando inventario:', err);
      setErrorMsg(err.message || 'No se pudo guardar el inventario.');
    } finally {
      setSavingInv(false);
    }
  }

  async function handleCrearPeticion(e: React.FormEvent) {
    e.preventDefault();
    if (!peticionDesc.trim()) return;

    try {
      setSubmittingPeticion(true);
      await crearPeticionRecursoApi(token, nodo.id, {
        tipo: peticionTipo,
        descripcion: peticionDesc.trim(),
        urgencia: peticionUrgencia,
      });

      setPeticionSuccess('✓ Solicitud de recursos transmitida a la red operativa.');
      setPeticionDesc('');
      onUpdated();
      setTimeout(() => {
        setIsPeticionOpen(false);
        setPeticionSuccess(null);
      }, 1500);
    } catch (err: any) {
      console.error('Error creando petición:', err);
    } finally {
      setSubmittingPeticion(false);
    }
  }

  return (
    <div
      className={`rounded-xl border bg-white p-5 shadow-sm transition-all ${
        isInactivoCritico
          ? 'border-rose-300 ring-2 ring-rose-400/20'
          : 'border-dark-teal/15 hover:shadow-md'
      }`}
    >
      {/* Cabecera del Nodo */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-4 border-b border-slate-100">
        <div>
          <div className="flex items-center gap-2">
            <h2 className="text-base font-bold text-dark-teal">{nodo.nombre}</h2>
            <span className="rounded-md bg-dark-teal/10 px-2 py-0.5 text-xs font-semibold text-dark-teal capitalize">
              {nodo.tipo || 'Nodo'}
            </span>
            <span
              className={`rounded-md px-2 py-0.5 text-xs font-semibold capitalize ${
                nodo.estado === 'activo'
                  ? 'bg-emerald-100 text-emerald-800'
                  : 'bg-amber-100 text-amber-800'
              }`}
            >
              {nodo.estado || 'Activo'}
            </span>
          </div>
          <div className="mt-1 text-xs text-slate-500 flex flex-wrap gap-x-4 gap-y-1">
            {nodo.direccion && <span>📍 {nodo.direccion}</span>}
            <span>🌐 {nodo.lat.toFixed(4)}, {nodo.lng.toFixed(4)}</span>
            {nodo.horario && <span>⏰ {nodo.horario}</span>}
          </div>
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setIsPeticionOpen(true)}
            className="flex items-center gap-1.5 rounded-md bg-rosy-copper/10 border border-rosy-copper/30 px-3 py-1.5 text-xs font-bold text-rosy-copper hover:bg-rosy-copper/20 transition"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="h-4 w-4">
              <path d="M12 9v4m0 4h.01" />
              <path d="M10.29 3.86 1.82 18a1.5 1.5 0 0 0 1.29 2.25h17.78A1.5 1.5 0 0 0 22.18 18L13.71 3.86a1.5 1.5 0 0 0-2.42 0Z" />
            </svg>
            Solicitar Recursos
          </button>
        </div>
      </div>

      {/* Banner de Estado de Inactividad (Regla 3h) */}
      <div className="mt-3">
        {isInactivoCritico ? (
          <div className="flex items-center gap-2.5 rounded-lg bg-rose-50 border border-rose-200 px-3.5 py-2.5 text-xs text-rose-800">
            <span className="flex h-2.5 w-2.5 rounded-full bg-rose-600 animate-ping" />
            <span className="font-bold">
              ⚠️ ADVERTENCIA: Este nodo lleva {horasInactivo} horas sin reportar actualizaciones.
            </span>
            <span className="text-rose-600 hidden sm:inline">
              Por protocolo de emergencia se exige actualizar el inventario antes de 3h.
            </span>
          </div>
        ) : (
          <div className="flex items-center gap-2 rounded-lg bg-emerald-50 border border-emerald-200 px-3 py-1.5 text-xs text-emerald-800">
            <span className="h-2 w-2 rounded-full bg-emerald-500" />
            <span>
              Reporte al día · Última actualización hace <strong>{horasInactivo}h</strong>
            </span>
          </div>
        )}
      </div>

      {/* Panel de Gestión de Insumos / Inventario */}
      <div className="mt-4">
        <div className="flex items-center justify-between mb-2">
          <h3 className="text-xs font-bold uppercase tracking-wider text-slate-700">
            Recursos Disponibles en Nodo (Inventario)
          </h3>
          <span className="text-[11px] text-slate-400">
            Selecciona el nivel actual de cada insumo
          </span>
        </div>

        {loadingInv ? (
          <div className="py-6 text-center text-xs text-slate-400">
            Cargando catálogo de recursos...
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3 max-h-72 overflow-y-auto pr-1">
            {inventario.map((item) => (
              <div
                key={item.insumo_id}
                className="flex items-center justify-between rounded-lg border border-slate-100 bg-slate-50/60 p-2.5 text-xs"
              >
                <div className="flex flex-col">
                  <span className="font-semibold text-slate-800">{item.nombre}</span>
                  <span className="text-[10px] text-slate-500 capitalize">
                    {item.categoria} · {item.unidad || 'unidades'}
                  </span>
                </div>

                <div className="flex items-center gap-1">
                  {(['no_hay', 'poco', 'bien', 'sobra'] as NivelInventario[]).map((lvl) => {
                    const isSelected = item.nivel === lvl;
                    return (
                      <button
                        key={lvl}
                        type="button"
                        onClick={() => handleNivelChange(item.insumo_id, lvl)}
                        className={`rounded px-2 py-1 text-[10px] font-bold uppercase transition ${
                          isSelected
                            ? NIVEL_LABELS[lvl].color
                            : 'bg-white text-slate-600 border border-slate-200 hover:bg-slate-100'
                        }`}
                      >
                        {lvl === 'no_hay'
                          ? '0'
                          : lvl === 'poco'
                          ? 'Bajo'
                          : lvl === 'bien'
                          ? 'OK'
                          : 'Max'}
                      </button>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Acciones de guardado */}
        <div className="mt-4 flex flex-col sm:flex-row items-center justify-between gap-3 pt-3 border-t border-slate-100">
          <div>
            {saveSuccess && (
              <span className="text-xs font-semibold text-emerald-700">
                ✓ Inventario actualizado en Supabase. Se restableció el contador de 3h.
              </span>
            )}
            {errorMsg && (
              <span className="text-xs font-semibold text-rose-600">{errorMsg}</span>
            )}
          </div>

          <button
            type="button"
            onClick={handleGuardarInventario}
            disabled={savingInv || loadingInv}
            className="w-full sm:w-auto rounded-md bg-dark-teal px-4 py-2 text-xs font-bold text-white shadow hover:bg-dark-teal/90 transition disabled:opacity-50 flex items-center justify-center gap-2"
          >
            {savingInv ? (
              <>
                <svg className="h-3.5 w-3.5 animate-spin" viewBox="0 0 24 24" fill="none">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                </svg>
                Guardando en Supabase...
              </>
            ) : (
              'Guardar Actualización de Inventario'
            )}
          </button>
        </div>
      </div>

      {/* Modal para emitir petición de recursos */}
      {isPeticionOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xs p-4">
          <div className="w-full max-w-md rounded-xl bg-white p-6 shadow-2xl border border-dark-teal/20">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100">
              <h3 className="text-sm font-bold text-dark-teal">
                Solicitar Recursos para {nodo.nombre}
              </h3>
              <button
                type="button"
                onClick={() => setIsPeticionOpen(false)}
                className="text-slate-400 hover:text-slate-600 text-xs"
              >
                ✕
              </button>
            </div>

            <form onSubmit={handleCrearPeticion} className="mt-4 flex flex-col gap-3">
              <div className="flex flex-col gap-1">
                <label className="text-xs font-semibold text-slate-700">Tipo de Insumo / Recurso *</label>
                <select
                  value={peticionTipo}
                  onChange={(e) => setPeticionTipo(e.target.value)}
                  className="rounded-md border border-slate-300 px-3 py-2 text-xs focus:border-dark-teal outline-none bg-white"
                >
                  <option value="Agua Potable">Agua Potable</option>
                  <option value="Alimentos y Raciones">Alimentos y Raciones</option>
                  <option value="Medicamentos y Primeros Auxilios">Medicamentos y Primeros Auxilios</option>
                  <option value="Colchonetas y Abrigo">Colchonetas y Abrigo</option>
                  <option value="Kits de Aseo e Higiene">Kits de Aseo e Higiene</option>
                  <option value="Personal de Apoyo y Rescate">Personal de Apoyo y Rescate</option>
                </select>
              </div>

              <div className="flex flex-col gap-1">
                <label className="text-xs font-semibold text-slate-700">Detalle del Requerimiento *</label>
                <textarea
                  required
                  rows={3}
                  value={peticionDesc}
                  onChange={(e) => setPeticionDesc(e.target.value)}
                  placeholder="Ej. Requerimos 300 unidades de agua potable debido a corte en el sector..."
                  className="rounded-md border border-slate-300 px-3 py-2 text-xs focus:border-dark-teal outline-none"
                />
              </div>

              <div className="flex flex-col gap-1">
                <label className="text-xs font-semibold text-slate-700">Nivel de Urgencia (1 a 5)</label>
                <div className="flex items-center gap-2">
                  {[1, 2, 3, 4, 5].map((val) => (
                    <button
                      key={val}
                      type="button"
                      onClick={() => setPeticionUrgencia(val)}
                      className={`flex-1 py-1.5 rounded text-xs font-bold ${
                        peticionUrgencia === val
                          ? 'bg-rosy-copper text-white shadow'
                          : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
                      }`}
                    >
                      {val}
                    </button>
                  ))}
                </div>
              </div>

              {peticionSuccess && (
                <div className="p-2 rounded bg-emerald-50 text-emerald-800 text-xs font-semibold">
                  {peticionSuccess}
                </div>
              )}

              <div className="mt-3 flex justify-end gap-2 pt-2 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setIsPeticionOpen(false)}
                  className="rounded-md border border-slate-200 px-3 py-1.5 text-xs font-semibold text-slate-600 hover:bg-slate-50"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={submittingPeticion || !peticionDesc.trim()}
                  className="rounded-md bg-rosy-copper px-4 py-1.5 text-xs font-bold text-white shadow hover:bg-rosy-copper/90 disabled:opacity-50"
                >
                  {submittingPeticion ? 'Transmitiendo...' : 'Emitir Solicitud'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

export default function MisNodosPage() {
  const userSession = useAppStore((state) => state.userSession);
  const [nodos, setNodos] = useState<PuntoControl[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchMisNodos = useCallback(async () => {
    if (!userSession?.token) return;
    try {
      setLoading(true);
      setError(null);
      const data = await getMisNodosApi(userSession.token);
      setNodos(data);
    } catch (err: any) {
      console.error('Error fetching mis nodos:', err);
      setError(err.message || 'No se pudieron cargar los nodos asignados.');
    } finally {
      setLoading(false);
    }
  }, [userSession?.token]);

  useEffect(() => {
    fetchMisNodos();
  }, [fetchMisNodos]);

  if (!userSession || !puedeGestionar(userSession.role)) {
    return (
      <div className="rounded-lg border border-dark-teal/10 bg-white p-6 shadow-sm">
        <h1 className="text-lg font-bold text-rosy-copper">Acceso Restringido</h1>
        <p className="mt-2 text-sm text-slate-600">
          Debes iniciar sesión con una cuenta de <strong>Ente Público</strong> o <strong>Administrador Gubernamental</strong> para acceder a este portal de gestión.
        </p>
        <a
          href="/login"
          className="mt-4 inline-block rounded-md bg-dark-teal px-4 py-2 text-xs font-bold text-white hover:bg-dark-teal/90"
        >
          Ir a Iniciar Sesión
        </a>
      </div>
    );
  }

  const roleName = normalizeRole(userSession.role) === 'admin_gubernamental'
    ? 'Administrador Gubernamental (Vista Global de Nodos)'
    : `Ente Público (${userSession.email || userSession.nombre})`;

  return (
    <div className="flex flex-col gap-5 p-2 sm:p-4">
      {/* Encabezado */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 rounded-xl bg-dark-teal p-5 text-white shadow-md">
        <div>
          <span className="text-[11px] font-semibold uppercase tracking-wider text-saffron">
            Portal Operativo de Control
          </span>
          <h1 className="text-xl font-bold">Mis Nodos Asignados en Cali</h1>
          <p className="mt-1 text-xs text-ghost-white/80">{roleName}</p>
        </div>

        <button
          type="button"
          onClick={fetchMisNodos}
          disabled={loading}
          className="flex items-center gap-1.5 rounded-md bg-white/10 border border-white/20 px-3 py-1.5 text-xs font-bold text-white hover:bg-white/20 transition self-start sm:self-auto"
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`}>
            <path d="M21.5 2v6h-6M21.34 15.57a10 10 0 1 1-.57-8.38l5.67-5.67" />
          </svg>
          Actualizar Nodos
        </button>
      </div>

      {/* Lista de Nodos */}
      {loading ? (
        <div className="flex items-center justify-center p-12 text-slate-500 text-sm">
          <svg className="h-5 w-5 animate-spin text-dark-teal mr-2" viewBox="0 0 24 24" fill="none">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
          </svg>
          Cargando nodos asignados desde Supabase...
        </div>
      ) : error ? (
        <div className="rounded-lg bg-rose-50 border border-rose-200 p-4 text-xs font-semibold text-rose-800">
          {error}
        </div>
      ) : nodos.length === 0 ? (
        <div className="rounded-xl border border-dashed border-slate-300 bg-slate-50 p-8 text-center">
          <h3 className="text-sm font-bold text-slate-700">No tienes nodos asignados</h3>
          <p className="mt-1 text-xs text-slate-500">
            El Administrador Gubernamental aún no ha asignado nodos a tu cuenta de Ente Público.
          </p>
        </div>
      ) : (
        <div className="flex flex-col gap-4">
          {nodos.map((nodo) => (
            <NodoCard
              key={nodo.id}
              nodo={nodo}
              token={userSession.token}
              onUpdated={fetchMisNodos}
            />
          ))}
        </div>
      )}
    </div>
  );
}

'use client';

import { useEffect, useState, useCallback } from 'react';
import type { Incidente, PuntoControl, InventarioItem } from '@/types';
import { getInventarioNodoApi, updateIncidenteApi, deleteIncidenteApi } from '@/lib/api';
import { useAppStore } from '@/store/useAppStore';
import { puedeGestionar } from '@/lib/rbac';

// Haversine distance en km
function distKm(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

const ESTADO_LABELS: Record<string, string> = {
  pendiente: 'Pendiente',
  en_atencion: 'En Atención',
  resuelto: 'Resuelto',
};

const ESTADO_COLORS: Record<string, string> = {
  pendiente: 'bg-amber-100 text-amber-800 border-amber-300',
  en_atencion: 'bg-blue-100 text-blue-800 border-blue-300',
  resuelto: 'bg-emerald-100 text-emerald-800 border-emerald-300',
};

const NIVEL_COLORS: Record<string, string> = {
  no_hay: 'text-red-700 font-bold',
  poco: 'text-orange-600 font-semibold',
  bien: 'text-emerald-700 font-semibold',
  sobra: 'text-blue-700 font-semibold',
};

const NIVEL_LABELS: Record<string, string> = {
  no_hay: 'Sin stock',
  poco: 'Poco',
  bien: 'Disponible',
  sobra: 'Abundante',
};

interface NodoPlan {
  punto: PuntoControl;
  distKm: number;
  inventario: InventarioItem[];
  loading: boolean;
}

interface Props {
  incidente: Incidente;
  puntosControl: PuntoControl[];
  onClose: () => void;
}

type Tab = 'detalle' | 'plan' | 'editar';

export default function IncidenteDetailDrawer({ incidente, puntosControl, onClose }: Props) {
  const userSession = useAppStore((s) => s.userSession);
  const removeIncidente = useAppStore((s) => s.removeIncidente);
  const updateIncidenteInStore = useAppStore((s) => s.updateIncidenteInStore);
  const setActiveIncidente = useAppStore((s) => s.setActiveIncidente);

  const puedeEditar = puedeGestionar(userSession?.role);
  const [tab, setTab] = useState<Tab>('detalle');
  const [nodosPlan, setNodosPlan] = useState<NodoPlan[]>([]);
  const [planLoaded, setPlanLoaded] = useState(false);

  // edit form state
  const [editUrgencia, setEditUrgencia] = useState(incidente.urgencia);
  const [editTestimonio, setEditTestimonio] = useState(incidente.testimonio ?? '');
  const [editEstado, setEditEstado] = useState(incidente.estado);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState('');

  // delete confirm
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);

  // Carga plan: top 4 puntos más cercanos + su inventario
  const loadPlan = useCallback(async () => {
    if (planLoaded) return;
    const sorted = [...puntosControl]
      .filter((p) => p.estado !== 'cerrado')
      .map((p) => ({ punto: p, distKm: distKm(incidente.lat, incidente.lng, p.lat, p.lng) }))
      .sort((a, b) => a.distKm - b.distKm)
      .slice(0, 4);

    setNodosPlan(sorted.map((s) => ({ ...s, inventario: [], loading: true })));
    setPlanLoaded(true);

    const results = await Promise.all(
      sorted.map(async ({ punto, distKm: d }) => {
        try {
          const inv = await getInventarioNodoApi(punto.id);
          return { punto, distKm: d, inventario: inv, loading: false };
        } catch {
          return { punto, distKm: d, inventario: [], loading: false };
        }
      })
    );
    setNodosPlan(results);
  }, [incidente.lat, incidente.lng, puntosControl, planLoaded]);

  useEffect(() => {
    if (tab === 'plan') loadPlan();
  }, [tab, loadPlan]);

  async function handleSave() {
    if (!userSession) return;
    setSaving(true);
    setSaveError('');
    try {
      const updated = await updateIncidenteApi(userSession.token, incidente.id, {
        urgencia: editUrgencia,
        testimonio: editTestimonio || undefined,
        estado: editEstado as 'pendiente' | 'en_atencion' | 'resuelto',
      });
      updateIncidenteInStore(updated);
      setActiveIncidente(updated);
      setTab('detalle');
    } catch (e: any) {
      setSaveError(e.message || 'Error al guardar');
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete() {
    if (!userSession) return;
    setDeleting(true);
    try {
      await deleteIncidenteApi(userSession.token, incidente.id);
      removeIncidente(incidente.id);
      onClose();
    } catch {
      setDeleting(false);
      setConfirmDelete(false);
    }
  }

  const recursos = Array.isArray(incidente.recursos_solicitados)
    ? incidente.recursos_solicitados
    : [];

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-end" onClick={onClose}>
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" />

      {/* Drawer */}
      <div
        className="relative z-10 h-full w-full max-w-lg bg-white shadow-2xl flex flex-col overflow-hidden animate-slideInRight"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-start justify-between gap-3 px-5 py-4 border-b border-slate-200 bg-rose-50">
          <div className="flex flex-col gap-1 min-w-0">
            <div className="flex items-center gap-2">
              <span className="h-2.5 w-2.5 rounded-full bg-rose-600 animate-ping shrink-0" />
              <span className="text-xs font-bold uppercase tracking-wider text-rose-700">
                Incidente Afectado
              </span>
            </div>
            <h2 className="text-base font-bold text-slate-800 leading-snug truncate">
              {incidente.tipo || 'Emergencia'}
            </h2>
            <div className="flex flex-wrap items-center gap-1.5 mt-0.5">
              <span className="rounded-md bg-rose-600 px-2 py-0.5 text-xs font-bold text-white">
                Urgencia {incidente.urgencia}/5
              </span>
              <span
                className={`rounded-md border px-2 py-0.5 text-xs font-semibold ${ESTADO_COLORS[incidente.estado] ?? 'bg-slate-100 text-slate-700 border-slate-300'}`}
              >
                {ESTADO_LABELS[incidente.estado] ?? incidente.estado}
              </span>
              {incidente.barrio && (
                <span className="rounded-md bg-slate-100 px-2 py-0.5 text-xs text-slate-600">
                  {incidente.barrio}
                </span>
              )}
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="shrink-0 rounded-full p-1.5 text-slate-400 hover:bg-slate-200 hover:text-slate-700 transition"
          >
            ✕
          </button>
        </div>

        {/* Tabs */}
        <div className="flex border-b border-slate-200 bg-white">
          {(['detalle', 'plan', ...(puedeEditar ? ['editar'] : [])] as Tab[]).map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => setTab(t)}
              className={`flex-1 py-2.5 text-xs font-semibold uppercase tracking-wide transition border-b-2 ${
                tab === t
                  ? 'border-rose-600 text-rose-700'
                  : 'border-transparent text-slate-500 hover:text-slate-700'
              }`}
            >
              {t === 'detalle' ? 'Detalle' : t === 'plan' ? 'Plan de Ayuda' : 'Editar'}
            </button>
          ))}
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-5 space-y-4">
          {/* ── DETALLE ── */}
          {tab === 'detalle' && (
            <>
              {incidente.analisis_ia && (
                <section>
                  <h3 className="text-[11px] font-bold uppercase tracking-wider text-slate-500 mb-1.5">
                    Diagnóstico IA
                  </h3>
                  <p className="text-sm text-slate-700 leading-relaxed bg-slate-50 rounded-lg p-3 border border-slate-200">
                    {incidente.analisis_ia}
                  </p>
                </section>
              )}

              {incidente.testimonio && (
                <section>
                  <h3 className="text-[11px] font-bold uppercase tracking-wider text-slate-500 mb-1.5">
                    Testimonio del Operador
                  </h3>
                  <blockquote className="text-sm italic text-slate-700 bg-amber-50 border border-amber-200 rounded-lg p-3 leading-relaxed">
                    &ldquo;{incidente.testimonio}&rdquo;
                  </blockquote>
                </section>
              )}

              {recursos.length > 0 && (
                <section>
                  <h3 className="text-[11px] font-bold uppercase tracking-wider text-slate-500 mb-2">
                    Insumos Requeridos ({recursos.length})
                  </h3>
                  <div className="space-y-2">
                    {recursos.map((r, i) => (
                      <div
                        key={i}
                        className="flex items-start gap-3 rounded-lg bg-rose-50 border border-rose-200 p-3"
                      >
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-semibold text-rose-800 truncate">{r.insumo_nombre}</p>
                          <p className="text-xs text-rose-600 mt-0.5">
                            {r.cantidad_estimada} {r.unidad}
                          </p>
                          {r.razon && (
                            <p className="text-[11px] text-slate-500 mt-1 leading-snug">{r.razon}</p>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                </section>
              )}

              <section className="text-[11px] text-slate-400 font-mono border-t border-slate-100 pt-3 space-y-1">
                <div className="flex justify-between">
                  <span>Lat / Lng</span>
                  <span>{incidente.lat.toFixed(5)}, {incidente.lng.toFixed(5)}</span>
                </div>
                {incidente.origen_reporte && (
                  <div className="flex justify-between">
                    <span>Origen</span>
                    <span className="text-slate-500">{incidente.origen_reporte}</span>
                  </div>
                )}
                {incidente.creado_en && (
                  <div className="flex justify-between">
                    <span>Reportado</span>
                    <span className="text-slate-500">
                      {new Date(incidente.creado_en).toLocaleString('es-CO', {
                        dateStyle: 'short',
                        timeStyle: 'short',
                      })}
                    </span>
                  </div>
                )}
              </section>
            </>
          )}

          {/* ── PLAN DE AYUDA ── */}
          {tab === 'plan' && (
            <>
              <div className="rounded-lg bg-blue-50 border border-blue-200 p-3 text-xs text-blue-700">
                <strong>Algoritmo Voronoi:</strong> Los nodos de ayuda más cercanos son asignados según
                proximidad geográfica. Se muestra qué tiene cada nodo de los insumos requeridos.
              </div>

              {recursos.length === 0 && (
                <p className="text-sm text-slate-500 text-center py-6">
                  Este incidente no tiene insumos requeridos registrados.
                </p>
              )}

              {nodosPlan.length === 0 && planLoaded && (
                <p className="text-sm text-slate-500 text-center py-6">
                  No hay nodos de ayuda activos registrados.
                </p>
              )}

              {nodosPlan.map((np) => (
                <section
                  key={np.punto.id}
                  className="rounded-xl border border-slate-200 bg-white shadow-sm overflow-hidden"
                >
                  {/* Nodo header */}
                  <div className="flex items-center justify-between gap-2 px-4 py-3 bg-slate-50 border-b border-slate-200">
                    <div className="min-w-0">
                      <p className="text-sm font-bold text-slate-800 truncate">{np.punto.nombre}</p>
                      <p className="text-[11px] text-slate-500 capitalize">
                        {np.punto.tipo ?? 'punto logístico'} · {np.punto.estado ?? 'activo'}
                      </p>
                    </div>
                    <span className="shrink-0 rounded-full bg-slate-200 px-2.5 py-1 text-[11px] font-bold text-slate-600">
                      {np.distKm.toFixed(1)} km
                    </span>
                  </div>

                  {/* Inventario vs necesidades */}
                  {np.loading ? (
                    <div className="px-4 py-4 text-xs text-slate-400 text-center">
                      Cargando inventario…
                    </div>
                  ) : recursos.length === 0 ? (
                    <div className="px-4 py-3 text-xs text-slate-400">
                      Sin insumos requeridos para cruzar.
                    </div>
                  ) : (
                    <div className="divide-y divide-slate-100">
                      {recursos.map((r, ri) => {
                        const invItem = np.inventario.find(
                          (inv) =>
                            inv.nombre.toLowerCase().includes(r.insumo_nombre.toLowerCase()) ||
                            r.insumo_nombre.toLowerCase().includes(inv.nombre.toLowerCase())
                        );
                        return (
                          <div key={ri} className="flex items-center justify-between gap-3 px-4 py-2.5">
                            <div className="flex-1 min-w-0">
                              <p className="text-xs font-semibold text-slate-700 truncate">
                                {r.insumo_nombre}
                              </p>
                              <p className="text-[11px] text-slate-400">
                                Necesario: {r.cantidad_estimada} {r.unidad}
                              </p>
                            </div>
                            {invItem ? (
                              <div className="text-right shrink-0">
                                <p className={`text-xs ${NIVEL_COLORS[invItem.nivel] ?? 'text-slate-600'}`}>
                                  {NIVEL_LABELS[invItem.nivel]}
                                </p>
                                <p className="text-[11px] text-slate-400">
                                  {invItem.cantidad_actual} / {invItem.cantidad_necesaria} {invItem.unidad ?? ''}
                                </p>
                              </div>
                            ) : (
                              <span className="text-xs text-slate-400 shrink-0">No registrado</span>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  )}

                  {np.punto.direccion && (
                    <div className="px-4 py-2 bg-slate-50 border-t border-slate-100 text-[11px] text-slate-400">
                      {np.punto.direccion}
                      {np.punto.telefono && ` · ${np.punto.telefono}`}
                    </div>
                  )}
                </section>
              ))}
            </>
          )}

          {/* ── EDITAR ── */}
          {tab === 'editar' && (
            <>
              {!userSession ? (
                <p className="text-sm text-slate-500 text-center py-8">
                  Debes iniciar sesión para editar incidentes.
                </p>
              ) : (
                <div className="space-y-4">
                  {/* Urgencia */}
                  <div>
                    <label className="block text-[11px] font-bold uppercase tracking-wider text-slate-500 mb-2">
                      Urgencia
                    </label>
                    <div className="flex gap-2">
                      {[1, 2, 3, 4, 5].map((n) => (
                        <button
                          key={n}
                          type="button"
                          onClick={() => setEditUrgencia(n)}
                          className={`flex-1 py-2 rounded-lg text-sm font-bold border-2 transition ${
                            editUrgencia === n
                              ? n >= 4
                                ? 'bg-rose-600 border-rose-600 text-white'
                                : 'bg-amber-500 border-amber-500 text-white'
                              : 'bg-white border-slate-200 text-slate-500 hover:border-slate-400'
                          }`}
                        >
                          {n}
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Estado */}
                  <div>
                    <label className="block text-[11px] font-bold uppercase tracking-wider text-slate-500 mb-2">
                      Estado
                    </label>
                    <div className="flex flex-col gap-2">
                      {(['pendiente', 'en_atencion', 'resuelto'] as const).map((e) => (
                        <button
                          key={e}
                          type="button"
                          onClick={() => setEditEstado(e)}
                          className={`rounded-lg border-2 py-2.5 px-3 text-sm font-semibold text-left transition ${
                            editEstado === e
                              ? ESTADO_COLORS[e] + ' border-current'
                              : 'bg-white border-slate-200 text-slate-500 hover:border-slate-400'
                          }`}
                        >
                          {ESTADO_LABELS[e]}
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Testimonio */}
                  <div>
                    <label className="block text-[11px] font-bold uppercase tracking-wider text-slate-500 mb-2">
                      Testimonio
                    </label>
                    <textarea
                      rows={5}
                      value={editTestimonio}
                      onChange={(e) => setEditTestimonio(e.target.value)}
                      className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-rose-400 resize-none"
                    />
                  </div>

                  {saveError && (
                    <p className="text-xs text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
                      {saveError}
                    </p>
                  )}

                  <button
                    type="button"
                    onClick={handleSave}
                    disabled={saving}
                    className="w-full rounded-xl bg-rose-600 py-3 text-sm font-bold text-white hover:bg-rose-700 disabled:opacity-50 transition"
                  >
                    {saving ? 'Guardando…' : 'Guardar Cambios'}
                  </button>

                  {/* Zona de borrado */}
                  <div className="border-t border-slate-200 pt-4">
                    <p className="text-[11px] font-bold uppercase tracking-wider text-slate-400 mb-3">
                      Zona Peligrosa
                    </p>
                    {!confirmDelete ? (
                      <button
                        type="button"
                        onClick={() => setConfirmDelete(true)}
                        className="w-full rounded-xl border-2 border-red-300 py-2.5 text-sm font-semibold text-red-600 hover:bg-red-50 transition"
                      >
                        Eliminar Incidente
                      </button>
                    ) : (
                      <div className="rounded-xl bg-red-50 border border-red-300 p-4 space-y-3">
                        <p className="text-sm text-red-700 font-semibold text-center">
                          ¿Confirmas que quieres eliminar este incidente?
                        </p>
                        <p className="text-xs text-red-500 text-center">Esta acción no se puede deshacer.</p>
                        <div className="flex gap-2">
                          <button
                            type="button"
                            onClick={() => setConfirmDelete(false)}
                            className="flex-1 rounded-lg border border-slate-300 py-2 text-sm text-slate-600 hover:bg-slate-50 transition"
                          >
                            Cancelar
                          </button>
                          <button
                            type="button"
                            onClick={handleDelete}
                            disabled={deleting}
                            className="flex-1 rounded-lg bg-red-600 py-2 text-sm font-bold text-white hover:bg-red-700 disabled:opacity-50 transition"
                          >
                            {deleting ? 'Eliminando…' : 'Sí, eliminar'}
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

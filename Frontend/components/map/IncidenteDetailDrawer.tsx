'use client';

import { useEffect, useState, useCallback } from 'react';
import type { Incidente, PuntoControl, InventarioItem, RecursoSugerido } from '@/types';
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

function matchInv(nodo: NodoPlan, nombreRecurso: string) {
  const q = nombreRecurso.toLowerCase();
  return nodo.inventario.find(
    (inv) => inv.nombre.toLowerCase().includes(q) || q.includes(inv.nombre.toLowerCase())
  );
}

function calcularDespachos(recursos: RecursoSugerido[], nodos: NodoPlan[]) {
  const nodosOrdenados = [...nodos].sort((a, b) => a.distKm - b.distKm);
  const despachos: { punto_id: string; insumo_nombre: string; cantidad: number }[] = [];

  for (const r of recursos) {
    let restante = r.cantidad_estimada;
    for (const nodo of nodosOrdenados) {
      if (restante <= 0) break;
      const inv = matchInv(nodo, r.insumo_nombre);
      if (!inv || inv.nivel === 'no_hay' || inv.cantidad_actual <= 0) continue;
      const aporte = Math.min(inv.cantidad_actual, restante);
      if (aporte > 0) {
        despachos.push({
          punto_id: nodo.punto.id,
          insumo_nombre: r.insumo_nombre,
          cantidad: aporte,
        });
        restante -= aporte;
      }
    }
  }

  return despachos;
}

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

  // Carga plan: top 6 puntos más cercanos + su inventario
  const loadPlan = useCallback(async () => {
    if (planLoaded) return;
    const sorted = [...puntosControl]
      .filter((p) => p.estado !== 'cerrado')
      .map((p) => ({ punto: p, distKm: distKm(incidente.lat, incidente.lng, p.lat, p.lng) }))
      .sort((a, b) => a.distKm - b.distKm)
      .slice(0, 6);

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
      let despachosPayload: { punto_id: string; insumo_nombre: string; cantidad: number }[] | undefined = undefined;

      if (editEstado === 'en_atencion') {
        let currentNodos = nodosPlan;
        if (currentNodos.length === 0 || currentNodos.some((n) => n.loading)) {
          const sorted = [...puntosControl]
            .filter((p) => p.estado !== 'cerrado')
            .map((p) => ({ punto: p, distKm: distKm(incidente.lat, incidente.lng, p.lat, p.lng) }))
            .sort((a, b) => a.distKm - b.distKm)
            .slice(0, 6);

          currentNodos = await Promise.all(
            sorted.map(async ({ punto, distKm: d }) => {
              try {
                const inv = await getInventarioNodoApi(punto.id);
                return { punto, distKm: d, inventario: inv, loading: false };
              } catch {
                return { punto, distKm: d, inventario: [], loading: false };
              }
            })
          );
        }
        despachosPayload = calcularDespachos(recursos, currentNodos);
      }

      const updated = await updateIncidenteApi(userSession.token, incidente.id, {
        urgencia: editUrgencia,
        testimonio: editTestimonio || undefined,
        estado: editEstado as 'pendiente' | 'en_atencion' | 'resuelto',
        despachos: despachosPayload,
      });
      updateIncidenteInStore(updated);
      setActiveIncidente(updated);
      if (editEstado === 'en_atencion') {
        window.dispatchEvent(new Event('refresh-asignaciones'));
        window.dispatchEvent(new Event('refresh-puntos'));
      }
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
      window.dispatchEvent(new Event('refresh-asignaciones'));
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
          {tab === 'plan' && (() => {
            const allLoaded = planLoaded && nodosPlan.every((n) => !n.loading);

            // Busca el item de inventario que coincide con el nombre del recurso
            function matchInv(nodo: NodoPlan, nombreRecurso: string) {
              const q = nombreRecurso.toLowerCase();
              return nodo.inventario.find(
                (inv) => inv.nombre.toLowerCase().includes(q) || q.includes(inv.nombre.toLowerCase())
              );
            }

            // Para cada recurso, asigna greedy de más cercano a más lejano hasta cubrir la cantidad
            type Asignacion = { nodo: NodoPlan; cantidad: number; unidad: string };
            type RecursoPlan = {
              nombre: string; unidad: string; necesario: number;
              asignaciones: Asignacion[]; cubierto: number; deficit: number;
            };

            const nodosOrdenados = [...nodosPlan].sort((a, b) => a.distKm - b.distKm);

            const planRecursos: RecursoPlan[] = recursos.map((r) => {
              let restante = r.cantidad_estimada;
              const asignaciones: Asignacion[] = [];
              for (const nodo of nodosOrdenados) {
                if (restante <= 0) break;
                const inv = matchInv(nodo, r.insumo_nombre);
                if (!inv || inv.nivel === 'no_hay' || inv.cantidad_actual <= 0) continue;
                const aporte = Math.min(inv.cantidad_actual, restante);
                asignaciones.push({ nodo, cantidad: aporte, unidad: inv.unidad ?? r.unidad });
                restante -= aporte;
              }
              return {
                nombre: r.insumo_nombre,
                unidad: r.unidad,
                necesario: r.cantidad_estimada,
                asignaciones,
                cubierto: r.cantidad_estimada - restante,
                deficit: restante,
              };
            });

            const totalCubiertos = planRecursos.filter((p) => p.deficit === 0).length;
            const nodosInvolucrados = Array.from(
              new Map(
                planRecursos.flatMap((p) => p.asignaciones.map((a) => [a.nodo.punto.id, a.nodo]))
              ).values()
            ).sort((a, b) => a.distKm - b.distKm);

            return (
              <>
                {!allLoaded ? (
                  <div className="flex flex-col items-center justify-center py-12 gap-3">
                    <div className="h-8 w-8 rounded-full border-2 border-rose-300 border-t-rose-600 animate-spin" />
                    <p className="text-xs text-slate-400">Evaluando nodos de ayuda…</p>
                  </div>
                ) : nodosPlan.length === 0 ? (
                  <p className="text-sm text-slate-500 text-center py-6">
                    No hay nodos de ayuda activos registrados.
                  </p>
                ) : recursos.length === 0 ? (
                  <p className="text-sm text-slate-500 text-center py-6">
                    Este incidente no tiene insumos requeridos registrados.
                  </p>
                ) : (
                  <>
                    {/* Resumen de cobertura */}
                    <div className={`rounded-lg px-4 py-3 text-sm font-semibold flex items-center gap-2 ${
                      totalCubiertos === recursos.length
                        ? 'bg-emerald-50 border border-emerald-300 text-emerald-800'
                        : totalCubiertos > 0
                        ? 'bg-amber-50 border border-amber-300 text-amber-800'
                        : 'bg-red-50 border border-red-300 text-red-800'
                    }`}>
                      <span className="text-lg">
                        {totalCubiertos === recursos.length ? '✅' : totalCubiertos > 0 ? '⚠️' : '🚨'}
                      </span>
                      <span>
                        {totalCubiertos} de {recursos.length} insumos cubiertos totalmente
                        {planRecursos.some((p) => p.deficit > 0 && p.cubierto > 0) && ' · algunos parciales'}
                      </span>
                    </div>

                    {/* Plan por recurso */}
                    <div className="space-y-3">
                      {planRecursos.map((rp, i) => {
                        const pct = Math.round((rp.cubierto / rp.necesario) * 100);
                        const color = rp.deficit === 0
                          ? 'border-emerald-300 bg-emerald-50'
                          : rp.cubierto > 0
                          ? 'border-amber-300 bg-amber-50'
                          : 'border-red-300 bg-red-50';
                        const barColor = rp.deficit === 0 ? 'bg-emerald-500' : rp.cubierto > 0 ? 'bg-amber-400' : 'bg-red-400';

                        return (
                          <section key={i} className={`rounded-xl border-2 overflow-hidden ${color}`}>
                            {/* Cabecera del recurso */}
                            <div className="px-4 py-2.5 flex items-center justify-between gap-3">
                              <div className="min-w-0">
                                <p className="text-sm font-bold text-slate-800 truncate">{rp.nombre}</p>
                                <p className="text-[11px] text-slate-500">
                                  Necesario: {rp.necesario} {rp.unidad}
                                  {rp.deficit > 0 && (
                                    <span className="text-red-600 font-semibold"> · Déficit: {rp.deficit} {rp.unidad}</span>
                                  )}
                                </p>
                              </div>
                              <span className="shrink-0 text-sm font-bold text-slate-700">{pct}%</span>
                            </div>

                            {/* Barra de progreso */}
                            <div className="mx-4 mb-2 h-1.5 rounded-full bg-black/10 overflow-hidden">
                              <div className={`h-full rounded-full transition-all ${barColor}`} style={{ width: `${pct}%` }} />
                            </div>

                            {/* Cadena de nodos que aportan */}
                            {rp.asignaciones.length > 0 ? (
                              <div className="border-t border-black/10 divide-y divide-black/5">
                                {rp.asignaciones.map((a, ai) => (
                                  <div key={ai} className="flex items-center justify-between gap-3 px-4 py-2">
                                    <div className="flex items-center gap-2 min-w-0">
                                      <span className="shrink-0 text-[10px] font-bold text-slate-400 w-4 text-right">{ai + 1}</span>
                                      <div className="min-w-0">
                                        <p className="text-xs font-semibold text-slate-700 truncate">{a.nodo.punto.nombre}</p>
                                        <p className="text-[11px] text-slate-400 capitalize">{a.nodo.punto.tipo ?? 'nodo'} · {a.nodo.distKm.toFixed(1)} km</p>
                                      </div>
                                    </div>
                                    <span className="shrink-0 text-xs font-bold text-emerald-700 bg-emerald-100 rounded px-2 py-0.5">
                                      +{a.cantidad} {a.unidad}
                                    </span>
                                  </div>
                                ))}
                              </div>
                            ) : (
                              <p className="px-4 py-2 text-xs text-red-600 font-semibold border-t border-black/10">
                                Ningún nodo cercano tiene este insumo disponible
                              </p>
                            )}
                          </section>
                        );
                      })}
                    </div>

                    {/* Nodos involucrados en el plan */}
                    {nodosInvolucrados.length > 0 && (
                      <section className="rounded-xl border border-slate-200 bg-white overflow-hidden">
                        <p className="px-4 py-2.5 text-[11px] font-bold uppercase tracking-wider text-slate-500 border-b border-slate-100">
                          Nodos a despachar ({nodosInvolucrados.length})
                        </p>
                        <div className="divide-y divide-slate-100">
                          {nodosInvolucrados.map((n, i) => (
                            <div key={n.punto.id} className="flex items-center gap-3 px-4 py-2.5">
                              <span className="text-xs font-bold text-slate-400 w-4 text-right shrink-0">{i + 1}</span>
                              <div className="flex-1 min-w-0">
                                <p className="text-xs font-semibold text-slate-700 truncate">{n.punto.nombre}</p>
                                {(n.punto.direccion || n.punto.telefono) && (
                                  <p className="text-[11px] text-slate-400 truncate">
                                    {n.punto.direccion}{n.punto.telefono ? ` · ${n.punto.telefono}` : ''}
                                  </p>
                                )}
                              </div>
                              <span className="shrink-0 text-[11px] font-semibold text-slate-500 bg-slate-100 rounded px-2 py-0.5">
                                {n.distKm.toFixed(1)} km
                              </span>
                            </div>
                          ))}
                        </div>
                      </section>
                    )}
                  </>
                )}
              </>
            );
          })()}

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

'use client';

import { useEffect, useState, useCallback } from 'react';
import { useAppStore } from '@/store/useAppStore';
import {
  getMisNodosApi,
  getInventarioNodoApi,
  updateInventarioNodoApi,
  crearPeticionRecursoApi,
  createInsumoApi,
} from '@/lib/api';
import { puedeGestionar, normalizeRole } from '@/lib/rbac';
import type { InventarioItem, NivelInventario, PuntoControl } from '@/types';

function calcularHorasInactivo(fechaStr?: string | null): number {
  if (!fechaStr) return 4.0;
  const fecha = new Date(fechaStr);
  const diffMs = Date.now() - fecha.getTime();
  return Number((diffMs / (1000 * 60 * 60)).toFixed(1));
}

function calcularNivelCuantitativo(actual: number, necesaria: number): {
  nivel: NivelInventario;
  label: string;
  badgeClass: string;
  progressColor: string;
} {
  if (actual <= 0) {
    return {
      nivel: 'no_hay',
      label: 'Agotado (0%)',
      badgeClass: 'bg-rose-100 text-rose-800 border-rose-200',
      progressColor: 'bg-rose-500',
    };
  }
  if (necesaria <= 0) {
    return {
      nivel: 'sobra',
      label: 'Excedente (100%)',
      badgeClass: 'bg-emerald-100 text-emerald-800 border-emerald-200',
      progressColor: 'bg-emerald-500',
    };
  }
  const ratio = actual / necesaria;
  if (ratio < 0.25) {
    return {
      nivel: 'poco',
      label: `Crítico (${Math.round(ratio * 100)}%)`,
      badgeClass: 'bg-amber-100 text-amber-800 border-amber-200',
      progressColor: 'bg-amber-500',
    };
  }
  if (ratio < 0.75) {
    return {
      nivel: 'bien',
      label: `Abastecido (${Math.round(ratio * 100)}%)`,
      badgeClass: 'bg-teal-100 text-teal-800 border-teal-200',
      progressColor: 'bg-teal-500',
    };
  }
  return {
    nivel: 'sobra',
    label: `Excedente (${Math.round(ratio * 100)}%)`,
    badgeClass: 'bg-emerald-100 text-emerald-800 border-emerald-200',
    progressColor: 'bg-emerald-500',
  };
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
  // El detalle de cantidades reales (grilla de insumos + inputs + botones de
  // ajuste) arranca colapsado: es la parte más cargada visualmente de la
  // tarjeta y no todo el mundo necesita verla de entrada.
  const [isInventarioOpen, setIsInventarioOpen] = useState(false);

  // Modal para petición de recursos
  const [isPeticionOpen, setIsPeticionOpen] = useState(false);
  const [peticionTipo, setPeticionTipo] = useState('Agua Potable');
  const [peticionDesc, setPeticionDesc] = useState('');
  const [peticionUrgencia, setPeticionUrgencia] = useState(4);
  const [submittingPeticion, setSubmittingPeticion] = useState(false);
  const [peticionSuccess, setPeticionSuccess] = useState<string | null>(null);
  const [peticionError, setPeticionError] = useState<string | null>(null);

  // Modal para crear nuevo recurso en catálogo (con deduplicación semántica)
  const [isNewInsumoOpen, setIsNewInsumoOpen] = useState(false);
  const [newInsumoNombre, setNewInsumoNombre] = useState('');
  const [newInsumoCategoria, setNewInsumoCategoria] = useState('alimentos');
  const [newInsumoUnidad, setNewInsumoUnidad] = useState('unidades');
  const [newInsumoCriticidad, setNewInsumoCriticidad] = useState(3);
  const [submittingNewInsumo, setSubmittingNewInsumo] = useState(false);
  const [newInsumoError, setNewInsumoError] = useState<string | null>(null);
  const [newInsumoSuccess, setNewInsumoSuccess] = useState<string | null>(null);

  const horasInactivo = calcularHorasInactivo(nodo.actualizado_en || nodo.creado_en);
  const isInactivoCritico = horasInactivo >= 3.0;

  const loadInventario = useCallback(async () => {
    try {
      setLoadingInv(true);
      const data = await getInventarioNodoApi(nodo.id);
      setInventario(data);
    } catch (err: any) {
      console.error('Error cargando inventario cuantitativo del nodo:', err);
    } finally {
      setLoadingInv(false);
    }
  }, [nodo.id]);

  useEffect(() => {
    loadInventario();
  }, [loadInventario]);

  function handleCantidadChange(
    insumoId: string,
    field: 'cantidad_actual' | 'cantidad_necesaria',
    val: number
  ) {
    const cleanVal = Math.max(0, isNaN(val) ? 0 : val);
    setInventario((prev) =>
      prev.map((item) => {
        if (item.insumo_id !== insumoId) return item;
        const actual = field === 'cantidad_actual' ? cleanVal : item.cantidad_actual;
        const necesaria = field === 'cantidad_necesaria' ? cleanVal : item.cantidad_necesaria;
        const deficit = Math.max(0, necesaria - actual);
        const { nivel } = calcularNivelCuantitativo(actual, necesaria);
        return {
          ...item,
          [field]: cleanVal,
          deficit,
          nivel,
        };
      })
    );
  }

  function handleQuickAdjust(insumoId: string, delta: number) {
    setInventario((prev) =>
      prev.map((item) => {
        if (item.insumo_id !== insumoId) return item;
        const actual = Math.max(0, (item.cantidad_actual || 0) + delta);
        const necesaria = item.cantidad_necesaria || 100;
        const deficit = Math.max(0, necesaria - actual);
        const { nivel } = calcularNivelCuantitativo(actual, necesaria);
        return {
          ...item,
          cantidad_actual: actual,
          deficit,
          nivel,
        };
      })
    );
  }

  async function handleGuardarInventario() {
    try {
      setSavingInv(true);
      setErrorMsg(null);
      setSaveSuccess(false);

      const itemsPayload = inventario.map((i) => ({
        insumo_id: i.insumo_id,
        cantidad_actual: Number(i.cantidad_actual) || 0,
        cantidad_necesaria: Number(i.cantidad_necesaria) || 0,
      }));

      const updated = await updateInventarioNodoApi(token, nodo.id, itemsPayload);
      setInventario(updated);
      setSaveSuccess(true);
      onUpdated();
      setTimeout(() => setSaveSuccess(false), 3000);
    } catch (err: any) {
      console.error('Error actualizando inventario cuantitativo:', err);
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
      setPeticionError(null);
      await crearPeticionRecursoApi(token, nodo.id, {
        tipo: peticionTipo,
        descripcion: peticionDesc.trim(),
        urgencia: peticionUrgencia,
      });

      setPeticionSuccess('✓ Solicitud de recursos transmitida a la red logística.');
      setPeticionDesc('');
      onUpdated();
      setTimeout(() => {
        setIsPeticionOpen(false);
        setPeticionSuccess(null);
      }, 1500);
    } catch (err: any) {
      console.error('Error creando petición:', err);
      setPeticionError(err.message || 'No se pudo registrar la solicitud de recursos.');
    } finally {
      setSubmittingPeticion(false);
    }
  }

  async function handleCrearInsumo(e: React.FormEvent) {
    e.preventDefault();
    if (!newInsumoNombre.trim()) return;

    try {
      setSubmittingNewInsumo(true);
      setNewInsumoError(null);
      setNewInsumoSuccess(null);

      const res = await createInsumoApi(token, {
        nombre: newInsumoNombre.trim(),
        categoria: newInsumoCategoria,
        unidad: newInsumoUnidad,
        criticidad: newInsumoCriticidad,
      });

      setNewInsumoSuccess(`✓ Recurso "${res.nombre}" incorporado exitosamente al catálogo.`);
      setNewInsumoNombre('');
      await loadInventario();
      onUpdated();
      setTimeout(() => {
        setIsNewInsumoOpen(false);
        setNewInsumoSuccess(null);
      }, 1500);
    } catch (err: any) {
      console.warn('Validación de insumo:', err.message);
      setNewInsumoError(err.message || 'No se pudo crear el recurso.');
    } finally {
      setSubmittingNewInsumo(false);
    }
  }

  // Totales cuantitativos
  const totalInsumos = inventario.length;
  const insumosConDeficit = inventario.filter((i) => (i.deficit || 0) > 0).length;
  const deficitTotalUnidades = inventario.reduce((acc, i) => acc + (i.deficit || 0), 0);

  return (
    <div
      className={`rounded-xl border bg-white p-5 shadow-sm transition-all ${
        isInactivoCritico
          ? 'border-rosy-copper/70 ring-2 ring-rosy-copper/25'
          : 'border-dark-teal/15 hover:shadow-md'
      }`}
    >
      {/* Cabecera del Nodo */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-4 border-b border-slate-100">
        <div>
          <div className="flex items-center gap-2 flex-wrap">
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
            onClick={() => {
              setPeticionError(null);
              setIsPeticionOpen(true);
            }}
            className="flex items-center gap-2 rounded-lg border-2 border-saffron bg-saffron px-4 py-2.5 text-sm font-extrabold text-dark-teal shadow-md hover:bg-saffron/90 transition"
          >
            {/* Ícono de "solicitud entrante" (bandeja), no de alerta/peligro */}
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className="h-5 w-5">
              <path d="M3 12h4l2 3h6l2-3h4" />
              <path d="M5.45 5.11 3 12v6a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-6l-2.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11Z" />
            </svg>
            Solicitar Recursos
          </button>
        </div>
      </div>

      {/* Banner de Estado de Inactividad (Regla 3h) */}
      <div className="mt-3">
        {isInactivoCritico ? (
          <div className="flex items-center gap-2.5 rounded-lg border-2 border-rosy-copper bg-rosy-copper px-3.5 py-2.5 text-xs text-white shadow-[0_10px_28px_-12px_rgba(219,80,74,0.6)]">
            <span className="relative flex h-2.5 w-2.5 shrink-0">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-white opacity-75" />
              <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-white" />
            </span>
            <span className="font-extrabold">
              ⚠️ ADVERTENCIA: Este nodo lleva {horasInactivo} horas sin reportar actualizaciones.
            </span>
            <span className="text-white/85 hidden sm:inline">
              El protocolo de emergencia SOGR exige registrar cantidades al menos cada 3h.
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

      {/* Resumen Cuantitativo Rápido */}
      {!loadingInv && (
        <div className="mt-3 grid grid-cols-3 gap-2 rounded-lg bg-slate-50 p-2.5 text-center border border-slate-200/60">
          <div>
            <div className="text-[10px] uppercase font-semibold text-slate-500">Insumos Totales</div>
            <div className="text-sm font-bold text-dark-teal">{totalInsumos}</div>
          </div>
          <div>
            <div className="text-[10px] uppercase font-semibold text-slate-500">Con Déficit</div>
            <div className={`text-sm font-bold ${insumosConDeficit > 0 ? 'text-amber-700' : 'text-emerald-700'}`}>
              {insumosConDeficit} / {totalInsumos}
            </div>
          </div>
          <div>
            <div className="text-[10px] uppercase font-semibold text-slate-500">Déficit de Unidades</div>
            <div className={`text-sm font-bold ${deficitTotalUnidades > 0 ? 'text-rose-600' : 'text-emerald-700'}`}>
              {deficitTotalUnidades > 0 ? `-${deficitTotalUnidades}` : '0 (OK)'}
            </div>
          </div>
        </div>
      )}

      {/* Panel de Gestión Cuantitativa de Insumos — colapsable */}
      <div className="mt-4">
        <button
          type="button"
          onClick={() => setIsInventarioOpen((v) => !v)}
          aria-expanded={isInventarioOpen}
          className="flex w-full items-center justify-between gap-2 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2.5 text-left transition hover:bg-slate-100"
        >
          <span className="flex items-center gap-2">
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth={2.5}
              strokeLinecap="round"
              strokeLinejoin="round"
              className={`h-3.5 w-3.5 text-slate-500 transition-transform ${isInventarioOpen ? 'rotate-90' : ''}`}
            >
              <path d="M9 18l6-6-6-6" />
            </svg>
            <span className="text-xs font-bold uppercase tracking-wider text-slate-700">
              Cantidades Reales por Insumo
            </span>
          </span>
          <span className="text-[11px] font-semibold text-slate-400">
            {isInventarioOpen ? 'Ocultar detalle' : `Ver detalle (${totalInsumos})`}
          </span>
        </button>

        {isInventarioOpen && (
          <div className="mt-3">
            <div className="mb-3 flex flex-col sm:flex-row sm:items-center justify-between gap-2">
              <p className="text-[11px] text-slate-400">
                Ingresa la cantidad física disponible y la meta necesaria
              </p>
              <button
                type="button"
                onClick={() => setIsNewInsumoOpen(true)}
                className="flex items-center gap-1.5 rounded-lg border border-dark-teal/20 bg-dark-teal/5 px-2.5 py-1 text-xs font-bold text-dark-teal hover:bg-dark-teal/10 transition self-start sm:self-auto"
              >
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} className="h-3.5 w-3.5">
                  <path d="M12 5v14M5 12h14" />
                </svg>
                + Crear Nuevo Recurso (IA Normalizada)
              </button>
            </div>

            {loadingInv ? (
          <div className="py-8 text-center text-xs text-slate-400">
            Cargando inventario cuantitativo desde Supabase...
          </div>
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-3.5 max-h-96 overflow-y-auto pr-1">
            {inventario.map((item) => {
              const actual = Number(item.cantidad_actual) || 0;
              const necesaria = Number(item.cantidad_necesaria) || 1;
              const deficit = Math.max(0, necesaria - actual);
              const { label, badgeClass, progressColor } = calcularNivelCuantitativo(actual, necesaria);
              const pct = Math.min(100, Math.round((actual / necesaria) * 100));

              return (
                <div
                  key={item.insumo_id}
                  className="flex flex-col gap-2 rounded-xl border border-slate-200/80 bg-white p-3.5 shadow-2xs hover:border-dark-teal/30 transition"
                >
                  {/* Encabezado del Insumo */}
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <div className="font-bold text-xs text-slate-900">{item.nombre}</div>
                      <div className="text-[10px] text-slate-500 capitalize">
                        {item.categoria || 'Insumo'} · Unidad: <strong>{item.unidad || 'unidades'}</strong>
                      </div>
                    </div>
                    <span className={`rounded-md border px-2 py-0.5 text-[10px] font-bold ${badgeClass}`}>
                      {label}
                    </span>
                  </div>

                  {/* Barra de progreso de cobertura */}
                  <div className="flex flex-col gap-1">
                    <div className="flex items-center justify-between text-[11px]">
                      <span className="font-semibold text-slate-700">
                        Disponible: <strong className="text-dark-teal text-xs">{actual}</strong> / {necesaria} {item.unidad}
                      </span>
                      {deficit > 0 ? (
                        <span className="font-bold text-rose-600 text-[10px]">
                          Faltan {deficit} {item.unidad}
                        </span>
                      ) : (
                        <span className="font-bold text-emerald-700 text-[10px]">
                          Meta cubierta
                        </span>
                      )}
                    </div>
                    <div className="h-2 w-full overflow-hidden rounded-full bg-slate-100">
                      <div
                        className={`h-full transition-all duration-300 ${progressColor}`}
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                  </div>

                  {/* Entradas Numéricas e Incrementos Rápidos */}
                  <div className="mt-1 flex flex-wrap items-center justify-between gap-2 pt-2 border-t border-slate-100">
                    <div className="flex items-center gap-1.5">
                      <div className="flex flex-col">
                        <span className="text-[9px] font-semibold text-slate-500 uppercase">Actual</span>
                        <input
                          type="number"
                          min="0"
                          value={item.cantidad_actual}
                          onChange={(e) =>
                            handleCantidadChange(
                              item.insumo_id,
                              'cantidad_actual',
                              parseInt(e.target.value, 10)
                            )
                          }
                          className="w-16 rounded border border-slate-300 px-2 py-1 text-xs font-bold text-slate-800 outline-none focus:border-dark-teal"
                        />
                      </div>
                      <div className="flex flex-col">
                        <span className="text-[9px] font-semibold text-slate-500 uppercase">Meta</span>
                        <input
                          type="number"
                          min="0"
                          value={item.cantidad_necesaria}
                          onChange={(e) =>
                            handleCantidadChange(
                              item.insumo_id,
                              'cantidad_necesaria',
                              parseInt(e.target.value, 10)
                            )
                          }
                          className="w-16 rounded border border-slate-300 px-2 py-1 text-xs font-bold text-slate-800 outline-none focus:border-dark-teal"
                        />
                      </div>
                    </div>

                    {/* Botones de ajuste rápido en terreno */}
                    <div className="flex items-center gap-1">
                      <button
                        type="button"
                        onClick={() => handleQuickAdjust(item.insumo_id, -10)}
                        className="rounded border border-slate-200 bg-slate-50 px-2 py-1 text-[10px] font-bold text-slate-700 hover:bg-slate-100"
                        title="Restar 10 unidades"
                      >
                        -10
                      </button>
                      <button
                        type="button"
                        onClick={() => handleQuickAdjust(item.insumo_id, 10)}
                        className="rounded border border-slate-200 bg-slate-50 px-2 py-1 text-[10px] font-bold text-slate-700 hover:bg-slate-100"
                        title="Sumar 10 unidades"
                      >
                        +10
                      </button>
                      <button
                        type="button"
                        onClick={() => handleQuickAdjust(item.insumo_id, 50)}
                        className="rounded border border-slate-200 bg-slate-50 px-2 py-1 text-[10px] font-bold text-slate-700 hover:bg-slate-100"
                        title="Sumar 50 unidades"
                      >
                        +50
                      </button>
                      <button
                        type="button"
                        onClick={() => handleCantidadChange(item.insumo_id, 'cantidad_actual', 0)}
                        className="rounded border border-rose-200 bg-rose-50 px-1.5 py-1 text-[10px] font-bold text-rose-700 hover:bg-rose-100"
                        title="Agotar (0)"
                      >
                        0
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {/* Acciones de guardado */}
        <div className="mt-4 flex flex-col sm:flex-row items-center justify-between gap-3 pt-3 border-t border-slate-100">
          <div>
            {saveSuccess && (
              <span className="text-xs font-semibold text-emerald-700">
                ✓ Cantidades cuantitativas persistidas en Supabase. Se restableció el contador de 3h.
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
            className="w-full sm:w-auto rounded-md bg-dark-teal px-5 py-2 text-xs font-bold text-white shadow hover:bg-dark-teal/90 transition disabled:opacity-50 flex items-center justify-center gap-2"
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
              'Guardar Cantidades Cuantitativas'
            )}
          </button>
            </div>
          </div>
        )}
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
                  className="rounded-md border border-slate-300 px-3 py-2 text-xs focus:border-dark-teal outline-none bg-white font-medium"
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
                <label className="text-xs font-semibold text-slate-700">Detalle Numérico del Requerimiento *</label>
                <textarea
                  required
                  rows={3}
                  value={peticionDesc}
                  onChange={(e) => setPeticionDesc(e.target.value)}
                  placeholder="Ej. Se requieren 350 litros de agua potable urgente para cubrir déficit del albergue..."
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

              {peticionError && (
                <div className="p-2 rounded bg-rose-50 border border-rose-200 text-rose-700 text-xs font-semibold">
                  {peticionError}
                </div>
              )}

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

      {/* Modal para crear nuevo recurso con deduplicación semántica por IA */}
      {isNewInsumoOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xs p-4">
          <div className="w-full max-w-md rounded-xl bg-white p-6 shadow-2xl border border-dark-teal/20">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100">
              <div className="flex items-center gap-2">
                <div className="flex h-7 w-7 items-center justify-center rounded-md bg-dark-teal/10 text-dark-teal">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} className="h-4 w-4">
                    <path d="M12 5v14M5 12h14" />
                  </svg>
                </div>
                <div>
                  <h3 className="text-sm font-bold text-dark-teal">
                    Nuevo Recurso en Catálogo
                  </h3>
                  <p className="text-[11px] text-slate-500">
                    SOGR · Deduplicación Semántica por IA
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setIsNewInsumoOpen(false)}
                className="text-slate-400 hover:text-slate-600 text-xs"
              >
                ✕
              </button>
            </div>

            <div className="mt-3 rounded-lg bg-teal-50 border border-teal-200/70 p-2.5 text-[11px] text-teal-900 leading-relaxed">
              💡 <strong>Validación Semántica:</strong> La IA evalúa si este recurso ya existe bajo otro nombre o sinónimo para evitar duplicados en la red de Cali.
            </div>

            <form onSubmit={handleCrearInsumo} className="mt-4 flex flex-col gap-3">
              <div className="flex flex-col gap-1">
                <label className="text-xs font-semibold text-slate-700">Nombre del Recurso *</label>
                <input
                  type="text"
                  required
                  placeholder="Ej. Linternas LED, Generadores Eléctricos..."
                  value={newInsumoNombre}
                  onChange={(e) => setNewInsumoNombre(e.target.value)}
                  className="rounded-md border border-slate-300 px-3 py-2 text-xs focus:border-dark-teal outline-none font-medium text-slate-800"
                />
              </div>

              <div className="grid grid-cols-2 gap-2.5">
                <div className="flex flex-col gap-1">
                  <label className="text-xs font-semibold text-slate-700">Categoría</label>
                  <select
                    value={newInsumoCategoria}
                    onChange={(e) => setNewInsumoCategoria(e.target.value)}
                    className="rounded-md border border-slate-300 px-2.5 py-2 text-xs focus:border-dark-teal outline-none bg-white font-medium"
                  >
                    <option value="seguridad">Seguridad / Rescate / Herramientas</option>
                    <option value="alimentos">Alimentos y Raciones</option>
                    <option value="agua">Agua y Bebidas</option>
                    <option value="salud">Salud y Medicamentos</option>
                    <option value="abrigo">Abrigo y Colchonetas</option>
                    <option value="aseo">Aseo e Higiene</option>
                    <option value="bebe">Bebés y Niños</option>
                    <option value="mascotas">Mascotas</option>
                  </select>
                </div>

                <div className="flex flex-col gap-1">
                  <label className="text-xs font-semibold text-slate-700">Unidad de Medida</label>
                  <select
                    value={newInsumoUnidad}
                    onChange={(e) => setNewInsumoUnidad(e.target.value)}
                    className="rounded-md border border-slate-300 px-2.5 py-2 text-xs focus:border-dark-teal outline-none bg-white font-medium"
                  >
                    <option value="unidades">unidades</option>
                    <option value="litros">litros</option>
                    <option value="kg">kg</option>
                    <option value="raciones">raciones</option>
                    <option value="kits">kits</option>
                    <option value="pares">pares</option>
                    <option value="paquetes">paquetes</option>
                    <option value="sobres">sobres</option>
                    <option value="cajas">cajas</option>
                  </select>
                </div>
              </div>

              <div className="flex flex-col gap-1">
                <label className="text-xs font-semibold text-slate-700">Criticidad en Emergencias (1 a 5)</label>
                <div className="flex items-center gap-2">
                  {[1, 2, 3, 4, 5].map((val) => (
                    <button
                      key={val}
                      type="button"
                      onClick={() => setNewInsumoCriticidad(val)}
                      className={`flex-1 py-1.5 rounded text-xs font-bold transition ${
                        newInsumoCriticidad === val
                          ? 'bg-dark-teal text-white shadow'
                          : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
                      }`}
                    >
                      {val}
                    </button>
                  ))}
                </div>
              </div>

              {newInsumoSuccess && (
                <div className="p-2.5 rounded-lg bg-emerald-50 border border-emerald-200 text-emerald-800 text-xs font-semibold flex items-center gap-2">
                  <svg className="h-4 w-4 text-emerald-600 shrink-0" viewBox="0 0 20 20" fill="currentColor">
                    <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                  </svg>
                  <span>{newInsumoSuccess}</span>
                </div>
              )}

              {newInsumoError && (
                <div className="p-2.5 rounded-lg bg-rose-50 border border-rose-200 text-rose-800 text-xs font-semibold flex items-start gap-2">
                  <svg className="h-4 w-4 text-rose-600 shrink-0 mt-0.5" viewBox="0 0 20 20" fill="currentColor">
                    <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7 4a1 1 0 11-2 0 1 1 0 012 0zm-1-9a1 1 0 00-1 1v4a1 1 0 102 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
                  </svg>
                  <span>{newInsumoError}</span>
                </div>
              )}

              <div className="mt-3 flex justify-end gap-2 pt-2 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setIsNewInsumoOpen(false)}
                  className="rounded-md border border-slate-200 px-3 py-1.5 text-xs font-semibold text-slate-600 hover:bg-slate-50"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={submittingNewInsumo || !newInsumoNombre.trim()}
                  className="rounded-md bg-dark-teal px-4 py-1.5 text-xs font-bold text-white shadow hover:bg-dark-teal/90 disabled:opacity-50 flex items-center gap-1.5"
                >
                  {submittingNewInsumo ? (
                    <>
                      <svg className="h-3.5 w-3.5 animate-spin" viewBox="0 0 24 24" fill="none">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                      </svg>
                      Validando con IA...
                    </>
                  ) : (
                    'Guardar Recurso en Catálogo'
                  )}
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

  // El admin_gubernamental no tiene nodos "asignados" — él los crea y ve
  // todos, así que el título/copy le habla en esos términos. El ente público
  // sí gestiona una asignación concreta.
  const isAdmin = normalizeRole(userSession.role) === 'admin_gubernamental';
  const roleName = isAdmin
    ? 'Administrador Gubernamental (Vista Global de Nodos)'
    : `Ente Público (${userSession.email || userSession.nombre})`;
  const pageTitle = isAdmin ? 'Nodos de Cali' : 'Mis Nodos Asignados en Cali';

  return (
    <div className="flex flex-col gap-5 p-2 sm:p-4">
      {/* Encabezado */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 rounded-xl bg-dark-teal p-5 text-white shadow-md">
        <div>
          <span className="text-[11px] font-semibold uppercase tracking-wider text-saffron">
            Portal Operativo de Control
          </span>
          <h1 className="text-xl font-bold">{pageTitle}</h1>
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
          <h3 className="text-sm font-bold text-slate-700">
            {isAdmin ? 'Aún no hay nodos levantados en Cali' : 'No tienes nodos asignados'}
          </h3>
          <p className="mt-1 text-xs text-slate-500">
            {isAdmin
              ? 'Usa "Levantar Nodo" para crear el primer punto de ayuda de la red.'
              : 'El Administrador Gubernamental aún no ha asignado nodos a tu cuenta de Ente Público.'}
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

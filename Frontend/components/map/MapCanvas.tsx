'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import * as maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { MapboxOverlay } from '@deck.gl/mapbox';
import { ArcLayer, GeoJsonLayer, ScatterplotLayer } from '@deck.gl/layers';
import type { AsignacionActiva } from '@/lib/api';
import { getAsignacionesActivasApi, completarEntregaApi } from '@/lib/api';
import { useAppStore } from '@/store/useAppStore';
import { getPuntosControlApi, getIncidentesApi, getVoronoiCeldasApi } from '@/lib/api';
import { puedeLevantarNodos } from '@/lib/rbac';
import type { PuntoControl, Incidente } from '@/types';
import IncidenteDetailDrawer from './IncidenteDetailDrawer';
import type { VoronoiFeatureCollection } from '@/types/map';

const CALI_CENTER: [number, number] = [-76.5320, 3.4516];
const INITIAL_ZOOM = 13;

// Debajo de este nivel de zoom las celdas de Voronoi no se dibujan: alejado
// (viendo toda Cali) las líneas de separación solo ensucian el mapa; recién
// tienen sentido cuando el usuario se acerca a una zona concreta.
const VORONOI_MIN_ZOOM = 12;
const EMPTY_VORONOI: VoronoiFeatureCollection = { type: 'FeatureCollection', features: [] };

export const MAP_BASE_STYLES = {
  calles: {
    name: 'Calles Cali (Color)',
    spec: {
      version: 8 as const,
      sources: {
        'carto-voyager': {
          type: 'raster' as const,
          tiles: [
            'https://a.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}@2x.png',
            'https://b.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}@2x.png',
            'https://c.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}@2x.png',
            'https://d.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}@2x.png',
          ],
          tileSize: 256,
          attribution:
            '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank">OpenStreetMap</a> &copy; <a href="https://carto.com/attributions" target="_blank">CARTO</a>',
          maxzoom: 20,
        },
      },
      layers: [
        {
          id: 'carto-voyager-layer',
          type: 'raster' as const,
          source: 'carto-voyager',
          minzoom: 0,
          maxzoom: 20,
        },
      ],
    },
  },
  satelite: {
    name: 'Satélite',
    spec: {
      version: 8 as const,
      sources: {
        'esri-sat': {
          type: 'raster' as const,
          tiles: [
            'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
          ],
          tileSize: 256,
          attribution:
            '&copy; <a href="https://www.esri.com" target="_blank">Esri</a>, Maxar, Earthstar Geographics',
          maxzoom: 19,
        },
      },
      layers: [
        {
          id: 'esri-sat-layer',
          type: 'raster' as const,
          source: 'esri-sat',
          minzoom: 0,
          maxzoom: 19,
        },
      ],
    },
  },
};

const TIPO_COLORS: Record<string, [number, number, number, number]> = {
  acopio: [46, 117, 89, 230],     // green / muted-teal
  albergue: [227, 181, 5, 230],   // saffron yellow
  hospital: [219, 80, 74, 230],   // rosy-copper red
  comando: [24, 76, 120, 230],    // dark-teal / navy
};

function getTipoColor(tipo?: string | null): [number, number, number, number] {
  if (!tipo) return [46, 117, 89, 230];
  const t = tipo.toLowerCase();
  return TIPO_COLORS[t] || [46, 117, 89, 230];
}

// Puntos del triángulo en un viewBox 24x24. Las esquinas se redondean con
// `stroke-linejoin="round"` (un truco estándar de SVG: un stroke grueso del
// mismo color con unión redondeada "come" la punta filosa de cada vértice) —
// mucho más simple y confiable que intentar un clip-path curvo.
const TRIANGLE_POINTS = '12,3 3,20 21,20';

function buildTriangleSvg(fillColor: string, strokeColor: string, strokeWidth: string): SVGSVGElement {
  const svgNS = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(svgNS, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('width', '100%');
  svg.setAttribute('height', '100%');
  svg.style.position = 'absolute';
  svg.style.inset = '0';
  svg.style.overflow = 'visible';

  const poly = document.createElementNS(svgNS, 'polygon');
  poly.setAttribute('points', TRIANGLE_POINTS);
  poly.setAttribute('fill', fillColor);
  poly.setAttribute('stroke', strokeColor);
  poly.setAttribute('stroke-width', strokeWidth);
  poly.setAttribute('stroke-linejoin', 'round');
  svg.appendChild(poly);
  return svg;
}

// Marcador DOM de incidente: triángulo de esquinas redondeadas con halo
// pulsante (mismo `animate-ping` que usa la leyenda), en vez de un círculo
// deck.gl — así el ícono comunica "afectación/alerta" en el propio mapa, no
// solo en las convenciones.
function buildIncidenteMarkerEl(inc: Incidente): HTMLDivElement {
  const urgencia = inc.urgencia || 3;
  const color = urgencia >= 4 ? '#DC2626' : '#F59E0B';
  const size = urgencia >= 4 ? 30 : 24;

  // `outer` es el elemento que le pasamos a `new maplibregl.Marker({ element })`
  // — MapLibre lo usa como su `_element` y le aplica `position: absolute` +
  // `transform: translate(...)` (vía la clase `.maplibregl-marker`) para
  // mantenerlo anclado a la coordenada real en cada pan/zoom. Por eso NO debe
  // llevar un `position` inline: pisaría esa regla y el marcador se cae al
  // flujo normal del documento (se apilan en columna y dejan de seguir el mapa).
  const outer = document.createElement('div');
  outer.style.width = `${size}px`;
  outer.style.height = `${size}px`;
  outer.style.cursor = 'pointer';
  outer.style.filter = 'drop-shadow(0 2px 4px rgba(0,0,0,0.35))';

  // Contenedor interno: acá sí necesitamos `position: relative` para apilar
  // el halo pulsante y el triángulo sólido uno encima del otro.
  const inner = document.createElement('div');
  inner.style.position = 'relative';
  inner.style.width = '100%';
  inner.style.height = '100%';

  // Halo pulsante (idéntico patrón visual a la leyenda: animate-ping)
  const halo = buildTriangleSvg(color, color, '3');
  halo.classList.add('animate-ping');
  halo.style.opacity = '0.7';

  // Triángulo sólido con borde blanco redondeado (reemplaza el
  // `getLineColor` blanco que tenía la capa deck.gl anterior)
  const solid = buildTriangleSvg(color, '#ffffff', '2.5');

  inner.appendChild(halo);
  inner.appendChild(solid);
  outer.appendChild(inner);
  return outer;
}

// Convenciones del mapa: cada entrada es a la vez ítem de leyenda y filtro
// clickeable (estilo Plotly) — clicear una categoría la oculta/muestra en
// el mapa sin recargar datos.
const LEGEND_ITEMS: Array<{ key: string; label: string; color: string; isIncidente?: boolean }> = [
  { key: 'acopio', label: 'Centro de Acopio', color: '#2E7559' },
  { key: 'albergue', label: 'Albergue Temporal', color: '#E3B505' },
  { key: 'hospital', label: 'Puesto de Salud', color: '#DB504A' },
  { key: 'comando', label: 'Puesto de Mando (PMU)', color: '#184C78' },
  { key: 'incidente', label: 'Incidente Afectado', color: '#DC2626', isIncidente: true },
];

// ---------------------------------------------------------------------------
// Helpers de animación de transporte
// ---------------------------------------------------------------------------

/** ms que tarda un "paquete" en ir de apoyo → afectado.
 *  Base 4s + 0.4ms/m de distancia + 3ms/unidad (capped 20s).
 *  Más lejos y más cantidad → animación más lenta. */
function getTransitDuration(distancia_m: number, cantidad: number): number {
  return Math.min(4000 + distancia_m * 0.4 + cantidad * 3, 20000);
}

/** Color RGBA por urgencia (5=rojo crítico … 1=verde ok). */
function urgenciaRgba(urgencia: number): [number, number, number, number] {
  if (urgencia >= 5) return [220, 38, 38, 230];
  if (urgencia >= 4) return [249, 115, 22, 210];
  if (urgencia >= 3) return [234, 179, 8, 200];
  return [34, 197, 94, 180];
}

/** Interpola linealmente entre (x0,y0) y (x1,y1) con t∈[0,1]. */
function lerpPos(
  lng0: number, lat0: number,
  lng1: number, lat1: number,
  t: number,
): [number, number] {
  return [lng0 + (lng1 - lng0) * t, lat0 + (lat1 - lat0) * t];
}

export default function MapCanvas() {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const overlayRef = useRef<MapboxOverlay | null>(null);

  // Capas estáticas (voronoi + puntos): guardadas en ref para que el RAF
  // de transporte las incluya sin re-ejecutar el useEffect que las genera.
  const staticLayersRef = useRef<any[]>([]);
  // Asignaciones activas (se re-fetcha periódicamente o por evento)
  const asignacionesRef = useRef<AsignacionActiva[]>([]);
  // ArcLayer pre-construida (se reconstruye solo cuando cambian las asignaciones)
  const arcLayerRef = useRef<ArcLayer | null>(null);
  // RAF handle
  const animFrameRef = useRef<number | null>(null);
  // Registro de timestamp de inicio por cada solicitud_id para animación finita
  const startTimesRef = useRef<Map<string, number>>(new Map());
  // Registro de solicitudes ya entregadas/completadas
  const completedRef = useRef<Set<string>>(new Set());

  const puntosControl = useAppStore((state) => state.puntosControl);
  const setPuntosControl = useAppStore((state) => state.setPuntosControl);
  const incidentes = useAppStore((state) => state.incidentes);
  const setIncidentes = useAppStore((state) => state.setIncidentes);
  const activePunto = useAppStore((state) => state.activePunto);
  const setActivePunto = useAppStore((state) => state.setActivePunto);
  const activeIncidente = useAppStore((state) => state.activeIncidente);
  const setActiveIncidente = useAppStore((state) => state.setActiveIncidente);
  const userSession = useAppStore((state) => state.userSession);
  const setCrearNodoModalOpen = useAppStore((state) => state.setCrearNodoModalOpen);

  // Ref sincrónica a incidentes para consulta dentro del RAF sin recrear el loop
  const incidentesRef = useRef<Incidente[]>(incidentes);

  const modalRef = useRef<HTMLDivElement | null>(null);

  const [activeBaseMap, setActiveBaseMap] = useState<'calles' | 'satelite'>('calles');
  const [detailDrawerOpen, setDetailDrawerOpen] = useState(false);
  const [hoverInfo, setHoverInfo] = useState<{
    x: number;
    y: number;
    object: any;
    isIncidente?: boolean;
  } | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  // Categorías ocultas por el usuario vía leyenda (filtro gráfico tipo Plotly)
  const [hiddenTipos, setHiddenTipos] = useState<Set<string>>(new Set());
  // Toggle de la capa animada de transporte de recursos
  const [showTransporte, setShowTransporte] = useState(true);
  // Celdas de Voronoi (zonas de responsabilidad de cada nodo de ayuda) y
  // zoom actual del mapa, para cortar el render de las celdas cuando está
  // muy alejado.
  const [voronoiData, setVoronoiData] = useState<VoronoiFeatureCollection>(EMPTY_VORONOI);
  const [mapZoom, setMapZoom] = useState(INITIAL_ZOOM);

  function toggleTipo(key: string) {
    setHiddenTipos((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  const isAdmin = puedeLevantarNodos(userSession?.role);

  // Helper para construir ArcLayer
  function buildArcLayer(data: AsignacionActiva[]): ArcLayer | null {
    if (data.length === 0) return null;
    return new ArcLayer({
      id: 'transport-arcs',
      data,
      getSourcePosition: (a: AsignacionActiva) => [a.apoyo_lng, a.apoyo_lat],
      getTargetPosition: (a: AsignacionActiva) => [a.afectado_lng, a.afectado_lat],
      getSourceColor: (a: AsignacionActiva) => urgenciaRgba(a.urgencia),
      getTargetColor: (a: AsignacionActiva) => urgenciaRgba(a.urgencia),
      getWidth: (a: AsignacionActiva) => Math.max(2, Math.min(a.cantidad_asignada / 30, 8)),
      widthUnits: 'pixels',
      greatCircle: true,
      opacity: 0.55,
      pickable: false,
    });
  }

  // Carga de puntos y de incidentes
  const loadData = useCallback(async () => {
    setIsLoading(true);
    try {
      const [nodos, incs] = await Promise.all([
        getPuntosControlApi().catch(() => []),
        getIncidentesApi().catch(() => []),
      ]);
      setPuntosControl(nodos);
      setIncidentes(incs);
    } catch (err) {
      console.error('Error cargando datos del mapa:', err);
    } finally {
      setIsLoading(false);
    }
  }, [setPuntosControl, setIncidentes]);

  useEffect(() => {
    loadData();
    window.addEventListener('refresh-puntos', loadData);
    return () => {
      window.removeEventListener('refresh-puntos', loadData);
    };
  }, [loadData]);

  // Actualizar ref sincrónica de incidentes y limpiar asignaciones de incidentes borrados/resueltos
  useEffect(() => {
    incidentesRef.current = incidentes;
    const activeIncs = incidentes.filter((i) => i.estado !== 'resuelto');
    const remaining = asignacionesRef.current.filter((a) =>
      activeIncs.some(
        (inc) =>
          Math.abs(inc.lat - a.afectado_lat) < 0.0005 &&
          Math.abs(inc.lng - a.afectado_lng) < 0.0005
      )
    );
    if (remaining.length !== asignacionesRef.current.length) {
      asignacionesRef.current = remaining;
      arcLayerRef.current = buildArcLayer(remaining);
    }
  }, [incidentes]);

  // Fetch periódico de asignaciones activas y construcción del ArcLayer estático.
  useEffect(() => {
    async function fetchAsignaciones() {
      try {
        const rawData = await getAsignacionesActivasApi();
        const currentIncs = incidentesRef.current;
        const now = Date.now();

        // Filtrar asignaciones completadas o de incidentes ya resueltos
        const data = rawData.filter((a) => {
          if (completedRef.current.has(a.solicitud_id)) return false;
          const matchingInc = currentIncs.find(
            (inc) =>
              Math.abs(inc.lat - a.afectado_lat) < 0.0005 &&
              Math.abs(inc.lng - a.afectado_lng) < 0.0005
          );
          if (matchingInc && matchingInc.estado === 'resuelto') return false;
          return true;
        });

        // Registrar inicio para cada nueva asignación
        data.forEach((a) => {
          if (!startTimesRef.current.has(a.solicitud_id)) {
            startTimesRef.current.set(a.solicitud_id, now);
          }
        });

        asignacionesRef.current = data;
        arcLayerRef.current = buildArcLayer(data);
      } catch {
        // degradación silenciosa: si el backend no responde, no hay capa de transporte
      }
    }

    fetchAsignaciones();
    const interval = setInterval(fetchAsignaciones, 10_000);
    window.addEventListener('refresh-asignaciones', fetchAsignaciones);
    return () => {
      clearInterval(interval);
      window.removeEventListener('refresh-asignaciones', fetchAsignaciones);
    };
  }, []);

  // RAF loop: actualiza posición de las partículas 60fps sin tocar React state.
  // Concluye la animación cuando t >= 1.0 y marca automáticamente el incidente como 'resuelto'.
  useEffect(() => {
    function animate() {
      const overlay = overlayRef.current;
      if (!overlay) {
        animFrameRef.current = requestAnimationFrame(animate);
        return;
      }

      const asignaciones = asignacionesRef.current;
      const now = Date.now();
      const activeParticles: any[] = [];
      let assignmentsChanged = false;

      if (showTransporte && asignaciones.length > 0) {
        for (const a of asignaciones) {
          const duration = getTransitDuration(a.distancia_metros, a.cantidad_asignada);
          const start = startTimesRef.current.get(a.solicitud_id) || now;
          const elapsed = now - start;
          const t = Math.min(1.0, Math.max(0.0, elapsed / duration));

          if (t < 1.0) {
            // Partícula en viaje hacia el nodo afectado
            const [lng, lat] = lerpPos(a.apoyo_lng, a.apoyo_lat, a.afectado_lng, a.afectado_lat, t);
            activeParticles.push({
              lng,
              lat,
              color: urgenciaRgba(a.urgencia),
              radius: 60 + Math.min(a.cantidad_asignada, 200) * 0.4,
            });
          } else {
            // Llegada a destino: registrar entrega y marcar como resuelto
            if (!completedRef.current.has(a.solicitud_id)) {
              completedRef.current.add(a.solicitud_id);
              assignmentsChanged = true;

              // 1. Notificar al backend la entrega completada
              completarEntregaApi(a.solicitud_id).catch(() => {});

              // 2. Actualizar el estado del incidente en el store a 'resuelto'
              const matchingInc = incidentesRef.current.find(
                (inc) =>
                  Math.abs(inc.lat - a.afectado_lat) < 0.0005 &&
                  Math.abs(inc.lng - a.afectado_lng) < 0.0005
              );
              if (matchingInc && matchingInc.estado !== 'resuelto') {
                useAppStore.getState().updateIncidenteInStore({
                  ...matchingInc,
                  estado: 'resuelto',
                });
              }
            }
          }
        }

        if (assignmentsChanged) {
          const remaining = asignaciones.filter((a) => !completedRef.current.has(a.solicitud_id));
          asignacionesRef.current = remaining;
          arcLayerRef.current = buildArcLayer(remaining);
        }
      }

      const particleLayer = activeParticles.length === 0 ? null : new ScatterplotLayer({
        id: 'transport-particles',
        data: activeParticles,
        getPosition: (d: any) => [d.lng, d.lat],
        getFillColor: (d: any) => d.color,
        getRadius: (d: any) => d.radius,
        radiusUnits: 'meters',
        radiusMinPixels: 4,
        radiusMaxPixels: 16,
        opacity: 0.92,
        pickable: false,
        stroked: true,
        getLineColor: [255, 255, 255, 200],
        lineWidthMinPixels: 1.5,
      });

      const transportLayers = [
        showTransporte ? arcLayerRef.current : null,
        particleLayer,
      ].filter(Boolean);

      overlay.setProps({
        layers: [...staticLayersRef.current, ...transportLayers],
      });

      animFrameRef.current = requestAnimationFrame(animate);
    }

    animFrameRef.current = requestAnimationFrame(animate);
    return () => {
      if (animFrameRef.current !== null) cancelAnimationFrame(animFrameRef.current);
    };
  }, [showTransporte]);

  // Recalcular el diagrama de Voronoi cada vez que cambian los puntos de
  // control — se dispara solo con el `setPuntosControl` inicial de
  // `loadData()`, pero también con el que corre CrearNodoModal después de
  // levantar un nodo de ayuda nuevo, así que las zonas quedan al día sin
  // lógica extra de invalidación.
  useEffect(() => {
    getVoronoiCeldasApi()
      .then(setVoronoiData)
      .catch((err) => {
        console.warn('Error calculando diagrama de Voronoi:', err);
        setVoronoiData(EMPTY_VORONOI);
      });
  }, [puntosControl]);

  // Construir GeoJSON para Puntos de Control
  const buildPuntosGeoJson = useCallback(() => {
    const features = puntosControl
      .filter((punto) => !hiddenTipos.has((punto.tipo || '').toLowerCase()))
      .map((punto) => ({
      type: 'Feature' as const,
      geometry: {
        type: 'Point' as const,
        coordinates: [punto.lng, punto.lat] as [number, number],
      },
      properties: {
        id: punto.id,
        nombre: punto.nombre,
        tipo: punto.tipo,
        estado: punto.estado,
        direccion: punto.direccion,
        responsable: punto.responsable,
        lat: punto.lat,
        lng: punto.lng,
      },
    }));

    return {
      type: 'FeatureCollection' as const,
      features,
    };
  }, [puntosControl, hiddenTipos]);

  // Actualizar capas Deck.gl (nodos de ayuda + celdas de Voronoi — los
  // incidentes se renderizan como marcadores DOM triangulares, ver más abajo)
  useEffect(() => {
    if (!overlayRef.current) return;

    const puntosData = buildPuntosGeoJson();

    // Zonas de responsabilidad geográfica de cada nodo de ayuda: relleno muy
    // transparente + borde algo más marcado, y solo visibles a partir de
    // cierto zoom (alejado del todo solo ensucian la vista de la ciudad).
    const voronoiLayer = new GeoJsonLayer({
      id: 'voronoi-celdas-layer',
      data: voronoiData,
      visible: mapZoom >= VORONOI_MIN_ZOOM,
      pickable: false,
      filled: true,
      stroked: true,
      getFillColor: [8, 76, 97, 28],
      getLineColor: [8, 76, 97, 150],
      lineWidthMinPixels: 1.25,
      getLineWidth: 1,
    });

    const puntosLayer = new GeoJsonLayer({
      id: 'puntos-control-layer',
      data: puntosData,
      pointType: 'circle',
      pickable: true,
      getFillColor: (f: any) => getTipoColor(f.properties?.tipo),
      getPointRadius: (f: any) => (f.properties?.tipo === 'comando' ? 180 : 120),
      pointRadiusUnits: 'meters',
      pointRadiusMinPixels: 8,
      pointRadiusMaxPixels: 24,
      stroked: true,
      getLineColor: [255, 255, 255, 240],
      getLineWidth: 2,
      lineWidthMinPixels: 2,
      autoHighlight: true,
      highlightColor: [255, 255, 255, 120],
      onHover: (info: any) => {
        if (info.object) {
          setHoverInfo({
            x: info.x,
            y: info.y,
            object: info.object.properties,
            isIncidente: false,
          });
        } else {
          setHoverInfo(null);
        }
      },
      onClick: (info: any) => {
        if (info.object) {
          const props = info.object.properties;
          setActivePunto(props as PuntoControl);
        }
      },
    });

    // Guardamos en ref: el RAF loop las combinará con las capas de transporte.
    // NO llamamos setProps aquí directamente para que el RAF siempre tenga
    // el conjunto completo de capas y no pisemos su salida.
    staticLayersRef.current = [voronoiLayer, puntosLayer];
  }, [puntosControl, hiddenTipos, voronoiData, mapZoom, buildPuntosGeoJson, setActivePunto]);

  // Marcadores DOM de incidentes (triángulo + halo pulsante). Se reconstruyen
  // por completo en cada cambio — el volumen de incidentes es chico y así se
  // evita mantener un diff manual de marcadores.
  useEffect(() => {
    if (!mapRef.current) return;
    const map = mapRef.current;
    const created: maplibregl.Marker[] = [];

    if (!hiddenTipos.has('incidente')) {
      incidentes.forEach((inc) => {
        const el = buildIncidenteMarkerEl(inc);

        el.addEventListener('click', (e) => {
          e.stopPropagation();
          setActiveIncidente(inc);
        });
        el.addEventListener('mouseenter', () => {
          const pos = map.project([inc.lng, inc.lat]);
          setHoverInfo({ x: pos.x, y: pos.y, object: inc, isIncidente: true });
        });
        el.addEventListener('mouseleave', () => setHoverInfo(null));

        const marker = new maplibregl.Marker({ element: el, anchor: 'center' })
          .setLngLat([inc.lng, inc.lat])
          .addTo(map);
        created.push(marker);
      });
    }

    return () => {
      created.forEach((marker) => marker.remove());
    };
  }, [incidentes, hiddenTipos, setActiveIncidente]);

  // Fly to active punto
  useEffect(() => {
    if (activePunto && mapRef.current) {
      mapRef.current.flyTo({
        center: [activePunto.lng, activePunto.lat],
        zoom: 15.2,
        essential: true,
      });
    }
  }, [activePunto]);

  // Fly to active incidente; cierra el drawer si ya no hay incidente activo
  useEffect(() => {
    if (activeIncidente && mapRef.current) {
      mapRef.current.flyTo({
        center: [activeIncidente.lng, activeIncidente.lat],
        zoom: 15.2,
        essential: true,
      });
    } else if (!activeIncidente) {
      setDetailDrawerOpen(false);
    }
  }, [activeIncidente]);

  // Posición en pantalla del nodo activo para el modal translúcido anclado
  const [nodeScreenPos, setNodeScreenPos] = useState<{ x: number; y: number } | null>(null);

  const updateNodeScreenPos = useCallback(() => {
    if (!mapRef.current) return;
    const lng = activeIncidente ? activeIncidente.lng : activePunto ? activePunto.lng : null;
    const lat = activeIncidente ? activeIncidente.lat : activePunto ? activePunto.lat : null;
    if (lng === null || lat === null || isNaN(lng) || isNaN(lat)) {
      setNodeScreenPos(null);
      return;
    }
    const pos = mapRef.current.project([lng, lat]);
    setNodeScreenPos({ x: pos.x, y: pos.y });
  }, [activePunto, activeIncidente]);

  useEffect(() => {
    updateNodeScreenPos();
    const map = mapRef.current;
    if (!map) return;

    map.on('move', updateNodeScreenPos);
    map.on('zoom', updateNodeScreenPos);
    map.on('resize', updateNodeScreenPos);
    map.on('render', updateNodeScreenPos);

    return () => {
      map.off('move', updateNodeScreenPos);
      map.off('zoom', updateNodeScreenPos);
      map.off('resize', updateNodeScreenPos);
      map.off('render', updateNodeScreenPos);
    };
  }, [updateNodeScreenPos]);

  // Cerrar el modal al hacer clic en otra parte de la pantalla (fuera del modal)
  useEffect(() => {
    function handleDocumentClick(e: MouseEvent) {
      if (modalRef.current && modalRef.current.contains(e.target as Node)) {
        return;
      }
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setActivePunto(null);
        setActiveIncidente(null);
      }
    }

    window.addEventListener('click', handleDocumentClick);
    return () => window.removeEventListener('click', handleDocumentClick);
  }, [setActivePunto, setActiveIncidente]);

  const selectedMapCoords = useAppStore((state) => state.selectedMapCoords);
  const targetMarkerRef = useRef<maplibregl.Marker | null>(null);

  // Fly to selected coordinates
  useEffect(() => {
    if (!mapRef.current || !selectedMapCoords) return;

    const [lng, lat] = selectedMapCoords;
    if (isNaN(lng) || isNaN(lat)) return;

    mapRef.current.flyTo({
      center: [lng, lat],
      zoom: 15.5,
      essential: true,
    });

    if (!targetMarkerRef.current) {
      const el = document.createElement('div');
      el.className =
        'w-7 h-7 rounded-full bg-rosy-copper border-2 border-white shadow-xl flex items-center justify-center text-white text-xs font-bold ring-4 ring-rosy-copper/30';
      el.innerHTML = '📍';
      targetMarkerRef.current = new maplibregl.Marker({ element: el })
        .setLngLat([lng, lat])
        .addTo(mapRef.current);
    } else {
      targetMarkerRef.current.setLngLat([lng, lat]);
    }
  }, [selectedMapCoords]);

  function handleChangeBaseMap(styleKey: 'calles' | 'satelite') {
    setActiveBaseMap(styleKey);
    if (mapRef.current) {
      mapRef.current.setStyle(MAP_BASE_STYLES[styleKey].spec as any);
    }
  }

  // Inicializar MapLibre
  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;

    const map = new maplibregl.Map({
      container: containerRef.current,
      style: MAP_BASE_STYLES.calles.spec as any,
      center: CALI_CENTER,
      zoom: INITIAL_ZOOM,
      attributionControl: false,
    });

    map.addControl(
      new maplibregl.AttributionControl({ compact: true }),
      'bottom-right'
    );
    map.addControl(new maplibregl.NavigationControl(), 'top-right');

    const overlay = new MapboxOverlay({
      layers: [],
    });
    map.addControl(overlay as unknown as maplibregl.IControl);
    overlayRef.current = overlay;

    map.on('click', (e) => {
      const lng = Number(e.lngLat.lng.toFixed(5));
      const lat = Number(e.lngLat.lat.toFixed(5));
      useAppStore.getState().setSelectedMapCoords([lng, lat]);

      // Si hace clic en una zona vacía del mapa (fuera de cualquier nodo), cerramos el modal
      const picked = overlayRef.current?.pickObject({ x: e.point.x, y: e.point.y });
      if (!picked || !picked.object) {
        useAppStore.getState().setActivePunto(null);
        useAppStore.getState().setActiveIncidente(null);
      }
    });

    map.on('dblclick', (e) => {
      const currentSession = useAppStore.getState().userSession;
      if (puedeLevantarNodos(currentSession?.role)) {
        e.preventDefault();
        const lng = Number(e.lngLat.lng.toFixed(5));
        const lat = Number(e.lngLat.lat.toFixed(5));
        useAppStore.getState().setSelectedMapCoords([lng, lat]);
        useAppStore.getState().setCrearNodoModalOpen(true);
      }
    });

    // Zoom actual del mapa — corta el render de las celdas de Voronoi por
    // debajo de VORONOI_MIN_ZOOM (ver capa deck.gl más abajo).
    map.on('zoom', () => setMapZoom(map.getZoom()));

    mapRef.current = map;

    return () => {
      map.remove();
      mapRef.current = null;
      overlayRef.current = null;
    };
  }, []);

  function resetView() {
    if (mapRef.current) {
      mapRef.current.flyTo({
        center: CALI_CENTER,
        zoom: INITIAL_ZOOM,
        essential: true,
      });
    }
  }

  return (
    <div className="relative h-full w-full overflow-hidden">
      <div ref={containerRef} className="h-full w-full" />

      {/* Barra de herramientas flotante superior */}
      <div className="absolute top-4 left-4 z-10 flex flex-wrap items-center gap-2.5">
        <button
          type="button"
          onClick={resetView}
          title="Centrar el mapa en Cali"
          className="flex items-center gap-2 rounded-md bg-white/95 px-3.5 py-2.5 text-sm font-bold text-slate-700 shadow-md backdrop-blur-xs border-2 border-slate-200 hover:bg-slate-50 hover:border-dark-teal/30 transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-dark-teal"
        >
          {/* Retícula/mira: comunica "centrar" de forma inequívoca, a diferencia
              del ícono de flecha circular anterior (que leía como "reiniciar"). */}
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.25} strokeLinecap="round" className="h-5 w-5 text-dark-teal">
            <circle cx="12" cy="12" r="6.5" />
            <circle cx="12" cy="12" r="1.4" fill="currentColor" stroke="none" />
            <path d="M12 2v3.5M12 18.5V22M2 12h3.5M18.5 12H22" />
          </svg>
          Centrar Cali
        </button>

        <button
          type="button"
          onClick={loadData}
          disabled={isLoading}
          title="Recargar datos de Supabase"
          className="flex items-center gap-2 rounded-md bg-white/95 px-3.5 py-2.5 text-sm font-bold text-slate-700 shadow-md backdrop-blur-xs border-2 border-slate-200 hover:bg-slate-50 hover:border-dark-teal/30 transition disabled:opacity-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-dark-teal"
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.25} className={`h-5 w-5 text-dark-teal ${isLoading ? 'animate-spin' : ''}`}>
            <path d="M21.5 2v6h-6M21.34 15.57a10 10 0 1 1-.57-8.38l5.67-5.67" />
          </svg>
          Actualizar
        </button>

        {/* Selector de capas base: Calles / Satélite */}
        <div className="flex items-center rounded-md bg-white/95 p-1 shadow-md backdrop-blur-xs border-2 border-slate-200 text-sm">
          <button
            type="button"
            onClick={() => handleChangeBaseMap('calles')}
            className={`rounded px-3 py-1.5 font-bold transition ${
              activeBaseMap === 'calles'
                ? 'bg-dark-teal text-white shadow-xs'
                : 'text-slate-600 hover:bg-slate-100'
            }`}
          >
            Calles Cali
          </button>
          <button
            type="button"
            onClick={() => handleChangeBaseMap('satelite')}
            className={`rounded px-3 py-1.5 font-bold transition ${
              activeBaseMap === 'satelite'
                ? 'bg-dark-teal text-white shadow-xs'
                : 'text-slate-600 hover:bg-slate-100'
            }`}
          >
            Satélite
          </button>
        </div>

        {/* Badge orientador para Admin Gubernamental */}
        {isAdmin && (
          <div className="hidden md:flex items-center gap-2 rounded-md border-2 border-saffron bg-saffron px-3.5 py-2 text-sm font-bold text-dark-teal shadow-md animate-fadeIn">
            <span aria-hidden="true">💡</span>
            <span>Doble clic para levantar un nodo logístico</span>
          </div>
        )}
      </div>

      {/* Tooltip flotante al pasar el cursor */}
      {hoverInfo && hoverInfo.object && (
        <div
          className="pointer-events-none absolute z-30 -translate-x-1/2 -translate-y-full rounded-lg border border-dark-teal/15 bg-white/95 p-3 shadow-xl backdrop-blur-xs text-xs max-w-xs"
          style={{ left: hoverInfo.x, top: hoverInfo.y - 12 }}
        >
          {hoverInfo.isIncidente ? (
            <div className="flex flex-col gap-1">
              <div className="flex items-center justify-between gap-2">
                <span className="font-bold text-rose-700">🚨 {hoverInfo.object.tipo}</span>
                <span className="rounded bg-rose-100 px-1.5 py-0.2 text-[10px] font-bold text-rose-800">
                  Urgencia: {hoverInfo.object.urgencia}/5
                </span>
              </div>
              <div className="text-[11px] text-slate-700 font-medium">
                {hoverInfo.object.analisis_ia || hoverInfo.object.descripcion}
              </div>
              {hoverInfo.object.recursos_solicitados && hoverInfo.object.recursos_solicitados.length > 0 && (
                <div className="text-[10px] text-dark-teal font-semibold mt-1">
                  📦 Insumos Requeridos: {hoverInfo.object.recursos_solicitados.map((r: any) => `${r.insumo_nombre} (${r.cantidad_estimada} ${r.unidad})`).join(', ')}
                </div>
              )}
              <div className="text-[10px] text-slate-400 mt-0.5">
                📍 {hoverInfo.object.barrio || 'Cali'} ({hoverInfo.object.lat.toFixed(4)}, {hoverInfo.object.lng.toFixed(4)})
              </div>
            </div>
          ) : (
            <div className="flex flex-col gap-0.5">
              <div className="flex items-center gap-2">
                <span
                  className="h-2.5 w-2.5 rounded-full"
                  style={{
                    backgroundColor: `rgba(${getTipoColor(hoverInfo.object.tipo).slice(0, 3).join(',')}, 1)`,
                  }}
                />
                <span className="font-bold text-dark-teal">{hoverInfo.object.nombre}</span>
              </div>
              <div className="mt-1 text-[11px] text-slate-600 flex flex-col gap-0.5">
                <div>
                  <span className="font-semibold">Tipo:</span> <span className="capitalize">{hoverInfo.object.tipo}</span> · <span className="font-semibold">Estado:</span> <span className="capitalize">{hoverInfo.object.estado}</span>
                </div>
                {hoverInfo.object.responsable && (
                  <div>
                    <span className="font-semibold">Responsable:</span> {hoverInfo.object.responsable}
                  </div>
                )}
                <div className="text-[10px] text-slate-400">
                  Coordenadas: {hoverInfo.object.lat.toFixed(4)}, {hoverInfo.object.lng.toFixed(4)}
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Modal translúcido anclado dinámicamente cerca del nodo consultado */}
      {(activePunto || activeIncidente) && (
        (() => {
          const containerW = containerRef.current?.clientWidth || 800;
          const containerH = containerRef.current?.clientHeight || 600;
          const posX = nodeScreenPos ? nodeScreenPos.x : containerW / 2;
          const posY = nodeScreenPos ? nodeScreenPos.y : containerH / 2;

          // Si el nodo está en la parte inferior, mostramos el modal arriba del nodo; si está en la parte superior, abajo.
          const isAbove = posY >= 280;
          const leftPos = Math.max(12, Math.min(containerW - 336, posX - 160));
          const topPos = isAbove
            ? Math.max(12, posY - 20)
            : Math.min(containerH - 340, posY + 20);

          return (
            <div
              ref={modalRef}
              onClick={(e) => e.stopPropagation()}
              onMouseDown={(e) => e.stopPropagation()}
              className={`absolute z-30 w-80 max-w-[calc(100vw-2.5rem)] rounded-2xl border border-white/70 bg-white/80 p-4 shadow-2xl backdrop-blur-md transition-[top,left] duration-75 text-slate-800 animate-fadeIn pointer-events-auto ${
                isAbove ? '-translate-y-full' : 'translate-y-0'
              }`}
              style={{
                left: leftPos,
                top: topPos,
              }}
            >
              {/* Indicador flecha hacia el punto del nodo */}
              {nodeScreenPos && (
                <div
                  className={`absolute left-1/2 -translate-x-1/2 w-3.5 h-3.5 rotate-45 bg-white/80 backdrop-blur-md ${
                    isAbove
                      ? '-bottom-1.5 border-b border-r border-white/70'
                      : '-top-1.5 border-t border-l border-white/70'
                  }`}
                />
              )}

              {activeIncidente ? (
                <div className="relative flex flex-col gap-2">
                  <div className="flex items-start justify-between gap-2 border-b border-rose-200/60 pb-2">
                    <div className="flex items-center gap-2">
                      <span className="h-2.5 w-2.5 rounded-full bg-rose-600 animate-ping" />
                      <span className="text-[11px] font-bold uppercase tracking-wider text-rose-700">
                        Emergencia / Afectación
                      </span>
                    </div>
                    <button
                      type="button"
                      onClick={() => setActiveIncidente(null)}
                      className="rounded-full p-1 text-slate-400 hover:bg-slate-200/60 hover:text-slate-700 transition text-xs font-bold"
                      title="Cerrar detalle"
                    >
                      ✕
                    </button>
                  </div>

                  <div className="flex items-center gap-1.5">
                    <span className="rounded-md bg-rose-600 px-2 py-0.5 text-xs font-bold text-white shadow-xs">
                      Urgencia {activeIncidente.urgencia ?? 3}/5
                    </span>
                    <span className="rounded-md bg-white/90 px-2 py-0.5 text-xs font-semibold text-slate-700 capitalize border border-slate-200">
                      {activeIncidente.estado || 'Pendiente'}
                    </span>
                    {activeIncidente.barrio && (
                      <span className="rounded-md bg-dark-teal/15 px-2 py-0.5 text-xs font-semibold text-dark-teal">
                        📍 {activeIncidente.barrio}
                      </span>
                    )}
                  </div>

                  {activeIncidente.analisis_ia && (
                    <div className="rounded-lg bg-white/70 border border-slate-200/70 p-2 text-xs text-slate-700">
                      <span className="font-bold text-dark-teal block mb-0.5 text-[11px]">
                        Diagnóstico IA:
                      </span>
                      <p className="line-clamp-3 text-slate-600 leading-relaxed">
                        {activeIncidente.analisis_ia}
                      </p>
                    </div>
                  )}

                  {activeIncidente.testimonio && (
                    <div className="text-xs text-slate-700 italic bg-amber-50/80 border border-amber-200/70 rounded-lg p-2 leading-relaxed">
                      &ldquo;{activeIncidente.testimonio}&rdquo;
                    </div>
                  )}

                  {Array.isArray(activeIncidente.recursos_solicitados) &&
                    activeIncidente.recursos_solicitados.length > 0 && (
                      <div className="text-xs">
                        <span className="font-bold text-slate-700 block mb-1 text-[11px]">
                          📦 Insumos Requeridos:
                        </span>
                        <div className="flex flex-wrap gap-1">
                          {activeIncidente.recursos_solicitados.map((r: any, i: number) => (
                            <span
                              key={i}
                              className="rounded bg-rose-100/90 border border-rose-200 px-1.5 py-0.5 text-[10px] font-bold text-rose-800"
                            >
                              {r.insumo_nombre} ({r.cantidad_estimada} {r.unidad})
                            </span>
                          ))}
                        </div>
                      </div>
                    )}

                  <div className="text-[10px] text-slate-500 pt-1 border-t border-slate-200/60 flex items-center justify-between font-mono">
                    <span>Lat: {Number(activeIncidente.lat).toFixed(4)}</span>
                    <span>Lng: {Number(activeIncidente.lng).toFixed(4)}</span>
                  </div>

                  <button
                    type="button"
                    onClick={() => setDetailDrawerOpen(true)}
                    className="w-full rounded-lg bg-rose-600 py-2 text-xs font-bold text-white hover:bg-rose-700 transition"
                  >
                    Ver detalle, insumos y plan de ayuda →
                  </button>
                </div>
              ) : activePunto ? (
                <div className="relative flex flex-col gap-2">
                  <div className="flex items-start justify-between gap-2 border-b border-dark-teal/15 pb-2">
                    <div>
                      <span className="text-[10px] font-bold uppercase tracking-wider text-dark-teal/70 block">
                        📍 Nodo de Ayuda
                      </span>
                      <h3 className="text-sm font-bold text-dark-teal leading-snug">
                        {activePunto.nombre}
                      </h3>
                    </div>
                    <button
                      type="button"
                      onClick={() => setActivePunto(null)}
                      className="rounded-full p-1 text-slate-400 hover:bg-slate-200/60 hover:text-slate-700 transition text-xs font-bold"
                      title="Cerrar detalle"
                    >
                      ✕
                    </button>
                  </div>

                  <div className="flex items-center gap-1.5">
                    <span className="rounded-md bg-dark-teal/15 px-2 py-0.5 text-xs font-semibold text-dark-teal capitalize">
                      {activePunto.tipo || 'Punto Logístico'}
                    </span>
                    <span className="rounded-md bg-emerald-100/90 px-2 py-0.5 text-xs font-semibold text-emerald-800 capitalize border border-emerald-200">
                      {activePunto.estado || 'Activo'}
                    </span>
                  </div>

                  <div className="text-xs text-slate-600 flex flex-col gap-1">
                    {activePunto.responsable && (
                      <div>
                        <span className="font-semibold text-slate-700">Responsable:</span>{' '}
                        <span className="text-dark-teal font-medium">{activePunto.responsable}</span>
                      </div>
                    )}
                    {activePunto.direccion && (
                      <div>
                        <span className="font-semibold text-slate-700">Dirección:</span>{' '}
                        {activePunto.direccion}
                      </div>
                    )}
                    {activePunto.horario && (
                      <div>
                        <span className="font-semibold text-slate-700">Horario:</span>{' '}
                        {activePunto.horario}
                      </div>
                    )}
                    {activePunto.telefono && (
                      <div>
                        <span className="font-semibold text-slate-700">Teléfono:</span>{' '}
                        {activePunto.telefono}
                      </div>
                    )}
                  </div>

                  <div className="text-[10px] text-slate-500 pt-1 border-t border-slate-200/60 flex items-center justify-between font-mono">
                    <span>Lat: {Number(activePunto.lat).toFixed(4)}</span>
                    <span>Lng: {Number(activePunto.lng).toFixed(4)}</span>
                  </div>
                </div>
              ) : null}
            </div>
          );
        })()
      )}

      {/* Leyenda de tipos de nodo e incidentes — cada ítem es un filtro
          clickeable (estilo Plotly): clicear una categoría la apaga/prende
          en el mapa. El estado apagado se ve atenuado + tachado. */}
      <div className="absolute bottom-3 left-3 z-10 rounded-lg border-2 border-slate-200 bg-white/95 p-3.5 shadow-lg backdrop-blur-xs">
        <div className="font-extrabold text-dark-teal text-xs uppercase tracking-wider mb-2 flex items-center justify-between gap-3">
          <span>Convenciones Mapa Cali</span>
          {hiddenTipos.size > 0 && (
            <button
              type="button"
              onClick={() => setHiddenTipos(new Set())}
              className="text-[11px] font-bold text-dark-teal/60 underline hover:text-dark-teal"
            >
              Mostrar todo
            </button>
          )}
        </div>
        <div className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-sm">
          {LEGEND_ITEMS.filter((it) => !it.isIncidente).map((item) => {
            const isHidden = hiddenTipos.has(item.key);
            return (
              <button
                key={item.key}
                type="button"
                onClick={() => toggleTipo(item.key)}
                aria-pressed={!isHidden}
                title={isHidden ? `Mostrar ${item.label}` : `Ocultar ${item.label}`}
                className={`flex items-center gap-2 rounded px-1.5 py-1 text-left transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-dark-teal ${
                  isHidden ? 'opacity-40 hover:opacity-70' : 'hover:bg-slate-50'
                }`}
              >
                <span
                  className="h-3.5 w-3.5 shrink-0 rounded-full border border-black/10"
                  style={{ backgroundColor: item.color }}
                />
                <span className={`font-semibold text-slate-700 ${isHidden ? 'line-through' : ''}`}>
                  {item.label}
                </span>
              </button>
            );
          })}
          {LEGEND_ITEMS.filter((it) => it.isIncidente).map((item) => {
            const isHidden = hiddenTipos.has(item.key);
            return (
              <button
                key={item.key}
                type="button"
                onClick={() => toggleTipo(item.key)}
                aria-pressed={!isHidden}
                title={isHidden ? `Mostrar ${item.label}` : `Ocultar ${item.label}`}
                className={`col-span-2 flex items-center gap-2 rounded px-1.5 py-1.5 mt-1 border-t-2 border-slate-100 pt-2 text-left font-extrabold transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-rosy-copper ${
                  isHidden ? 'opacity-40 hover:opacity-70 text-slate-500' : 'text-rosy-copper hover:bg-rosy-copper/5'
                }`}
              >
                <span
                  className={`h-3.5 w-3.5 shrink-0 bg-rose-600 [clip-path:polygon(50%_0%,0%_100%,100%_100%)] ${isHidden ? '' : 'animate-ping'}`}
                />
                <span aria-hidden="true">🚨</span>
                <span className={isHidden ? 'line-through' : ''}>{item.label}</span>
              </button>
            );
          })}

          {/* Toggle de rutas de transporte animadas */}
          <button
            type="button"
            onClick={() => setShowTransporte((v) => !v)}
            aria-pressed={showTransporte}
            title={showTransporte ? 'Ocultar rutas de transporte' : 'Mostrar rutas de transporte'}
            className={`col-span-2 flex items-center gap-2 rounded px-1.5 py-1.5 mt-1 border-t-2 border-slate-100 pt-2 text-left font-extrabold transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-dark-teal ${
              showTransporte ? 'text-dark-teal hover:bg-dark-teal/5' : 'opacity-40 hover:opacity-70 text-slate-500'
            }`}
          >
            {/* Mini arco animado como icono */}
            <svg viewBox="0 0 20 14" width="18" height="12" fill="none" className="shrink-0">
              <path
                d="M2 12 Q10 0 18 12"
                stroke={showTransporte ? '#184C78' : '#94a3b8'}
                strokeWidth="2"
                strokeLinecap="round"
              />
              <circle
                cx={showTransporte ? '10' : '10'}
                cy="6"
                r="2.5"
                fill={showTransporte ? '#184C78' : '#94a3b8'}
                className={showTransporte ? 'animate-ping' : ''}
                style={{ transformOrigin: '10px 6px' }}
              />
            </svg>
            <span className={showTransporte ? '' : 'line-through'}>Rutas de transporte</span>
          </button>
        </div>
      </div>

      {/* Drawer de detalle completo del incidente */}
      {detailDrawerOpen && activeIncidente && (
        <IncidenteDetailDrawer
          incidente={activeIncidente}
          puntosControl={puntosControl}
          onClose={() => setDetailDrawerOpen(false)}
        />
      )}
    </div>
  );
}

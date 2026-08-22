'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import * as maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { MapboxOverlay } from '@deck.gl/mapbox';
import { GeoJsonLayer } from '@deck.gl/layers';
import { useAppStore } from '@/store/useAppStore';
import { getPuntosControlApi } from '@/lib/api';
import { puedeLevantarNodos } from '@/lib/rbac';
import type { PuntoControl } from '@/types';

const CALI_CENTER: [number, number] = [-76.5320, 3.4516];
const INITIAL_ZOOM = 13;

// Definición de estilos de mapa base de alta resolución y disponibilidad para Cali
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

export default function MapCanvas() {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const overlayRef = useRef<MapboxOverlay | null>(null);

  const puntosControl = useAppStore((state) => state.puntosControl);
  const setPuntosControl = useAppStore((state) => state.setPuntosControl);
  const activePunto = useAppStore((state) => state.activePunto);
  const setActivePunto = useAppStore((state) => state.setActivePunto);
  const userSession = useAppStore((state) => state.userSession);

  const [activeBaseMap, setActiveBaseMap] = useState<'calles' | 'satelite'>('calles');
  const [hoverInfo, setHoverInfo] = useState<{
    x: number;
    y: number;
    object?: any;
  } | null>(null);

  const [isLoading, setIsLoading] = useState(true);

  const isAdmin = puedeLevantarNodos(userSession?.role);

  // Fetch nodes from backend Supabase
  const loadNodos = useCallback(async () => {
    try {
      setIsLoading(true);
      const data = await getPuntosControlApi();
      setPuntosControl(data);
    } catch (err) {
      console.warn('Error fetching live puntos from backend, keeping cached/local:', err);
    } finally {
      setIsLoading(false);
    }
  }, [setPuntosControl]);

  useEffect(() => {
    loadNodos();
  }, [loadNodos]);

  // Build GeoJSON from puntosControl in Zustand store
  const buildGeoJson = useCallback(() => {
    const features = puntosControl.map((p) => ({
      type: 'Feature' as const,
      geometry: {
        type: 'Point' as const,
        coordinates: [p.lng, p.lat] as [number, number],
      },
      properties: {
        id: p.id,
        nombre: p.nombre,
        tipo: p.tipo,
        estado: p.estado,
        lat: p.lat,
        lng: p.lng,
        direccion: p.direccion,
        horario: p.horario,
        telefono: p.telefono,
        responsable: p.responsable,
        responsable_user_id: p.responsable_user_id,
        verificado: p.verificado,
      },
    }));

    return {
      type: 'FeatureCollection' as const,
      features,
    };
  }, [puntosControl]);

  // Update Deck.gl overlay layers when data changes
  useEffect(() => {
    if (!overlayRef.current) return;

    const geojsonData = buildGeoJson();

    const layer = new GeoJsonLayer({
      id: 'puntos-control-layer',
      data: geojsonData,
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

    overlayRef.current.setProps({
      layers: [layer],
    });
  }, [puntosControl, buildGeoJson, setActivePunto]);

  // Fly to active punto when selected
  useEffect(() => {
    if (activePunto && mapRef.current) {
      mapRef.current.flyTo({
        center: [activePunto.lng, activePunto.lat],
        zoom: 14.5,
        essential: true,
      });
    }
  }, [activePunto]);

  const selectedMapCoords = useAppStore((state) => state.selectedMapCoords);
  const targetMarkerRef = useRef<maplibregl.Marker | null>(null);

  // Fly to selected coordinates when updated (e.g. from address geocoding)
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

  // Switch base map style
  function handleChangeBaseMap(styleKey: 'calles' | 'satelite') {
    setActiveBaseMap(styleKey);
    if (mapRef.current) {
      mapRef.current.setStyle(MAP_BASE_STYLES[styleKey].spec as any);
    }
  }

  // Initialize MapLibre
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

    // Single click on map captures coordinates in store
    map.on('click', (e) => {
      const lng = Number(e.lngLat.lng.toFixed(5));
      const lat = Number(e.lngLat.lat.toFixed(5));
      useAppStore.getState().setSelectedMapCoords([lng, lat]);
    });

    // DOUBLE CLICK: Admin Gubernamental can double click anywhere to open node creation modal with coordinates pre-filled!
    map.on('dblclick', (e) => {
      const currentSession = useAppStore.getState().userSession;
      if (puedeLevantarNodos(currentSession?.role)) {
        e.preventDefault(); // Evita el zoom predeterminado de doble clic
        const lng = Number(e.lngLat.lng.toFixed(5));
        const lat = Number(e.lngLat.lat.toFixed(5));
        useAppStore.getState().setSelectedMapCoords([lng, lat]);
        useAppStore.getState().setCrearNodoModalOpen(true);
      }
    });

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
    <div className="relative h-full w-full overflow-hidden rounded-lg">
      <div ref={containerRef} className="h-full w-full" />

      {/* Barra superior de estado y controles */}
      <div className="absolute top-3 left-3 z-10 flex flex-wrap items-center gap-2">
        <div className="flex items-center gap-2 rounded-md bg-white/95 px-3 py-1.5 shadow-md backdrop-blur-xs border border-slate-200 text-xs font-semibold text-dark-teal">
          <span className="h-2 w-2 rounded-full bg-emerald-500 animate-pulse" />
          <span>Cali, Colombia · Red Operativa</span>
          <span className="rounded bg-dark-teal/10 px-1.5 py-0.5 text-[10px] text-dark-teal font-bold">
            {puntosControl.length} Nodos
          </span>
        </div>

        <button
          type="button"
          onClick={resetView}
          title="Centrar mapa en Cali"
          className="flex items-center gap-1 rounded-md bg-white/95 px-2.5 py-1.5 text-xs font-medium text-slate-700 shadow-md backdrop-blur-xs border border-slate-200 hover:bg-slate-50 transition"
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="h-3.5 w-3.5 text-dark-teal">
            <circle cx="12" cy="12" r="10" />
            <polygon points="16.24 7.76 14.12 14.12 7.76 16.24 9.88 9.88 16.24 7.76" />
          </svg>
          Centrar Cali
        </button>

        <button
          type="button"
          onClick={loadNodos}
          disabled={isLoading}
          title="Recargar nodos de Supabase"
          className="flex items-center gap-1 rounded-md bg-white/95 px-2.5 py-1.5 text-xs font-medium text-slate-700 shadow-md backdrop-blur-xs border border-slate-200 hover:bg-slate-50 transition disabled:opacity-50"
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className={`h-3.5 w-3.5 text-dark-teal ${isLoading ? 'animate-spin' : ''}`}>
            <path d="M21.5 2v6h-6M21.34 15.57a10 10 0 1 1-.57-8.38l5.67-5.67" />
          </svg>
          Actualizar
        </button>

        {/* Selector de capas base: Calles / Satélite */}
        <div className="flex items-center rounded-md bg-white/95 p-0.5 shadow-md backdrop-blur-xs border border-slate-200 text-xs">
          <button
            type="button"
            onClick={() => handleChangeBaseMap('calles')}
            className={`rounded px-2 py-1 font-medium transition ${
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
            className={`rounded px-2 py-1 font-medium transition ${
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
          <div className="hidden md:flex items-center gap-1.5 rounded-md bg-saffron/90 px-2.5 py-1 text-[11px] font-bold text-dark-teal shadow-md backdrop-blur-xs border border-saffron animate-fadeIn">
            <span>💡 Doble clic en el mapa para levantar un nodo aquí</span>
          </div>
        )}
      </div>

      {/* Tooltip flotante al pasar el cursor */}
      {hoverInfo && hoverInfo.object && (
        <div
          className="pointer-events-none absolute z-30 -translate-x-1/2 -translate-y-full rounded-lg border border-dark-teal/15 bg-white/95 p-3 shadow-xl backdrop-blur-xs text-xs"
          style={{ left: hoverInfo.x, top: hoverInfo.y - 12 }}
        >
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
              <span className="font-semibold">Tipo:</span>{' '}
              <span className="capitalize">{hoverInfo.object.tipo}</span> ·{' '}
              <span className="font-semibold">Estado:</span>{' '}
              <span className="capitalize">{hoverInfo.object.estado}</span>
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

      {/* Leyenda de tipos de nodo */}
      <div className="absolute bottom-3 left-3 z-10 rounded-lg border border-slate-200 bg-white/95 p-2.5 shadow-md backdrop-blur-xs text-xs">
        <div className="font-semibold text-dark-teal text-[11px] uppercase tracking-wider mb-1.5">
          Convenciones Nodos Cali
        </div>
        <div className="grid grid-cols-2 gap-x-3 gap-y-1 text-[11px] text-slate-700">
          <div className="flex items-center gap-1.5">
            <span className="h-2.5 w-2.5 rounded-full bg-[#2E7559]" />
            <span>Centro de Acopio</span>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="h-2.5 w-2.5 rounded-full bg-[#E3B505]" />
            <span>Albergue Temporal</span>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="h-2.5 w-2.5 rounded-full bg-[#DB504A]" />
            <span>Hospital / Salud</span>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="h-2.5 w-2.5 rounded-full bg-[#184C78]" />
            <span>Puesto de Mando (PMU)</span>
          </div>
        </div>
      </div>
    </div>
  );
}

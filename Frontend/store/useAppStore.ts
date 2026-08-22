import { create } from 'zustand';
import { useShallow } from 'zustand/react/shallow';
import { useMemo } from 'react';
import type {
  UserSession,
  MapFilters,
  Reporte,
  ReporteStatus,
  MapFeatureCollection,
} from '@/types';

interface AppState {
  userSession: UserSession | null;
  activeNodeId: string | null;
  filters: MapFilters;
  reportes: Reporte[];

  setSession: (session: UserSession) => void;
  logout: () => void;
  setActiveNodeId: (id: string | null) => void;
  setFilters: (filters: Partial<MapFilters>) => void;
  resetFilters: () => void;
  addReporte: (reporte: Reporte) => void;
  updateReporteStatus: (id: string, status: ReporteStatus) => void;
}

const initialFilters: MapFilters = {
  type: 'todos',
  status: 'todos',
  urgency: 'todos',
  comuna: 'todas',
};

const mockReportes: Reporte[] = [
  {
    id: 'rep-001',
    titulo: 'Falta de agua potable en el sector',
    descripcion:
      'La comunidad reporta ausencia de suministro de agua potable desde hace 3 días. Se requiere distribución de agua embotellada o carro cisterna.',
    type: 'agua',
    status: 'Pendiente',
    urgency: 'critica',
    comuna: 'Comuna 1',
    lat: 3.4699,
    lng: -76.5323,
  },
  {
    id: 'rep-002',
    titulo: 'Escasez de alimentos en albergue temporal',
    descripcion:
      'El albergue habilitado en el sector cuenta con provisiones para menos de 24 horas. Se solicita reabastecimiento urgente de alimentos no perecederos.',
    type: 'alimentos',
    status: 'En Atención',
    urgency: 'alta',
    comuna: 'Comuna 3',
    lat: 3.4516,
    lng: -76.5320,
  },
  {
    id: 'rep-003',
    titulo: 'Necesidad de medicinas básicas',
    descripcion:
      'Se reporta falta de medicamentos esenciales (antibióticos, antipiréticos y suero oral) en el puesto de salud comunitario.',
    type: 'medicinas',
    status: 'Pendiente',
    urgency: 'media',
    comuna: 'Comuna 15',
    lat: 3.3908,
    lng: -76.5309,
  },
];

export const useAppStore = create<AppState>((set) => ({
  userSession: {
    userId: 'usr-001',
    nombre: 'David Caicedo',
    role: 'admin_gubernamental',
    token: 'mock-jwt-token',
  },
  activeNodeId: null,
  filters: initialFilters,
  reportes: mockReportes,

  setSession: (session) => set({ userSession: session }),

  logout: () => set({ userSession: null }),

  setActiveNodeId: (id) => set({ activeNodeId: id }),

  setFilters: (filters) =>
    set((state) => ({ filters: { ...state.filters, ...filters } })),

  resetFilters: () => set({ filters: initialFilters }),

  addReporte: (reporte) =>
    set((state) => ({ reportes: [...state.reportes, reporte] })),

  updateReporteStatus: (id, status) =>
    set((state) => ({
      reportes: state.reportes.map((r) =>
        r.id === id ? { ...r, status } : r
      ),
    })),
}));

// ---------------------------------------------------------------------------
// Selector memoizado: reportes -> GeoJSON (MapFeatureCollection)
// ---------------------------------------------------------------------------
//
// `selectGeoJsonData` es una función pura (no un hook) que transforma un
// array de `Reporte` al formato GeoJSON estándar que consume el mapa
// (MapLibre/Deck.gl), mapeando cada reporte a `ReporteFeatureProperties`
// (id, urgencia, tipo, titulo).
//
// Patrón de consumo recomendado para que MapLibre/Deck.gl no re-renderice en
// cada cambio del store (toasts, sesión, activeNodeId, etc.), solo cuando el
// resultado FILTRADO realmente cambia:
//
//   import { useAppStore, selectFilteredReportes, selectGeoJsonData } from '@/store/useAppStore';
//   import { useShallow } from 'zustand/react/shallow';
//   import { useMemo } from 'react';
//
//   function MapCanvas() {
//     // 1) useShallow compara el array resultante ítem a ítem (mismas
//     //    referencias de Reporte). Si el set filtrado no cambia, Zustand
//     //    devuelve la MISMA referencia de array entre renders, aunque otras
//     //    claves del store hayan cambiado.
//     const filteredReportes = useAppStore(useShallow(selectFilteredReportes));
//
//     // 2) La transformación a GeoJSON solo se recalcula cuando la
//     //    referencia de `filteredReportes` cambia de verdad, así el objeto
//     //    que llega al mapa mantiene identidad estable entre renders no
//     //    relacionados con el filtrado.
//     const geoJson = useMemo(
//       () => selectGeoJsonData(filteredReportes),
//       [filteredReportes]
//     );
//
//     return <Map data={geoJson} />;
//   }
//
// (`useFilteredReportes` / `useGeoJsonData` de abajo ya empaquetan ese
// patrón como hooks listos para usar.)
export function selectGeoJsonData(reportes: Reporte[]): MapFeatureCollection {
  return {
    type: 'FeatureCollection',
    features: reportes.map((reporte) => ({
      type: 'Feature',
      geometry: {
        type: 'Point',
        coordinates: [reporte.lng, reporte.lat],
      },
      properties: {
        id: reporte.id,
        urgencia: reporte.urgency,
        tipo: reporte.type,
        titulo: reporte.titulo,
      },
    })),
  };
}

// Selector plano (no-hook) de los reportes que pasan los `filters` activos.
// Se usa junto a `useShallow` para que la identidad del array de salida solo
// cambie cuando el resultado del filtro realmente cambia.
export function selectFilteredReportes(state: AppState): Reporte[] {
  const { reportes, filters } = state;
  return reportes.filter(
    (r) =>
      (filters.type === 'todos' || r.type === filters.type) &&
      (filters.status === 'todos' || r.status === filters.status) &&
      (filters.urgency === 'todos' || r.urgency === filters.urgency) &&
      (filters.comuna === 'todas' || r.comuna === filters.comuna)
  );
}

// Hook de conveniencia: reportes filtrados con referencia de array estable
// (useShallow evita nuevas referencias cuando el contenido no cambió).
export function useFilteredReportes(): Reporte[] {
  return useAppStore(useShallow(selectFilteredReportes));
}

// Hook de conveniencia: GeoJSON derivado y memoizado sobre la referencia
// estable de `useFilteredReportes`. Este es el hook que debería consumir el
// componente del mapa (MapLibre/Deck.gl).
export function useGeoJsonData(): MapFeatureCollection {
  const filteredReportes = useFilteredReportes();
  return useMemo(
    () => selectGeoJsonData(filteredReportes),
    [filteredReportes]
  );
}

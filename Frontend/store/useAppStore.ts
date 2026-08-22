import { create } from 'zustand';
import { useShallow } from 'zustand/react/shallow';
import { useMemo } from 'react';
import type {
  UserSession,
  MapFilters,
  Reporte,
  ReporteStatus,
  MapFeatureCollection,
  MisionPriorizada,
} from '@/types';

interface AppState {
  userSession: UserSession | null;
  activeNodeId: string | null;
  filters: MapFilters;
  reportes: Reporte[];
  misionesPriorizadas: MisionPriorizada[];

  setSession: (session: UserSession) => void;
  logout: () => void;
  setActiveNodeId: (id: string | null) => void;
  setFilters: (filters: Partial<MapFilters>) => void;
  resetFilters: () => void;
  addReporte: (reporte: Reporte) => void;
  updateReporteStatus: (id: string, status: ReporteStatus) => void;
  setMisionesPriorizadas: (misiones: MisionPriorizada[]) => void;
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

// Misiones exactas de la demo del pitch: cruce agua/colchonetas desde
// Plazoleta Jairo Varela (origen con 'sobra') hacia los albergues/puntos con
// faltante, replicando 1:1 el resultado documentado en
// Backend/supabase/seed.sql para `misiones_priorizadas()` (orden por
// urgencia desc, valores tal como quedarían sembrados en Supabase).
// Los ids son slugs legibles (no UUIDs reales) porque esta capa sigue
// siendo mock en memoria: cuando se conecte el endpoint real, alimentar
// `misionesPriorizadas` con la respuesta de FastAPI vía `setMisionesPriorizadas`.
const mockMisionesPriorizadas: MisionPriorizada[] = [
  {
    origen_id: 'punto-jairo-varela',
    destino_id: 'punto-demo-albergue-comuna-20',
    insumo_id: 'insumo-agua',
    nombre_insumo: 'agua',
    urgencia: 106,
    nivel_destino: 'no_hay',
    horas_faltando: 8,
    razon: 'DEMO — Albergue Comuna 20 lleva 8h sin agua',
  },
  {
    origen_id: 'punto-jairo-varela',
    destino_id: 'punto-demo-albergue-comuna-13',
    insumo_id: 'insumo-agua',
    nombre_insumo: 'agua',
    urgencia: 82,
    nivel_destino: 'poco',
    horas_faltando: 6,
    razon: 'DEMO — Albergue Comuna 13 lleva 6h con poco agua',
  },
  {
    origen_id: 'punto-jairo-varela',
    destino_id: 'punto-demo-albergue-comuna-20',
    insumo_id: 'insumo-colchonetas',
    nombre_insumo: 'colchonetas',
    urgencia: 80,
    nivel_destino: 'no_hay',
    horas_faltando: 5,
    razon: 'DEMO — Albergue Comuna 20 lleva 5h sin colchonetas',
  },
  {
    origen_id: 'punto-jairo-varela',
    destino_id: 'punto-banco-alimentos-cali',
    insumo_id: 'insumo-agua',
    nombre_insumo: 'agua',
    urgencia: 76,
    nivel_destino: 'poco',
    horas_faltando: 3,
    razon: 'Banco de Alimentos de Cali lleva 3h con poco agua',
  },
];

export const useAppStore = create<AppState>((set) => ({
  // Sin sesión por defecto: ahora que existe login real (mock) + middleware
  // de auth, un default "siempre admin logueado" causaba un flicker de RBAC
  // real — en el primer paint (antes de que AppShell hidrate la cookie en un
  // useEffect) se mostraban ítems de administración a cualquier rol, incluido
  // 'civil', hasta que la sesión real se resolvía un tick después. Con
  // `null` por defecto, el primer paint ya oculta todo lo restringido por
  // rol (fail-closed) y solo se revela una vez confirmada la sesión real.
  userSession: null,
  activeNodeId: null,
  filters: initialFilters,
  reportes: mockReportes,
  misionesPriorizadas: mockMisionesPriorizadas,

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

  setMisionesPriorizadas: (misiones) => set({ misionesPriorizadas: misiones }),
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
// El resultado es GeoJSON estándar (FeatureCollection de Point Features con
// `properties` planas y `geometry.coordinates` en [lng, lat]) — el mismo
// shape que arman las funciones SQL del backend (puntos_cercanos(),
// necesidades_en_zona()) vía ST_AsGeoJSON + json_build_object, así que se
// puede pasar tal cual tanto a un `<Source data={geoJson}>` de
// MapLibre/Deck.gl como al indexador de `supercluster` (que solo necesita
// `feature.geometry.coordinates`), sin transformación adicional.
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

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
  PuntoControl,
} from '@/types';

interface AppState {
  userSession: UserSession | null;
  activeNodeId: string | null;
  activePunto: PuntoControl | null;
  puntosControl: PuntoControl[];
  filters: MapFilters;
  reportes: Reporte[];
  misionesPriorizadas: MisionPriorizada[];
  isCrearNodoModalOpen: boolean;
  selectedMapCoords: [number, number] | null;

  setSession: (session: UserSession | null) => void;
  logout: () => void;
  setActiveNodeId: (id: string | null) => void;
  setActivePunto: (punto: PuntoControl | null) => void;
  setPuntosControl: (puntos: PuntoControl[]) => void;
  addPuntoControl: (punto: PuntoControl) => void;
  setFilters: (filters: Partial<MapFilters>) => void;
  resetFilters: () => void;
  addReporte: (reporte: Reporte) => void;
  updateReporteStatus: (id: string, status: ReporteStatus) => void;
  setMisionesPriorizadas: (misiones: MisionPriorizada[]) => void;
  setCrearNodoModalOpen: (open: boolean) => void;
  setSelectedMapCoords: (coords: [number, number] | null) => void;
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

const mockMisionesPriorizadas: MisionPriorizada[] = [
  {
    origen_id: 'punto-jairo-varela',
    destino_id: 'punto-demo-albergue-comuna-20',
    insumo_id: 'insumo-agua',
    nombre_insumo: 'agua',
    urgencia: 330,
    nivel_destino: 'no_hay',
    deficit: 200,
    horas_faltando: 12,
    razon: 'DEMO — Albergue Comuna 20 lleva 12h sin agua',
  },
  {
    origen_id: 'punto-jairo-varela',
    destino_id: 'punto-demo-albergue-comuna-13',
    insumo_id: 'insumo-agua',
    nombre_insumo: 'agua',
    urgencia: 212,
    nivel_destino: 'poco',
    deficit: 135,
    horas_faltando: 10,
    razon: 'DEMO — Albergue Comuna 13 lleva 10h con escasez de agua',
  },
  {
    origen_id: 'punto-jairo-varela',
    destino_id: 'punto-demo-albergue-comuna-20',
    insumo_id: 'insumo-colchonetas',
    nombre_insumo: 'colchonetas',
    urgencia: 195,
    nivel_destino: 'no_hay',
    deficit: 120,
    horas_faltando: 9,
    razon: 'DEMO — Albergue Comuna 20 lleva 9h sin colchonetas',
  },
  {
    origen_id: 'punto-jairo-varela',
    destino_id: 'punto-banco-alimentos-cali',
    insumo_id: 'insumo-agua',
    nombre_insumo: 'agua',
    urgencia: 153,
    nivel_destino: 'poco',
    deficit: 80,
    horas_faltando: 7,
    razon: 'Banco de Alimentos de Cali lleva 7h con escasez de agua',
  },
];

export const useAppStore = create<AppState>((set) => ({
  userSession: null,
  activeNodeId: null,
  activePunto: null,
  puntosControl: [],
  filters: initialFilters,
  reportes: mockReportes,
  misionesPriorizadas: mockMisionesPriorizadas,
  isCrearNodoModalOpen: false,
  selectedMapCoords: null,

  setSession: (session) => set({ userSession: session }),

  logout: () => set({ userSession: null, activeNodeId: null, activePunto: null }),

  setActiveNodeId: (id) => set({ activeNodeId: id }),

  setActivePunto: (punto) => set({ activePunto: punto, activeNodeId: punto ? punto.id : null }),

  setPuntosControl: (puntos) => set({ puntosControl: puntos }),

  addPuntoControl: (punto) =>
    set((state) => ({ puntosControl: [punto, ...state.puntosControl] })),

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

  setCrearNodoModalOpen: (open) => set({ isCrearNodoModalOpen: open }),

  setSelectedMapCoords: (coords) => set({ selectedMapCoords: coords }),
}));

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

export function useFilteredReportes(): Reporte[] {
  return useAppStore(useShallow(selectFilteredReportes));
}

export function useGeoJsonData(): MapFeatureCollection {
  const filteredReportes = useFilteredReportes();
  return useMemo(
    () => selectGeoJsonData(filteredReportes),
    [filteredReportes]
  );
}

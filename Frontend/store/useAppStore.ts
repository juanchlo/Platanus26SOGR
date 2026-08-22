import { create } from 'zustand';
import { useShallow } from 'zustand/react/shallow';
import { useMemo } from 'react';
import type {
  Incidente,
  MapFeatureCollection,
  MapFilters,
  PuntoControl,
  Reporte,
  ReporteStatus,
  UserSession,
} from '@/types';

interface AppState {
  userSession: UserSession | null;
  activeNodeId: string | null;
  activePunto: PuntoControl | null;
  activeIncidente: Incidente | null;
  puntosControl: PuntoControl[];
  filters: MapFilters;
  reportes: Reporte[];
  incidentes: Incidente[];
  isCrearNodoModalOpen: boolean;
  selectedMapCoords: [number, number] | null;

  setSession: (session: UserSession | null) => void;
  logout: () => void;
  setActiveNodeId: (id: string | null) => void;
  setActivePunto: (punto: PuntoControl | null) => void;
  setActiveIncidente: (incidente: Incidente | null) => void;
  setPuntosControl: (puntos: PuntoControl[]) => void;
  addPuntoControl: (punto: PuntoControl) => void;
  setIncidentes: (incidentes: Incidente[]) => void;
  addIncidente: (incidente: Incidente) => void;
  setFilters: (filters: Partial<MapFilters>) => void;
  resetFilters: () => void;
  addReporte: (reporte: Reporte) => void;
  updateReporteStatus: (id: string, status: ReporteStatus) => void;
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

export const useAppStore = create<AppState>((set) => ({
  userSession: null,
  activeNodeId: null,
  activePunto: null,
  activeIncidente: null,
  puntosControl: [],
  filters: initialFilters,
  reportes: mockReportes,
  incidentes: [],
  isCrearNodoModalOpen: false,
  selectedMapCoords: null,

  setSession: (session) => set({ userSession: session }),

  logout: () => set({ userSession: null, activeNodeId: null, activePunto: null, activeIncidente: null }),

  setActiveNodeId: (id) => set({ activeNodeId: id }),

  setActivePunto: (punto) =>
    set({
      activePunto: punto,
      activeIncidente: null,
      activeNodeId: punto ? punto.id : null,
    }),

  setActiveIncidente: (incidente) =>
    set({
      activeIncidente: incidente,
      activePunto: null,
      activeNodeId: incidente ? incidente.id : null,
    }),

  setPuntosControl: (puntos) => set({ puntosControl: puntos }),

  addPuntoControl: (punto) =>
    set((state) => ({ puntosControl: [punto, ...state.puntosControl] })),

  setIncidentes: (incidentes) => set({ incidentes }),

  addIncidente: (incidente) =>
    set((state) => ({ incidentes: [incidente, ...state.incidentes] })),

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

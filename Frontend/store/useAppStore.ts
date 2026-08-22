import { create } from 'zustand';
import type {
  UserSession,
  MapFilters,
  Reporte,
  ReporteStatus,
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

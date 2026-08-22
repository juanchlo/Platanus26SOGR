export type UserRole =
  | 'admin_gubernamental'
  | 'ente_publico'
  | 'operador_campo'
  | 'civil';

export interface UserSession {
  userId: string;
  nombre: string;
  role: UserRole;
  token: string;
  email?: string;
}

export type UrgenciaType = 'critica' | 'alta' | 'media' | 'baja';

export type ReporteStatus = 'Pendiente' | 'En Atención' | 'Resuelto';

export interface Reporte {
  id: string;
  titulo: string;
  descripcion: string;
  type: string;
  status: ReporteStatus;
  urgency: UrgenciaType;
  comuna: string;
  lat: number;
  lng: number;
}

export interface MapFilters {
  type: string;
  status: string;
  urgency: string;
  comuna: string;
}

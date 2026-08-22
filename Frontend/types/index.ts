export type UserRole =
  | 'admin_gubernamental'
  | 'ente_publico'
  | 'operador_campo'
  | 'civil'
  | 'ADMIN_GUBERNAMENTAL'
  | 'ENTE_PUBLICO'
  | 'OPERADOR_CAMPO'
  | 'CIVIL';

export interface UserSession {
  userId: string;
  nombre: string;
  role: UserRole;
  token: string;
  email?: string;
}

export interface PuntoControl {
  id: string;
  nombre: string;
  tipo: 'acopio' | 'albergue' | 'hospital' | 'comando' | string | null;
  estado: 'activo' | 'saturado' | 'cerrado' | 'pendiente' | string | null;
  lat: number;
  lng: number;
  direccion?: string | null;
  horario?: string | null;
  telefono?: string | null;
  responsable?: string | null;
  responsable_user_id?: string | null;
  verificado: boolean;
  creado_en?: string | null;
  actualizado_en?: string | null;
}

export interface UserResponseItem {
  id: string;
  email: string;
  role: UserRole;
  is_active: boolean;
  created_at?: string;
}

export interface Insumo {
  id: string;
  nombre: string;
  categoria?: string | null;
  unidad?: string | null;
  criticidad?: number | null;
}

export type NivelInventario = 'no_hay' | 'poco' | 'bien' | 'sobra';

export interface InventarioItem {
  insumo_id: string;
  nombre: string;
  categoria?: string | null;
  unidad?: string | null;
  criticidad?: number | null;
  cantidad_actual: number;
  cantidad_necesaria: number;
  deficit: number;
  nivel: NivelInventario;
  actualizado_en?: string | null;
  actualizado_por?: string | null;
}

export interface AlertaNodoInactivo {
  id: string;
  nombre: string;
  direccion?: string | null;
  responsable?: string | null;
  ultima_actualizacion?: string | null;
  horas_sin_reporte: number;
}

export interface PeticionRecurso {
  id: string;
  tipo: string;
  descripcion?: string | null;
  lat: number;
  lng: number;
  barrio?: string | null;
  urgencia?: number | null;
  estado: string;
  creado_en?: string | null;
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

// --- Contrato GeoJSON para el mapa (MapLibre/Deck.gl) -----------------------

export interface ReporteFeatureProperties {
  id: string;
  urgencia: UrgenciaType;
  tipo: string;
  titulo: string;
}

export interface ReporteFeature {
  type: 'Feature';
  geometry: {
    type: 'Point';
    coordinates: [number, number]; // [lng, lat]
  };
  properties: ReporteFeatureProperties;
}

export interface MapFeatureCollection {
  type: 'FeatureCollection';
  features: ReporteFeature[];
}

// --- Contrato exacto de Backend/supabase/postgis.sql: puntos_cercanos() ----

export interface PuntoControlFeatureProperties {
  id: string;
  nombre: string;
  tipo: 'acopio' | 'albergue' | 'hospital' | 'comando' | null;
  estado: 'activo' | 'saturado' | 'cerrado' | 'pendiente' | null;
  verificado: boolean;
  distancia_km?: number;
}

export interface PuntoControlFeature {
  type: 'Feature';
  geometry: {
    type: 'Point';
    coordinates: [number, number]; // [lng, lat]
  };
  properties: PuntoControlFeatureProperties;
}

export interface PuntosControlFeatureCollection {
  type: 'FeatureCollection';
  features: PuntoControlFeature[];
}

// --- Contrato exacto de Backend/supabase/postgis.sql: necesidades_en_zona() -

export interface NecesidadFeatureProperties {
  id: string;
  tipo: string | null;
  descripcion: string | null;
  barrio: string | null;
  urgencia: number; // 1-5, crudo de la tabla `necesidades`
  estado: 'pendiente' | 'en_atencion' | 'resuelto' | null;
}

export interface NecesidadFeature {
  type: 'Feature';
  geometry: {
    type: 'Point';
    coordinates: [number, number]; // [lng, lat]
  };
  properties: NecesidadFeatureProperties;
}

export interface NecesidadesFeatureCollection {
  type: 'FeatureCollection';
  features: NecesidadFeature[];
}

// --- Contrato exacto de Backend/supabase/pgrouting.sql: ruta_optima() ------

export interface RutaOptimaProperties {
  origen_id: string;
  destino_id: string;
  tiempo_min: number | null;
  pasos: number;
}

export interface RutaOptimaFeature {
  type: 'Feature';
  geometry: GeoJSON.Feature['geometry'] | null;
  properties: RutaOptimaProperties;
}

// --- Contrato exacto de Backend/supabase/pgrouting.sql: misiones_priorizadas() -

export interface MisionPriorizada {
  origen_id: string;
  destino_id: string;
  insumo_id: string;
  nombre_insumo: string;
  urgencia: number | null;
  nivel_destino: 'no_hay' | 'poco';
  deficit: number | null;
  horas_faltando: number;
  razon: string;
}

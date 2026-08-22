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

// NOTA de contrato: `ReporteFeatureProperties`/`MapFeatureCollection` de
// arriba modelan el mock `Reporte` (necesidades civiles) que arma este
// frontend, NO son un espejo 1:1 de `necesidades_en_zona()` en
// Backend/supabase/postgis.sql — esa función devuelve
// { id, tipo, descripcion, barrio, urgencia (1-5 numérico), estado },
// distinto en nombres y en el tipo de `urgencia` (número, no
// 'critica'|'alta'|'media'|'baja'). Cuando se conecte el endpoint real,
// usar `NecesidadFeatureProperties`/`NecesidadesFeatureCollection` de abajo,
// que sí son el contrato exacto de esa función.

// --- Contrato exacto de Backend/supabase/postgis.sql: puntos_cercanos() ----

export interface PuntoControlFeatureProperties {
  id: string;
  nombre: string;
  tipo: 'acopio' | 'albergue' | 'hospital' | 'comando' | null;
  estado: 'activo' | 'saturado' | 'cerrado' | 'pendiente' | null;
  verificado: boolean;
  distancia_km: number;
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
//
// OJO: a diferencia de las FeatureCollection de arriba (puntos), esto es UN
// solo Feature con geometría LineString — ruta_optima() no devuelve una
// colección, devuelve un único camino entre origen y destino.

export interface RutaOptimaProperties {
  origen_id: string;
  destino_id: string;
  tiempo_min: number | null;
  pasos: number;
}

// `geometry`/`tiempo_min` nullable por feedback de backend: ruta_optima()
// devuelve null en ambos cuando no existe camino entre origen y destino
// (grafo desconectado, algún punto sin arcos activos) en vez de lanzar
// excepción — ver Backend/supabase/pgrouting.sql.
export interface RutaOptimaFeature {
  type: 'Feature';
  geometry: GeoJSON.Feature['geometry'] | null;
  properties: RutaOptimaProperties;
}

// --- Contrato exacto de Backend/supabase/pgrouting.sql: misiones_priorizadas() -
//
// El shape { origen_id, destino_id, insumo, urgencia, tiempo_min, razon }
// no coincide con lo que realmente devuelve misiones_priorizadas() (ver
// Backend/supabase/pgrouting.sql y el bloque de resultado esperado que deja
// documentado Backend/supabase/seed.sql): la función no calcula
// `tiempo_min` (eso es ruta_optima(), una función distinta que resuelve
// sobre el grafo de red_logistica) y el insumo viaja como `insumo_id` +
// `nombre_insumo`, no como un campo único `insumo`. Se modela aquí 1:1 con
// el payload real para no inventarle datos a la función SQL.

export interface MisionPriorizada {
  origen_id: string;
  destino_id: string;
  insumo_id: string;
  nombre_insumo: string;
  urgencia: number | null;
  nivel_destino: 'no_hay' | 'poco';
  horas_faltando: number;
  razon: string;
}

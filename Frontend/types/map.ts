// Urgencia alineada con la paleta de marca:
//   alta    → rosy-copper  (#DB504A)
//   media   → saffron      (#E3B505)
//   baja    → muted-teal   (#93C0A4)
export type Urgencia = "alta" | "media" | "baja";

export type TipoPunto = "reporte" | "centro_acopio";

export type EstadoReporte = "activo" | "en_proceso" | "resuelto";

export type CategoriaReporte =
  | "alimentos"
  | "agua"
  | "medicamentos"
  | "refugio"
  | "otro";

export interface MapFeatureProperties {
  id: string;
  tipo: TipoPunto;
  titulo: string;
  urgencia: Urgencia;
  estado: EstadoReporte;
  descripcion: string;
  timestamp: string; // ISO 8601
  // Solo para tipo "reporte"
  categoria?: CategoriaReporte;
  // Solo para tipo "centro_acopio"
  capacidad?: number;
  stockDisponible?: number;
}

export interface MapFeature {
  type: "Feature";
  geometry: {
    type: "Point";
    coordinates: [number, number]; // [lng, lat]
  };
  properties: MapFeatureProperties;
}

export interface MapFeatureCollection {
  type: "FeatureCollection";
  features: MapFeature[];
}

// Celdas de Voronoi (zonas de responsabilidad geográfica de cada nodo de
// ayuda), calculadas en vivo por el backend — ver GET /puntos-control/voronoi.
export interface VoronoiCeldaProperties {
  punto_control_id: string;
  nombre: string;
  tipo?: string | null;
}

export interface VoronoiFeature {
  type: "Feature";
  geometry: {
    type: "Polygon";
    coordinates: number[][][]; // [ [ [lng, lat], ... ] ]
  };
  properties: VoronoiCeldaProperties;
}

export interface VoronoiFeatureCollection {
  type: "FeatureCollection";
  features: VoronoiFeature[];
}

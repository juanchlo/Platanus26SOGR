"use client";

import { useEffect, useRef } from "react";
import * as maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { MapboxOverlay } from "@deck.gl/mapbox";
import { ScatterplotLayer } from "@deck.gl/layers";
import { mockMapData } from "@/lib/mock/map-data";
import type { MapFeature, Urgencia } from "@/types/map";

const CALI_CENTER: [number, number] = [-76.5225, 3.4516];
const INITIAL_ZOOM = 12;
const MAP_STYLE = "https://tiles.openfreemap.org/styles/liberty";

// Colores alineados con la paleta de marca (tailwind.config.ts)
const URGENCIA_COLOR: Record<Urgencia, [number, number, number, number]> = {
  alta: [219, 80, 74, 220],   // rosy-copper
  media: [227, 181, 5, 220],  // saffron
  baja: [147, 192, 164, 220], // muted-teal
};

function buildLayers() {
  return [
    new ScatterplotLayer<MapFeature>({
      id: "sogr-puntos",
      data: mockMapData.features,
      getPosition: (f) => f.geometry.coordinates,
      getFillColor: (f) => URGENCIA_COLOR[f.properties.urgencia],
      getRadius: (f) => (f.properties.tipo === "centro_acopio" ? 120 : 60),
      radiusUnits: "meters",
      radiusMinPixels: 6,
      pickable: true,
      stroked: true,
      getLineColor: [255, 255, 255, 200],
      lineWidthMinPixels: 1,
    }),
  ];
}

export default function MapCanvas() {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;

    const map = new maplibregl.Map({
      container: containerRef.current,
      style: MAP_STYLE,
      center: CALI_CENTER,
      zoom: INITIAL_ZOOM,
    });

    map.addControl(new maplibregl.NavigationControl(), "top-right");

    const overlay = new MapboxOverlay({ layers: buildLayers() });
    // MapboxOverlay implementa IControl — lo añadimos al mapa como un control
    map.addControl(overlay as unknown as maplibregl.IControl);

    mapRef.current = map;

    return () => {
      map.remove();
      mapRef.current = null;
    };
  }, []);

  return <div ref={containerRef} className="h-full w-full" />;
}

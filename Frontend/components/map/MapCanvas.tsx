"use client";

import { useEffect, useRef } from "react";
import * as maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";

// Centro en Cali, Colombia
const CALI_CENTER: [number, number] = [-76.5225, 3.4516];
const INITIAL_ZOOM = 12;

// Estilo gratuito sin API key (OpenFreeMap)
const MAP_STYLE = "https://tiles.openfreemap.org/styles/liberty";

export default function MapCanvas() {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;

    mapRef.current = new maplibregl.Map({
      container: containerRef.current,
      style: MAP_STYLE,
      center: CALI_CENTER,
      zoom: INITIAL_ZOOM,
    });

    mapRef.current.addControl(
      new maplibregl.NavigationControl(),
      "top-right"
    );

    return () => {
      mapRef.current?.remove();
      mapRef.current = null;
    };
  }, []);

  return <div ref={containerRef} className="h-full w-full" />;
}

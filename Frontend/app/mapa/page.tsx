import dynamic from "next/dynamic";

// ssr: false evita que MapLibre intente acceder a window/self en el servidor
const MapCanvas = dynamic(() => import("@/components/map/MapCanvas"), {
  ssr: false,
  loading: () => (
    <div className="flex h-full w-full items-center justify-center bg-ghost-white text-sm text-slate-500">
      Cargando mapa…
    </div>
  ),
});

export default function MapaPage() {
  return (
    // -m-6 cancela el p-6 del layout principal para que el mapa ocupe todo el área
    <div className="-m-6 h-[calc(100vh-64px)]">
      <MapCanvas />
    </div>
  );
}

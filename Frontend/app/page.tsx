import dynamic from 'next/dynamic';

const MapCanvas = dynamic(() => import('@/components/map/MapCanvas'), {
  ssr: false,
  loading: () => (
    <div className="flex h-full min-h-[65vh] w-full items-center justify-center bg-ghost-white text-sm text-slate-500">
      <div className="flex items-center gap-2">
        <svg className="h-5 w-5 animate-spin text-dark-teal" viewBox="0 0 24 24" fill="none">
          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
        </svg>
        <span>Cargando mapa de Cali, Colombia...</span>
      </div>
    </div>
  ),
});

export default function HomePage() {
  return (
    <div className="h-full min-h-[70vh] w-full flex-1">
      <MapCanvas />
    </div>
  );
}

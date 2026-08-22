export default function HomePage() {
  return (
    <div className="rounded-lg border border-dark-teal/10 bg-white p-6 shadow-sm">
      <h1 className="text-xl font-semibold text-dark-teal">
        Panel principal
      </h1>
      <p className="mt-2 text-sm text-slate-600">
        Contenido de cada módulo (CRUD de posts, mapa, logística, etc.) se
        renderiza aquí, dentro del layout principal.
      </p>
    </div>
  );
}

import type { Config } from "tailwindcss";

// Paleta de marca del Sistema Operativo de Gestión de Riesgo y Red de Emergencias.
// Cada color de marca queda expuesto también como alias semántico para que el
// resto del equipo (mapa, alertas, CRUD de posts) use nombres con intención
// en vez de recordar códigos hex.
const brand = {
  "dark-teal": "#084C61", // Color primario: barra superior, navegación, acentos de marca
  "rosy-copper": "#DB504A", // Peligro / crítico: alertas RF-16, estados de error
  saffron: "#E3B505", // Advertencia: estados "En Atención", saturación de recursos
  "ghost-white": "#FAFAFF", // Fondo base de la app (modo claro)
  "muted-teal": "#93C0A4", // Éxito / resuelto: confirmaciones, estados positivos
  // Texto secundario SÓLIDO (no usar text-white/NN ni text-slate-400/500):
  // la opacidad diluye el trazo además de bajar el contraste. Estos tonos
  // están mezclados a mano para mantener ≥4.5:1 reales.
  "on-dark-muted": "#C7D9DC", // texto secundario sobre dark-teal
  "on-light-muted": "#4B5A60", // texto secundario sobre fondos claros
};

const config: Config = {
  content: [
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
    "./components/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        ...brand,
        // Alias semánticos usados por componentes (topbar, sidebar, alertas RF-16)
        primary: brand["dark-teal"],
        danger: brand["rosy-copper"],
        warning: brand.saffron,
        background: brand["ghost-white"],
        success: brand["muted-teal"],
      },
      fontFamily: {
        // Public Sans (cargada vía next/font en app/layout.tsx) reemplaza el
        // stack system-ui por defecto, que en varios SO/navegadores resuelve
        // a un trazo fino y agrava la falta de contraste del texto secundario.
        sans: ["var(--font-public-sans)", "Segoe UI", "system-ui", "sans-serif"],
      },
    },
  },
  plugins: [],
};

export default config;

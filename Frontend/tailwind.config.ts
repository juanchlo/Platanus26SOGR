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
    },
  },
  plugins: [],
};

export default config;

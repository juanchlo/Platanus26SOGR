import type { UserRole } from '@/types';

// RBAC de interfaz (RF-14 simulado): qué roles tienen acceso a acciones
// sensibles — administración, edición de nodos y creación de avisos/
// comunicados oficiales. 'operador_campo' queda en modo lectura para esas
// acciones específicas (sigue pudiendo ver el mapa, actualizar inventario
// no es "gestión" en este sentido).
export const ROLES_CON_GESTION: readonly UserRole[] = [
  'admin_gubernamental',
  'ente_publico',
];

export function puedeGestionar(role: UserRole | null | undefined): boolean {
  return !!role && ROLES_CON_GESTION.includes(role);
}

// REGLA DE NEGOCIO CRÍTICA: el portal para 'civil' es 100% informativo.
// 'civil' se representa en el store como `userSession === null` (ver
// middleware.ts / AppShell — acceso sin login) o, si alguna vez existe un
// login explícito con rol 'civil', también cae acá. Puede VER el mapa y las
// necesidades reportadas, pero NO puede crear solicitudes, reportar
// necesidades nuevas ni gestionar nada.
//
// Cualquier botón/formulario de "Crear Solicitud", "Reportar" o "Nueva
// Necesidad" que se construya a futuro (ej. en la página /necesidades)
// DEBE gatearse con esta función antes de renderizarse — no alcanza con
// "hay sesión", porque 'operador_campo' sí puede crear/reportar.
export function puedeCrearReportes(role: UserRole | null | undefined): boolean {
  return !!role && role !== 'civil';
}

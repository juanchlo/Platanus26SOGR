import type { UserRole } from '@/types';

// RBAC de interfaz (RF-14 simulado): qué roles tienen acceso a acciones
// sensibles — administración, edición de nodos y creación de avisos/
// comunicados oficiales. 'civil' y 'operador_campo' quedan en modo
// lectura/reporte para esas acciones específicas (igual pueden ver el mapa
// y reportar necesidades, que no son acciones de gestión).
export const ROLES_CON_GESTION: readonly UserRole[] = [
  'admin_gubernamental',
  'ente_publico',
];

export function puedeGestionar(role: UserRole | null | undefined): boolean {
  return !!role && ROLES_CON_GESTION.includes(role);
}

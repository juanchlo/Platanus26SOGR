import type { UserRole } from '@/types';

export function normalizeRole(role: UserRole | string | null | undefined): string {
  if (!role) return '';
  return role.toLowerCase().trim();
}

// RBAC de interfaz (RF-14): qué roles tienen acceso a acciones sensibles
export const ROLES_CON_GESTION: readonly string[] = [
  'admin_gubernamental',
  'ente_publico',
];

export function puedeGestionar(role: UserRole | string | null | undefined): boolean {
  const norm = normalizeRole(role);
  return !!norm && ROLES_CON_GESTION.includes(norm);
}

// REGLA CRÍTICA: Solo ADMIN_GUBERNAMENTAL puede levantar/crear nuevos nodos logísticos y dar de alta Entes Públicos
export function puedeLevantarNodos(role: UserRole | string | null | undefined): boolean {
  const norm = normalizeRole(role);
  return norm === 'admin_gubernamental';
}

export function isAdminGubernamental(role: UserRole | string | null | undefined): boolean {
  const norm = normalizeRole(role);
  return norm === 'admin_gubernamental';
}

export function isEntePublico(role: UserRole | string | null | undefined): boolean {
  const norm = normalizeRole(role);
  return norm === 'ente_publico';
}

// REGLA DE NEGOCIO CRÍTICA: el portal para 'civil' es 100% informativo / solo lectura.
// Un civil (con o sin sesión) NO tiene ningún permiso de creación.
export function puedeCrearReportes(role: UserRole | string | null | undefined): boolean {
  const norm = normalizeRole(role);
  return !!norm && norm !== 'civil';
}

export function isCivil(role: UserRole | string | null | undefined): boolean {
  const norm = normalizeRole(role);
  return !norm || norm === 'civil';
}

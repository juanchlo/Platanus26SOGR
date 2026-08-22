import Cookies from 'js-cookie';
import type { UserSession } from '@/types';

// Persistencia de la sesión simulada vía cookie (el store de Zustand sigue
// siendo puro en memoria — sin middleware `persist` — así que la cookie es
// la única fuente de verdad que sobrevive a un refresh; ver AppShell, que
// hidrata el store leyendo esta cookie al montar).
//
// Una sola cookie JSON en vez de una por campo: más simple de mantener en
// sync y evita que token/rol quedar desalineados si solo se actualiza uno.
const SESSION_COOKIE_NAME = 'sogr_session';
const SESSION_COOKIE_EXPIRES_DAYS = 1;

export function setSessionCookie(session: UserSession): void {
  Cookies.set(SESSION_COOKIE_NAME, JSON.stringify(session), {
    expires: SESSION_COOKIE_EXPIRES_DAYS,
    sameSite: 'lax',
    secure: typeof window !== 'undefined' && window.location.protocol === 'https:',
  });
}

export function getSessionCookie(): UserSession | null {
  const raw = Cookies.get(SESSION_COOKIE_NAME);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    if (
      parsed &&
      typeof parsed.userId === 'string' &&
      typeof parsed.nombre === 'string' &&
      typeof parsed.role === 'string' &&
      typeof parsed.token === 'string'
    ) {
      return parsed as UserSession;
    }
    return null;
  } catch {
    return null; // cookie corrupta/manipulada: se ignora, no se rompe la app
  }
}

export function clearSessionCookie(): void {
  Cookies.remove(SESSION_COOKIE_NAME);
}

// Token JWT "dummy" para el modo mock (RF-14 simulado): no es un JWT real
// firmado, solo un string con forma reconocible para el resto del equipo
// (ej. 'mock-jwt-token-david-caicedo').
export function generateMockJwt(nombre: string): string {
  const slug = nombre
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '') // quita tildes (diacríticos tras NFD)
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-');
  return `mock-jwt-token-${slug || 'usuario'}`;
}

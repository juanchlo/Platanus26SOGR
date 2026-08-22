import { NextResponse, type NextRequest } from 'next/server';

// Protección de rutas (RF-14 simulado) a nivel de Edge Middleware.
//
// No valida un JWT real (esto es un login mock, ver lib/auth.ts) — solo
// confirma que exista la cookie de sesión con forma mínima esperada
// ({ role, token }). El nombre de la cookie DEBE coincidir con
// `SESSION_COOKIE_NAME` en lib/auth.ts; no se puede importar ese módulo
// acá porque usa `js-cookie` (asume `document`), que no existe en el
// runtime Edge del middleware — por eso la constante y el parseo se
// repiten localmente, deliberadamente.
const SESSION_COOKIE_NAME = 'sogr_session';

function hasValidSession(request: NextRequest): boolean {
  const raw = request.cookies.get(SESSION_COOKIE_NAME)?.value;
  if (!raw) return false;
  try {
    const parsed = JSON.parse(raw);
    return typeof parsed?.role === 'string' && typeof parsed?.token === 'string';
  } catch {
    return false; // cookie corrupta/manipulada: se trata como "sin sesión"
  }
}

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const authenticated = hasValidSession(request);

  if (pathname === '/login') {
    // Usuario ya autenticado no debería ver el formulario de login de nuevo.
    if (authenticated) {
      return NextResponse.redirect(new URL('/', request.url));
    }
    return NextResponse.next();
  }

  // Todo lo demás que matchea `config.matcher` (dashboard '/', '/mapa',
  // '/admin', '/reportes', etc.) requiere sesión.
  if (!authenticated) {
    return NextResponse.redirect(new URL('/login', request.url));
  }

  return NextResponse.next();
}

// Excluye assets estáticos, imágenes optimizadas de Next, favicon y rutas
// de API (aunque el proyecto todavía no tiene ninguna bajo app/api, se deja
// excluida preventivamente para no interceptar llamadas de servidor).
export const config = {
  matcher: [
    '/((?!api|_next/static|_next/image|favicon\\.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico|css|js|map|woff2?)$).*)',
  ],
};

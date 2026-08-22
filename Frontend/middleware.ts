import { NextResponse, type NextRequest } from 'next/server';

// Control de acceso (RF-14 simulado) a nivel de Edge Middleware.
//
// La app es de acceso público por defecto: un visitante sin cookie de
// sesión navega el mapa y reporta necesidades como 'civil' SIN loguearse,
// sin formulario y sin entregar ningún dato personal — ver AppShell/
// lib/rbac.ts, donde `userSession === null` ya renderiza exactamente el
// mismo subconjunto de UI que un civil autenticado (ningún ítem de gestión
// requiere rol explícito 'civil', así que "sin sesión" y "civil" son
// equivalentes de cara a la interfaz).
//
// Solo el login de STAFF (roles con permisos de gestión: admin_gubernamental,
// ente_publico, operador_campo) sigue existiendo en '/login' — y ese login
// sigue siendo simulado, no valida un JWT real, ver lib/auth.ts.
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

  // Único caso que el middleware sigue gateando: alguien con sesión de
  // staff ya activa no debería volver a ver el formulario de login.
  if (pathname === '/login' && hasValidSession(request)) {
    return NextResponse.redirect(new URL('/', request.url));
  }

  // Todo lo demás (incluyendo '/', '/mapa', etc.) pasa libre, con o sin
  // cookie — el gating de acciones sensibles para staff se resuelve en la
  // UI (RBAC de interfaz), no acá. Ver PASO 2 del audit: esto significa que
  // hoy NO hay autorización real a nivel de servidor; cualquier endpoint de
  // backend que se conecte a futuro debe validar el rol por su cuenta.
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

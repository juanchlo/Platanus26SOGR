'use client';

import { useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { useAppStore } from '@/store/useAppStore';
import { setSessionCookie, generateMockJwt } from '@/lib/auth';
import type { UserRole } from '@/types';

// Login simulado (RF-14) — SOLO para roles de staff. Un civil NO pasa por
// acá: navega y reporta necesidades sin loguearse (ver middleware.ts), así
// que 'civil' no es una opción seleccionable en este formulario — mostrarla
// acá sugeriría, incorrectamente, que un civil necesita credenciales.
//
// No valida contra ningún backend de auth real — acepta cualquier
// credencial y arma una `UserSession` mock a partir del rol elegido y el
// correo ingresado (para derivar un nombre/token legibles). La sesión se
// persiste en una cookie (ver lib/auth.ts) y se refleja en el store de
// Zustand vía `setSession`.

const ROLE_OPTIONS: Array<{ value: UserRole; label: string; hint: string }> = [
  {
    value: 'admin_gubernamental',
    label: 'Administrador',
    hint: 'Admin Gubernamental — control total del sistema',
  },
  {
    value: 'ente_publico',
    label: 'Ente Público',
    hint: 'Coordinación institucional y despacho',
  },
  {
    value: 'operador_campo',
    label: 'Operador',
    hint: 'Operador de Campo — actualiza inventario y estado de nodos',
  },
];

function nombreFromEmail(email: string): string {
  const local = email.split('@')[0] || 'Usuario';
  return local
    .replace(/[._-]+/g, ' ')
    .split(' ')
    .filter(Boolean)
    .map((part) => part[0].toUpperCase() + part.slice(1))
    .join(' ');
}

export default function LoginPage() {
  const router = useRouter();
  const setSession = useAppStore((state) => state.setSession);

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [role, setRole] = useState<UserRole>('admin_gubernamental');
  const [error, setError] = useState<string | null>(null);

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!email.trim() || !password.trim()) {
      setError('Ingresa correo y contraseña (cualquier valor es válido en modo mock).');
      return;
    }
    setError(null);

    const nombre = nombreFromEmail(email);
    const session = {
      userId: `usr-${role}`,
      nombre,
      role,
      token: generateMockJwt(nombre),
      email: email.trim(),
    };

    setSessionCookie(session);
    setSession(session);
    router.push('/');
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="w-full max-w-md rounded-xl border border-dark-teal/10 bg-white shadow-lg">
        {/* Encabezado de marca */}
        <div className="flex flex-col items-center gap-2 rounded-t-xl bg-dark-teal px-6 py-8 text-ghost-white">
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth={1.75}
            strokeLinecap="round"
            strokeLinejoin="round"
            className="h-9 w-9"
          >
            <path d="M12 3l8 4v5c0 4.5-3.2 8.2-8 9-4.8-.8-8-4.5-8-9V7l8-4Z" />
            <path d="M9.5 12.5l1.75 1.75L15 10.5" />
          </svg>
          <span className="text-lg font-bold tracking-tight">LOGI-RED</span>
          <span className="text-xs text-ghost-white/70">
            Gestión de Riesgo y Red de Emergencias · Cali
          </span>
        </div>

        <div className="px-6 pt-6">
          {/* Salida directa para civiles: no necesitan loguearse ni llenar
              nada de este formulario para usar la app. */}
          <div className="flex items-center justify-between gap-3 rounded-md border border-muted-teal/30 bg-muted-teal/10 px-3 py-2 text-xs text-dark-teal">
            <span>¿Sos un civil? No hace falta iniciar sesión para ver el mapa y las necesidades reportadas.</span>
            <a
              href="/"
              className="shrink-0 font-semibold underline underline-offset-2 hover:no-underline"
            >
              Entrar directo
            </a>
          </div>
        </div>

        <form onSubmit={handleSubmit} className="flex flex-col gap-4 px-6 py-6">
          <div>
            <h1 className="text-base font-semibold text-dark-teal">
              Iniciar sesión de personal autorizado
            </h1>
            <p className="mt-1 text-xs text-slate-500">
              Solo para roles de gestión (admin, ente público, operador de
              campo). Cualquier correo y contraseña son válidos — esta demo
              no autentica contra un backend real.
            </p>
          </div>

          <div className="flex flex-col gap-1.5">
            <label htmlFor="email" className="text-xs font-medium text-slate-700">
              Correo
            </label>
            <input
              id="email"
              type="email"
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="nombre@sogr.gov.co"
              className="rounded-md border border-dark-teal/20 bg-background px-3 py-2 text-sm text-slate-900 outline-none transition-colors focus:border-dark-teal"
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <label htmlFor="password" className="text-xs font-medium text-slate-700">
              Contraseña
            </label>
            <input
              id="password"
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
              className="rounded-md border border-dark-teal/20 bg-background px-3 py-2 text-sm text-slate-900 outline-none transition-colors focus:border-dark-teal"
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <span className="text-xs font-medium text-slate-700">
              Rol a simular
            </span>
            <div className="grid grid-cols-3 gap-2">
              {ROLE_OPTIONS.map((option) => (
                <label
                  key={option.value}
                  title={option.hint}
                  className={`flex cursor-pointer flex-col gap-0.5 rounded-md border px-3 py-2 text-xs transition-colors ${
                    role === option.value
                      ? 'border-dark-teal bg-dark-teal/5 text-dark-teal'
                      : 'border-dark-teal/15 text-slate-600 hover:border-dark-teal/40'
                  }`}
                >
                  <span className="flex items-center gap-1.5 font-medium">
                    <input
                      type="radio"
                      name="role"
                      value={option.value}
                      checked={role === option.value}
                      onChange={() => setRole(option.value)}
                      className="accent-dark-teal"
                    />
                    {option.label}
                  </span>
                </label>
              ))}
            </div>
          </div>

          {error ? (
            <p role="alert" className="text-xs font-medium text-rosy-copper">
              {error}
            </p>
          ) : null}

          <button
            type="submit"
            className="mt-2 rounded-md bg-dark-teal px-4 py-2.5 text-sm font-semibold text-ghost-white transition-colors hover:bg-dark-teal/90"
          >
            Ingresar
          </button>
        </form>
      </div>
    </div>
  );
}

'use client';

import { useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { useAppStore } from '@/store/useAppStore';
import { setSessionCookie, clearSessionCookie } from '@/lib/auth';
import { loginApi, getMeApi } from '@/lib/api';
import type { UserRole, UserSession } from '@/types';

function formatRoleLabel(role: string): string {
  const normalized = role.toLowerCase();
  switch (normalized) {
    case 'admin_gubernamental':
      return 'Administrador Gubernamental';
    case 'ente_publico':
      return 'Ente Público';
    case 'operador_campo':
      return 'Operador de Campo';
    case 'civil':
      return 'Ciudadano / Civil';
    default:
      return role;
  }
}

export default function LoginPage() {
  const router = useRouter();
  const setSession = useAppStore((state) => state.setSession);

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!email.trim() || !password.trim()) {
      setError('Por favor ingresa tu correo institucional y contraseña.');
      return;
    }
    setError(null);
    setIsSubmitting(true);

    try {
      // 1. Authenticate against FastAPI / Supabase PostgreSQL backend
      const loginRes = await loginApi(email, password);

      // 2. Fetch authenticated user profile
      const meRes = await getMeApi(loginRes.access_token);

      // 3. Build session object
      const userRole = meRes.role.toLowerCase() as UserRole;
      const nombre =
        meRes.email.split('@')[0].replace(/[._-]+/g, ' ') || 'Funcionario';

      const session: UserSession = {
        userId: meRes.id,
        nombre: nombre
          .split(' ')
          .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
          .join(' '),
        role: userRole,
        token: loginRes.access_token,
        email: meRes.email,
      };

      setSessionCookie(session);
      setSession(session);
      router.push('/');
    } catch (err: any) {
      console.error('Login error:', err);
      setError(
        err.message ||
          'No se pudo conectar con el servidor de autenticación en Supabase.'
      );
    } finally {
      setIsSubmitting(false);
    }
  }

  function handleEntrarComoCivil() {
    clearSessionCookie();
    setSession(null);
    router.push('/');
  }

  function handleQuickFill(demoEmail: string, demoPass: string) {
    setEmail(demoEmail);
    setPassword(demoPass);
    setError(null);
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4 py-12">
      <div className="w-full max-w-md rounded-xl border border-dark-teal/10 bg-white shadow-xl">
        {/* Encabezado institucional */}
        <div className="flex flex-col items-center gap-2 rounded-t-xl bg-dark-teal px-6 py-8 text-ghost-white">
          <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-white/10 shadow-inner">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/pulse-logo.png" alt="PULSE" className="h-9 w-9" />
          </div>
          <span className="text-2xl font-extrabold tracking-tight">PULSE</span>
          <span className="text-[13px] font-semibold text-on-dark-muted text-center">
            Plataforma de Unificación y Lógica de Seguridad en Emergencias
          </span>
        </div>

        {/* Acceso libre para civiles */}
        <div className="px-6 pt-6">
          <div className="flex flex-col gap-2.5 rounded-lg border-2 border-muted-teal bg-muted-teal/15 p-4 text-sm text-dark-teal">
            <div className="flex items-start gap-2.5">
              <svg
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth={2.25}
                className="mt-0.5 h-5 w-5 shrink-0 text-dark-teal"
              >
                <circle cx="12" cy="12" r="10" />
                <line x1="12" y1="16" x2="12" y2="12" />
                <line x1="12" y1="8" x2="12.01" y2="8" />
              </svg>
              <span className="font-medium">
                <strong className="font-extrabold">Acceso Ciudadano (Civil):</strong> Puedes consultar el mapa, albergues y centros de acopio sin necesidad de iniciar sesión.
              </span>
            </div>
            <button
              type="button"
              onClick={handleEntrarComoCivil}
              className="mt-1 w-full rounded-md border-2 border-dark-teal bg-white py-2.5 text-center text-sm font-bold text-dark-teal shadow-sm transition hover:bg-dark-teal/5"
            >
              Ingresar como Civil (Acceso libre de consulta) →
            </button>
          </div>
        </div>

        <form onSubmit={handleSubmit} className="flex flex-col gap-4 px-6 py-6">
          <div>
            <h1 className="text-lg font-extrabold text-dark-teal">
              Iniciar Sesión de Personal Autorizado
            </h1>
            <p className="mt-1 text-[13px] font-semibold text-on-light-muted">
              Validación oficial contra la base de datos de Supabase.
            </p>
          </div>

          <div className="flex flex-col gap-1.5">
            <label htmlFor="email" className="text-[13px] font-bold uppercase tracking-wide text-dark-teal">
              Correo Electrónico
            </label>
            <input
              id="email"
              type="email"
              autoComplete="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="funcionario@sogr.gov.co"
              className="rounded-md border-2 border-dark-teal/25 bg-background px-3.5 py-2.5 text-base font-medium text-slate-900 outline-none transition-colors focus:border-dark-teal focus:ring-1 focus:ring-dark-teal"
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <label htmlFor="password" className="text-[13px] font-bold uppercase tracking-wide text-dark-teal">
              Contraseña
            </label>
            <input
              id="password"
              type="password"
              autoComplete="current-password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
              className="rounded-md border-2 border-dark-teal/25 bg-background px-3.5 py-2.5 text-base font-medium text-slate-900 outline-none transition-colors focus:border-dark-teal focus:ring-1 focus:ring-dark-teal"
            />
          </div>

          {error ? (
            <div className="rounded-md bg-rosy-copper p-3 text-sm font-bold text-white border-2 border-rosy-copper">
              {error}
            </div>
          ) : null}

          <button
            type="submit"
            disabled={isSubmitting}
            className="mt-2 flex items-center justify-center gap-2 rounded-md bg-dark-teal px-4 py-3 text-base font-bold text-ghost-white transition hover:bg-dark-teal/90 disabled:opacity-50"
          >
            {isSubmitting ? (
              <>
                <svg className="h-4 w-4 animate-spin text-white" viewBox="0 0 24 24" fill="none">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                </svg>
                Verificando en Supabase...
              </>
            ) : (
              'Ingresar al Sistema'
            )}
          </button>
        </form>

        {/* Cuentas de prueba rápida */}
        <div className="border-t-2 border-slate-200 bg-slate-50 px-6 py-4 rounded-b-xl">
          <span className="text-[13px] font-extrabold uppercase tracking-wider text-dark-teal">
            Cuentas Demo para Pruebas
          </span>
          <div className="mt-2.5 grid grid-cols-2 gap-2 text-xs">
            <button
              type="button"
              onClick={() => handleQuickFill('admin@sogr.gov.co', 'admin123')}
              className="rounded-md border-2 border-slate-200 bg-white p-2.5 text-left hover:border-dark-teal hover:bg-dark-teal/5 transition"
            >
              <div className="text-[13px] font-bold text-dark-teal">Admin Gubernamental</div>
              <div className="text-xs font-semibold text-on-light-muted">admin@sogr.gov.co</div>
            </button>
            <button
              type="button"
              onClick={() => handleQuickFill('ente.alcaldia@sogr.gov.co', 'ente123')}
              className="rounded-md border-2 border-slate-200 bg-white p-2.5 text-left hover:border-dark-teal hover:bg-dark-teal/5 transition"
            >
              <div className="text-[13px] font-bold text-dark-teal">Ente Público</div>
              <div className="text-xs font-semibold text-on-light-muted">ente.alcaldia@sogr.gov.co</div>
            </button>
            <button
              type="button"
              onClick={() => handleQuickFill('operador@sogr.gov.co', 'operador123')}
              className="rounded-md border-2 border-slate-200 bg-white p-2.5 text-left hover:border-dark-teal hover:bg-dark-teal/5 transition"
            >
              <div className="text-[13px] font-bold text-dark-teal">Operador de Campo</div>
              <div className="text-xs font-semibold text-on-light-muted">operador@sogr.gov.co</div>
            </button>
            <button
              type="button"
              onClick={() => handleQuickFill('civil@sogr.gov.co', 'civil123')}
              className="rounded-md border-2 border-slate-200 bg-white p-2.5 text-left hover:border-dark-teal hover:bg-dark-teal/5 transition"
            >
              <div className="text-[13px] font-bold text-dark-teal">Usuario Civil</div>
              <div className="text-xs font-semibold text-on-light-muted">civil@sogr.gov.co</div>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

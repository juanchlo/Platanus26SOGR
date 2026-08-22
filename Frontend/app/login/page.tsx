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
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth={1.75}
              strokeLinecap="round"
              strokeLinejoin="round"
              className="h-8 w-8 text-ghost-white"
            >
              <path d="M12 3l8 4v5c0 4.5-3.2 8.2-8 9-4.8-.8-8-4.5-8-9V7l8-4Z" />
              <path d="M9.5 12.5l1.75 1.75L15 10.5" />
            </svg>
          </div>
          <span className="text-xl font-bold tracking-tight">LOGI-RED CALI</span>
          <span className="text-xs text-ghost-white/80 text-center">
            Sistema Operativo de Gestión de Riesgo y Red de Emergencias
          </span>
        </div>

        {/* Acceso libre para civiles */}
        <div className="px-6 pt-6">
          <div className="flex flex-col gap-2 rounded-lg border border-muted-teal/40 bg-muted-teal/10 p-3.5 text-xs text-dark-teal">
            <div className="flex items-start gap-2">
              <svg
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth={2}
                className="mt-0.5 h-4 w-4 shrink-0 text-muted-teal"
              >
                <circle cx="12" cy="12" r="10" />
                <line x1="12" y1="16" x2="12" y2="12" />
                <line x1="12" y1="8" x2="12.01" y2="8" />
              </svg>
              <span>
                <strong>Acceso Ciudadano (Civil):</strong> Puedes consultar el mapa, albergues y centros de acopio sin necesidad de iniciar sesión.
              </span>
            </div>
            <button
              type="button"
              onClick={handleEntrarComoCivil}
              className="mt-1 w-full rounded-md border border-dark-teal/20 bg-white py-2 text-center text-xs font-semibold text-dark-teal shadow-sm transition hover:bg-dark-teal/5"
            >
              Ingresar como Civil (Acceso libre de consulta) →
            </button>
          </div>
        </div>

        <form onSubmit={handleSubmit} className="flex flex-col gap-4 px-6 py-6">
          <div>
            <h1 className="text-base font-semibold text-dark-teal">
              Iniciar Sesión de Personal Autorizado
            </h1>
            <p className="mt-1 text-xs text-slate-500">
              Validación oficial contra la base de datos de Supabase.
            </p>
          </div>

          <div className="flex flex-col gap-1.5">
            <label htmlFor="email" className="text-xs font-medium text-slate-700">
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
              className="rounded-md border border-dark-teal/20 bg-background px-3 py-2 text-sm text-slate-900 outline-none transition-colors focus:border-dark-teal focus:ring-1 focus:ring-dark-teal"
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
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
              className="rounded-md border border-dark-teal/20 bg-background px-3 py-2 text-sm text-slate-900 outline-none transition-colors focus:border-dark-teal focus:ring-1 focus:ring-dark-teal"
            />
          </div>

          {error ? (
            <div className="rounded-md bg-rosy-copper/10 p-3 text-xs font-medium text-rosy-copper border border-rosy-copper/20">
              {error}
            </div>
          ) : null}

          <button
            type="submit"
            disabled={isSubmitting}
            className="mt-2 flex items-center justify-center gap-2 rounded-md bg-dark-teal px-4 py-2.5 text-sm font-semibold text-ghost-white transition hover:bg-dark-teal/90 disabled:opacity-50"
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
        <div className="border-t border-slate-100 bg-slate-50/70 px-6 py-4 rounded-b-xl">
          <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">
            Cuentas Demo para Pruebas:
          </span>
          <div className="mt-2 grid grid-cols-2 gap-2 text-xs">
            <button
              type="button"
              onClick={() => handleQuickFill('admin@sogr.gov.co', 'admin123')}
              className="rounded border border-slate-200 bg-white p-2 text-left hover:border-dark-teal hover:bg-dark-teal/5 transition"
            >
              <div className="font-semibold text-dark-teal">Admin Gubernamental</div>
              <div className="text-[10px] text-slate-500">admin@sogr.gov.co</div>
            </button>
            <button
              type="button"
              onClick={() => handleQuickFill('ente.alcaldia@sogr.gov.co', 'ente123')}
              className="rounded border border-slate-200 bg-white p-2 text-left hover:border-dark-teal hover:bg-dark-teal/5 transition"
            >
              <div className="font-semibold text-dark-teal">Ente Público</div>
              <div className="text-[10px] text-slate-500">ente.alcaldia@sogr.gov.co</div>
            </button>
            <button
              type="button"
              onClick={() => handleQuickFill('operador@sogr.gov.co', 'operador123')}
              className="rounded border border-slate-200 bg-white p-2 text-left hover:border-dark-teal hover:bg-dark-teal/5 transition"
            >
              <div className="font-semibold text-dark-teal">Operador de Campo</div>
              <div className="text-[10px] text-slate-500">operador@sogr.gov.co</div>
            </button>
            <button
              type="button"
              onClick={() => handleQuickFill('civil@sogr.gov.co', 'civil123')}
              className="rounded border border-slate-200 bg-white p-2 text-left hover:border-dark-teal hover:bg-dark-teal/5 transition"
            >
              <div className="font-semibold text-dark-teal">Usuario Civil</div>
              <div className="text-[10px] text-slate-500">civil@sogr.gov.co</div>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

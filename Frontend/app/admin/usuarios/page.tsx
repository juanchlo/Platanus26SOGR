'use client';

import { useState, useEffect, useCallback, type FormEvent } from 'react';
import { useAppStore } from '@/store/useAppStore';
import { getUsersApi, createUserApi, toggleUserActiveApi } from '@/lib/api';
import { puedeLevantarNodos, normalizeRole } from '@/lib/rbac';
import type { UserResponseItem, UserRole } from '@/types';

export default function AdminUsuariosPage() {
  const userSession = useAppStore((state) => state.userSession);
  const [users, setUsers] = useState<UserResponseItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Modal para dar de alta nuevo usuario / ente público
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [newEmail, setNewEmail] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [newRole, setNewRole] = useState<UserRole>('ENTE_PUBLICO');
  const [submitting, setSubmitting] = useState(false);
  const [modalError, setModalError] = useState<string | null>(null);
  const [modalSuccess, setModalSuccess] = useState<string | null>(null);

  const fetchUsers = useCallback(async () => {
    if (!userSession?.token) return;
    try {
      setLoading(true);
      setError(null);
      const data = await getUsersApi(undefined, userSession.token);
      setUsers(data);
    } catch (err: any) {
      console.error('Error cargando usuarios:', err);
      setError(err.message || 'No se pudieron cargar los usuarios.');
    } finally {
      setLoading(false);
    }
  }, [userSession?.token]);

  useEffect(() => {
    fetchUsers();
  }, [fetchUsers]);

  if (!userSession || !puedeLevantarNodos(userSession.role)) {
    return (
      <div className="rounded-lg border border-dark-teal/10 bg-white p-6 shadow-sm">
        <h1 className="text-lg font-bold text-rosy-copper">Acceso Restringido</h1>
        <p className="mt-2 text-sm text-slate-600">
          Solo los funcionarios con rol <strong>Administrador Gubernamental</strong> tienen autorización para gestionar y dar de alta usuarios o Entes Públicos.
        </p>
      </div>
    );
  }

  async function handleToggleActive(user: UserResponseItem) {
    if (!userSession?.token) return;
    try {
      const updated = await toggleUserActiveApi(userSession.token, user.id, !user.is_active);
      setUsers((prev) =>
        prev.map((u) => (u.id === user.id ? { ...u, is_active: updated.is_active } : u))
      );
    } catch (err: any) {
      console.error('Error toggling user active status:', err);
      alert('Error al cambiar el estado del usuario.');
    }
  }

  async function handleCreateUser(e: FormEvent) {
    e.preventDefault();
    if (!userSession?.token) return;
    if (!newEmail.trim() || !newPassword.trim()) {
      setModalError('Por favor completa todos los campos.');
      return;
    }
    if (newPassword.length < 6) {
      setModalError('La contraseña debe tener al menos 6 caracteres.');
      return;
    }

    try {
      setSubmitting(true);
      setModalError(null);
      const created = await createUserApi(userSession.token, {
        email: newEmail.trim(),
        password: newPassword.trim(),
        role: newRole,
      });

      setUsers((prev) => [created, ...prev]);
      setModalSuccess(`✓ Usuario ${created.email} creado y habilitado exitosamente.`);
      setNewEmail('');
      setNewPassword('');

      setTimeout(() => {
        setIsModalOpen(false);
        setModalSuccess(null);
      }, 1500);
    } catch (err: any) {
      console.error('Error creando usuario:', err);
      setModalError(err.message || 'Error al registrar el usuario.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="flex flex-col gap-5 p-2 sm:p-4">
      {/* Cabecera */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 rounded-xl bg-dark-teal p-5 text-white shadow-md">
        <div>
          <span className="text-[11px] font-semibold uppercase tracking-wider text-saffron">
            Administración del Sistema SOGR
          </span>
          <h1 className="text-xl font-bold">Gestión de Usuarios y Entes Públicos</h1>
          <p className="mt-1 text-xs text-ghost-white/80">
            Habilita y administra las entidades públicas responsables de los nodos de Cali.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setIsModalOpen(true)}
            className="flex items-center gap-1.5 rounded-md bg-saffron px-3.5 py-2 text-xs font-bold text-dark-teal shadow transition hover:bg-saffron/90"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} className="h-4 w-4">
              <line x1="12" y1="5" x2="12" y2="19" />
              <line x1="5" y1="12" x2="19" y2="12" />
            </svg>
            Dar de Alta Ente Público
          </button>
        </div>
      </div>

      {/* Tabla de Usuarios */}
      <div className="rounded-xl border border-dark-teal/15 bg-white shadow-sm overflow-hidden">
        <div className="p-4 border-b border-slate-100 flex items-center justify-between">
          <h2 className="text-sm font-bold text-dark-teal">
            Usuarios Registrados ({users.length})
          </h2>
          <button
            type="button"
            onClick={fetchUsers}
            disabled={loading}
            className="text-xs text-slate-500 hover:text-dark-teal transition flex items-center gap-1"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`}>
              <path d="M21.5 2v6h-6M21.34 15.57a10 10 0 1 1-.57-8.38l5.67-5.67" />
            </svg>
            Refrescar
          </button>
        </div>

        {loading ? (
          <div className="p-12 text-center text-xs text-slate-500">
            Cargando usuarios desde Supabase...
          </div>
        ) : error ? (
          <div className="p-4 text-xs text-rose-600 bg-rose-50">{error}</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="bg-ghost-white text-slate-600 font-semibold border-b border-slate-100">
                <tr>
                  <th className="p-3">Correo Institucional</th>
                  <th className="p-3">Rol Asignado</th>
                  <th className="p-3">Estado</th>
                  <th className="p-3 text-right">Acciones</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 text-slate-700">
                {users.map((user) => {
                  const normRole = normalizeRole(user.role);
                  return (
                    <tr key={user.id} className="hover:bg-slate-50/70 transition">
                      <td className="p-3 font-medium text-slate-900">{user.email}</td>
                      <td className="p-3">
                        <span
                          className={`rounded-md px-2 py-0.5 text-[11px] font-bold ${
                            normRole === 'admin_gubernamental'
                              ? 'bg-purple-100 text-purple-800'
                              : normRole === 'ente_publico'
                              ? 'bg-dark-teal/15 text-dark-teal'
                              : normRole === 'operador_campo'
                              ? 'bg-amber-100 text-amber-800'
                              : 'bg-slate-100 text-slate-700'
                          }`}
                        >
                          {normRole === 'admin_gubernamental'
                            ? 'Admin Gubernamental'
                            : normRole === 'ente_publico'
                            ? 'Ente Público'
                            : normRole === 'operador_campo'
                            ? 'Operador de Campo'
                            : 'Civil'}
                        </span>
                      </td>
                      <td className="p-3">
                        <span
                          className={`rounded-md px-2 py-0.5 text-[10px] font-bold uppercase ${
                            user.is_active
                              ? 'bg-emerald-100 text-emerald-800'
                              : 'bg-rose-100 text-rose-800'
                          }`}
                        >
                          {user.is_active ? 'Habilitado' : 'Deshabilitado'}
                        </span>
                      </td>
                      <td className="p-3 text-right">
                        <button
                          type="button"
                          onClick={() => handleToggleActive(user)}
                          className={`rounded px-2.5 py-1 text-[11px] font-semibold transition ${
                            user.is_active
                              ? 'border border-rose-200 text-rose-700 hover:bg-rose-50'
                              : 'border border-emerald-200 text-emerald-700 hover:bg-emerald-50'
                          }`}
                        >
                          {user.is_active ? 'Deshabilitar' : 'Habilitar'}
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Modal para Crear/Dar de Alta Ente Público */}
      {isModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xs p-4">
          <div className="w-full max-w-md rounded-xl bg-white p-6 shadow-2xl border border-dark-teal/20">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100">
              <h3 className="text-base font-bold text-dark-teal">
                Dar de Alta Nuevo Ente Público
              </h3>
              <button
                type="button"
                onClick={() => setIsModalOpen(false)}
                className="text-slate-400 hover:text-slate-600 text-xs"
              >
                ✕
              </button>
            </div>

            <form onSubmit={handleCreateUser} className="mt-4 flex flex-col gap-3.5">
              <div className="flex flex-col gap-1">
                <label className="text-xs font-semibold text-slate-700">
                  Correo Institucional (Ente Público) *
                </label>
                <input
                  type="email"
                  required
                  value={newEmail}
                  onChange={(e) => setNewEmail(e.target.value)}
                  placeholder="ej. cruzroja.norte@sogr.gov.co"
                  className="rounded-md border border-slate-300 px-3 py-2 text-xs focus:border-dark-teal outline-none"
                />
              </div>

              <div className="flex flex-col gap-1">
                <label className="text-xs font-semibold text-slate-700">
                  Contraseña Inicial * (mínimo 6 caracteres)
                </label>
                <input
                  type="password"
                  required
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  placeholder="••••••••"
                  className="rounded-md border border-slate-300 px-3 py-2 text-xs focus:border-dark-teal outline-none"
                />
              </div>

              <div className="flex flex-col gap-1">
                <label className="text-xs font-semibold text-slate-700">Rol a Asignar *</label>
                <select
                  value={newRole}
                  onChange={(e) => setNewRole(e.target.value as UserRole)}
                  className="rounded-md border border-slate-300 px-3 py-2 text-xs focus:border-dark-teal outline-none bg-white font-medium"
                >
                  <option value="ENTE_PUBLICO">Ente Público (Responsable de Nodos)</option>
                  <option value="OPERADOR_CAMPO">Operador de Campo</option>
                  <option value="ADMIN_GUBERNAMENTAL">Administrador Gubernamental</option>
                </select>
              </div>

              {modalError && (
                <div className="p-2 rounded bg-rose-50 text-rose-700 text-xs font-semibold border border-rose-200">
                  {modalError}
                </div>
              )}

              {modalSuccess && (
                <div className="p-2 rounded bg-emerald-50 text-emerald-800 text-xs font-semibold border border-emerald-200">
                  {modalSuccess}
                </div>
              )}

              <div className="mt-2 flex justify-end gap-2 pt-3 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setIsModalOpen(false)}
                  className="rounded-md border border-slate-200 px-3.5 py-1.5 text-xs font-semibold text-slate-600 hover:bg-slate-50"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={submitting}
                  className="rounded-md bg-dark-teal px-4 py-1.5 text-xs font-bold text-white shadow hover:bg-dark-teal/90 disabled:opacity-50 flex items-center gap-1.5"
                >
                  {submitting ? 'Creando...' : 'Habilitar Ente Público'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

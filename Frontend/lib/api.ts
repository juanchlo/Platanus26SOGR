import type { PuntoControl, UserResponseItem } from '@/types';

const API_BASE_URL =
  process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000/api/v1';

export interface LoginResponse {
  access_token: string;
  token_type: string;
  expires_in: number;
}

export interface UserMeResponse {
  id: string;
  email: string;
  role: string;
  is_active: boolean;
  created_at?: string;
  updated_at?: string;
}

export interface CreatePuntoControlPayload {
  nombre: string;
  tipo: string;
  estado?: string;
  lat: number;
  lng: number;
  responsable_user_id: string;
  direccion?: string;
  horario?: string;
  telefono?: string;
  responsable?: string;
  verificado?: boolean;
}

export async function loginApi(
  email: string,
  password: string
): Promise<LoginResponse> {
  const response = await fetch(`${API_BASE_URL}/auth/login`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ email: email.trim(), password }),
  });

  if (!response.ok) {
    let errorMsg = 'Error al iniciar sesión';
    try {
      const errJson = await response.json();
      errorMsg =
        errJson?.error?.message ||
        errJson?.detail ||
        errJson?.message ||
        `Error HTTP ${response.status}`;
    } catch {
      errorMsg = `Error HTTP ${response.status}`;
    }
    throw new Error(errorMsg);
  }

  return response.json();
}

export async function getMeApi(token: string): Promise<UserMeResponse> {
  const response = await fetch(`${API_BASE_URL}/auth/me`, {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${token}`,
    },
  });

  if (!response.ok) {
    throw new Error('No se pudo verificar la sesión con el servidor.');
  }

  return response.json();
}

export async function getPuntosControlApi(): Promise<PuntoControl[]> {
  try {
    const response = await fetch(`${API_BASE_URL}/puntos-control`, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
      },
      cache: 'no-store',
    });

    if (!response.ok) {
      throw new Error(`Error HTTP ${response.status} al cargar nodos.`);
    }

    return response.json();
  } catch (err) {
    console.error('Error fetching puntos de control:', err);
    throw err;
  }
}

export async function createPuntoControlApi(
  token: string,
  payload: CreatePuntoControlPayload
): Promise<PuntoControl> {
  const response = await fetch(`${API_BASE_URL}/puntos-control`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    let errorMsg = 'Error al crear el nodo';
    try {
      const errJson = await response.json();
      errorMsg =
        errJson?.error?.message ||
        errJson?.detail ||
        errJson?.message ||
        `Error HTTP ${response.status}`;
    } catch {
      errorMsg = `Error HTTP ${response.status}`;
    }
    throw new Error(errorMsg);
  }

  return response.json();
}

export async function getUsersApi(
  role?: string,
  token?: string
): Promise<UserResponseItem[]> {
  const url = new URL(`${API_BASE_URL}/users`);
  if (role) {
    url.searchParams.set('role', role);
  }

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }

  const response = await fetch(url.toString(), {
    method: 'GET',
    headers,
  });

  if (!response.ok) {
    throw new Error(`Error HTTP ${response.status} al obtener usuarios.`);
  }

  return response.json();
}

import type {
  AlertaNodoInactivo,
  Incidente,
  Insumo,
  InventarioItem,
  NivelInventario,
  PeticionRecurso,
  PuntoControl,
  UserResponseItem,
} from '@/types';

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

export interface CreateUserPayload {
  email: string;
  password: string;
  role: string;
}

export interface PeticionRecursoPayload {
  tipo: string;
  descripcion: string;
  urgencia?: number;
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
}

export async function getMisNodosApi(token: string): Promise<PuntoControl[]> {
  const response = await fetch(`${API_BASE_URL}/puntos-control/mis-nodos`, {
    method: 'GET',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    cache: 'no-store',
  });

  if (!response.ok) {
    throw new Error(`Error HTTP ${response.status} al cargar mis nodos asignados.`);
  }

  return response.json();
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
    cache: 'no-store',
  });

  if (!response.ok) {
    throw new Error(`Error HTTP ${response.status} al obtener usuarios.`);
  }

  return response.json();
}

export async function createUserApi(
  token: string,
  payload: CreateUserPayload
): Promise<UserResponseItem> {
  const response = await fetch(`${API_BASE_URL}/users`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    let errorMsg = 'Error al registrar el usuario';
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

export async function toggleUserActiveApi(
  token: string,
  userId: string,
  isActive: boolean
): Promise<UserResponseItem> {
  const response = await fetch(`${API_BASE_URL}/users/${userId}/status`, {
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ is_active: isActive }),
  });

  if (!response.ok) {
    throw new Error(`Error HTTP ${response.status} al cambiar estado de usuario.`);
  }

  return response.json();
}

export async function getInsumosApi(): Promise<Insumo[]> {
  const response = await fetch(`${API_BASE_URL}/insumos`, {
    method: 'GET',
    headers: {
      'Content-Type': 'application/json',
    },
    cache: 'no-store',
  });

  if (!response.ok) {
    throw new Error(`Error HTTP ${response.status} al obtener catálogo de insumos.`);
  }

  return response.json();
}

export async function getInventarioNodoApi(
  puntoId: string
): Promise<InventarioItem[]> {
  const response = await fetch(`${API_BASE_URL}/puntos-control/${puntoId}/inventario`, {
    method: 'GET',
    headers: {
      'Content-Type': 'application/json',
    },
    cache: 'no-store',
  });

  if (!response.ok) {
    throw new Error(`Error HTTP ${response.status} al obtener inventario del nodo.`);
  }

  return response.json();
}

export async function updateInventarioNodoApi(
  token: string,
  puntoId: string,
  items: Array<{
    insumo_id: string;
    cantidad_actual: number;
    cantidad_necesaria: number;
    nivel?: NivelInventario;
  }>
): Promise<InventarioItem[]> {
  const response = await fetch(`${API_BASE_URL}/puntos-control/${puntoId}/inventario`, {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ items }),
  });

  if (!response.ok) {
    let errorMsg = 'Error al actualizar inventario';
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

export async function crearPeticionRecursoApi(
  token: string,
  puntoId: string,
  payload: PeticionRecursoPayload
): Promise<PeticionRecurso> {
  const response = await fetch(`${API_BASE_URL}/puntos-control/${puntoId}/peticiones`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    let errorMsg = 'Error al registrar petición de recursos';
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

export async function getAlertasNodosInactivosApi(): Promise<AlertaNodoInactivo[]> {
  const response = await fetch(`${API_BASE_URL}/alertas/nodos-inactivos`, {
    method: 'GET',
    headers: {
      'Content-Type': 'application/json',
    },
    cache: 'no-store',
  });

  if (!response.ok) {
    throw new Error(`Error HTTP ${response.status} al consultar alertas de inactividad.`);
  }

  return response.json();
}

export interface CreateIncidentePayload {
  testimonio: string;
  lat: number;
  lng: number;
  direccion?: string;
  barrio?: string;
  urgencia_manual?: number;
}

export async function createIncidenteApi(
  token: string,
  payload: CreateIncidentePayload
): Promise<Incidente> {
  const response = await fetch(`${API_BASE_URL}/incidentes`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    let errorMsg = 'Error al reportar incidente';
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

export async function getIncidentesApi(): Promise<Incidente[]> {
  const response = await fetch(`${API_BASE_URL}/incidentes`, {
    method: 'GET',
    headers: {
      'Content-Type': 'application/json',
    },
    cache: 'no-store',
  });

  if (!response.ok) {
    throw new Error(`Error HTTP ${response.status} al cargar incidentes.`);
  }

  return response.json();
}

export async function updateIncidenteEstadoApi(
  token: string,
  id: string,
  estado: string
): Promise<Incidente> {
  const response = await fetch(`${API_BASE_URL}/incidentes/${id}/estado`, {
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ estado }),
  });

  if (!response.ok) {
    throw new Error(`Error HTTP ${response.status} al actualizar estado del incidente.`);
  }

  return response.json();
}

export interface TranscripcionAudioResult {
  texto: string;
  proveedor: string;
  confianza: number;
}

export async function transcribirAudioApi(
  token: string,
  audioBlob: Blob,
  filename = 'testimonio_operador.webm'
): Promise<TranscripcionAudioResult> {
  const formData = new FormData();
  formData.append('file', audioBlob, filename);

  const response = await fetch(`${API_BASE_URL}/incidentes/transcribir-audio`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
    },
    body: formData,
  });

  if (!response.ok) {
    let errorMsg = 'Error al transcribir audio';
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

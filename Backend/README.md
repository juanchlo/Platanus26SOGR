# SOGR Backend API

Backend modular construido con **FastAPI**, **Python 3.14**, **SQLAlchemy 2.0 (Async)**, **Arquitectura Hexagonal (Ports & Adapters)** y **RBAC (Role-Based Access Control)**.

---

## 🏗️ Arquitectura Hexagonal (Puertos y Adaptadores)

```text
Backend/
├── src/backend/
│   ├── domain/                  # Núcleo de Dominio Puro (CERO dependencias de frameworks)
│   │   ├── entities/            # UserRole (Enum) y UserEntity (Dataclass pura)
│   │   ├── ports/               # Interfaces abstractas: UserRepository, PasswordHasher, TokenService
│   │   └── services/            # Servicios de aplicación: AuthService puro con inyección de puertos
│   ├── infrastructure/          # Adaptadores de Salida (Driven Adapters)
│   │   ├── database.py          # Conexión SQLAlchemy 2.0 async engine (Supabase PostgreSQL / SQLite) + SSL + Pool
│   │   ├── security.py          # Implementaciones concretas de Bcrypt y PyJWT
│   │   └── persistence/
│   │       ├── models/          # UserModel ORM + mappers bidireccionales (to_entity, from_entity)
│   │       └── repositories/    # SQLAlchemyUserRepository implementando UserRepository
│   ├── api/                     # Adaptadores de Entrada (Driving Adapters / HTTP)
│   │   ├── deps.py              # Inyección de dependencias (DI Container)
│   │   └── v1/
│   │       ├── router.py        # Enrutador raíz v1
│   │       └── endpoints/
│   │           ├── auth.py      # /api/v1/auth (login, register, me)
│   │           └── health.py    # /api/v1/health
│   ├── core/                    # Cross-cutting (Settings y Excepciones)
│   │   ├── config.py            # Variables de entorno con pydantic-settings
│   │   ├── exceptions.py        # Excepciones de dominio puras (sin FastAPI)
│   │   └── exception_handlers.py# Manejadores globales HTTP/JSON de FastAPI
│   ├── schemas/                 # DTOs Pydantic (con Field(description=...) para LLMs)
│   │   ├── common.py            # Envoltorios de respuesta y errores
│   │   ├── token.py             # DTOs de autenticación y JWT
│   │   └── user.py              # DTOs de usuarios (Login, Register, Profile)
│   └── main.py                  # Fábrica FastAPI, middlewares CORS, lifespan y OpenAPI metadata
├── tests/                       # Suite de pruebas automatizadas con pytest y async in-memory SQLite
├── .env.example                 # Plantilla de variables de entorno (incluye templates de Supabase)
└── pyproject.toml               # Dependencias gestionadas con uv
```

---

## 👥 Roles RBAC Soportados

- `ADMIN_GUBERNAMENTAL`: Administrador con acceso total a gestión y publicaciones.
- `OPERADOR_CAMPO`: Operador de campo para reportes e incidentes.
- `ENTE_PUBLICO`: Entidades oficiales autorizadas para emitir comunicaciones.
- `CIVIL`: Ciudadano / usuario estándar.

---

## ⚡ Guía de Integración con Supabase PostgreSQL

El backend ya está preparado con soporte nativo asíncrono para **Supabase PostgreSQL** mediante `asyncpg`, gestión de SSL automática y pool de conexiones configurable.

### 1. Obtener la cadena de conexión en Supabase
1. Ve al panel de tu proyecto en [Supabase Dashboard](https://supabase.com/dashboard).
2. Navega a **Project Settings** > **Database** > **Connection string** > **URI**.
3. Selecciona la pestaña **Transaction** (recomendado para APIs) o **Session**.

### 2. Formato de la URL de Conexión (Requisito `asyncpg`)
> ⚠️ **IMPORTANTE**: SQLAlchemy en modo async requiere explícitamente el prefijo del driver `postgresql+asyncpg://` en lugar de `postgresql://` o `postgres://`.

Ejemplo para **Transaction Pooler (Puerto 6543 - Recomendado)**:
```env
DATABASE_URL=postgresql+asyncpg://postgres.[PROJECT_REF]:[PASSWORD]@aws-0-[REGION].pooler.supabase.com:6543/postgres
```

Ejemplo para **Session Pooler (Puerto 5432)**:
```env
DATABASE_URL=postgresql+asyncpg://postgres.[PROJECT_REF]:[PASSWORD]@aws-0-[REGION].pooler.supabase.com:5432/postgres
```

> 💡 **Nota sobre contraseñas**: Si tu contraseña contiene caracteres especiales (como `@`, `#`, `%`, `?`), asegúrate de codificarlos en formato URL (URL-encode, p. ej. `@` → `%40`).

### 3. Variables de Entorno para Supabase (`.env`)

Configura las siguientes variables en tu `.env`:

```env
# URL de conexión a Supabase con asyncpg
DATABASE_URL=postgresql+asyncpg://postgres.your-ref:your-password@aws-0-us-east-1.pooler.supabase.com:6543/postgres

# Configuración del Pool de conexiones
DB_POOL_SIZE=5
DB_MAX_OVERFLOW=10
DB_POOL_RECYCLE=300

# Requerido en true para Supabase (activa contexto SSL seguro con asyncpg)
DB_SSL_REQUIRED=true
```

### 4. Creación y Migración Automática de Tablas
- Al iniciar la aplicación (`backend.main:app`), el evento `lifespan` ejecuta automáticamente `init_db()`, el cual sincroniza los modelos declarativos (`Base.metadata.create_all`) con Supabase.
- Verás creadas las tablas correspondientes (como `users`) directamente en el **Table Editor** o **SQL Editor** de Supabase.

### 5. Consideraciones sobre Row Level Security (RLS)
- El backend se conecta mediante el usuario `postgres`, el cual tiene permisos de superusuario / administrador en la base de datos y hace bypass de RLS por defecto.
- El control de acceso a nivel de aplicación está centralizado en el módulo de dominio y dependencias FastAPI mediante **Role-Based Access Control (RBAC)** (`RequireAdmin`, `RequireFieldOperator`, `RequirePublicEntity`, `RoleChecker`).

---

## 🚀 Inicio Rápido

### 1. Requisitos
- [uv](https://github.com/astral-sh/uv) (o Python 3.14+)

### 2. Configurar entorno
```bash
cp .env.example .env
# Edita .env con tus credenciales de Supabase o mantén SQLite para pruebas locales
```

### 3. Instalar dependencias
```bash
uv sync
```

### 4. Ejecutar el servidor de desarrollo
```bash
uv run uvicorn backend.main:app --reload --port 8000
```

### 5. Documentación Interactiva y OpenAPI
- **Swagger UI**: [http://localhost:8000/docs](http://localhost:8000/docs)
- **ReDoc**: [http://localhost:8000/redoc](http://localhost:8000/redoc)
- **OpenAPI JSON**: [http://localhost:8000/openapi.json](http://localhost:8000/openapi.json)

---

## 🧪 Pruebas Automatizadas

La suite de pruebas utiliza **SQLite asíncrono en memoria** (`sqlite+aiosqlite:///:memory:`), por lo que **no afecta ni depende de la conexión remota a Supabase**.

```bash
uv run pytest -v
```

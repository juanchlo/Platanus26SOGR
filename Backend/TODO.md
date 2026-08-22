1. Boilerplate de FastAPI y Configuración OpenAPI

    Estructura modular del proyecto:

        Configurar el entorno virtual y dependencias (fastapi, uvicorn, pydantic-settings, asyncpg, sqlmodel/sqlalchemy).

        Definir la arquitectura de carpetas (api/v1/, core/, models/, schemas/, services/, deps/).

    Gestión de variables de entorno:

        Implementar core/config.py con pydantic-settings para cargar variables (DATABASE_URL, JWT_SECRET_KEY, ALGORITHM, CORS_ORIGINS).

    Middlewares y ciclo de vida (Lifespan):

        Configurar CORSMiddleware para habilitar el consumo seguro desde Next.js.

        Implementar manejadores de excepciones globales (validaciones de Pydantic, errores HTTP personalizados y errores 500).

    Exposición y documentación OpenAPI:

        Personalizar metadatos de la API (title, version, description, tags_metadata) en la instancia de FastAPI.

        Verificar que la ruta /openapi.json y la interfaz /docs expongan los esquemas de forma estructurada para consumo de LLMs.

2. Autenticación y Control de Acceso Basado en Roles (RF-14)

    Definición de entidades y modelos:

        Crear el modelo de base de datos User con campos id, email, hashed_password, role e is_active.

        Definir el Enum para los roles: ADMIN_GUBERNAMENTAL, OPERADOR_CAMPO, ENTE_PUBLICO, CIVIL.

    Criptografía y manejo de tokens:

        Implementar funciones utilitarias en core/security.py para hashing de contraseñas (passlib con bcrypt) y generación/decodificación de JWT (python-jose o pyjwt).

    Dependencias de inyección (FastAPI Dependencies):

        Crear la dependencia get_current_user que extraiga y valide el Bearer Token del header Authorization.

        Crear una fábrica de dependencias RoleChecker(allowed_roles=[...]) que compare el rol del usuario autenticado contra los roles permitidos y lance un error HTTP 403 Forbidden si no cuenta con permisos.

    Endpoints de autenticación:

        POST /api/v1/auth/login: Validación de credenciales y retorno del access_token.

        GET /api/v1/auth/me: Retorno de los datos del usuario autenticado y su rol actual.

3. CRUD de Publicaciones Oficiales (RF-01)

    Esquemas de validación (Pydantic):

        Definir el Enum para las categorías: ALERTA, INFORMATIVO, INSTRUCTIVO, ACTUALIZACION_ESTADO.

        Crear los esquemas PostCreate, PostUpdate, PostResponse y PostFilter incluyendo campos: title, content, category, image_url y author_id.

    Capa de servicio y consultas a base de datos:

        Implementar la capa PostService con métodos asíncronos para create_post, get_post_by_id, list_posts (con paginación y filtros por categoría/fecha), update_post y delete_post.

    Endpoints de API protegidos por RBAC:

        GET /api/v1/posts: Lectura pública o filtrada de posts (acceso para todos los roles).

        GET /api/v1/posts/{id}: Detalle de publicación.

        POST /api/v1/posts: Creación restringida exclusivamente a roles autorizados (ENTE_PUBLICO, ADMIN_GUBERNAMENTAL).

        PUT/PATCH /api/v1/posts/{id}: Modificación restringida al autor del post o administradores.

        DELETE /api/v1/posts/{id}: Eliminación física o lógica (soft delete) restringida a administradores.

    Validación de contrato para Agentes IA:

        Asegurar descripciones (Field(description="...")) claras en cada parámetro de los esquemas Pydantic para garantizar que el agente de IA pueda invocar estos endpoints mediante Tool Calling sin ambigüedades.
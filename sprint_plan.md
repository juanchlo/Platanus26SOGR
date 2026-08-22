# Plan de Trabajo: Sistema Operativo de Gestión de Riesgo y Red de Emergencias

## Distribución del Equipo

Para estructurar el trabajo de forma paralela y evitar cuellos de botella, dividimos el equipo en especialidades técnicas:

*   **Backend 1 (Datos y Geoespacial):** Encargado de PostgreSQL, PostGIS, pgRouting y conexiones en tiempo real (WebSockets/SSE).
*   **Backend 2 (API y Agentes IA):** Encargado de la lógica de FastAPI, integración con LLMs, tareas asíncronas (Celery) y seguridad (RBAC).
*   **Frontend 1 (Visualización Avanzada):** Responsable del mapa interactivo con MapLibre y renderizado de alto rendimiento con Deck.gl.
*   **Frontend 2 (UX/UI y Aplicación):** Responsable de la estructura en Next.js, gestión de estado, formularios CRUD y notificaciones (FCM).

---

## Sprint 1: Cimientos, Seguridad y Contenido (Módulos 1 y 5)
**Objetivo:** Levantar la arquitectura base, asegurar las rutas y permitir la creación de la información oficial que alimentará el resto del sistema.

| Rol | Tareas Asignadas |
| :--- | :--- |
| **Backend 1** | Configurar Supabase/PostgreSQL. Crear esquemas iniciales, roles de base de datos y *triggers* para el historial inmutable (RF-15). |
| **Backend 2** | Levantar *boilerplate* de FastAPI con OpenAPI. Implementar autenticación RBAC (RF-14) y endpoints CRUD para Publicaciones Oficiales (RF-01). |
| **Frontend 1** | Configurar el repositorio Next.js. Implementar el lienzo base del mapa (MapLibre) sin datos dinámicos aún. |
| **Frontend 2** | Construir el *layout* principal, la pantalla de Login basada en roles y la interfaz de gestión (CRUD) para los posts oficiales. |

---

## Sprint 2: Georreferenciación y Reportes Civiles (Módulos 2 y 4)
**Objetivo:** Habilitar la captura de datos desde el terreno. Conectar frontend y backend para procesar coordenadas y mostrar los primeros datos espaciales.

| Rol | Tareas Asignadas |
| :--- | :--- |
| **Backend 1** | Configurar PostGIS. Crear lógica de geocodificación automática para asociar coordenadas a comunas/barrios (RF-11). |
| **Backend 2** | Desarrollar endpoints para el Registro de Necesidades (RF-10) y la Consulta Civil de solo lectura (RF-12). |
| **Frontend 1** | Integrar Deck.gl sobre el mapa base. Renderizar la capa de agrupamiento (*clustering*) de reportes activos según urgencia (RF-04). |
| **Frontend 2** | Construir el formulario de registro de necesidades y la vista civil de estados. Configurar *Service Workers* para notificaciones FCM (RF-02). |

---

## Sprint 3: Lógica de Red y Logística (Módulo 3)
**Objetivo:** Modelar la infraestructura y calcular las rutas óptimas (fase de mayor complejidad algorítmica).

| Rol | Tareas Asignadas |
| :--- | :--- |
| **Backend 1** | Implementar pgRouting. Estructurar el grafo logístico (RF-06) y desarrollar la consulta SQL/PostGIS para el enrutamiento óptimo (RF-07). |
| **Backend 2** | Crear API de infraestructura y stock. Programar la lógica de despachos, logística inversa (RF-09) y automatización del estado de reportes (RF-13). |
| **Frontend 1** | Añadir capas a Deck.gl para visualizar centros de acopio (RF-05) y renderizar las rutas óptimas sugeridas como arcos o líneas en el mapa. |
| **Frontend 2** | Desarrollar el panel de control logístico: tablas de inventario en tiempo real, asignación de despachos y gestión de excedentes. |

---

## Sprint 4: IA, Tiempo Real y Resiliencia (Transversal)
**Objetivo:** Inyectar la inteligencia artificial, activar los canales de tiempo real y asegurar la tolerancia a fallos.

| Rol | Tareas Asignadas |
| :--- | :--- |
| **Backend 1** | Habilitar WebSockets/SSE para emitir cambios de stock y alertas. Crear *cronjobs* en Celery para monitorear inactividad de nodos (RF-17). |
| **Backend 2** | Integrar Pydantic con LLMs para generar borradores de posts basados en contexto (RF-03). Programar detección de saturación logística (RF-08). |
| **Frontend 1** | Optimizar el rendimiento de Deck.gl al recibir ráfagas de datos por WebSockets. Asegurar transiciones fluidas en el mapa. |
| **Frontend 2** | Implementar alertas críticas (visuales/sonoras) en la UI (RF-16). Conectar la vista de borrador sugerido por IA para revisión humana. |

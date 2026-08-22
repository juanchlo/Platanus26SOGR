**Proyecto:** Sistema Operativo de Gestión de Riesgo y Red de Emergencias 

Sistema integral de despacho, logística crítica y gestión del riesgo para la administración municipal de Cali. La plataforma integra un agente orquestador central que procesa eventos en tiempo real para coordinar la asignación dinámica de recursos de socorro, optimizar rutas de atención considerando variables del entorno urbano y garantizar la trazabilidad de insumos estratégicos. Al unificar la información dispersa entre organismos de respuesta, el sistema reduce los tiempos de reacción y mitiga el impacto en vidas y pérdidas materiales en situaciones de crisis.

## Requisitos Funcionales
### Módulo 1: Gestión de Información, Contenido y Notificaciones

- **RF-01 (Publicaciones Oficiales):** El sistema debe permitir a los usuarios del ente público crear, leer, actualizar y eliminar (CRUD) posts oficiales que incluyan texto, imágenes y categorización (Alerta, Informativo, Instructivo, Actualización de estado).
- **RF-02 (Notificaciones Geodirigidas):** El sistema debe enviar notificaciones push automáticas a los dispositivos móviles de los civiles ubicados dentro o cerca del perímetro de una zona afectada al publicarse un post relevante.
- **RF-03 (Generación de Contenido por IA):** El sistema debe analizar reportes de necesidades, estado de recursos y posts previos para generar borradores sugeridos de posts oficiales (Ej: detección de desabastecimiento de agua para sugerir la apertura de un punto de recolección).

### Módulo 2: Georreferenciación, Visualización y Análisis de Datos

- **RF-04 (Panel de Control de Mapa):** El sistema debe renderizar un mapa interactivo para el ente público que visualice los reportes de necesidades activos mediante agrupación (_clustering_) por zonas, codificados por colores según urgencia y tipo.
- **RF-05 (Visualización de Infraestructura y Stock):** El mapa debe mostrar la ubicación exacta de centros de recursos, albergues y puntos de donación, detallando sus niveles de inventario en tiempo real.
- **RF-06 (Modelado de Red por Grafos):** El sistema debe estructurar los datos de logística como un grafo, donde los nodos representen centros o necesidades y las aristas representen la distancia física o el tiempo de viaje estimado.

### Módulo 3: Logística Avanzada, Rutas y Optimización

- **RF-07 (Enrutamiento Óptimo y Despacho):** El sistema debe calcular y sugerir rutas óptimas desde los centros de recursos hacia los puntos de necesidad, priorizando por nivel de urgencia, proximidad y compatibilidad del recurso (Ej: restringir ambulancias solo para emergencias médicas).
- **RF-08 (Gestión de Saturación de Recursos):** El sistema debe identificar automáticamente la saturación de un centro de recursos o nodo logístico y habilitar herramientas para el redireccionamiento asistido de insumos hacia nodos alternos.
- **RF-09 (Logística Inversa y Desmovilización):** El sistema debe permitir la planificación y registro del retorno de recursos excedentes, consumibles reutilizables, equipos y manejo estructurado de donaciones no solicitadas.

### Módulo 4: Gestión de Necesidades y Reportes Civiles

- **RF-10 (Registro de Necesidades Verificadas):** El sistema debe permitir al ente público registrar requerimientos validados especificando tipo (agua, alimento, medicina, refugio, rescate, atención médica), descripción, coordenadas de ubicación y nivel de urgencia.
- **RF-11 (Geocodificación Automática):** El sistema debe capturar la geolocalización de cada reporte para asociarlo automáticamente a un barrio o comuna específica de Cali.
- **RF-12 (Consulta Civil de Estados):** El sistema debe proveer una interfaz de solo lectura para los ciudadanos, permitiéndoles consultar el estado actual (_Pendiente, En Atención, Resuelto_) de las necesidades de su zona.
- **RF-13 (Automatización de Ciclo de Vida):** El sistema debe actualizar de forma automática el estado de un reporte de necesidad (Ej: pasar a "En Atención" o "Resuelto") al registrarse el despacho o la entrega del recurso asociado.

### Módulo 5: Seguridad, Trazabilidad y Resiliencia

- **RF-14 (Control de Acceso Basado en Roles - RBAC):** El sistema debe restringir las funcionalidades mediante roles definidos (Administrador Gubernamental, Operador de Campo, Ente Público, Civil) para garantizar la seguridad de la información.
- **RF-15 (Auditoría e Historial de Cambios):** El sistema debe registrar un historial inmutable (log) con sello de tiempo y usuario de la última modificación realizada en cada punto de control, centro o reporte.
- **RF-16 (Alertas Críticas de UI):** La interfaz de usuario debe desplegar alertas visuales y sonoras de alta prioridad inmediatamente ocurra un cambio crítico (Ej: desabastecimiento severo, alertas climáticas o fallas de comunicación).
- **RF-17 (Monitoreo de Actividad de Nodos):** El sistema debe emitir una alerta al centro de mando si un centro de recursos o nodo operativo no reporta actualizaciones de datos dentro de un umbral de tiempo crítico predefinido.

## 1. Capa Backend y Base de Datos (Python)

El backend debe estar diseñado para procesar lógica geográfica pesada y exponer sus herramientas al agente de forma automática.

- **FastAPI (Python):** Es el framework ideal porque es asíncrono y auto-genera documentación OpenAPI (Swagger). El agente de IA puede ingerir este archivo `openapi.json` para entender exactamente qué endpoints existen y usar _Function Calling_ para leer reportes o actualizar estados sin código adicional.
    
- **PostgreSQL (ej. vía Supabase):** Tu motor de base de datos principal, pero potenciado con tres extensiones clave:
    
    - **PostGIS:** Maneja la geocodificación (RF-11) y las consultas espaciales (ej. "encontrar civiles a 5km a la redonda para notificaciones" en RF-02).
        
    - **pgRouting:** Permite estructurar la red logística y calcular el enrutamiento óptimo (RF-07) y la logística inversa (RF-09) directamente a nivel de base de datos usando algoritmos como Dijkstra o A*.
        
    - **pgvector:** Almacena los posts y reportes como vectores para que el agente IA haga búsquedas semánticas y redacte borradores basados en contexto histórico (RF-03).
        
- **Celery + Redis (Message Broker):** Fundamental para tareas en segundo plano, como calcular la saturación de recursos (RF-08) y ejecutar cronjobs que monitoreen el _heartbeat_ de los nodos operativos para emitir alertas si dejan de reportar (RF-17).
    

## 2. Frontend y Visualización (Next.js)

El frontend debe manejar un alto volumen de datos espaciales sin congelar el navegador en situaciones críticas.

- **Next.js (App Router):** Permite renderizado en el servidor (SSR) para que la vista civil (RF-12) sea ultrarrápida y consuma pocos datos móviles.
    
- **Deck.gl + MapLibre GL JS:** En lugar de un mapa básico, **Deck.gl** es una suite de visualización de WebGL. Tiene capas nativas para hacer _clustering_ de miles de reportes (RF-04) y renderizar arcos/grafos logísticos sobre el mapa con un rendimiento excepcional (RF-06).
    
- **Firebase Cloud Messaging (FCM):** Integrado a través de _Service Workers_ en Next.js para despachar las notificaciones push (RF-02) a los civiles de forma confiable, incluso si tienen la PWA cerrada.
    

### 3. Capa de Inteligencia Artificial (Agent-Ready)

- **Pydantic + LLM APIs:** Para la generación de contenido (RF-03), debes forzar al modelo de IA a responder en esquemas estructurados de Pydantic. Esto garantiza que el borrador sugerido tenga el título, la categoría (Alerta, Informativo) y las coordenadas separadas, listas para inyectarse en el CRUD.
    
- **RBAC Integrado a la IA:** El agente debe recibir el token JWT del usuario que lo invoca. Si un "Operador de Campo" le pide datos, el agente solo debe poder consultar la información autorizada para ese rol (RF-14).
    

### 4. Tiempo Real y Trazabilidad

- **WebSockets / Server-Sent Events (SSE):** Conexiones bidireccionales directas (que puedes manejar con FastAPI o Supabase Realtime) para actualizar el stock en vivo (RF-05) y disparar las alertas críticas visuales/sonoras en el UI inmediatamente (RF-16).
    
- **Event Sourcing o Triggers DB:** Para el historial inmutable (RF-15), usa _triggers_ en PostgreSQL que guarden automáticamente una copia del registro en una tabla de auditoría (quién, cuándo y qué cambió) en cada operación CRUD, evitando que la lógica de aplicación falle en registrar un cambio.


## Organización de equipo
- Backend 1: Kta: Encargado de PostgreSQL, PostGIS, pgRouting y conexiones en tiempo real (WebSockets/SSE).
- Backend 2 Juan: Encargado de la lógica de FastAPI, integración con LLMs, tareas asíncronas (Celery) y seguridad (RBAC).

- Frontend 1: Sam: Responsable del mapa interactivo con MapLibre y renderizado de alto rendimiento con Deck.gl.
- Frontend 2: David: Responsable de la estructura en Next.js, gestión de estado, formularios CRUD y notificaciones (FCM).



# 🚨 PULSE — Plataforma de Unificación y Lógica de Seguridad en Emergencias

Cuando ocurre una emergencia (un deslizamiento, un incendio, una inundación), la información sobre qué falta y dónde está lo que sobra vive repartida entre WhatsApp, radios y planillas de Excel de decenas de organismos distintos. Esa desconexión cuesta tiempo — y en una emergencia, el tiempo cuesta vidas. **PULSE unifica esa información en un solo sistema operativo de gestión de riesgo**, construido para la administración municipal de Cali, Colombia.

## ¿Qué hace?

PULSE conecta tres cosas que hoy no se hablan entre sí: los **incidentes reportados en terreno**, el **inventario real de los nodos de ayuda** (albergues, centros de acopio, puestos de salud, puestos de mando) y las **necesidades de la comunidad**. Sobre esa base:

- 🧠 **Analiza testimonios con IA.** Un operador de campo describe la emergencia en texto o por voz (transcripción en vivo vía WebSocket) y un LLM extrae automáticamente tipo de incidente, urgencia, insumos requeridos y cantidades — sin formularios eternos en medio del caos.
- 🗺️ **Visualiza todo en un mapa en tiempo real.** Deck.gl + MapLibre renderizan nodos de ayuda, incidentes activos y celdas de responsabilidad (diagrama de Voronoi) sobre Cali, con animaciones de transporte que muestran los insumos viajando de un nodo a otro mientras se despachan.
- 🔀 **Despacha con un algoritmo greedy multi-nodo.** Cuando un insumo falta, PULSE no se limita al centro más cercano: reparte la cobertura entre varios nodos de apoyo ordenados por distancia (PostGIS) hasta cubrir la cantidad necesaria, con reservas atómicas en Redis para evitar condiciones de carrera entre despachos concurrentes.
- ✅ **Cierra el ciclo solo.** Un nodo afectado pasa a "Resuelto" automáticamente cuando el 100% de sus insumos fue entregado — nunca antes, ni con cobertura parcial — y una tarea programada en segundo plano garantiza esa transición aunque nadie esté mirando el mapa en ese momento.
- 📢 **Le habla directo al ciudadano.** La vista pública (sin necesidad de iniciar sesión) muestra qué insumos concretos hacen falta hoy en la ciudad y a qué punto de ayuda llevarlos — sin exponer nunca la ubicación exacta del evento ni a quién se está ayudando.
- 🔐 **Respeta quién es quién.** Cuatro roles (Administrador Gubernamental, Ente Público, Operador de Campo, Civil) con permisos distintos: desde levantar un nodo logístico hasta simplemente consultar el estado de tu comuna.

## Cómo está construido

- **Backend:** FastAPI (async) + PostgreSQL/PostGIS/pgRouting para toda la lógica geoespacial (distancias, celdas de Voronoi, rutas), Celery + Redis para cobertura asíncrona y tareas en segundo plano, y un servicio de IA (análisis de testimonios + transcripción de voz) integrado vía Pydantic para respuestas estructuradas.
- **Frontend:** Next.js (App Router) + Deck.gl/MapLibre para visualización geoespacial de alto rendimiento, con estado global en Zustand y RBAC aplicado en cada vista.

## Equipo — team-31

Juan Chacón, Samuel Federico Carlos Rodríguez, David Caicedo Samboni y Ktalyna García.

**Track:** 🚨 Emergencies

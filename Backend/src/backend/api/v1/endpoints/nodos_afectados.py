from datetime import datetime, timezone
import json
from typing import Sequence
import uuid

from fastapi import APIRouter, status
from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import AsyncSession

from backend.api.deps import DatabaseSession, RequireOperationalUser
from backend.core.config import settings
from backend.domain.utils.geo import calculate_centroid, calculate_distance_meters
from backend.infrastructure import cache
from backend.infrastructure.persistence.models.nodo_afectado import NodoAfectadoModel
from backend.schemas.nodo_afectado import (
    AlertaDesabastecimientoItem,
    NodoAfectadoCreate,
    NodoAfectadoDetalleResponse,
    NodoAfectadoResponse,
    PlanAyudaResponse,
    TriageActivoItem,
)

FUSION_DISTANCE_METERS = 100.0

router = APIRouter(prefix="/nodos-afectados", tags=["Nodos Afectados & Planificación de Ayuda (IA)"])

CACHE_KEY_TRIAGE = "cache:nodos-afectados:triage"


async def _find_nearby_nodos_afectados(
    db: AsyncSession, lat: float, lng: float, radius_m: float
) -> Sequence[NodoAfectadoModel]:
    """Find active nodos_afectados within radius_m meters of (lat, lng).

    Mismo patrón que _find_nearby_necesidades en incidentes.py (hallazgo R-03 de
    docs/PLAN_MASTER_OPTIMIZACION.md): en PostgreSQL usa ST_DWithin sobre el índice
    GiST de nodos_afectados.geom para acotar los candidatos por índice antes de
    hidratar filas ORM completas; en SQLite (tests) cae al filtro Python original.
    """
    bind = db.get_bind()
    if bind is not None and bind.dialect.name == "postgresql":
        nearby_ids_stmt = text(
            """
            SELECT id FROM nodos_afectados
            WHERE estado = 'activo'
              AND ST_DWithin(
                    geom::geography,
                    ST_SetSRID(ST_MakePoint(:lng, :lat), 4326)::geography,
                    :radio_m
                  )
            """
        )
        ids_res = await db.execute(nearby_ids_stmt, {"lat": lat, "lng": lng, "radio_m": radius_m})
        nearby_ids = [row[0] for row in ids_res.all()]
        if not nearby_ids:
            return []
        stmt = select(NodoAfectadoModel).where(NodoAfectadoModel.id.in_(nearby_ids))
        return (await db.execute(stmt)).scalars().all()

    active_stmt = select(NodoAfectadoModel).where(NodoAfectadoModel.estado == "activo")
    active_nodos = (await db.execute(active_stmt)).scalars().all()
    return [
        n
        for n in active_nodos
        if calculate_distance_meters(lat, lng, n.lat, n.lng) <= radius_m
    ]


async def _garantizar_despacho_nodo_afectado(db: AsyncSession, nodo: NodoAfectadoModel) -> None:
    bind = db.get_bind()
    is_postgres = bind is not None and bind.dialect.name == "postgresql"
    now_dt = datetime.now(timezone.utc)

    # Buscar insumos base del catálogo
    ins_res = await db.execute(text("SELECT id, nombre FROM insumos ORDER BY criticidad DESC LIMIT 2"))
    insumo_list = [(str(row[0]), row[1]) for row in ins_res.fetchall()]
    if not insumo_list:
        return

    # Buscar puntos de apoyo ordenados por distancia geográfica
    if is_postgres:
        puntos_res = await db.execute(
            text("""
                SELECT id, nombre, lat, lng,
                       ST_Distance(
                           ST_SetSRID(ST_MakePoint(lng, lat), 4326)::geography,
                           ST_SetSRID(ST_MakePoint(:lng, :lat), 4326)::geography
                       ) AS dist_m
                FROM puntos_control
                WHERE estado = 'activo'
                ORDER BY dist_m ASC
            """),
            {"lat": nodo.lat, "lng": nodo.lng},
        )
        puntos_ordenados = [{"id": str(r[0]), "nombre": r[1], "lat": r[2], "lng": r[3], "dist_m": r[4]} for r in puntos_res.fetchall()]
    else:
        puntos_res = await db.execute(
            text("SELECT id, nombre, lat, lng FROM puntos_control WHERE estado = 'activo'")
        )
        puntos_ordenados = [{"id": str(r[0]), "nombre": r[1], "lat": r[2], "lng": r[3]} for r in puntos_res.fetchall()]
        for p in puntos_ordenados:
            p["dist_m"] = calculate_distance_meters(nodo.lat, nodo.lng, p["lat"], p["lng"])
        puntos_ordenados.sort(key=lambda x: x.get("dist_m", 0))

    if not puntos_ordenados:
        return

    for insumo_id, insumo_nombre in insumo_list:
        cantidad_necesaria = 60
        sol_res = await db.execute(
            text("SELECT id FROM solicitudes_insumo WHERE nodo_afectado_id = :na_id AND insumo_id = :ins_id LIMIT 1"),
            {"na_id": str(nodo.id), "ins_id": insumo_id},
        )
        sol_row = sol_res.fetchone()
        if sol_row:
            solicitud_id = str(sol_row[0])
        else:
            sol_id_val = str(uuid.uuid4())
            await db.execute(
                text("""
                    INSERT INTO solicitudes_insumo
                        (id, nodo_afectado_id, insumo_id, cantidad_solicitada, cantidad_cubierta, urgencia, estado)
                    VALUES
                        (:sol_id, :na_id, :ins_id, :qty, 0, :urgencia, 'pendiente')
                """),
                {
                    "sol_id": sol_id_val,
                    "na_id": str(nodo.id),
                    "ins_id": insumo_id,
                    "qty": cantidad_necesaria,
                    "urgencia": nodo.severidad or 3,
                },
            )
            solicitud_id = sol_id_val

        await db.execute(
            text("DELETE FROM asignaciones_insumo WHERE solicitud_id = :sol_id AND estado IN ('pendiente', 'en_transito')"),
            {"sol_id": solicitud_id},
        )

        restante = cantidad_necesaria
        asignaciones_generadas = 0

        for punto in puntos_ordenados:
            if restante <= 0:
                break

            inv_res = await db.execute(
                text("SELECT cantidad_actual, nivel FROM inventario WHERE punto_id = :pid AND insumo_id = :iid LIMIT 1"),
                {"pid": punto["id"], "iid": insumo_id},
            )
            inv_row = inv_res.fetchone()
            if not inv_row:
                continue

            cant_disponible = inv_row[0] or 0
            nivel = inv_row[1] or "no_hay"
            if nivel == "no_hay" or cant_disponible <= 0:
                continue

            aporte = min(cant_disponible, restante)
            if aporte > 0:
                await db.execute(
                    text("""
                        INSERT INTO asignaciones_insumo
                            (id, solicitud_id, punto_apoyo_id, insumo_id, cantidad_asignada, estado, creado_en, actualizado_en)
                        VALUES
                            (:asig_id, :sol_id, :punto_id, :ins_id, :qty_asig, 'en_transito', :now, :now)
                    """),
                    {
                        "asig_id": str(uuid.uuid4()),
                        "sol_id": solicitud_id,
                        "punto_id": punto["id"],
                        "ins_id": insumo_id,
                        "qty_asig": aporte,
                        "now": now_dt,
                    },
                )
                restante -= aporte
                await db.execute(
                    text("""
                        UPDATE inventario
                        SET cantidad_actual = CASE
                                WHEN cantidad_actual - :cantidad < 0 THEN 0
                                ELSE cantidad_actual - :cantidad
                            END,
                            nivel = CASE
                                WHEN (CASE WHEN cantidad_actual - :cantidad < 0 THEN 0 ELSE cantidad_actual - :cantidad END) = 0 THEN 'no_hay'
                                WHEN (CASE WHEN cantidad_actual - :cantidad < 0 THEN 0 ELSE cantidad_actual - :cantidad END) < COALESCE(cantidad_necesaria, 100) * 0.3 THEN 'poco'
                                WHEN (CASE WHEN cantidad_actual - :cantidad < 0 THEN 0 ELSE cantidad_actual - :cantidad END) < COALESCE(cantidad_necesaria, 100) * 0.8 THEN 'bien'
                                ELSE 'sobra'
                            END,
                            actualizado_en = :now
                        WHERE punto_id = :pid AND insumo_id = :iid
                    """),
                    {"pid": punto["id"], "iid": insumo_id, "cantidad": aporte, "now": now_dt},
                )

    await db.commit()


@router.post(
    "",
    response_model=NodoAfectadoResponse,
    status_code=status.HTTP_201_CREATED,
    summary="Report Affected Node",
    description="Allows OPERADOR_CAMPO, ADMIN_GUBERNAMENTAL or ENTE_PUBLICO to report a new emergency. Merges automatically if within 100m of an existing active affected node.",
)
async def create_nodo_afectado(
    payload: NodoAfectadoCreate,
    current_user: RequireOperationalUser,
    db: DatabaseSession,
) -> NodoAfectadoResponse:
    """Create or fuse a nodo_afectado within 100 meters; barrio/geom quedan a cargo del trigger de la DB."""
    # 1. Search for existing active affected nodes within 100m (vía PostGIS, ver
    # _find_nearby_nodos_afectados / hallazgo R-03).
    nearby_nodos = await _find_nearby_nodos_afectados(
        db, payload.lat, payload.lng, FUSION_DISTANCE_METERS
    )

    now_utc = datetime.now(timezone.utc)

    if not nearby_nodos:
        nodo = NodoAfectadoModel(
            titulo=payload.titulo,
            descripcion=payload.descripcion,
            necesidad=payload.necesidad,
            lat=payload.lat,
            lng=payload.lng,
            severidad=payload.severidad,
            personas_afectadas=payload.personas_afectadas,
            creado_por=current_user.id,
            creado_en=now_utc,
            actualizado_en=now_utc,
        )
        db.add(nodo)
        await db.commit()
        await db.refresh(nodo)
        await cache.delete(CACHE_KEY_TRIAGE)
        await _garantizar_despacho_nodo_afectado(db, nodo)
        return NodoAfectadoResponse.model_validate(nodo)

    # 3. FUSION: Merge all nearby affected nodes and new payload into single consolidated node
    primary_nodo = min(
        nearby_nodos,
        key=lambda n: calculate_distance_meters(payload.lat, payload.lng, n.lat, n.lng),
    )
    secondary_nodos = [n for n in nearby_nodos if n.id != primary_nodo.id]

    # Calculate cluster centroid
    all_coords = [(n.lat, n.lng) for n in nearby_nodos] + [(payload.lat, payload.lng)]
    c_lat, c_lng = calculate_centroid(all_coords)

    # Consolidate values
    total_personas = (
        (primary_nodo.personas_afectadas or 0)
        + sum((s.personas_afectadas or 0) for s in secondary_nodos)
        + (payload.personas_afectadas or 0)
    )
    max_severidad = max(
        [primary_nodo.severidad or 1]
        + [s.severidad or 1 for s in secondary_nodos]
        + [payload.severidad or 1]
    )

    # Merge descriptions & needs
    descripciones = [primary_nodo.descripcion] + [
        s.descripcion for s in secondary_nodos if s.descripcion
    ]
    if payload.descripcion and payload.descripcion not in descripciones:
        descripciones.append(payload.descripcion)

    necesidades = [primary_nodo.necesidad] + [
        s.necesidad for s in secondary_nodos if s.necesidad
    ]
    if payload.necesidad and payload.necesidad not in necesidades:
        necesidades.append(payload.necesidad)

    primary_nodo.lat = c_lat
    primary_nodo.lng = c_lng
    primary_nodo.personas_afectadas = total_personas
    primary_nodo.severidad = max_severidad
    primary_nodo.descripcion = " | ".join(dict.fromkeys(descripciones))
    primary_nodo.necesidad = ", ".join(dict.fromkeys(necesidades))
    primary_nodo.actualizado_en = now_utc

    # Remove secondary duplicate nodes
    for s in secondary_nodos:
        await db.delete(s)

    await db.commit()
    await db.refresh(primary_nodo)
    await cache.delete(CACHE_KEY_TRIAGE)
    return NodoAfectadoResponse.model_validate(primary_nodo)


@router.get(
    "",
    response_model=list[TriageActivoItem],
    status_code=status.HTTP_200_OK,
    summary="List Active Emergencies by Triage Priority",
    description=(
        "Returns all active nodos_afectados ordered by priority score, vía "
        "tool_triage_activo(). Cacheado en Redis con TTL corto "
        "(CACHE_TTL_NODOS_AFECTADOS_TRIAGE) -- se invalida al reportar/fusionar una emergencia."
    ),
)
async def list_nodos_afectados(db: DatabaseSession) -> Sequence[TriageActivoItem]:
    """List active emergencies ordered by triage score, cache-aside sobre Redis."""

    async def compute() -> list:
        result = await db.execute(text("SELECT tool_triage_activo()"))
        raw_json = result.scalar_one_or_none() or "[]"
        return json.loads(raw_json) if isinstance(raw_json, str) else raw_json

    data = await cache.get_or_set_json(
        CACHE_KEY_TRIAGE, settings.CACHE_TTL_NODOS_AFECTADOS_TRIAGE, compute
    )
    return [TriageActivoItem.model_validate(item) for item in data]


@router.get(
    "/alertas-desabastecimiento",
    response_model=list[AlertaDesabastecimientoItem],
    status_code=status.HTTP_200_OK,
    summary="List Unmet-Need Alerts (for the public Civil view)",
    description=(
        "Insumos cuyo déficit actual supera el stock total sumado de todos los Nodos de "
        "Ayuda activos: ningún despacho posible hoy alcanza a cubrirlos. Cubre DOS fuentes: "
        "(1) necesidades ya despachadas ('en_atencion'), con déficit real medido en "
        "solicitudes_insumo, y (2) necesidades aún 'pendiente' (nunca pasaron por el "
        "operador), estimadas con el análisis de la IA (recursos_solicitados) -- sin esto "
        "último, una emergencia recién reportada con un déficit obvio (p.ej. 5000L de agua "
        "para un incendio, con la ciudad entera sin ese stock) no generaba ninguna alerta "
        "hasta que alguien la despachara manualmente. NO expone el Nodo Afectado (evento/"
        "ubicación del desastre) -- solo el insumo faltante y el punto de entrega (Nodo de "
        "Ayuda activo más cercano al evento). Declarado ANTES de /{id} en el router para "
        "que no colisione con el path param."
    ),
)
async def list_alertas_desabastecimiento(db: DatabaseSession) -> Sequence[AlertaDesabastecimientoItem]:
    """El "dónde llevarlo" para el civil es siempre el punto_control activo más cercano
    al Nodo Afectado / necesidad (no al civil): se calcula en Python con
    calculate_distance_meters -- mismo patrón que _garantizar_despacho_nodo_afectado/
    _garantizar_despacho_en_atencion -- para no depender de PostGIS y así funcionar igual
    en Postgres y en SQLite (tests). El match insumo estimado→catálogo también reusa el
    mismo criterio "nombre del catálogo contiene el nombre pedido" que ya usan esos
    helpers de despacho, para no divergir de qué cuenta como "el mismo insumo".

    Orden base: más antiguo primero (creado_en ASC), fallback "orden de llegada" cuando
    el cliente no tiene GPS del civil. El frontend reordena por distancia (al punto de
    entrega, que es la ubicación accionable) cuando sí lo tiene."""
    # Stock activo agregado por insumo (subquery correlacionada, no requiere PostGIS):
    # única fuente de verdad de "cuánto hay hoy en toda la red", reusada por las dos
    # fuentes de déficit de abajo.
    stock_res = await db.execute(
        text("""
            SELECT ins.id, ins.nombre, ins.unidad,
                   COALESCE((
                       SELECT SUM(inv.cantidad_actual)
                       FROM inventario inv
                       JOIN puntos_control pc ON pc.id = inv.punto_id
                       WHERE pc.estado = 'activo' AND inv.insumo_id = ins.id
                   ), 0) AS stock_disponible
            FROM insumos ins
        """)
    )
    catalogo = [(str(r.id), r.nombre, r.unidad, int(r.stock_disponible or 0)) for r in stock_res.fetchall()]
    if not catalogo:
        return []
    stock_por_insumo_id = {c[0]: c[3] for c in catalogo}

    def _match_insumo(nombre_pedido: str) -> tuple[str, str, str, int] | None:
        """Mismo criterio que usan los helpers de despacho: el nombre del catálogo
        CONTIENE el nombre pedido (equivalente a `LOWER(nombre) LIKE LOWER('%pedido%')`)."""
        pedido_low = nombre_pedido.strip().lower()
        for c in catalogo:
            if pedido_low and pedido_low in c[1].lower():
                return c
        return None

    puntos_res = await db.execute(
        text("SELECT nombre, direccion, tipo, lat, lng FROM puntos_control WHERE estado = 'activo'")
    )
    puntos_activos = puntos_res.fetchall()
    if not puntos_activos:
        return []

    def _punto_mas_cercano(lat: float, lng: float):
        return min(puntos_activos, key=lambda p: calculate_distance_meters(lat, lng, p[3], p[4]))

    # Acumulador: (creado_en, insumo_nombre, unidad, deficit, lat, lng) por cada
    # déficit detectado, de cualquiera de las dos fuentes.
    hallazgos: list[tuple] = []

    # Fuente 1: necesidades ya despachadas -- déficit real (asignado vs. cubierto)
    # comparado contra el stock activo agregado.
    despachadas_res = await db.execute(
        text("""
            SELECT
                na.lat, na.lng, na.creado_en,
                ins.id AS insumo_id, ins.nombre AS insumo_nombre, ins.unidad,
                (si.cantidad_solicitada - si.cantidad_cubierta) AS deficit
            FROM solicitudes_insumo si
            JOIN nodos_afectados na ON na.id = si.nodo_afectado_id
            JOIN insumos ins ON ins.id = si.insumo_id
            WHERE na.estado != 'resuelto'
              AND si.estado != 'cubierta'
        """)
    )
    for d in despachadas_res.fetchall():
        stock = stock_por_insumo_id.get(str(d.insumo_id), 0)
        if d.deficit > stock:
            hallazgos.append((d.creado_en, d.insumo_nombre, d.unidad, int(d.deficit), d.lat, d.lng))

    # Fuente 2: necesidades aún 'pendiente' (ningún operador las despachó todavía) --
    # estimadas con el análisis de la IA (recursos_solicitados), asumiendo 0 cubierto.
    pendientes_res = await db.execute(
        text("""
            SELECT lat, lng, creado_en, recursos_solicitados
            FROM necesidades
            WHERE estado = 'pendiente'
              AND recursos_solicitados IS NOT NULL
              AND recursos_solicitados NOT IN ('', '[]')
        """)
    )
    for n in pendientes_res.fetchall():
        try:
            recursos = json.loads(n.recursos_solicitados)
        except (TypeError, ValueError):
            continue
        for r in recursos or []:
            nombre_pedido = str(r.get("insumo_nombre") or "").strip()
            cantidad = r.get("cantidad_estimada")
            if not nombre_pedido or not isinstance(cantidad, (int, float)) or cantidad <= 0:
                continue
            match = _match_insumo(nombre_pedido)
            if not match:
                continue  # sin equivalente en el catálogo real: no se puede comparar contra stock
            _, insumo_nombre, unidad_catalogo, stock = match
            cantidad = int(cantidad)
            if cantidad > stock:
                unidad = str(r.get("unidad") or unidad_catalogo or "unidades")
                hallazgos.append((n.creado_en, insumo_nombre, unidad, cantidad - stock, n.lat, n.lng))

    if not hallazgos:
        return []

    hallazgos.sort(key=lambda h: h[0] or datetime.min.replace(tzinfo=timezone.utc))

    items: list[AlertaDesabastecimientoItem] = []
    for creado_en, insumo_nombre, unidad, deficit, lat, lng in hallazgos:
        punto_cercano = _punto_mas_cercano(lat, lng)
        items.append(
            AlertaDesabastecimientoItem(
                insumo_nombre=insumo_nombre,
                unidad=unidad,
                deficit=deficit,
                punto_entrega_nombre=punto_cercano[0],
                punto_entrega_direccion=punto_cercano[1],
                punto_entrega_tipo=punto_cercano[2],
                punto_entrega_lat=punto_cercano[3],
                punto_entrega_lng=punto_cercano[4],
                creado_en=creado_en,
            )
        )
    return items


@router.get(
    "/{id}",
    response_model=NodoAfectadoDetalleResponse,
    status_code=status.HTTP_200_OK,
    summary="Get Affected Node Detail (incluye el plan guardado al crearse)",
    description=(
        "Devuelve el nodo_afectado completo, incluyendo nodos_ayuda_asignados y "
        "plan_respuesta -- la foto fija que generó el trigger de Postgres al insertarse "
        "(Backend/supabase/plan_respuesta_nodo_afectado.sql), distinta del plan en vivo "
        "de /{id}/plan."
    ),
)
async def get_nodo_afectado(id: uuid.UUID, db: DatabaseSession) -> NodoAfectadoDetalleResponse:
    """Fetch one nodo_afectado by id, incluyendo el plan guardado por el trigger."""
    result = await db.execute(
        text(
            """
            SELECT id, titulo, descripcion, necesidad, lat, lng, severidad,
                   personas_afectadas, estado, barrio, creado_por, creado_en,
                   actualizado_en, nodos_ayuda_asignados, plan_respuesta
            FROM nodos_afectados
            WHERE id = :id
            """
        ),
        {"id": str(id)},
    )
    row = result.mappings().one_or_none()
    if row is None:
        raise NotFoundException(f"nodo_afectado con ID {id} no encontrado.")

    data = dict(row)
    if isinstance(data.get("nodos_ayuda_asignados"), str):
        data["nodos_ayuda_asignados"] = json.loads(data["nodos_ayuda_asignados"])
    return NodoAfectadoDetalleResponse.model_validate(data)


@router.get(
    "/{id}/plan",
    response_model=PlanAyudaResponse,
    status_code=status.HTTP_200_OK,
    summary="Get Response Plan for an Affected Node",
    description="Corre la cascada greedy de asignación (asignar_ayuda, radio fijo 10km) para un nodo_afectado.",
)
async def get_plan_nodo_afectado(id: uuid.UUID, db: DatabaseSession) -> PlanAyudaResponse:
    """Get the greedy assignment plan for a nodo_afectado. Nunca lanza 404: asignar_ayuda() ya
    devuelve {"error": "..."} si el id no existe, en vez de fallar."""
    result = await db.execute(
        text("SELECT asignar_ayuda(:id, :radio)"),
        {"id": str(id), "radio": 10.0},
    )
    raw_json = result.scalar_one()
    data = json.loads(raw_json) if isinstance(raw_json, str) else raw_json
    return PlanAyudaResponse.model_validate(data)

from typing import Literal
import uuid
from pydantic import BaseModel, Field, ConfigDict

CategoriaInsumo = Literal[
    'agua',
    'alimentos',
    'aseo',
    'abrigo',
    'seguridad',
    'salud',
    'bebe',
    'mascotas',
]

class InsumoCreate(BaseModel):
    nombre: str = Field(..., min_length=2, max_length=200, description="Nombre del nuevo recurso/insumo.")
    categoria: CategoriaInsumo | None = Field(None, description="Categoría permitida por base de datos.")
    unidad: str | None = Field(None, description="Unidad de medida: litros, kg, raciones, unidades, kits, pares, paquetes, sobres")
    criticidad: int | None = Field(None, ge=1, le=5, description="Nivel de criticidad 1-5")

class InsumoCreateResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: uuid.UUID
    nombre: str
    categoria: str | None = None
    unidad: str | None = None
    criticidad: int | None = None
    es_nuevo: bool = True
    recurso_equivalente: str | None = None

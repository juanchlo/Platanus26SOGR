"""Pydantic schemas for the AI coordination agent endpoint."""

from pydantic import BaseModel, Field


class AgenteConsultaRequest(BaseModel):
    """Schema for a natural-language query submitted to the agent."""

    consulta: str = Field(..., min_length=3, description="Consulta en lenguaje natural del operador (ej. '¿Cuál emergencia atiendo primero?').")


class AgenteConsultaResponse(BaseModel):
    """Schema for the agent's response, plan and the tools it used to build it."""

    respuesta: str
    tools_usadas: list[str]

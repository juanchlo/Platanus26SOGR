"""Common generic response and error schemas."""

from typing import Any, Generic, TypeVar
from pydantic import BaseModel, ConfigDict, Field

T = TypeVar("T")


class MessageResponse(BaseModel):
    """Standard message response for simple operations."""

    message: str = Field(..., description="Human-readable informational message.")
    success: bool = Field(default=True, description="Indicates whether the operation succeeded.")


class ErrorDetail(BaseModel):
    """Detailed error representation for validation or domain errors."""

    field: str | None = Field(default=None, description="Path or name of the field that caused the error.")
    message: str = Field(..., description="Explanation of why the error occurred.")
    type: str | None = Field(default=None, description="Error type identifier.")


class ErrorBody(BaseModel):
    """Standardized error payload wrapper."""

    code: str = Field(..., description="Standardized error code (e.g. UNAUTHORIZED, NOT_FOUND).")
    message: str = Field(..., description="Human-readable error description.")
    details: Any | None = Field(default=None, description="Optional granular error details or validation list.")


class ErrorResponse(BaseModel):
    """Global API error envelope."""

    success: bool = Field(default=False, description="Always false in error responses.")
    error: ErrorBody = Field(..., description="Error payload details.")


class GenericResponse(BaseModel, Generic[T]):
    """Generic payload response envelope."""

    model_config = ConfigDict(from_attributes=True)

    success: bool = Field(default=True, description="Indicates whether the operation succeeded.")
    data: T = Field(..., description="The main response data payload.")

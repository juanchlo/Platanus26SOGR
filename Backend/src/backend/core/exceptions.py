"""Pure domain exception classes. No framework dependencies — safe for domain layer imports."""

from typing import Any


class AppException(Exception):
    """Base application exception."""

    def __init__(
        self,
        message: str,
        status_code: int = 400,
        code: str = "BAD_REQUEST",
        details: Any = None,
    ):
        super().__init__(message)
        self.message = message
        self.status_code = status_code
        self.code = code
        self.details = details


class NotFoundException(AppException):
    """Resource not found exception (HTTP 404)."""

    def __init__(self, message: str = "Resource not found", details: Any = None):
        super().__init__(
            message=message,
            status_code=404,
            code="NOT_FOUND",
            details=details,
        )


class UnauthorizedException(AppException):
    """Authentication required or invalid exception (HTTP 401)."""

    def __init__(self, message: str = "Could not validate credentials", details: Any = None):
        super().__init__(
            message=message,
            status_code=401,
            code="UNAUTHORIZED",
            details=details,
        )


class ForbiddenException(AppException):
    """Insufficient permissions exception (HTTP 403)."""

    def __init__(self, message: str = "Operation not permitted", details: Any = None):
        super().__init__(
            message=message,
            status_code=403,
            code="FORBIDDEN",
            details=details,
        )


class BadRequestException(AppException):
    """Bad request parameters exception (HTTP 400)."""

    def __init__(self, message: str = "Invalid request payload or parameters", details: Any = None):
        super().__init__(
            message=message,
            status_code=400,
            code="BAD_REQUEST",
            details=details,
        )


class ConflictException(AppException):
    """Conflict with existing resource exception (HTTP 409)."""

    def __init__(self, message: str = "Resource already exists", details: Any = None):
        super().__init__(
            message=message,
            status_code=409,
            code="CONFLICT",
            details=details,
        )

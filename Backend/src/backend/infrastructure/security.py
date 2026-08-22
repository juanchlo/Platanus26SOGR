"""Security adapters implementing cryptographic operations: Bcrypt and PyJWT."""

from datetime import datetime, timedelta, timezone
from typing import Any
import bcrypt
import jwt

from backend.core.config import settings
from backend.domain.ports.security_service import PasswordHasher, TokenService


class BcryptPasswordHasher(PasswordHasher):
    """Bcrypt password hashing adapter."""

    def hash_password(self, password: str) -> str:
        """Hash password using bcrypt."""
        salt = bcrypt.gensalt()
        hashed = bcrypt.hashpw(password.encode("utf-8"), salt)
        return hashed.decode("utf-8")

    def verify_password(self, plain_password: str, hashed_password: str) -> bool:
        """Verify plain password against bcrypt hash."""
        try:
            return bcrypt.checkpw(
                plain_password.encode("utf-8"),
                hashed_password.encode("utf-8"),
            )
        except Exception:
            return False


class JWTTokenService(TokenService):
    """PyJWT token generation and validation adapter."""

    def __init__(
        self,
        secret_key: str = settings.JWT_SECRET_KEY,
        algorithm: str = settings.ALGORITHM,
        expire_minutes: int = settings.ACCESS_TOKEN_EXPIRE_MINUTES,
    ) -> None:
        self.secret_key = secret_key
        self.algorithm = algorithm
        self.expire_minutes = expire_minutes

    def create_token(
        self,
        subject: str,
        role: str,
        extra_claims: dict[str, Any] | None = None,
        expires_delta: timedelta | None = None,
    ) -> str:
        """Generate a signed JWT access token."""
        now = datetime.now(timezone.utc)
        expire = now + (expires_delta or timedelta(minutes=self.expire_minutes))

        payload: dict[str, Any] = {
            "sub": str(subject),
            "role": role,
            "iat": int(now.timestamp()),
            "exp": int(expire.timestamp()),
        }

        if extra_claims:
            payload.update(extra_claims)

        return jwt.encode(payload, self.secret_key, algorithm=self.algorithm)

    def decode_token(self, token: str) -> dict[str, Any]:
        """Decode and validate a signed JWT access token."""
        return jwt.decode(
            token,
            self.secret_key,
            algorithms=[self.algorithm],
        )


# Default singleton instances for dependency injection
password_hasher = BcryptPasswordHasher()
token_service = JWTTokenService()

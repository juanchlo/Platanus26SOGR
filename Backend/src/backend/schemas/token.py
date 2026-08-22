"""Authentication token schemas."""

from pydantic import BaseModel, Field


class Token(BaseModel):
    """Bearer access token response schema."""

    access_token: str = Field(..., description="JWT Bearer access token string.")
    token_type: str = Field(default="bearer", description="Token type, typically 'bearer'.")
    expires_in: int = Field(..., description="Validity period in seconds.")


class TokenPayload(BaseModel):
    """Decoded JWT payload data schema."""

    sub: str | None = Field(default=None, description="Subject identifier (User UUID string).")
    role: str | None = Field(default=None, description="User role associated with the token.")
    exp: int | None = Field(default=None, description="Token expiration timestamp in UNIX epoch seconds.")
    iat: int | None = Field(default=None, description="Token issued-at timestamp in UNIX epoch seconds.")

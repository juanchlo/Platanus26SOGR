"""Pydantic schemas for user operations and authentication."""

from datetime import datetime
import uuid
from pydantic import BaseModel, ConfigDict, EmailStr, Field

from backend.domain.entities.user import UserRole


class UserBase(BaseModel):
    """Base schema attributes shared by user representations."""

    email: EmailStr = Field(..., description="Unique email address of the user.", examples=["usuario@ejemplo.com"])
    role: UserRole = Field(default=UserRole.CIVIL, description="Assigned role for permissions control.")
    is_active: bool = Field(default=True, description="Indicates if the user account is active.")


class UserCreate(BaseModel):
    """Schema for registering a new user."""

    email: EmailStr = Field(..., description="Email address for the new account.", examples=["nuevo.usuario@ejemplo.com"])
    password: str = Field(..., min_length=6, description="Plaintext password (minimum 6 characters).", examples=["secreto123"])
    role: UserRole = Field(default=UserRole.CIVIL, description="User role to assign (defaults to CIVIL).")


class UserLogin(BaseModel):
    """Schema for user authentication request."""

    email: EmailStr = Field(..., description="Registered user email address.", examples=["usuario@ejemplo.com"])
    password: str = Field(..., description="Plaintext account password.", examples=["secreto123"])


class UserResponse(BaseModel):
    """Schema representing public user profile information."""

    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID = Field(..., description="Unique identifier (UUID) of the user.")
    email: EmailStr = Field(..., description="Email address of the user.")
    role: UserRole = Field(..., description="Assigned role of the user.")
    is_active: bool = Field(..., description="Active status of the user account.")
    created_at: datetime = Field(..., description="Account creation timestamp in UTC.")
    updated_at: datetime = Field(..., description="Account last update timestamp in UTC.")


class UserUpdate(BaseModel):
    """Schema for updating user details."""

    email: EmailStr | None = Field(default=None, description="Updated email address.")
    password: str | None = Field(default=None, min_length=6, description="Updated plaintext password.")
    role: UserRole | None = Field(default=None, description="Updated user role.")
    is_active: bool | None = Field(default=None, description="Updated account active status.")

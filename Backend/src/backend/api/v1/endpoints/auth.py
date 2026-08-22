"""Authentication endpoints driving adapter using domain AuthService and TokenService."""

from datetime import timedelta
from typing import Annotated
from fastapi import APIRouter, Depends, status
from fastapi.security import OAuth2PasswordRequestForm

from backend.api.deps import AuthServiceDep, CurrentUser, TokenServiceDep
from backend.core.config import settings
from backend.schemas.token import Token
from backend.schemas.user import UserCreate, UserLogin, UserResponse

router = APIRouter(prefix="/auth", tags=["Authentication & RBAC"])


@router.post(
    "/login",
    response_model=Token,
    summary="Authenticate User and Get Token",
    description="Authenticates user credentials and returns a JWT Bearer access token containing subject ID and role claims.",
    status_code=status.HTTP_200_OK,
)
async def login(
    credentials: UserLogin,
    auth_service: AuthServiceDep,
    token_service: TokenServiceDep,
) -> Token:
    """Validate credentials and issue JWT token."""
    user = await auth_service.authenticate_user(
        email=credentials.email,
        plain_password=credentials.password,
    )
    expires_minutes = settings.ACCESS_TOKEN_EXPIRE_MINUTES
    access_token = token_service.create_token(
        subject=str(user.id),
        role=user.role.value,
        extra_claims={"email": user.email},
        expires_delta=timedelta(minutes=expires_minutes),
    )
    return Token(
        access_token=access_token,
        token_type="bearer",
        expires_in=expires_minutes * 60,
    )


@router.post(
    "/login/oauth",
    response_model=Token,
    summary="OAuth2 Compatible Form Login",
    description="OAuth2 password form login endpoint for Swagger UI /docs interactive authentication.",
    status_code=status.HTTP_200_OK,
    include_in_schema=False,
)
async def login_oauth(
    form_data: Annotated[OAuth2PasswordRequestForm, Depends()],
    auth_service: AuthServiceDep,
    token_service: TokenServiceDep,
) -> Token:
    """OAuth2 password form login handler for Swagger UI."""
    user = await auth_service.authenticate_user(
        email=form_data.username,
        plain_password=form_data.password,
    )
    expires_minutes = settings.ACCESS_TOKEN_EXPIRE_MINUTES
    access_token = token_service.create_token(
        subject=str(user.id),
        role=user.role.value,
        extra_claims={"email": user.email},
        expires_delta=timedelta(minutes=expires_minutes),
    )
    return Token(
        access_token=access_token,
        token_type="bearer",
        expires_in=expires_minutes * 60,
    )


@router.post(
    "/register",
    response_model=UserResponse,
    status_code=status.HTTP_201_CREATED,
    summary="Register New User",
    description="Registers a new user account with unique email, hashed password, and assigned role.",
)
async def register(
    user_in: UserCreate,
    auth_service: AuthServiceDep,
) -> UserResponse:
    """Create a new user account in the system."""
    user = await auth_service.register_user(
        email=user_in.email,
        plain_password=user_in.password,
        role=user_in.role,
    )
    return UserResponse.model_validate(user)


@router.get(
    "/me",
    response_model=UserResponse,
    status_code=status.HTTP_200_OK,
    summary="Get Authenticated User Profile",
    description="Retrieves profile data and assigned RBAC role of the currently authenticated domain user.",
)
async def get_me(
    current_user: CurrentUser,
) -> UserResponse:
    """Return the profile of the currently logged-in user."""
    return UserResponse.model_validate(current_user)

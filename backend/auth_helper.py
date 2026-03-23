"""
Supabase Authentication Helper
Validates JWT tokens from Supabase Auth using JWKS (asymmetric keys)
with fallback to legacy HS256 shared secret for backward compatibility.
"""
import os
import logging
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional, Dict, Any, Tuple

import jwt as pyjwt
from dotenv import load_dotenv
from jwt import PyJWKClient, PyJWKClientError
from fastapi import HTTPException, Depends
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from database import db

logger = logging.getLogger(__name__)

ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / '.env')

_jwks_clients: Dict[str, PyJWKClient] = {}

# Supported Supabase signing algorithms.
# HS256 is used by legacy shared-secret projects; asymmetric tokens use JWKS.
_ASYMMETRIC_ALGORITHMS = {"RS256", "ES256", "EdDSA"}
_SUPPORTED_ALGORITHMS = _ASYMMETRIC_ALGORITHMS | {"HS256"}

# Security
security = HTTPBearer()


def _auth_error_detail(base: str, reason: Optional[str]) -> str:
    """Include temporary auth diagnostics in HTTP errors when enabled."""
    include_reason = os.environ.get("AUTH_DEBUG_ERRORS", "true").lower() == "true"
    if include_reason and reason:
        return f"{base} | reason={reason}"
    return base


def _get_auth_settings() -> Dict[str, str]:
    supabase_url = os.environ.get('SUPABASE_URL', '').rstrip('/')
    jwt_secret = os.environ.get('SUPABASE_JWT_SECRET', '')
    issuer = os.environ.get('SUPABASE_JWT_ISSUER', '') or (
        f"{supabase_url}/auth/v1" if supabase_url else ''
    )
    audience = os.environ.get('SUPABASE_JWT_AUDIENCE', 'authenticated')
    jwks_url = f"{supabase_url}/auth/v1/.well-known/jwks.json" if supabase_url else ''

    return {
        "supabase_url": supabase_url,
        "jwt_secret": jwt_secret,
        "issuer": issuer,
        "audience": audience,
        "jwks_url": jwks_url,
    }


def _get_jwks_client(jwks_url: str) -> Optional[PyJWKClient]:
    if not jwks_url:
        return None

    cached_client = _jwks_clients.get(jwks_url)
    if cached_client:
        return cached_client

    try:
        client = PyJWKClient(jwks_url, cache_keys=True, lifespan=600)
        _jwks_clients[jwks_url] = client
        logger.info("Supabase JWKS client initialized for %s", jwks_url)
        return client
    except Exception:
        logger.exception("Failed to initialize Supabase JWKS client for %s", jwks_url)
        return None


def _log_token_diagnostics(token: str, stage: str, **extra: Any) -> None:
    token_hint = f"{token[:12]}..." if token else "<empty>"

    try:
        header = pyjwt.get_unverified_header(token)
    except Exception as exc:
        header = {"parse_error": str(exc)}

    try:
        claims = pyjwt.decode(
            token,
            options={
                "verify_signature": False,
                "verify_exp": False,
                "verify_nbf": False,
                "verify_iat": False,
                "verify_aud": False,
                "verify_iss": False,
            },
            algorithms=list(_SUPPORTED_ALGORITHMS),
        )
    except Exception as exc:
        claims = {"parse_error": str(exc)}

    logger.warning(
        "Supabase token validation failed at %s | token=%s | alg=%s | kid=%s | iss=%s | aud=%s | sub=%s | extra=%s",
        stage,
        token_hint,
        header.get("alg"),
        header.get("kid"),
        claims.get("iss"),
        claims.get("aud"),
        claims.get("sub"),
        extra,
    )


def verify_supabase_token(token: str) -> Tuple[Optional[Dict[str, Any]], Optional[str]]:
    """
    Verify and decode a Supabase JWT token.

    Strategy:
      1. Inspect the JWT header to determine the signing algorithm
      2. Validate issuer and audience against Supabase access-token claims
      3. Use JWKS for asymmetric tokens or the shared secret for legacy HS256
    """
    settings = _get_auth_settings()

    if not settings["issuer"]:
        logger.error("SUPABASE_URL or SUPABASE_JWT_ISSUER must be set for token validation")
        return None, "missing-issuer-config"

    try:
        unverified_header = pyjwt.get_unverified_header(token)
    except pyjwt.InvalidTokenError as exc:
        _log_token_diagnostics(token, "header-parse", error=str(exc))
        return None, f"header-parse:{exc}"

    algorithm = unverified_header.get("alg")
    if algorithm not in _SUPPORTED_ALGORITHMS:
        _log_token_diagnostics(
            token,
            "unsupported-algorithm",
            algorithm=algorithm,
            supported_algorithms=sorted(_SUPPORTED_ALGORITHMS),
        )
        return None, f"unsupported-algorithm:{algorithm}"

    decode_kwargs = {
        "algorithms": [algorithm],
        "audience": settings["audience"],
        "issuer": settings["issuer"],
        "options": {
            "require": ["exp", "iat", "sub", "iss", "aud"],
        },
    }

    try:
        if algorithm in _ASYMMETRIC_ALGORITHMS:
            jwks_client = _get_jwks_client(settings["jwks_url"])
            if not jwks_client:
                _log_token_diagnostics(
                    token,
                    "jwks-misconfigured",
                    jwks_url=settings["jwks_url"],
                )
                return None, "jwks-misconfigured"

            signing_key = jwks_client.get_signing_key_from_jwt(token)
            payload = pyjwt.decode(token, signing_key.key, **decode_kwargs)
            logger.info(
                "Supabase token validated with JWKS | alg=%s | iss=%s | aud=%s | sub=%s",
                algorithm,
                payload.get("iss"),
                payload.get("aud"),
                payload.get("sub"),
            )
        else:
            jwt_secret = settings["jwt_secret"]
            if not jwt_secret:
                _log_token_diagnostics(token, "hs256-misconfigured")
                return None, "hs256-misconfigured"

            payload = pyjwt.decode(token, jwt_secret, **decode_kwargs)
            logger.info(
                "Supabase token validated with shared secret | alg=%s | iss=%s | aud=%s | sub=%s",
                algorithm,
                payload.get("iss"),
                payload.get("aud"),
                payload.get("sub"),
            )

        return payload, None

    except pyjwt.ExpiredSignatureError:
        _log_token_diagnostics(token, "expired")
        return None, "expired"
    except pyjwt.InvalidAudienceError as exc:
        _log_token_diagnostics(
            token,
            "invalid-audience",
            expected_audience=settings["audience"],
            error=str(exc),
        )
        return None, f"invalid-audience:{exc}"
    except pyjwt.InvalidIssuerError as exc:
        _log_token_diagnostics(
            token,
            "invalid-issuer",
            expected_issuer=settings["issuer"],
            error=str(exc),
        )
        return None, f"invalid-issuer:{exc}"
    except PyJWKClientError as exc:
        _log_token_diagnostics(
            token,
            "jwks-key-fetch",
            jwks_url=settings["jwks_url"],
            error=str(exc),
        )
        return None, f"jwks-key-fetch:{exc}"
    except pyjwt.InvalidTokenError as exc:
        _log_token_diagnostics(token, "invalid-token", error=str(exc))
        return None, f"invalid-token:{exc}"


async def get_current_user(
    credentials: HTTPAuthorizationCredentials = Depends(security)
) -> Dict[str, Any]:
    """
    FastAPI dependency to get the current authenticated user from Supabase token.

    1. Extracts the JWT token from Authorization header
    2. Validates the token via JWKS or legacy HS256
    3. Retrieves user profile from database
    4. Updates last_login timestamp
    """
    token = credentials.credentials
    logger.info("Authenticating request with Supabase bearer token")

    payload, auth_reason = verify_supabase_token(token)
    if not payload:
        raise HTTPException(
            status_code=401,
            detail=_auth_error_detail("Token inválido ou expirado", auth_reason)
        )

    user_id = payload.get("sub")

    # Get user profile from database
    profile = await db.find_profile_by_id(user_id)

    if not profile:
        # Profile doesn't exist yet - this might happen if user signed up
        # but the trigger didn't create the profile
        email = payload.get("email")
        if email:
            logger.info("Creating missing profile for authenticated user %s", user_id)
            profile_data = {
                "id": user_id,
                "email": email,
                "name": payload.get("user_metadata", {}).get("name", email.split("@")[0]),
                "role": "employee"
            }
            await db.create_profile(profile_data)
            profile = await db.find_profile_by_id(user_id)

        if not profile:
            raise HTTPException(
                status_code=401,
                detail="Perfil de utilizador não encontrado"
            )

    # Update last_login timestamp
    await db.update_profile(user_id, {
        "last_login": datetime.now(timezone.utc).isoformat()
    })

    return profile


async def get_current_user_id(
    credentials: HTTPAuthorizationCredentials = Depends(security)
) -> str:
    """
    FastAPI dependency to get only the current user ID (lighter version).
    Does NOT load the full profile or update last_login.
    """
    token = credentials.credentials
    logger.info("Authenticating request for current user id with Supabase bearer token")

    payload, auth_reason = verify_supabase_token(token)
    if not payload:
        raise HTTPException(
            status_code=401,
            detail=_auth_error_detail("Token inválido ou expirado", auth_reason)
        )

    user_id = payload.get("sub")
    if not user_id:
        raise HTTPException(
            status_code=401,
            detail="Token inválido"
        )

    return user_id


def validate_service_role_key(api_key: str) -> bool:
    """
    Validate if the provided API key is the Supabase service role key.
    Used for admin operations.
    """
    service_role_key = os.environ.get('SUPABASE_SERVICE_ROLE_KEY', '')
    return api_key == service_role_key and service_role_key != ''

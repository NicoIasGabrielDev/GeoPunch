"""
Supabase Authentication Helper
Validates JWT tokens from Supabase Auth and extracts user information
"""
import os
import logging
from typing import Optional, Dict, Any
from fastapi import HTTPException, Depends
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from jose import JWTError, jwt
from database import db

logger = logging.getLogger(__name__)

# Supabase JWT Configuration
SUPABASE_JWT_SECRET = os.environ.get('SUPABASE_JWT_SECRET', '')
if not SUPABASE_JWT_SECRET:
    logger.warning("SUPABASE_JWT_SECRET not set. JWT validation will fail.")

ALGORITHM = "HS256"

# Security
security = HTTPBearer()


def verify_supabase_token(token: str) -> Optional[Dict[str, Any]]:
    """
    Verify and decode a Supabase JWT token
    
    Args:
        token: The JWT token from Authorization header
        
    Returns:
        Decoded token payload with user info, or None if invalid
    """
    try:
        # Decode and verify JWT using Supabase JWT secret
        payload = jwt.decode(
            token, 
            SUPABASE_JWT_SECRET, 
            algorithms=[ALGORITHM],
            options={"verify_aud": False}  # Supabase tokens don't always have audience
        )
        
        # Extract user ID from sub claim
        user_id = payload.get("sub")
        if not user_id:
            logger.error("Token payload missing 'sub' claim")
            return None
            
        return payload
        
    except JWTError as e:
        logger.error(f"JWT validation error: {e}")
        return None
    except Exception as e:
        logger.error(f"Unexpected error validating token: {e}")
        return None


async def get_current_user(
    credentials: HTTPAuthorizationCredentials = Depends(security)
) -> Dict[str, Any]:
    """
    FastAPI dependency to get the current authenticated user from Supabase token
    
    This function:
    1. Extracts the JWT token from Authorization header
    2. Validates the token against Supabase JWT secret
    3. Retrieves user profile from database
    4. Updates last_login timestamp
    
    Args:
        credentials: HTTP Bearer token from request header
        
    Returns:
        User profile dictionary
        
    Raises:
        HTTPException: If token is invalid or user not found
    """
    token = credentials.credentials
    
    # Validate token
    payload = verify_supabase_token(token)
    if not payload:
        raise HTTPException(
            status_code=401, 
            detail="Token inválido ou expirado"
        )
    
    user_id = payload.get("sub")
    
    # Get user profile from database
    profile = await db.find_profile_by_id(user_id)
    
    if not profile:
        # Profile doesn't exist yet - this might happen if user signed up
        # but the trigger didn't create the profile
        email = payload.get("email")
        if email:
            logger.info(f"Creating missing profile for user {user_id}")
            # Create profile automatically
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
    
    # Update last login
    from datetime import datetime
    await db.update_profile(user_id, {"last_login": datetime.utcnow().isoformat()})
    
    return profile


async def get_current_user_id(
    credentials: HTTPAuthorizationCredentials = Depends(security)
) -> str:
    """
    FastAPI dependency to get only the current user ID (lighter version)
    
    Args:
        credentials: HTTP Bearer token from request header
        
    Returns:
        User ID string
        
    Raises:
        HTTPException: If token is invalid
    """
    token = credentials.credentials
    
    payload = verify_supabase_token(token)
    if not payload:
        raise HTTPException(
            status_code=401, 
            detail="Token inválido ou expirado"
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
    Validate if the provided API key is the Supabase service role key
    Used for admin operations
    
    Args:
        api_key: The API key to validate
        
    Returns:
        True if valid service role key, False otherwise
    """
    service_role_key = os.environ.get('SUPABASE_SERVICE_ROLE_KEY', '')
    return api_key == service_role_key and service_role_key != ''

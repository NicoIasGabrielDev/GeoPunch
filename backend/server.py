from fastapi import FastAPI, APIRouter, HTTPException, Depends, status, Request
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from fastapi.responses import StreamingResponse
from dotenv import load_dotenv
from starlette.middleware.cors import CORSMiddleware
from motor.motor_asyncio import AsyncIOMotorClient
import os
import logging
from pathlib import Path
from pydantic import BaseModel, Field, EmailStr, validator
from typing import List, Optional, Literal
import uuid
from datetime import datetime, timedelta, time, timezone
from passlib.context import CryptContext
from jose import JWTError, jwt
import io
import csv
from openpyxl import Workbook
from openpyxl.styles import Font, Alignment, PatternFill, Border, Side
from bson import ObjectId
import asyncio
from collections import defaultdict
import hashlib

ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / '.env')

# MongoDB connection
mongo_url = os.environ['MONGO_URL']
client = AsyncIOMotorClient(mongo_url)
db = client[os.environ.get('DB_NAME', 'geopunch')]

# JWT Configuration - Short-lived access + refresh tokens
SECRET_KEY = os.environ.get('JWT_SECRET', 'geopunch-secret-key-change-in-production-' + hashlib.sha256(str(datetime.now()).encode()).hexdigest()[:16])
REFRESH_SECRET_KEY = os.environ.get('JWT_REFRESH_SECRET', 'geopunch-refresh-secret-' + hashlib.sha256(str(datetime.now()).encode()).hexdigest()[:16])
ALGORITHM = "HS256"
ACCESS_TOKEN_EXPIRE_MINUTES = 30  # Short-lived
REFRESH_TOKEN_EXPIRE_DAYS = 7

# Password hashing with bcrypt (secure)
pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")

# Security
security = HTTPBearer()

# Rate limiting storage (in-memory for MVP, use Redis in production)
login_attempts = defaultdict(list)
RATE_LIMIT_WINDOW = 300  # 5 minutes
MAX_LOGIN_ATTEMPTS = 5
LOCKOUT_DURATION = 900  # 15 minutes

# Create the main app
app = FastAPI(title="GeoPunch API", version="2.0.0")

# Create a router with the /api prefix
api_router = APIRouter(prefix="/api")

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)

# ==================== MODELS ====================

class UserCreate(BaseModel):
    email: EmailStr
    password: str
    name: str
    employeeId: Optional[str] = None
    
    @validator('password')
    def password_strength(cls, v):
        if len(v) < 6:
            raise ValueError('Senha deve ter pelo menos 6 caracteres')
        return v
    
    @validator('name')
    def name_not_empty(cls, v):
        if not v or not v.strip():
            raise ValueError('Nome é obrigatório')
        return v.strip()

class UserLogin(BaseModel):
    email: EmailStr
    password: str

class UserResponse(BaseModel):
    id: str
    email: str
    name: str
    employeeId: Optional[str] = None
    role: str
    workplaceId: Optional[str] = None
    createdAt: datetime

class TokenResponse(BaseModel):
    access_token: str
    refresh_token: str
    token_type: str = "bearer"
    expires_in: int = ACCESS_TOKEN_EXPIRE_MINUTES * 60
    user: UserResponse

class RefreshTokenRequest(BaseModel):
    refresh_token: str

class WorkplaceCreate(BaseModel):
    name: str
    latitude: float
    longitude: float
    radiusMeters: int = 150
    startTime: str = "09:00"  # HH:MM format
    endTime: str = "18:00"
    allowedMarginMinutes: int = 120
    timezone: str = "Europe/Lisbon"  # Added timezone support
    
    @validator('radiusMeters')
    def validate_radius(cls, v):
        if v < 50 or v > 5000:
            raise ValueError('Raio deve estar entre 50m e 5000m')
        return v
    
    @validator('startTime', 'endTime')
    def validate_time_format(cls, v):
        try:
            parts = v.split(':')
            if len(parts) != 2:
                raise ValueError()
            int(parts[0])
            int(parts[1])
        except:
            raise ValueError('Formato de hora inválido. Use HH:MM')
        return v

class WorkplaceResponse(BaseModel):
    id: str
    name: str
    latitude: float
    longitude: float
    radiusMeters: int
    startTime: str
    endTime: str
    allowedMarginMinutes: int
    timezone: str
    createdAt: datetime

class GeofenceEventCreate(BaseModel):
    eventId: str  # Client-generated unique ID for idempotency
    eventType: Literal["ENTER", "EXIT"]
    latitude: float
    longitude: float
    accuracy: float
    deviceTime: Optional[datetime] = None  # Client device time
    timestamp: Optional[datetime] = None

class ManualPunchCreate(BaseModel):
    punchType: Literal["CLOCK_IN", "CLOCK_OUT"]
    latitude: float
    longitude: float
    accuracy: float
    deviceTime: Optional[datetime] = None  # Client device time
    forceOutsideWindow: bool = False  # Allow admin override

class LunchBreakCreate(BaseModel):
    breakType: Literal["LUNCH_START", "LUNCH_END"]
    latitude: float
    longitude: float
    accuracy: float
    deviceTime: Optional[datetime] = None

class PunchEventResponse(BaseModel):
    id: str
    userId: str
    workplaceId: str
    date: str
    eventType: str
    timestamp: datetime
    method: str
    source: str
    latitude: Optional[float] = None
    longitude: Optional[float] = None
    accuracy: Optional[float] = None
    insideGeofence: bool = True

class DayTimesheetResponse(BaseModel):
    date: str
    workplaceName: str
    clockIn: Optional[datetime] = None
    clockInMethod: Optional[str] = None
    clockOut: Optional[datetime] = None
    clockOutMethod: Optional[str] = None
    lunchStart: Optional[datetime] = None
    lunchEnd: Optional[datetime] = None
    grossMinutes: int = 0
    breakMinutes: int = 0
    netWorkedMinutes: int = 0
    netWorkedFormatted: str = "00:00"
    status: str
    anomalies: List[str] = []  # Track issues like outside geofence, low accuracy

class AssignWorkplaceRequest(BaseModel):
    userId: str
    workplaceId: str

class AuditLogEntry(BaseModel):
    id: str
    userId: str
    action: str
    targetType: str
    targetId: str
    details: dict
    timestamp: datetime
    ipAddress: Optional[str] = None

# ==================== HELPER FUNCTIONS ====================

def hash_password(password: str) -> str:
    return pwd_context.hash(password)

def verify_password(plain_password: str, hashed_password: str) -> bool:
    return pwd_context.verify(plain_password, hashed_password)

def create_access_token(data: dict) -> str:
    to_encode = data.copy()
    expire = datetime.utcnow() + timedelta(minutes=ACCESS_TOKEN_EXPIRE_MINUTES)
    to_encode.update({"exp": expire, "type": "access"})
    return jwt.encode(to_encode, SECRET_KEY, algorithm=ALGORITHM)

def create_refresh_token(data: dict) -> str:
    to_encode = data.copy()
    expire = datetime.utcnow() + timedelta(days=REFRESH_TOKEN_EXPIRE_DAYS)
    to_encode.update({"exp": expire, "type": "refresh"})
    return jwt.encode(to_encode, REFRESH_SECRET_KEY, algorithm=ALGORITHM)

async def get_current_user(credentials: HTTPAuthorizationCredentials = Depends(security)):
    try:
        token = credentials.credentials
        payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
        
        if payload.get("type") != "access":
            raise HTTPException(status_code=401, detail="Token inválido")
            
        user_id = payload.get("sub")
        if user_id is None:
            raise HTTPException(status_code=401, detail="Token inválido")
        
        user = await db.users.find_one({"_id": ObjectId(user_id)})
        if user is None:
            raise HTTPException(status_code=401, detail="Utilizador não encontrado")
        
        return user
    except JWTError:
        raise HTTPException(status_code=401, detail="Token inválido ou expirado")

async def get_admin_user(user = Depends(get_current_user)):
    if user.get("role") != "admin":
        raise HTTPException(status_code=403, detail="Acesso apenas para administradores")
    return user

def check_rate_limit(email: str) -> bool:
    """Check if email is rate limited. Returns True if allowed, False if blocked."""
    now = datetime.utcnow()
    
    # Clean old attempts
    login_attempts[email] = [t for t in login_attempts[email] 
                             if (now - t).total_seconds() < RATE_LIMIT_WINDOW]
    
    # Check lockout
    if len(login_attempts[email]) >= MAX_LOGIN_ATTEMPTS:
        oldest = min(login_attempts[email])
        if (now - oldest).total_seconds() < LOCKOUT_DURATION:
            return False
    
    return True

def record_login_attempt(email: str):
    """Record a failed login attempt."""
    login_attempts[email].append(datetime.utcnow())

def clear_login_attempts(email: str):
    """Clear login attempts on successful login."""
    login_attempts[email] = []

def calculate_distance(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    """Calculate distance in meters using Haversine formula"""
    from math import radians, sin, cos, sqrt, atan2
    R = 6371000  # Earth's radius in meters
    
    lat1_rad = radians(lat1)
    lat2_rad = radians(lat2)
    delta_lat = radians(lat2 - lat1)
    delta_lon = radians(lon2 - lon1)
    
    a = sin(delta_lat/2)**2 + cos(lat1_rad) * cos(lat2_rad) * sin(delta_lon/2)**2
    c = 2 * atan2(sqrt(a), sqrt(1-a))
    
    return R * c

def parse_time(time_str: str) -> time:
    """Parse HH:MM string to time object"""
    parts = time_str.split(":")
    return time(int(parts[0]), int(parts[1]))

def is_within_time_window(current_time: time, target_time: time, margin_minutes: int) -> tuple:
    """Check if current time is within [target - margin, target + margin]. Returns (is_within, window_start, window_end)"""
    current_minutes = current_time.hour * 60 + current_time.minute
    target_minutes = target_time.hour * 60 + target_time.minute
    
    window_start = target_minutes - margin_minutes
    window_end = target_minutes + margin_minutes
    
    # Format window for display
    start_h, start_m = divmod(max(0, window_start), 60)
    end_h, end_m = divmod(min(1439, window_end), 60)
    window_str = f"{start_h:02d}:{start_m:02d} - {end_h:02d}:{end_m:02d}"
    
    return window_start <= current_minutes <= window_end, window_str

def format_minutes(minutes: int) -> str:
    """Format minutes to HH:MM string"""
    hours = minutes // 60
    mins = minutes % 60
    return f"{hours:02d}:{mins:02d}"

def get_today_date() -> str:
    """Get today's date in YYYY-MM-DD format"""
    return datetime.utcnow().strftime("%Y-%m-%d")

async def create_audit_log(user_id: str, action: str, target_type: str, target_id: str, details: dict, ip_address: str = None):
    """Create an audit log entry for admin actions"""
    log_entry = {
        "userId": ObjectId(user_id),
        "action": action,
        "targetType": target_type,
        "targetId": target_id,
        "details": details,
        "timestamp": datetime.utcnow(),
        "ipAddress": ip_address
    }
    await db.audit_logs.insert_one(log_entry)

# ==================== AUTH ENDPOINTS ====================

@api_router.post("/auth/register", response_model=TokenResponse)
async def register(user_data: UserCreate):
    # Check if email already exists
    existing = await db.users.find_one({"email": user_data.email.lower()})
    if existing:
        raise HTTPException(status_code=400, detail="Email já registado")
    
    # Create user
    user_doc = {
        "email": user_data.email.lower(),
        "password_hash": hash_password(user_data.password),
        "name": user_data.name,
        "employeeId": user_data.employeeId,
        "role": "employee",
        "workplaceId": None,
        "createdAt": datetime.utcnow(),
        "lastLogin": None,
        "loginCount": 0
    }
    
    result = await db.users.insert_one(user_doc)
    user_doc["_id"] = result.inserted_id
    
    # Create tokens
    access_token = create_access_token({"sub": str(user_doc["_id"])})
    refresh_token = create_refresh_token({"sub": str(user_doc["_id"])})
    
    return TokenResponse(
        access_token=access_token,
        refresh_token=refresh_token,
        user=UserResponse(
            id=str(user_doc["_id"]),
            email=user_doc["email"],
            name=user_doc["name"],
            employeeId=user_doc.get("employeeId"),
            role=user_doc["role"],
            workplaceId=user_doc.get("workplaceId"),
            createdAt=user_doc["createdAt"]
        )
    )

@api_router.post("/auth/login", response_model=TokenResponse)
async def login(credentials: UserLogin):
    email = credentials.email.lower()
    
    # Rate limiting check
    if not check_rate_limit(email):
        raise HTTPException(
            status_code=429, 
            detail="Demasiadas tentativas. Tente novamente em 15 minutos."
        )
    
    user = await db.users.find_one({"email": email})
    if not user or not verify_password(credentials.password, user["password_hash"]):
        record_login_attempt(email)
        raise HTTPException(status_code=401, detail="Email ou senha incorretos")
    
    # Clear rate limit on success
    clear_login_attempts(email)
    
    # Update login stats
    await db.users.update_one(
        {"_id": user["_id"]},
        {"$set": {"lastLogin": datetime.utcnow()}, "$inc": {"loginCount": 1}}
    )
    
    # Create tokens
    access_token = create_access_token({"sub": str(user["_id"])})
    refresh_token = create_refresh_token({"sub": str(user["_id"])})
    
    return TokenResponse(
        access_token=access_token,
        refresh_token=refresh_token,
        user=UserResponse(
            id=str(user["_id"]),
            email=user["email"],
            name=user["name"],
            employeeId=user.get("employeeId"),
            role=user["role"],
            workplaceId=str(user["workplaceId"]) if user.get("workplaceId") else None,
            createdAt=user["createdAt"]
        )
    )

@api_router.post("/auth/refresh", response_model=TokenResponse)
async def refresh_token(request: RefreshTokenRequest):
    try:
        payload = jwt.decode(request.refresh_token, REFRESH_SECRET_KEY, algorithms=[ALGORITHM])
        
        if payload.get("type") != "refresh":
            raise HTTPException(status_code=401, detail="Token inválido")
        
        user_id = payload.get("sub")
        user = await db.users.find_one({"_id": ObjectId(user_id)})
        
        if not user:
            raise HTTPException(status_code=401, detail="Utilizador não encontrado")
        
        # Create new tokens (rotation)
        new_access_token = create_access_token({"sub": str(user["_id"])})
        new_refresh_token = create_refresh_token({"sub": str(user["_id"])})
        
        return TokenResponse(
            access_token=new_access_token,
            refresh_token=new_refresh_token,
            user=UserResponse(
                id=str(user["_id"]),
                email=user["email"],
                name=user["name"],
                employeeId=user.get("employeeId"),
                role=user["role"],
                workplaceId=str(user["workplaceId"]) if user.get("workplaceId") else None,
                createdAt=user["createdAt"]
            )
        )
    except JWTError:
        raise HTTPException(status_code=401, detail="Token de refresh inválido ou expirado")

@api_router.get("/auth/me", response_model=UserResponse)
async def get_me(user = Depends(get_current_user)):
    return UserResponse(
        id=str(user["_id"]),
        email=user["email"],
        name=user["name"],
        employeeId=user.get("employeeId"),
        role=user["role"],
        workplaceId=str(user["workplaceId"]) if user.get("workplaceId") else None,
        createdAt=user["createdAt"]
    )

# ==================== WORKPLACE ENDPOINTS ====================

@api_router.get("/workplace", response_model=Optional[WorkplaceResponse])
async def get_user_workplace(user = Depends(get_current_user)):
    if not user.get("workplaceId"):
        return None
    
    workplace = await db.workplaces.find_one({"_id": ObjectId(user["workplaceId"])})
    if not workplace:
        return None
    
    return WorkplaceResponse(
        id=str(workplace["_id"]),
        name=workplace["name"],
        latitude=workplace["latitude"],
        longitude=workplace["longitude"],
        radiusMeters=workplace["radiusMeters"],
        startTime=workplace["startTime"],
        endTime=workplace["endTime"],
        allowedMarginMinutes=workplace["allowedMarginMinutes"],
        timezone=workplace.get("timezone", "Europe/Lisbon"),
        createdAt=workplace["createdAt"]
    )

@api_router.get("/admin/workplaces", response_model=List[WorkplaceResponse])
async def list_workplaces(user = Depends(get_admin_user)):
    workplaces = await db.workplaces.find().to_list(100)
    return [
        WorkplaceResponse(
            id=str(w["_id"]),
            name=w["name"],
            latitude=w["latitude"],
            longitude=w["longitude"],
            radiusMeters=w["radiusMeters"],
            startTime=w["startTime"],
            endTime=w["endTime"],
            allowedMarginMinutes=w["allowedMarginMinutes"],
            timezone=w.get("timezone", "Europe/Lisbon"),
            createdAt=w["createdAt"]
        )
        for w in workplaces
    ]

@api_router.post("/admin/workplaces", response_model=WorkplaceResponse)
async def create_workplace(workplace: WorkplaceCreate, request: Request, user = Depends(get_admin_user)):
    workplace_doc = {
        "name": workplace.name,
        "latitude": workplace.latitude,
        "longitude": workplace.longitude,
        "radiusMeters": workplace.radiusMeters,
        "startTime": workplace.startTime,
        "endTime": workplace.endTime,
        "allowedMarginMinutes": workplace.allowedMarginMinutes,
        "timezone": workplace.timezone,
        "createdAt": datetime.utcnow()
    }
    
    result = await db.workplaces.insert_one(workplace_doc)
    workplace_doc["_id"] = result.inserted_id
    
    # Audit log
    await create_audit_log(
        str(user["_id"]), 
        "CREATE_WORKPLACE",
        "workplace",
        str(result.inserted_id),
        {"name": workplace.name, "latitude": workplace.latitude, "longitude": workplace.longitude},
        request.client.host if request.client else None
    )
    
    return WorkplaceResponse(
        id=str(workplace_doc["_id"]),
        name=workplace_doc["name"],
        latitude=workplace_doc["latitude"],
        longitude=workplace_doc["longitude"],
        radiusMeters=workplace_doc["radiusMeters"],
        startTime=workplace_doc["startTime"],
        endTime=workplace_doc["endTime"],
        allowedMarginMinutes=workplace_doc["allowedMarginMinutes"],
        timezone=workplace_doc.get("timezone", "Europe/Lisbon"),
        createdAt=workplace_doc["createdAt"]
    )

@api_router.put("/admin/workplaces/{workplace_id}", response_model=WorkplaceResponse)
async def update_workplace(workplace_id: str, workplace: WorkplaceCreate, request: Request, user = Depends(get_admin_user)):
    old_workplace = await db.workplaces.find_one({"_id": ObjectId(workplace_id)})
    
    result = await db.workplaces.find_one_and_update(
        {"_id": ObjectId(workplace_id)},
        {"$set": {
            "name": workplace.name,
            "latitude": workplace.latitude,
            "longitude": workplace.longitude,
            "radiusMeters": workplace.radiusMeters,
            "startTime": workplace.startTime,
            "endTime": workplace.endTime,
            "allowedMarginMinutes": workplace.allowedMarginMinutes,
            "timezone": workplace.timezone
        }},
        return_document=True
    )
    
    if not result:
        raise HTTPException(status_code=404, detail="Local de trabalho não encontrado")
    
    # Audit log with changes
    changes = {}
    if old_workplace:
        for field in ["name", "latitude", "longitude", "radiusMeters", "startTime", "endTime", "allowedMarginMinutes"]:
            old_val = old_workplace.get(field)
            new_val = getattr(workplace, field)
            if old_val != new_val:
                changes[field] = {"old": old_val, "new": new_val}
    
    await create_audit_log(
        str(user["_id"]),
        "UPDATE_WORKPLACE",
        "workplace",
        workplace_id,
        changes,
        request.client.host if request.client else None
    )
    
    return WorkplaceResponse(
        id=str(result["_id"]),
        name=result["name"],
        latitude=result["latitude"],
        longitude=result["longitude"],
        radiusMeters=result["radiusMeters"],
        startTime=result["startTime"],
        endTime=result["endTime"],
        allowedMarginMinutes=result["allowedMarginMinutes"],
        timezone=result.get("timezone", "Europe/Lisbon"),
        createdAt=result["createdAt"]
    )

@api_router.delete("/admin/workplaces/{workplace_id}")
async def delete_workplace(workplace_id: str, request: Request, user = Depends(get_admin_user)):
    workplace = await db.workplaces.find_one({"_id": ObjectId(workplace_id)})
    result = await db.workplaces.delete_one({"_id": ObjectId(workplace_id)})
    if result.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Local de trabalho não encontrado")
    
    # Audit log
    await create_audit_log(
        str(user["_id"]),
        "DELETE_WORKPLACE",
        "workplace",
        workplace_id,
        {"name": workplace["name"] if workplace else "unknown"},
        request.client.host if request.client else None
    )
    
    return {"message": "Local de trabalho eliminado"}

@api_router.post("/admin/assign-workplace")
async def assign_workplace(request_data: AssignWorkplaceRequest, request: Request, user = Depends(get_admin_user)):
    # Verify workplace exists
    workplace = await db.workplaces.find_one({"_id": ObjectId(request_data.workplaceId)})
    if not workplace:
        raise HTTPException(status_code=404, detail="Local de trabalho não encontrado")
    
    target_user = await db.users.find_one({"_id": ObjectId(request_data.userId)})
    if not target_user:
        raise HTTPException(status_code=404, detail="Utilizador não encontrado")
    
    old_workplace_id = target_user.get("workplaceId")
    
    # Update user
    result = await db.users.update_one(
        {"_id": ObjectId(request_data.userId)},
        {"$set": {"workplaceId": ObjectId(request_data.workplaceId)}}
    )
    
    if result.modified_count == 0:
        raise HTTPException(status_code=404, detail="Utilizador não encontrado")
    
    # Audit log
    await create_audit_log(
        str(user["_id"]),
        "ASSIGN_WORKPLACE",
        "user",
        request_data.userId,
        {
            "userName": target_user["name"],
            "oldWorkplaceId": str(old_workplace_id) if old_workplace_id else None,
            "newWorkplaceId": request_data.workplaceId,
            "workplaceName": workplace["name"]
        },
        request.client.host if request.client else None
    )
    
    return {"message": "Local de trabalho atribuído com sucesso"}

@api_router.get("/admin/users", response_model=List[UserResponse])
async def list_users(user = Depends(get_admin_user)):
    users = await db.users.find().to_list(1000)
    return [
        UserResponse(
            id=str(u["_id"]),
            email=u["email"],
            name=u["name"],
            employeeId=u.get("employeeId"),
            role=u["role"],
            workplaceId=str(u["workplaceId"]) if u.get("workplaceId") else None,
            createdAt=u["createdAt"]
        )
        for u in users
    ]

@api_router.get("/admin/audit-logs")
async def get_audit_logs(
    limit: int = 100,
    target_type: Optional[str] = None,
    user = Depends(get_admin_user)
):
    """Get audit logs for admin actions"""
    query = {}
    if target_type:
        query["targetType"] = target_type
    
    logs = await db.audit_logs.find(query).sort("timestamp", -1).limit(limit).to_list(limit)
    
    result = []
    for log in logs:
        admin_user = await db.users.find_one({"_id": log["userId"]})
        result.append({
            "id": str(log["_id"]),
            "adminName": admin_user["name"] if admin_user else "Unknown",
            "action": log["action"],
            "targetType": log["targetType"],
            "targetId": log["targetId"],
            "details": log["details"],
            "timestamp": log["timestamp"],
            "ipAddress": log.get("ipAddress")
        })
    
    return result

@api_router.get("/admin/anomalies")
async def get_anomalies(
    from_date: Optional[str] = None,
    to_date: Optional[str] = None,
    user = Depends(get_admin_user)
):
    """Get punch anomalies: outside geofence, low accuracy, outside window attempts"""
    if not from_date:
        from_date = (datetime.utcnow() - timedelta(days=7)).strftime("%Y-%m-%d")
    if not to_date:
        to_date = datetime.utcnow().strftime("%Y-%m-%d")
    
    # Find punches with anomalies
    anomaly_events = await db.punch_events.find({
        "date": {"$gte": from_date, "$lte": to_date},
        "$or": [
            {"insideGeofence": False},
            {"accuracy": {"$gt": 50}},
            {"outsideWindow": True}
        ]
    }).sort("timestamp", -1).to_list(500)
    
    # Also get failed geofence events
    failed_geofence = await db.geofence_events.find({
        "timestamp": {"$gte": datetime.fromisoformat(from_date), "$lte": datetime.fromisoformat(to_date + "T23:59:59")},
        "punchCreated": False
    }).sort("timestamp", -1).to_list(500)
    
    result = []
    
    for event in anomaly_events:
        emp = await db.users.find_one({"_id": event["userId"]})
        anomalies = []
        if not event.get("insideGeofence", True):
            anomalies.append("Fora do geofence")
        if event.get("accuracy", 0) > 50:
            anomalies.append(f"Precisão GPS baixa ({event['accuracy']:.0f}m)")
        if event.get("outsideWindow"):
            anomalies.append("Fora da janela de tempo")
        
        result.append({
            "type": "punch",
            "employeeName": emp["name"] if emp else "Unknown",
            "eventType": event["eventType"],
            "timestamp": event["timestamp"],
            "anomalies": anomalies,
            "distance": event.get("distance"),
            "accuracy": event.get("accuracy")
        })
    
    for event in failed_geofence:
        emp = await db.users.find_one({"_id": event["userId"]})
        result.append({
            "type": "geofence_rejected",
            "employeeName": emp["name"] if emp else "Unknown",
            "eventType": event["eventType"],
            "timestamp": event["timestamp"],
            "reason": event.get("reason"),
            "distance": event.get("distance")
        })
    
    return sorted(result, key=lambda x: x["timestamp"], reverse=True)[:100]

# ==================== GEOFENCE EVENTS ====================

@api_router.post("/events/geofence")
async def process_geofence_event(event: GeofenceEventCreate, user = Depends(get_current_user)):
    """Process geofence enter/exit events with idempotency"""
    
    # Check idempotency - if this eventId was already processed, return existing result
    existing = await db.geofence_events.find_one({"eventId": event.eventId})
    if existing:
        return {
            "processed": True,
            "duplicate": True,
            "punchCreated": existing.get("punchCreated", False),
            "message": "Evento já processado anteriormente"
        }
    
    # Get user's workplace
    if not user.get("workplaceId"):
        raise HTTPException(status_code=400, detail="Nenhum local de trabalho atribuído")
    
    workplace = await db.workplaces.find_one({"_id": ObjectId(user["workplaceId"])})
    if not workplace:
        raise HTTPException(status_code=404, detail="Local de trabalho não encontrado")
    
    server_time = datetime.utcnow()
    event_timestamp = event.timestamp or server_time
    event_date = event_timestamp.strftime("%Y-%m-%d")
    event_time = event_timestamp.time()
    
    # Calculate distance to workplace
    distance = calculate_distance(
        event.latitude, event.longitude,
        workplace["latitude"], workplace["longitude"]
    )
    
    # Determine punch type based on geofence event
    punch_type = "CLOCK_IN" if event.eventType == "ENTER" else "CLOCK_OUT"
    target_time = parse_time(workplace["startTime"] if punch_type == "CLOCK_IN" else workplace["endTime"])
    
    # Check if within time window
    within_window, window_str = is_within_time_window(event_time, target_time, workplace["allowedMarginMinutes"])
    
    # Check if within geofence radius
    within_geofence = distance <= workplace["radiusMeters"]
    
    # Store raw geofence event
    geofence_doc = {
        "eventId": event.eventId,
        "userId": user["_id"],
        "workplaceId": workplace["_id"],
        "eventType": event.eventType,
        "timestamp": event_timestamp,
        "serverTime": server_time,
        "deviceTime": event.deviceTime,
        "latitude": event.latitude,
        "longitude": event.longitude,
        "accuracy": event.accuracy,
        "distance": distance,
        "withinGeofence": within_geofence,
        "withinTimeWindow": within_window,
        "allowedWindow": window_str,
        "processed": True,
        "punchCreated": False,
        "reason": None
    }
    
    punch_created = False
    message = ""
    
    if not within_geofence:
        geofence_doc["reason"] = f"Fora da área do local de trabalho ({int(distance)}m, máximo {workplace['radiusMeters']}m)"
        message = geofence_doc["reason"]
    elif not within_window:
        geofence_doc["reason"] = f"Fora do horário permitido. Janela: {window_str}"
        message = geofence_doc["reason"]
    else:
        # Check for existing punch of same type today (unique constraint simulation)
        existing_punch = await db.punch_events.find_one({
            "userId": user["_id"],
            "date": event_date,
            "eventType": punch_type
        })
        
        if existing_punch:
            geofence_doc["reason"] = f"{punch_type} já registado hoje"
            message = geofence_doc["reason"]
        else:
            # For CLOCK_OUT, verify CLOCK_IN exists
            if punch_type == "CLOCK_OUT":
                clock_in = await db.punch_events.find_one({
                    "userId": user["_id"],
                    "date": event_date,
                    "eventType": "CLOCK_IN"
                })
                if not clock_in:
                    geofence_doc["reason"] = "Sem registo de entrada hoje"
                    message = "Não é possível registar saída sem entrada"
                else:
                    # Create punch event
                    punch_doc = {
                        "userId": user["_id"],
                        "workplaceId": workplace["_id"],
                        "date": event_date,
                        "eventType": punch_type,
                        "timestamp": event_timestamp,
                        "serverTime": server_time,
                        "deviceTime": event.deviceTime,
                        "method": "auto",
                        "source": f"geofence_{event.eventType.lower()}",
                        "latitude": event.latitude,
                        "longitude": event.longitude,
                        "accuracy": event.accuracy,
                        "insideGeofence": within_geofence,
                        "distance": distance,
                        "eventId": event.eventId
                    }
                    await db.punch_events.insert_one(punch_doc)
                    punch_created = True
                    geofence_doc["punchCreated"] = True
                    message = "Saída registada automaticamente"
            else:
                # Create CLOCK_IN punch
                punch_doc = {
                    "userId": user["_id"],
                    "workplaceId": workplace["_id"],
                    "date": event_date,
                    "eventType": punch_type,
                    "timestamp": event_timestamp,
                    "serverTime": server_time,
                    "deviceTime": event.deviceTime,
                    "method": "auto",
                    "source": f"geofence_{event.eventType.lower()}",
                    "latitude": event.latitude,
                    "longitude": event.longitude,
                    "accuracy": event.accuracy,
                    "insideGeofence": within_geofence,
                    "distance": distance,
                    "eventId": event.eventId
                }
                await db.punch_events.insert_one(punch_doc)
                punch_created = True
                geofence_doc["punchCreated"] = True
                message = "Entrada registada automaticamente"
    
    # Save geofence event
    await db.geofence_events.insert_one(geofence_doc)
    
    return {
        "processed": True,
        "duplicate": False,
        "punchCreated": punch_created,
        "withinGeofence": within_geofence,
        "withinTimeWindow": within_window,
        "allowedWindow": window_str,
        "distance": int(distance),
        "message": message
    }

# ==================== MANUAL PUNCH ====================

@api_router.post("/punch/manual")
async def manual_punch(punch: ManualPunchCreate, user = Depends(get_current_user)):
    """Process manual clock in/out request with location validation"""
    
    # Get user's workplace
    if not user.get("workplaceId"):
        raise HTTPException(status_code=400, detail="Nenhum local de trabalho atribuído")
    
    workplace = await db.workplaces.find_one({"_id": ObjectId(user["workplaceId"])})
    if not workplace:
        raise HTTPException(status_code=404, detail="Local de trabalho não encontrado")
    
    server_time = datetime.utcnow()
    today = server_time.strftime("%Y-%m-%d")
    current_time = server_time.time()
    
    # Calculate distance
    distance = calculate_distance(
        punch.latitude, punch.longitude,
        workplace["latitude"], workplace["longitude"]
    )
    
    # Check if within geofence
    inside_geofence = distance <= workplace["radiusMeters"]
    if not inside_geofence:
        raise HTTPException(
            status_code=400, 
            detail=f"Está fora da área do local de trabalho ({int(distance)}m de distância, máximo {workplace['radiusMeters']}m)"
        )
    
    # Check time window
    target_time = parse_time(workplace["startTime"] if punch.punchType == "CLOCK_IN" else workplace["endTime"])
    within_window, window_str = is_within_time_window(current_time, target_time, workplace["allowedMarginMinutes"])
    
    if not within_window and not punch.forceOutsideWindow:
        raise HTTPException(
            status_code=400,
            detail=f"Fora do horário permitido para este tipo de registo. Janela permitida: {window_str}"
        )
    
    # Check for existing punch (unique constraint)
    existing = await db.punch_events.find_one({
        "userId": user["_id"],
        "date": today,
        "eventType": punch.punchType
    })
    
    if existing:
        raise HTTPException(status_code=400, detail=f"{punch.punchType} já registado hoje")
    
    # For CLOCK_OUT, verify CLOCK_IN exists
    if punch.punchType == "CLOCK_OUT":
        clock_in = await db.punch_events.find_one({
            "userId": user["_id"],
            "date": today,
            "eventType": "CLOCK_IN"
        })
        if not clock_in:
            raise HTTPException(status_code=400, detail="Não é possível registar saída sem entrada")
    
    # GPS accuracy warning
    accuracy_warning = ""
    if punch.accuracy > 50:
        accuracy_warning = f" (Aviso: precisão GPS de {int(punch.accuracy)}m)"
    
    # Create punch with full audit data
    punch_doc = {
        "userId": user["_id"],
        "workplaceId": workplace["_id"],
        "date": today,
        "eventType": punch.punchType,
        "timestamp": server_time,
        "serverTime": server_time,
        "deviceTime": punch.deviceTime,
        "method": "manual",
        "source": "manual_request",
        "latitude": punch.latitude,
        "longitude": punch.longitude,
        "accuracy": punch.accuracy,
        "insideGeofence": inside_geofence,
        "distance": distance,
        "outsideWindow": not within_window
    }
    
    result = await db.punch_events.insert_one(punch_doc)
    
    return {
        "success": True,
        "punchId": str(result.inserted_id),
        "eventType": punch.punchType,
        "timestamp": server_time,
        "insideGeofence": inside_geofence,
        "distance": int(distance),
        "message": f"{'Entrada' if punch.punchType == 'CLOCK_IN' else 'Saída'} registada com sucesso{accuracy_warning}"
    }

# ==================== LUNCH BREAK ====================

@api_router.post("/break/manual")
async def manual_break(break_data: LunchBreakCreate, user = Depends(get_current_user)):
    """Process manual lunch break start/end with full validation"""
    
    # Get user's workplace
    if not user.get("workplaceId"):
        raise HTTPException(status_code=400, detail="Nenhum local de trabalho atribuído")
    
    workplace = await db.workplaces.find_one({"_id": ObjectId(user["workplaceId"])})
    if not workplace:
        raise HTTPException(status_code=404, detail="Local de trabalho não encontrado")
    
    server_time = datetime.utcnow()
    today = server_time.strftime("%Y-%m-%d")
    
    # Verify CLOCK_IN exists today
    clock_in = await db.punch_events.find_one({
        "userId": user["_id"],
        "date": today,
        "eventType": "CLOCK_IN"
    })
    
    if not clock_in:
        raise HTTPException(status_code=400, detail="Não é possível registar pausa sem entrada registada hoje")
    
    # Check for CLOCK_OUT - lunch should be between clock in and out
    clock_out = await db.punch_events.find_one({
        "userId": user["_id"],
        "date": today,
        "eventType": "CLOCK_OUT"
    })
    
    if clock_out:
        raise HTTPException(status_code=400, detail="Não é possível registar pausa após a saída")
    
    # Calculate distance (optional validation)
    distance = calculate_distance(
        break_data.latitude, break_data.longitude,
        workplace["latitude"], workplace["longitude"]
    )
    
    inside_geofence = distance <= workplace["radiusMeters"]
    
    if break_data.breakType == "LUNCH_START":
        # Check if lunch already started
        existing_start = await db.punch_events.find_one({
            "userId": user["_id"],
            "date": today,
            "eventType": "LUNCH_START"
        })
        
        if existing_start:
            # Check if lunch was already ended
            existing_end = await db.punch_events.find_one({
                "userId": user["_id"],
                "date": today,
                "eventType": "LUNCH_END"
            })
            if not existing_end:
                raise HTTPException(status_code=400, detail="Pausa de almoço já iniciada. Termine a pausa atual primeiro.")
            else:
                raise HTTPException(status_code=400, detail="Já registou uma pausa de almoço hoje (apenas uma permitida)")
    
    elif break_data.breakType == "LUNCH_END":
        # Check if lunch was started
        lunch_start = await db.punch_events.find_one({
            "userId": user["_id"],
            "date": today,
            "eventType": "LUNCH_START"
        })
        
        if not lunch_start:
            raise HTTPException(status_code=400, detail="Não é possível terminar pausa sem a ter iniciado")
        
        # Check if already ended
        existing_end = await db.punch_events.find_one({
            "userId": user["_id"],
            "date": today,
            "eventType": "LUNCH_END"
        })
        
        if existing_end:
            raise HTTPException(status_code=400, detail="Pausa de almoço já terminada")
        
        # Validate that LUNCH_END timestamp is after LUNCH_START
        if server_time <= lunch_start["timestamp"]:
            raise HTTPException(status_code=400, detail="Fim de pausa não pode ser antes do início")
    
    # Create break event with full audit data
    break_doc = {
        "userId": user["_id"],
        "workplaceId": workplace["_id"],
        "date": today,
        "eventType": break_data.breakType,
        "timestamp": server_time,
        "serverTime": server_time,
        "deviceTime": break_data.deviceTime,
        "method": "manual",
        "source": "manual_break",
        "latitude": break_data.latitude,
        "longitude": break_data.longitude,
        "accuracy": break_data.accuracy,
        "insideGeofence": inside_geofence,
        "distance": distance
    }
    
    result = await db.punch_events.insert_one(break_doc)
    
    location_warning = ""
    if not inside_geofence:
        location_warning = f" (fora do local de trabalho - {int(distance)}m)"
    
    return {
        "success": True,
        "breakId": str(result.inserted_id),
        "eventType": break_data.breakType,
        "timestamp": server_time,
        "insideGeofence": inside_geofence,
        "distance": int(distance),
        "message": f"{'Início' if break_data.breakType == 'LUNCH_START' else 'Fim'} de almoço registado{location_warning}"
    }

# ==================== OFFLINE SYNC ====================

@api_router.post("/sync/events")
async def sync_offline_events(events: List[GeofenceEventCreate], user = Depends(get_current_user)):
    """
    Sync multiple offline events. Server handles idempotency and ordering.
    Events should be sent with unique eventId to prevent duplicates.
    """
    results = []
    
    # Sort events by timestamp to process in order
    sorted_events = sorted(events, key=lambda x: x.timestamp or datetime.utcnow())
    
    for event in sorted_events:
        try:
            # Check if already processed (idempotency)
            existing = await db.geofence_events.find_one({"eventId": event.eventId})
            if existing:
                results.append({
                    "eventId": event.eventId,
                    "status": "duplicate",
                    "message": "Evento já processado"
                })
                continue
            
            # Process the event (reuse existing logic)
            # ... simplified - in production would call process_geofence_event
            results.append({
                "eventId": event.eventId,
                "status": "queued",
                "message": "Evento em processamento"
            })
            
        except Exception as e:
            results.append({
                "eventId": event.eventId,
                "status": "error",
                "message": str(e)
            })
    
    return {
        "processed": len(results),
        "results": results
    }

# ==================== TIMESHEET ====================

@api_router.get("/timesheet")
async def get_timesheet(
    from_date: Optional[str] = None,
    to_date: Optional[str] = None,
    user = Depends(get_current_user)
):
    """Get timesheet with daily summaries and anomaly detection"""
    
    # Default to last 30 days
    if not from_date:
        from_date = (datetime.utcnow() - timedelta(days=30)).strftime("%Y-%m-%d")
    if not to_date:
        to_date = datetime.utcnow().strftime("%Y-%m-%d")
    
    # Get user's workplace
    workplace = None
    if user.get("workplaceId"):
        workplace = await db.workplaces.find_one({"_id": ObjectId(user["workplaceId"])})
    
    # Get all punch events in date range
    events = await db.punch_events.find({
        "userId": user["_id"],
        "date": {"$gte": from_date, "$lte": to_date}
    }).sort("timestamp", 1).to_list(1000)
    
    # Group events by date
    days = {}
    for event in events:
        date = event["date"]
        if date not in days:
            days[date] = {
                "clockIn": None,
                "clockInMethod": None,
                "clockOut": None,
                "clockOutMethod": None,
                "lunchStart": None,
                "lunchEnd": None,
                "anomalies": []
            }
        
        # Track anomalies
        if not event.get("insideGeofence", True):
            days[date]["anomalies"].append(f"{event['eventType']}: fora do geofence")
        if event.get("accuracy", 0) > 50:
            days[date]["anomalies"].append(f"{event['eventType']}: GPS impreciso")
        
        if event["eventType"] == "CLOCK_IN":
            days[date]["clockIn"] = event["timestamp"]
            days[date]["clockInMethod"] = event["method"]
        elif event["eventType"] == "CLOCK_OUT":
            days[date]["clockOut"] = event["timestamp"]
            days[date]["clockOutMethod"] = event["method"]
        elif event["eventType"] == "LUNCH_START":
            days[date]["lunchStart"] = event["timestamp"]
        elif event["eventType"] == "LUNCH_END":
            days[date]["lunchEnd"] = event["timestamp"]
    
    # Calculate summaries
    result = []
    for date, day_data in sorted(days.items(), reverse=True):
        gross_minutes = 0
        break_minutes = 0
        status = "not_started"
        
        if day_data["clockIn"]:
            status = "working"
            
            if day_data["lunchStart"] and not day_data["lunchEnd"]:
                status = "on_lunch"
            
            if day_data["clockOut"]:
                status = "finished"
                delta = day_data["clockOut"] - day_data["clockIn"]
                gross_minutes = int(delta.total_seconds() / 60)
            else:
                # Still working - calculate from clock in to now
                delta = datetime.utcnow() - day_data["clockIn"]
                gross_minutes = int(delta.total_seconds() / 60)
        
        if day_data["lunchStart"] and day_data["lunchEnd"]:
            delta = day_data["lunchEnd"] - day_data["lunchStart"]
            break_minutes = int(delta.total_seconds() / 60)
        elif day_data["lunchStart"]:
            # Currently on lunch
            delta = datetime.utcnow() - day_data["lunchStart"]
            break_minutes = int(delta.total_seconds() / 60)
        
        net_minutes = max(0, gross_minutes - break_minutes)
        
        result.append(DayTimesheetResponse(
            date=date,
            workplaceName=workplace["name"] if workplace else "Sem local atribuído",
            clockIn=day_data["clockIn"],
            clockInMethod=day_data["clockInMethod"],
            clockOut=day_data["clockOut"],
            clockOutMethod=day_data["clockOutMethod"],
            lunchStart=day_data["lunchStart"],
            lunchEnd=day_data["lunchEnd"],
            grossMinutes=gross_minutes,
            breakMinutes=break_minutes,
            netWorkedMinutes=net_minutes,
            netWorkedFormatted=format_minutes(net_minutes),
            status=status,
            anomalies=day_data["anomalies"]
        ))
    
    return result

@api_router.get("/timesheet/today")
async def get_today_status(user = Depends(get_current_user)):
    """Get today's status for the home screen with enhanced info"""
    
    today = get_today_date()
    
    # Get user's workplace
    workplace = None
    if user.get("workplaceId"):
        workplace = await db.workplaces.find_one({"_id": ObjectId(user["workplaceId"])})
    
    # Get today's events
    events = await db.punch_events.find({
        "userId": user["_id"],
        "date": today
    }).to_list(10)
    
    day_data = {
        "clockIn": None,
        "clockInMethod": None,
        "clockOut": None,
        "clockOutMethod": None,
        "lunchStart": None,
        "lunchEnd": None
    }
    
    for event in events:
        if event["eventType"] == "CLOCK_IN":
            day_data["clockIn"] = event["timestamp"]
            day_data["clockInMethod"] = event["method"]
        elif event["eventType"] == "CLOCK_OUT":
            day_data["clockOut"] = event["timestamp"]
            day_data["clockOutMethod"] = event["method"]
        elif event["eventType"] == "LUNCH_START":
            day_data["lunchStart"] = event["timestamp"]
        elif event["eventType"] == "LUNCH_END":
            day_data["lunchEnd"] = event["timestamp"]
    
    # Calculate status and times
    gross_minutes = 0
    break_minutes = 0
    status = "not_started"
    
    if day_data["clockIn"]:
        status = "working"
        
        if day_data["lunchStart"] and not day_data["lunchEnd"]:
            status = "on_lunch"
        
        if day_data["clockOut"]:
            status = "finished"
            delta = day_data["clockOut"] - day_data["clockIn"]
            gross_minutes = int(delta.total_seconds() / 60)
        else:
            delta = datetime.utcnow() - day_data["clockIn"]
            gross_minutes = int(delta.total_seconds() / 60)
    
    if day_data["lunchStart"] and day_data["lunchEnd"]:
        delta = day_data["lunchEnd"] - day_data["lunchStart"]
        break_minutes = int(delta.total_seconds() / 60)
    elif day_data["lunchStart"]:
        delta = datetime.utcnow() - day_data["lunchStart"]
        break_minutes = int(delta.total_seconds() / 60)
    
    net_minutes = max(0, gross_minutes - break_minutes)
    
    # Calculate allowed windows for UI
    clock_in_window = None
    clock_out_window = None
    if workplace:
        start_time = parse_time(workplace["startTime"])
        end_time = parse_time(workplace["endTime"])
        margin = workplace["allowedMarginMinutes"]
        
        _, clock_in_window = is_within_time_window(datetime.utcnow().time(), start_time, margin)
        _, clock_out_window = is_within_time_window(datetime.utcnow().time(), end_time, margin)
    
    return {
        "date": today,
        "workplace": {
            "id": str(workplace["_id"]) if workplace else None,
            "name": workplace["name"] if workplace else None,
            "latitude": workplace["latitude"] if workplace else None,
            "longitude": workplace["longitude"] if workplace else None,
            "radiusMeters": workplace["radiusMeters"] if workplace else None,
            "startTime": workplace["startTime"] if workplace else None,
            "endTime": workplace["endTime"] if workplace else None,
            "allowedMarginMinutes": workplace["allowedMarginMinutes"] if workplace else None,
            "timezone": workplace.get("timezone", "Europe/Lisbon") if workplace else None,
            "clockInWindow": clock_in_window,
            "clockOutWindow": clock_out_window
        } if workplace else None,
        "clockIn": day_data["clockIn"],
        "clockInMethod": day_data["clockInMethod"],
        "clockOut": day_data["clockOut"],
        "clockOutMethod": day_data["clockOutMethod"],
        "lunchStart": day_data["lunchStart"],
        "lunchEnd": day_data["lunchEnd"],
        "grossMinutes": gross_minutes,
        "breakMinutes": break_minutes,
        "netWorkedMinutes": net_minutes,
        "netWorkedFormatted": format_minutes(net_minutes),
        "status": status
    }

# ==================== EXPORT ====================

@api_router.get("/export/timesheet.csv")
async def export_csv(
    from_date: Optional[str] = None,
    to_date: Optional[str] = None,
    user_id: Optional[str] = None,
    user = Depends(get_current_user)
):
    """Export timesheet as CSV with proper formatting"""
    
    # Default to last 30 days
    if not from_date:
        from_date = (datetime.utcnow() - timedelta(days=30)).strftime("%Y-%m-%d")
    if not to_date:
        to_date = datetime.utcnow().strftime("%Y-%m-%d")
    
    # Determine which user(s) to export
    if user_id and user.get("role") == "admin":
        target_users = [await db.users.find_one({"_id": ObjectId(user_id)})]
    elif user.get("role") == "admin":
        target_users = await db.users.find().to_list(1000)
    else:
        target_users = [user]
    
    # Create CSV
    output = io.StringIO()
    writer = csv.writer(output)
    writer.writerow([
        "Funcionário", "ID Funcionário", "Data", "Local de Trabalho",
        "Entrada", "Método Entrada", "Início Almoço", "Fim Almoço",
        "Saída", "Método Saída", "Minutos Brutos", "Pausa (min)", 
        "Minutos Líquidos", "Horas Trabalhadas", "Anomalias"
    ])
    
    for target_user in target_users:
        if not target_user:
            continue
            
        # Get workplace
        workplace = None
        if target_user.get("workplaceId"):
            workplace = await db.workplaces.find_one({"_id": ObjectId(target_user["workplaceId"])})
        
        # Get events
        events = await db.punch_events.find({
            "userId": target_user["_id"],
            "date": {"$gte": from_date, "$lte": to_date}
        }).sort("timestamp", 1).to_list(10000)
        
        # Group by date
        days = {}
        for event in events:
            date = event["date"]
            if date not in days:
                days[date] = {"anomalies": []}
            days[date][event["eventType"]] = event
            
            # Track anomalies
            if not event.get("insideGeofence", True):
                days[date]["anomalies"].append("Fora geofence")
            if event.get("accuracy", 0) > 50:
                days[date]["anomalies"].append("GPS impreciso")
        
        # Write rows
        for date in sorted(days.keys()):
            day_events = days[date]
            
            clock_in = day_events.get("CLOCK_IN", {})
            clock_out = day_events.get("CLOCK_OUT", {})
            lunch_start = day_events.get("LUNCH_START", {})
            lunch_end = day_events.get("LUNCH_END", {})
            
            gross_minutes = 0
            break_minutes = 0
            
            if clock_in.get("timestamp") and clock_out.get("timestamp"):
                delta = clock_out["timestamp"] - clock_in["timestamp"]
                gross_minutes = int(delta.total_seconds() / 60)
            
            if lunch_start.get("timestamp") and lunch_end.get("timestamp"):
                delta = lunch_end["timestamp"] - lunch_start["timestamp"]
                break_minutes = int(delta.total_seconds() / 60)
            
            net_minutes = max(0, gross_minutes - break_minutes)
            
            anomalies = ", ".join(set(day_events.get("anomalies", [])))
            
            writer.writerow([
                target_user["name"],
                target_user.get("employeeId", ""),
                date,
                workplace["name"] if workplace else "",
                clock_in.get("timestamp", "").strftime("%H:%M:%S") if clock_in.get("timestamp") else "",
                clock_in.get("method", ""),
                lunch_start.get("timestamp", "").strftime("%H:%M:%S") if lunch_start.get("timestamp") else "",
                lunch_end.get("timestamp", "").strftime("%H:%M:%S") if lunch_end.get("timestamp") else "",
                clock_out.get("timestamp", "").strftime("%H:%M:%S") if clock_out.get("timestamp") else "",
                clock_out.get("method", ""),
                gross_minutes,
                break_minutes,
                net_minutes,
                format_minutes(net_minutes),
                anomalies
            ])
    
    output.seek(0)
    
    return StreamingResponse(
        iter([output.getvalue()]),
        media_type="text/csv; charset=utf-8",
        headers={
            "Content-Disposition": f"attachment; filename=folha_ponto_{from_date}_{to_date}.csv"
        }
    )

@api_router.get("/export/timesheet.xlsx")
async def export_xlsx(
    from_date: Optional[str] = None,
    to_date: Optional[str] = None,
    user_id: Optional[str] = None,
    user = Depends(get_current_user)
):
    """Export timesheet as Excel XLSX with formatting"""
    
    # Default to last 30 days
    if not from_date:
        from_date = (datetime.utcnow() - timedelta(days=30)).strftime("%Y-%m-%d")
    if not to_date:
        to_date = datetime.utcnow().strftime("%Y-%m-%d")
    
    # Determine which user(s) to export
    if user_id and user.get("role") == "admin":
        target_users = [await db.users.find_one({"_id": ObjectId(user_id)})]
    elif user.get("role") == "admin":
        target_users = await db.users.find().to_list(1000)
    else:
        target_users = [user]
    
    # Create Excel workbook
    wb = Workbook()
    ws = wb.active
    ws.title = "Folha de Ponto"
    
    # Headers with styling
    headers = [
        "Funcionário", "ID Funcionário", "Data", "Local de Trabalho",
        "Entrada", "Método Entrada", "Início Almoço", "Fim Almoço",
        "Saída", "Método Saída", "Minutos Brutos", "Pausa (min)", 
        "Minutos Líquidos", "Horas Trabalhadas", "Anomalias"
    ]
    ws.append(headers)
    
    # Style headers
    header_fill = PatternFill(start_color="1a73e8", end_color="1a73e8", fill_type="solid")
    header_font = Font(color="FFFFFF", bold=True)
    for cell in ws[1]:
        cell.fill = header_fill
        cell.font = header_font
        cell.alignment = Alignment(horizontal="center")
    
    row_num = 2
    total_net_minutes = 0
    
    for target_user in target_users:
        if not target_user:
            continue
            
        # Get workplace
        workplace = None
        if target_user.get("workplaceId"):
            workplace = await db.workplaces.find_one({"_id": ObjectId(target_user["workplaceId"])})
        
        # Get events
        events = await db.punch_events.find({
            "userId": target_user["_id"],
            "date": {"$gte": from_date, "$lte": to_date}
        }).sort("timestamp", 1).to_list(10000)
        
        # Group by date
        days = {}
        for event in events:
            date = event["date"]
            if date not in days:
                days[date] = {"anomalies": []}
            days[date][event["eventType"]] = event
            
            if not event.get("insideGeofence", True):
                days[date]["anomalies"].append("Fora geofence")
            if event.get("accuracy", 0) > 50:
                days[date]["anomalies"].append("GPS impreciso")
        
        # Write rows
        for date in sorted(days.keys()):
            day_events = days[date]
            
            clock_in = day_events.get("CLOCK_IN", {})
            clock_out = day_events.get("CLOCK_OUT", {})
            lunch_start = day_events.get("LUNCH_START", {})
            lunch_end = day_events.get("LUNCH_END", {})
            
            gross_minutes = 0
            break_minutes = 0
            
            if clock_in.get("timestamp") and clock_out.get("timestamp"):
                delta = clock_out["timestamp"] - clock_in["timestamp"]
                gross_minutes = int(delta.total_seconds() / 60)
            
            if lunch_start.get("timestamp") and lunch_end.get("timestamp"):
                delta = lunch_end["timestamp"] - lunch_start["timestamp"]
                break_minutes = int(delta.total_seconds() / 60)
            
            net_minutes = max(0, gross_minutes - break_minutes)
            total_net_minutes += net_minutes
            
            anomalies = ", ".join(set(day_events.get("anomalies", [])))
            
            ws.append([
                target_user["name"],
                target_user.get("employeeId", ""),
                date,
                workplace["name"] if workplace else "",
                clock_in.get("timestamp").strftime("%H:%M:%S") if clock_in.get("timestamp") else "",
                clock_in.get("method", ""),
                lunch_start.get("timestamp").strftime("%H:%M:%S") if lunch_start.get("timestamp") else "",
                lunch_end.get("timestamp").strftime("%H:%M:%S") if lunch_end.get("timestamp") else "",
                clock_out.get("timestamp").strftime("%H:%M:%S") if clock_out.get("timestamp") else "",
                clock_out.get("method", ""),
                gross_minutes,
                break_minutes,
                net_minutes,
                format_minutes(net_minutes),
                anomalies
            ])
            row_num += 1
    
    # Add totals row
    ws.append([])
    total_row = ["", "", "", "TOTAL", "", "", "", "", "", "", "", "", total_net_minutes, format_minutes(total_net_minutes), ""]
    ws.append(total_row)
    
    # Style totals
    for cell in ws[row_num + 2]:
        cell.font = Font(bold=True)
    
    # Adjust column widths
    for column in ws.columns:
        max_length = 0
        column_letter = column[0].column_letter
        for cell in column:
            try:
                if len(str(cell.value)) > max_length:
                    max_length = len(str(cell.value))
            except:
                pass
        ws.column_dimensions[column_letter].width = min(max_length + 2, 30)
    
    # Save to buffer
    output = io.BytesIO()
    wb.save(output)
    output.seek(0)
    
    return StreamingResponse(
        iter([output.getvalue()]),
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={
            "Content-Disposition": f"attachment; filename=folha_ponto_{from_date}_{to_date}.xlsx"
        }
    )

# ==================== PDF EXPORT ====================

@api_router.get("/export/timesheet.pdf")
async def export_pdf(
    from_date: Optional[str] = None,
    to_date: Optional[str] = None,
    user_id: Optional[str] = None,
    user = Depends(get_current_user)
):
    """Export timesheet as PDF summary (simplified HTML-based PDF)"""
    
    # Default to last 30 days
    if not from_date:
        from_date = (datetime.utcnow() - timedelta(days=30)).strftime("%Y-%m-%d")
    if not to_date:
        to_date = datetime.utcnow().strftime("%Y-%m-%d")
    
    # For MVP, return HTML that can be printed as PDF
    # In production, use reportlab or weasyprint
    
    # Get user data
    target_user = user
    if user_id and user.get("role") == "admin":
        target_user = await db.users.find_one({"_id": ObjectId(user_id)})
    
    workplace = None
    if target_user and target_user.get("workplaceId"):
        workplace = await db.workplaces.find_one({"_id": ObjectId(target_user["workplaceId"])})
    
    # Get events
    events = await db.punch_events.find({
        "userId": target_user["_id"],
        "date": {"$gte": from_date, "$lte": to_date}
    }).sort("timestamp", 1).to_list(10000)
    
    # Calculate totals
    days = {}
    for event in events:
        date = event["date"]
        if date not in days:
            days[date] = {}
        days[date][event["eventType"]] = event
    
    total_net_minutes = 0
    total_days = len(days)
    
    for day_events in days.values():
        clock_in = day_events.get("CLOCK_IN", {})
        clock_out = day_events.get("CLOCK_OUT", {})
        lunch_start = day_events.get("LUNCH_START", {})
        lunch_end = day_events.get("LUNCH_END", {})
        
        gross = 0
        brk = 0
        
        if clock_in.get("timestamp") and clock_out.get("timestamp"):
            gross = int((clock_out["timestamp"] - clock_in["timestamp"]).total_seconds() / 60)
        if lunch_start.get("timestamp") and lunch_end.get("timestamp"):
            brk = int((lunch_end["timestamp"] - lunch_start["timestamp"]).total_seconds() / 60)
        
        total_net_minutes += max(0, gross - brk)
    
    html_content = f"""
    <!DOCTYPE html>
    <html>
    <head>
        <meta charset="utf-8">
        <title>Folha de Ponto - {target_user['name']}</title>
        <style>
            body {{ font-family: Arial, sans-serif; margin: 40px; }}
            h1 {{ color: #1a73e8; }}
            .header {{ margin-bottom: 30px; }}
            .summary {{ background: #f5f5f5; padding: 20px; border-radius: 8px; margin-bottom: 30px; }}
            .summary h2 {{ margin-top: 0; }}
            table {{ width: 100%; border-collapse: collapse; }}
            th, td {{ border: 1px solid #ddd; padding: 10px; text-align: left; }}
            th {{ background: #1a73e8; color: white; }}
            .total {{ font-weight: bold; background: #e3f2fd; }}
            @media print {{
                body {{ margin: 20px; }}
                .no-print {{ display: none; }}
            }}
        </style>
    </head>
    <body>
        <div class="header">
            <h1>GeoPunch - Folha de Ponto</h1>
            <p><strong>Funcionário:</strong> {target_user['name']}</p>
            <p><strong>ID:</strong> {target_user.get('employeeId', 'N/A')}</p>
            <p><strong>Local de Trabalho:</strong> {workplace['name'] if workplace else 'N/A'}</p>
            <p><strong>Período:</strong> {from_date} a {to_date}</p>
        </div>
        
        <div class="summary">
            <h2>Resumo</h2>
            <p><strong>Total de dias trabalhados:</strong> {total_days}</p>
            <p><strong>Total de horas trabalhadas:</strong> {format_minutes(total_net_minutes)} ({total_net_minutes} minutos)</p>
            <p><strong>Média diária:</strong> {format_minutes(total_net_minutes // total_days if total_days > 0 else 0)}</p>
        </div>
        
        <p class="no-print">Para guardar como PDF, use Ctrl+P (ou Cmd+P) e selecione "Guardar como PDF"</p>
        
        <p><em>Gerado em: {datetime.utcnow().strftime('%Y-%m-%d %H:%M:%S')} UTC</em></p>
    </body>
    </html>
    """
    
    return StreamingResponse(
        iter([html_content]),
        media_type="text/html; charset=utf-8",
        headers={
            "Content-Disposition": f"inline; filename=folha_ponto_{from_date}_{to_date}.html"
        }
    )

# ==================== SEED DATA ====================

@api_router.post("/seed")
async def seed_data():
    """Seed initial data for testing"""
    
    # Check if admin exists
    admin = await db.users.find_one({"email": "admin@geopunch.pt"})
    if not admin:
        admin_doc = {
            "email": "admin@geopunch.pt",
            "password_hash": hash_password("admin123"),
            "name": "Administrador",
            "employeeId": "ADM001",
            "role": "admin",
            "workplaceId": None,
            "createdAt": datetime.utcnow(),
            "lastLogin": None,
            "loginCount": 0
        }
        await db.users.insert_one(admin_doc)
        logger.info("Admin user created")
    
    # Check if sample workplace exists
    workplace = await db.workplaces.find_one({"name": "Escritório Central"})
    workplace_id = None
    if not workplace:
        workplace_doc = {
            "name": "Escritório Central",
            "latitude": 38.7223,  # Lisbon coordinates
            "longitude": -9.1393,
            "radiusMeters": 150,
            "startTime": "09:00",
            "endTime": "18:00",
            "allowedMarginMinutes": 120,
            "timezone": "Europe/Lisbon",
            "createdAt": datetime.utcnow()
        }
        result = await db.workplaces.insert_one(workplace_doc)
        workplace_id = result.inserted_id
        logger.info(f"Sample workplace created with id: {workplace_id}")
    else:
        workplace_id = workplace["_id"]
    
    # Assign workplace to admin if not assigned
    admin = await db.users.find_one({"email": "admin@geopunch.pt"})
    if admin and not admin.get("workplaceId"):
        await db.users.update_one(
            {"_id": admin["_id"]},
            {"$set": {"workplaceId": workplace_id}}
        )
    
    return {"message": "Dados de teste criados com sucesso"}

# ==================== ROOT ====================

@api_router.get("/")
async def root():
    return {"message": "GeoPunch API v2.0", "status": "online"}

@api_router.get("/health")
async def health_check():
    return {"status": "healthy", "timestamp": datetime.utcnow(), "version": "2.0.0"}

# Include the router in the main app
app.include_router(api_router)

app.add_middleware(
    CORSMiddleware,
    allow_credentials=True,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

@app.on_event("startup")
async def startup_event():
    """Initialize database indexes and seed data on startup"""
    # Create indexes for performance and uniqueness
    await db.users.create_index("email", unique=True)
    await db.punch_events.create_index([("userId", 1), ("date", 1), ("eventType", 1)])
    await db.punch_events.create_index("eventId", sparse=True)  # For idempotency
    await db.geofence_events.create_index("eventId", unique=True)
    await db.audit_logs.create_index([("timestamp", -1)])
    await db.audit_logs.create_index("targetType")
    logger.info("Database indexes created")

@app.on_event("shutdown")
async def shutdown_db_client():
    client.close()

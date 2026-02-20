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
from typing import List, Optional, Literal, Dict
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

# JWT Configuration
SECRET_KEY = os.environ.get('JWT_SECRET', 'geopunch-secret-key-change-in-production')
REFRESH_SECRET_KEY = os.environ.get('JWT_REFRESH_SECRET', 'geopunch-refresh-secret')
ALGORITHM = "HS256"
ACCESS_TOKEN_EXPIRE_MINUTES = 30
REFRESH_TOKEN_EXPIRE_DAYS = 7

# Password hashing
pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")

# Security
security = HTTPBearer()

# Rate limiting
login_attempts = defaultdict(list)
RATE_LIMIT_WINDOW = 300
MAX_LOGIN_ATTEMPTS = 5
LOCKOUT_DURATION = 900

# Create the main app
app = FastAPI(title="GeoPunch API", version="3.0.0")
api_router = APIRouter(prefix="/api")

logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(name)s - %(levelname)s - %(message)s')
logger = logging.getLogger(__name__)

# ==================== MODELS ====================

# Workdays model - bitmask or booleans
class WorkdaysConfig(BaseModel):
    monday: bool = True
    tuesday: bool = True
    wednesday: bool = True
    thursday: bool = True
    friday: bool = True
    saturday: bool = False
    sunday: bool = False
    
    def to_list(self) -> List[str]:
        days = []
        if self.monday: days.append("Mon")
        if self.tuesday: days.append("Tue")
        if self.wednesday: days.append("Wed")
        if self.thursday: days.append("Thu")
        if self.friday: days.append("Fri")
        if self.saturday: days.append("Sat")
        if self.sunday: days.append("Sun")
        return days

class ScheduleConfig(BaseModel):
    startTime: str = "09:00"
    endTime: str = "18:00"
    marginMinutes: int = 120

class WorkplaceCreate(BaseModel):
    name: str
    latitude: float
    longitude: float
    radiusMeters: int = 150
    workdays: WorkdaysConfig = WorkdaysConfig()
    schedule: Optional[ScheduleConfig] = None
    
    @validator('radiusMeters')
    def validate_radius(cls, v):
        if v < 50 or v > 300:
            raise ValueError('Raio deve estar entre 50m e 300m')
        return v
    
    @validator('name')
    def validate_name(cls, v):
        if not v or not v.strip():
            raise ValueError('Nome é obrigatório')
        return v.strip()

class WorkplaceUpdate(BaseModel):
    """Only non-location fields can be updated"""
    name: Optional[str] = None
    radiusMeters: Optional[int] = None
    workdays: Optional[WorkdaysConfig] = None
    schedule: Optional[ScheduleConfig] = None
    
    @validator('radiusMeters')
    def validate_radius(cls, v):
        if v is not None and (v < 50 or v > 300):
            raise ValueError('Raio deve estar entre 50m e 300m')
        return v

class WorkplaceResponse(BaseModel):
    id: str
    name: str
    latitude: float
    longitude: float
    radiusMeters: int
    workdays: Dict
    schedule: Optional[Dict] = None
    locationLocked: bool = True
    configuredAt: datetime
    isActive: bool = False
    createdAt: datetime

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

class UserLogin(BaseModel):
    email: EmailStr
    password: str

class UserResponse(BaseModel):
    id: str
    email: str
    name: str
    employeeId: Optional[str] = None
    role: str
    activeWorkplaceId: Optional[str] = None
    createdAt: datetime

class TokenResponse(BaseModel):
    access_token: str
    refresh_token: str
    token_type: str = "bearer"
    expires_in: int = ACCESS_TOKEN_EXPIRE_MINUTES * 60
    user: UserResponse

class RefreshTokenRequest(BaseModel):
    refresh_token: str

class PunchCreate(BaseModel):
    punchType: Literal["IN", "OUT", "BREAK_START", "BREAK_END"]
    latitude: float
    longitude: float
    accuracy: float
    deviceTime: Optional[datetime] = None
    note: Optional[str] = None
    method: Literal["manual", "geofence_suggestion"] = "manual"

class PunchResponse(BaseModel):
    id: str
    userId: str
    workplaceId: str
    workplaceName: str
    date: str
    punchType: str
    occurredAt: datetime
    receivedAt: datetime
    latitude: float
    longitude: float
    accuracyMeters: float
    distanceToWorkplaceMeters: float
    method: str
    outsideWorkplace: bool
    note: Optional[str] = None

class GeofenceEventCreate(BaseModel):
    eventId: str
    eventType: Literal["ENTER", "EXIT"]
    latitude: float
    longitude: float
    accuracy: float
    deviceTime: Optional[datetime] = None

class DayTimesheetResponse(BaseModel):
    date: str
    workplaceName: str
    workplaceId: str
    isScheduledWorkday: bool
    punches: List[Dict]
    grossMinutes: int = 0
    breakMinutes: int = 0
    netWorkedMinutes: int = 0
    netWorkedFormatted: str = "00:00"
    status: str
    anomalies: List[str] = []

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

def check_rate_limit(email: str) -> bool:
    now = datetime.utcnow()
    login_attempts[email] = [t for t in login_attempts[email] if (now - t).total_seconds() < RATE_LIMIT_WINDOW]
    if len(login_attempts[email]) >= MAX_LOGIN_ATTEMPTS:
        oldest = min(login_attempts[email])
        if (now - oldest).total_seconds() < LOCKOUT_DURATION:
            return False
    return True

def record_login_attempt(email: str):
    login_attempts[email].append(datetime.utcnow())

def clear_login_attempts(email: str):
    login_attempts[email] = []

def calculate_distance(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    from math import radians, sin, cos, sqrt, atan2
    R = 6371000
    lat1_rad = radians(lat1)
    lat2_rad = radians(lat2)
    delta_lat = radians(lat2 - lat1)
    delta_lon = radians(lon2 - lon1)
    a = sin(delta_lat/2)**2 + cos(lat1_rad) * cos(lat2_rad) * sin(delta_lon/2)**2
    c = 2 * atan2(sqrt(a), sqrt(1-a))
    return R * c

def format_minutes(minutes: int) -> str:
    hours = minutes // 60
    mins = minutes % 60
    return f"{hours:02d}:{mins:02d}"

def get_today_date() -> str:
    return datetime.utcnow().strftime("%Y-%m-%d")

def is_workday(workdays: dict, date: datetime) -> bool:
    """Check if given date is a configured workday"""
    day_map = {
        0: 'monday',
        1: 'tuesday', 
        2: 'wednesday',
        3: 'thursday',
        4: 'friday',
        5: 'saturday',
        6: 'sunday'
    }
    day_name = day_map[date.weekday()]
    return workdays.get(day_name, False)

def generate_maps_link(lat: float, lng: float) -> str:
    """Generate Google Maps link for coordinates"""
    return f"https://maps.google.com/?q={lat},{lng}"

# ==================== AUTH ENDPOINTS ====================

@api_router.post("/auth/register", response_model=TokenResponse)
async def register(user_data: UserCreate):
    existing = await db.users.find_one({"email": user_data.email.lower()})
    if existing:
        raise HTTPException(status_code=400, detail="Email já registado")
    
    user_doc = {
        "email": user_data.email.lower(),
        "password_hash": hash_password(user_data.password),
        "name": user_data.name,
        "employeeId": user_data.employeeId,
        "role": "employee",
        "activeWorkplaceId": None,
        "createdAt": datetime.utcnow(),
        "lastLogin": None,
        "loginCount": 0
    }
    
    result = await db.users.insert_one(user_doc)
    user_doc["_id"] = result.inserted_id
    
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
            activeWorkplaceId=None,
            createdAt=user_doc["createdAt"]
        )
    )

@api_router.post("/auth/login", response_model=TokenResponse)
async def login(credentials: UserLogin):
    email = credentials.email.lower()
    
    if not check_rate_limit(email):
        raise HTTPException(status_code=429, detail="Demasiadas tentativas. Tente novamente em 15 minutos.")
    
    user = await db.users.find_one({"email": email})
    if not user or not verify_password(credentials.password, user["password_hash"]):
        record_login_attempt(email)
        raise HTTPException(status_code=401, detail="Email ou senha incorretos")
    
    clear_login_attempts(email)
    
    await db.users.update_one(
        {"_id": user["_id"]},
        {"$set": {"lastLogin": datetime.utcnow()}, "$inc": {"loginCount": 1}}
    )
    
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
            activeWorkplaceId=str(user["activeWorkplaceId"]) if user.get("activeWorkplaceId") else None,
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
                activeWorkplaceId=str(user["activeWorkplaceId"]) if user.get("activeWorkplaceId") else None,
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
        activeWorkplaceId=str(user["activeWorkplaceId"]) if user.get("activeWorkplaceId") else None,
        createdAt=user["createdAt"]
    )

# ==================== WORKPLACE ENDPOINTS (USER-OWNED) ====================

@api_router.get("/workplaces", response_model=List[WorkplaceResponse])
async def list_user_workplaces(user = Depends(get_current_user)):
    """List all workplaces owned by the current user"""
    workplaces = await db.workplaces.find({"userId": user["_id"]}).to_list(100)
    active_id = user.get("activeWorkplaceId")
    
    return [
        WorkplaceResponse(
            id=str(w["_id"]),
            name=w["name"],
            latitude=w["latitude"],
            longitude=w["longitude"],
            radiusMeters=w["radiusMeters"],
            workdays=w.get("workdays", {}),
            schedule=w.get("schedule"),
            locationLocked=w.get("locationLocked", True),
            configuredAt=w.get("configuredAt", w["createdAt"]),
            isActive=str(w["_id"]) == str(active_id) if active_id else False,
            createdAt=w["createdAt"]
        )
        for w in workplaces
    ]

@api_router.post("/workplaces", response_model=WorkplaceResponse)
async def create_workplace(workplace: WorkplaceCreate, user = Depends(get_current_user)):
    """Create a new workplace with LOCKED location"""
    now = datetime.utcnow()
    
    workplace_doc = {
        "userId": user["_id"],
        "name": workplace.name,
        "latitude": workplace.latitude,
        "longitude": workplace.longitude,
        "radiusMeters": workplace.radiusMeters,
        "workdays": workplace.workdays.dict(),
        "schedule": workplace.schedule.dict() if workplace.schedule else None,
        "locationLocked": True,  # ALWAYS locked after creation
        "configuredAt": now,
        "createdAt": now,
        "versionHistory": [{
            "timestamp": now,
            "changes": {"initial": True},
            "workdays": workplace.workdays.dict(),
            "schedule": workplace.schedule.dict() if workplace.schedule else None,
            "radiusMeters": workplace.radiusMeters
        }]
    }
    
    result = await db.workplaces.insert_one(workplace_doc)
    workplace_doc["_id"] = result.inserted_id
    
    # If this is the user's first workplace, set it as active
    user_workplaces = await db.workplaces.count_documents({"userId": user["_id"]})
    if user_workplaces == 1:
        await db.users.update_one(
            {"_id": user["_id"]},
            {"$set": {"activeWorkplaceId": result.inserted_id}}
        )
    
    return WorkplaceResponse(
        id=str(workplace_doc["_id"]),
        name=workplace_doc["name"],
        latitude=workplace_doc["latitude"],
        longitude=workplace_doc["longitude"],
        radiusMeters=workplace_doc["radiusMeters"],
        workdays=workplace_doc["workdays"],
        schedule=workplace_doc["schedule"],
        locationLocked=True,
        configuredAt=workplace_doc["configuredAt"],
        isActive=user_workplaces == 1,
        createdAt=workplace_doc["createdAt"]
    )

@api_router.put("/workplaces/{workplace_id}", response_model=WorkplaceResponse)
async def update_workplace(workplace_id: str, update: WorkplaceUpdate, user = Depends(get_current_user)):
    """Update non-location fields only. Changes apply from next day."""
    workplace = await db.workplaces.find_one({
        "_id": ObjectId(workplace_id),
        "userId": user["_id"]
    })
    
    if not workplace:
        raise HTTPException(status_code=404, detail="Local de trabalho não encontrado")
    
    # Build update dict (only non-location fields)
    update_dict = {}
    changes = {}
    now = datetime.utcnow()
    
    if update.name is not None:
        update_dict["name"] = update.name
        changes["name"] = {"old": workplace["name"], "new": update.name}
    
    if update.radiusMeters is not None:
        update_dict["radiusMeters"] = update.radiusMeters
        changes["radiusMeters"] = {"old": workplace["radiusMeters"], "new": update.radiusMeters}
    
    if update.workdays is not None:
        update_dict["workdays"] = update.workdays.dict()
        changes["workdays"] = {"old": workplace.get("workdays"), "new": update.workdays.dict()}
    
    if update.schedule is not None:
        update_dict["schedule"] = update.schedule.dict()
        changes["schedule"] = {"old": workplace.get("schedule"), "new": update.schedule.dict()}
    
    if update_dict:
        # Add to version history
        version_entry = {
            "timestamp": now,
            "changes": changes,
            "effectiveFrom": (now + timedelta(days=1)).strftime("%Y-%m-%d"),  # Changes apply from next day
            "workdays": update_dict.get("workdays", workplace.get("workdays")),
            "schedule": update_dict.get("schedule", workplace.get("schedule")),
            "radiusMeters": update_dict.get("radiusMeters", workplace["radiusMeters"])
        }
        
        await db.workplaces.update_one(
            {"_id": ObjectId(workplace_id)},
            {
                "$set": update_dict,
                "$push": {"versionHistory": version_entry}
            }
        )
    
    updated = await db.workplaces.find_one({"_id": ObjectId(workplace_id)})
    active_id = user.get("activeWorkplaceId")
    
    return WorkplaceResponse(
        id=str(updated["_id"]),
        name=updated["name"],
        latitude=updated["latitude"],
        longitude=updated["longitude"],
        radiusMeters=updated["radiusMeters"],
        workdays=updated.get("workdays", {}),
        schedule=updated.get("schedule"),
        locationLocked=True,
        configuredAt=updated.get("configuredAt", updated["createdAt"]),
        isActive=str(updated["_id"]) == str(active_id) if active_id else False,
        createdAt=updated["createdAt"]
    )

@api_router.post("/workplaces/{workplace_id}/activate")
async def set_active_workplace(workplace_id: str, user = Depends(get_current_user)):
    """Set a workplace as the active one"""
    workplace = await db.workplaces.find_one({
        "_id": ObjectId(workplace_id),
        "userId": user["_id"]
    })
    
    if not workplace:
        raise HTTPException(status_code=404, detail="Local de trabalho não encontrado")
    
    await db.users.update_one(
        {"_id": user["_id"]},
        {"$set": {"activeWorkplaceId": ObjectId(workplace_id)}}
    )
    
    return {"message": f"'{workplace['name']}' definido como local de trabalho ativo"}

@api_router.get("/workplaces/active", response_model=Optional[WorkplaceResponse])
async def get_active_workplace(user = Depends(get_current_user)):
    """Get the currently active workplace"""
    if not user.get("activeWorkplaceId"):
        return None
    
    workplace = await db.workplaces.find_one({"_id": user["activeWorkplaceId"]})
    if not workplace:
        return None
    
    return WorkplaceResponse(
        id=str(workplace["_id"]),
        name=workplace["name"],
        latitude=workplace["latitude"],
        longitude=workplace["longitude"],
        radiusMeters=workplace["radiusMeters"],
        workdays=workplace.get("workdays", {}),
        schedule=workplace.get("schedule"),
        locationLocked=True,
        configuredAt=workplace.get("configuredAt", workplace["createdAt"]),
        isActive=True,
        createdAt=workplace["createdAt"]
    )

# Legacy endpoint for backwards compatibility
@api_router.get("/workplace", response_model=Optional[WorkplaceResponse])
async def get_user_workplace(user = Depends(get_current_user)):
    """Legacy endpoint - returns active workplace"""
    return await get_active_workplace(user)

# ==================== PUNCH ENDPOINTS ====================

@api_router.post("/punch", response_model=PunchResponse)
async def create_punch(punch: PunchCreate, user = Depends(get_current_user)):
    """Create a punch (IN, OUT, BREAK_START, BREAK_END)"""
    
    # Get active workplace
    if not user.get("activeWorkplaceId"):
        raise HTTPException(status_code=400, detail="Nenhum local de trabalho ativo. Configure um local primeiro.")
    
    workplace = await db.workplaces.find_one({"_id": user["activeWorkplaceId"]})
    if not workplace:
        raise HTTPException(status_code=404, detail="Local de trabalho não encontrado")
    
    server_time = datetime.utcnow()
    device_time = punch.deviceTime or server_time
    today = server_time.strftime("%Y-%m-%d")
    
    # Calculate distance
    distance = calculate_distance(
        punch.latitude, punch.longitude,
        workplace["latitude"], workplace["longitude"]
    )
    
    outside_workplace = distance > workplace["radiusMeters"]
    
    # Validation for IN/OUT
    if punch.punchType == "IN":
        # Check if already punched in today
        existing_in = await db.punches.find_one({
            "userId": user["_id"],
            "date": today,
            "punchType": "IN"
        })
        if existing_in:
            raise HTTPException(status_code=400, detail="Já registou entrada hoje")
    
    elif punch.punchType == "OUT":
        # Must have IN first
        punch_in = await db.punches.find_one({
            "userId": user["_id"],
            "date": today,
            "punchType": "IN"
        })
        if not punch_in:
            raise HTTPException(status_code=400, detail="Não é possível registar saída sem entrada")
        
        # Check if already punched out
        existing_out = await db.punches.find_one({
            "userId": user["_id"],
            "date": today,
            "punchType": "OUT"
        })
        if existing_out:
            raise HTTPException(status_code=400, detail="Já registou saída hoje")
        
        # Check for unclosed break
        breaks = await db.punches.find({
            "userId": user["_id"],
            "date": today,
            "punchType": {"$in": ["BREAK_START", "BREAK_END"]}
        }).to_list(100)
        
        break_starts = len([b for b in breaks if b["punchType"] == "BREAK_START"])
        break_ends = len([b for b in breaks if b["punchType"] == "BREAK_END"])
        
        if break_starts > break_ends:
            raise HTTPException(status_code=400, detail="Termine a pausa antes de registar saída")
    
    elif punch.punchType == "BREAK_START":
        # Must have IN and no OUT
        punch_in = await db.punches.find_one({
            "userId": user["_id"],
            "date": today,
            "punchType": "IN"
        })
        if not punch_in:
            raise HTTPException(status_code=400, detail="Não é possível iniciar pausa sem entrada")
        
        punch_out = await db.punches.find_one({
            "userId": user["_id"],
            "date": today,
            "punchType": "OUT"
        })
        if punch_out:
            raise HTTPException(status_code=400, detail="Não é possível iniciar pausa após saída")
        
        # Check for unclosed break
        breaks = await db.punches.find({
            "userId": user["_id"],
            "date": today,
            "punchType": {"$in": ["BREAK_START", "BREAK_END"]}
        }).to_list(100)
        
        break_starts = len([b for b in breaks if b["punchType"] == "BREAK_START"])
        break_ends = len([b for b in breaks if b["punchType"] == "BREAK_END"])
        
        if break_starts > break_ends:
            raise HTTPException(status_code=400, detail="Já tem uma pausa em curso")
    
    elif punch.punchType == "BREAK_END":
        # Must have unclosed break
        breaks = await db.punches.find({
            "userId": user["_id"],
            "date": today,
            "punchType": {"$in": ["BREAK_START", "BREAK_END"]}
        }).to_list(100)
        
        break_starts = len([b for b in breaks if b["punchType"] == "BREAK_START"])
        break_ends = len([b for b in breaks if b["punchType"] == "BREAK_END"])
        
        if break_starts <= break_ends:
            raise HTTPException(status_code=400, detail="Nenhuma pausa em curso para terminar")
    
    # Create punch with evidence data
    punch_doc = {
        "userId": user["_id"],
        "workplaceId": workplace["_id"],
        "workplaceName": workplace["name"],
        "workplaceLocationSnapshot": {
            "latitude": workplace["latitude"],
            "longitude": workplace["longitude"],
            "radiusMeters": workplace["radiusMeters"]
        },
        "date": today,
        "punchType": punch.punchType,
        "occurredAt": device_time,
        "receivedAt": server_time,
        "latitude": punch.latitude,
        "longitude": punch.longitude,
        "accuracyMeters": punch.accuracy,
        "distanceToWorkplaceMeters": distance,
        "method": punch.method,
        "outsideWorkplace": outside_workplace,
        "note": punch.note
    }
    
    result = await db.punches.insert_one(punch_doc)
    
    location_warning = ""
    if outside_workplace:
        location_warning = f" (fora do local: {int(distance)}m)"
    
    return PunchResponse(
        id=str(result.inserted_id),
        userId=str(user["_id"]),
        workplaceId=str(workplace["_id"]),
        workplaceName=workplace["name"],
        date=today,
        punchType=punch.punchType,
        occurredAt=device_time,
        receivedAt=server_time,
        latitude=punch.latitude,
        longitude=punch.longitude,
        accuracyMeters=punch.accuracy,
        distanceToWorkplaceMeters=distance,
        method=punch.method,
        outsideWorkplace=outside_workplace,
        note=punch.note
    )

# Legacy endpoint for backwards compatibility
@api_router.post("/punch/manual")
async def manual_punch_legacy(punch: PunchCreate, user = Depends(get_current_user)):
    """Legacy endpoint - maps to new punch endpoint"""
    # Map old types to new
    type_map = {
        "CLOCK_IN": "IN",
        "CLOCK_OUT": "OUT",
        "LUNCH_START": "BREAK_START",
        "LUNCH_END": "BREAK_END"
    }
    
    # Accept both old and new types
    punch_type = punch.punchType
    if punch_type in type_map:
        punch.punchType = type_map[punch_type]
    
    return await create_punch(punch, user)

@api_router.post("/break/manual")
async def manual_break_legacy(break_data: PunchCreate, user = Depends(get_current_user)):
    """Legacy endpoint for breaks"""
    type_map = {
        "LUNCH_START": "BREAK_START",
        "LUNCH_END": "BREAK_END",
        "BREAK_START": "BREAK_START",
        "BREAK_END": "BREAK_END"
    }
    
    break_data.punchType = type_map.get(break_data.punchType, break_data.punchType)
    return await create_punch(break_data, user)

# ==================== GEOFENCE EVENTS ====================

@api_router.post("/events/geofence")
async def process_geofence_event(event: GeofenceEventCreate, user = Depends(get_current_user)):
    """Process geofence events - notify but don't auto-punch"""
    
    # Check idempotency
    existing = await db.geofence_events.find_one({"eventId": event.eventId})
    if existing:
        return {
            "processed": True,
            "duplicate": True,
            "suggestion": existing.get("suggestion"),
            "message": "Evento já processado"
        }
    
    if not user.get("activeWorkplaceId"):
        return {
            "processed": True,
            "suggestion": None,
            "message": "Nenhum local de trabalho ativo"
        }
    
    workplace = await db.workplaces.find_one({"_id": user["activeWorkplaceId"]})
    if not workplace:
        return {
            "processed": True,
            "suggestion": None,
            "message": "Local de trabalho não encontrado"
        }
    
    server_time = datetime.utcnow()
    today = server_time.strftime("%Y-%m-%d")
    
    distance = calculate_distance(
        event.latitude, event.longitude,
        workplace["latitude"], workplace["longitude"]
    )
    
    # Determine suggestion based on event type
    suggestion = None
    message = ""
    
    if event.eventType == "ENTER":
        # Check if not already punched in
        existing_in = await db.punches.find_one({
            "userId": user["_id"],
            "date": today,
            "punchType": "IN"
        })
        
        if not existing_in:
            suggestion = {
                "action": "START_SHIFT",
                "message": f"Chegou a '{workplace['name']}'. Iniciar turno?"
            }
            message = f"Chegou a '{workplace['name']}'"
        else:
            message = f"Regressou a '{workplace['name']}'"
    
    elif event.eventType == "EXIT":
        # Check if punched in but not out
        existing_in = await db.punches.find_one({
            "userId": user["_id"],
            "date": today,
            "punchType": "IN"
        })
        existing_out = await db.punches.find_one({
            "userId": user["_id"],
            "date": today,
            "punchType": "OUT"
        })
        
        if existing_in and not existing_out:
            suggestion = {
                "action": "END_SHIFT",
                "message": f"A sair de '{workplace['name']}'. Terminar turno?",
                "options": ["Terminar turno", "Continuar a trabalhar"]
            }
            message = f"A sair de '{workplace['name']}'"
        else:
            message = f"Saiu de '{workplace['name']}'"
    
    # Store event
    geofence_doc = {
        "eventId": event.eventId,
        "userId": user["_id"],
        "workplaceId": workplace["_id"],
        "eventType": event.eventType,
        "timestamp": event.deviceTime or server_time,
        "serverTime": server_time,
        "latitude": event.latitude,
        "longitude": event.longitude,
        "accuracy": event.accuracy,
        "distance": distance,
        "suggestion": suggestion
    }
    
    await db.geofence_events.insert_one(geofence_doc)
    
    return {
        "processed": True,
        "duplicate": False,
        "suggestion": suggestion,
        "workplaceName": workplace["name"],
        "distance": int(distance),
        "message": message
    }

# ==================== TIMESHEET ====================

@api_router.get("/timesheet")
async def get_timesheet(
    from_date: Optional[str] = None,
    to_date: Optional[str] = None,
    user = Depends(get_current_user)
):
    """Get timesheet with daily summaries"""
    
    if not from_date:
        from_date = (datetime.utcnow() - timedelta(days=30)).strftime("%Y-%m-%d")
    if not to_date:
        to_date = datetime.utcnow().strftime("%Y-%m-%d")
    
    # Get all punches in date range
    punches = await db.punches.find({
        "userId": user["_id"],
        "date": {"$gte": from_date, "$lte": to_date}
    }).sort("occurredAt", 1).to_list(1000)
    
    # Get active workplace for workday info
    active_workplace = None
    if user.get("activeWorkplaceId"):
        active_workplace = await db.workplaces.find_one({"_id": user["activeWorkplaceId"]})
    
    # Group by date
    days = {}
    for punch in punches:
        date = punch["date"]
        if date not in days:
            days[date] = {
                "punches": [],
                "workplaceId": str(punch["workplaceId"]),
                "workplaceName": punch["workplaceName"],
                "anomalies": []
            }
        
        days[date]["punches"].append({
            "id": str(punch["_id"]),
            "type": punch["punchType"],
            "occurredAt": punch["occurredAt"],
            "method": punch["method"],
            "outsideWorkplace": punch["outsideWorkplace"],
            "distance": punch["distanceToWorkplaceMeters"],
            "accuracy": punch["accuracyMeters"],
            "note": punch.get("note"),
            "mapsLink": generate_maps_link(punch["latitude"], punch["longitude"])
        })
        
        if punch["outsideWorkplace"]:
            days[date]["anomalies"].append(f"{punch['punchType']}: fora do local")
        if punch["accuracyMeters"] > 50:
            days[date]["anomalies"].append(f"{punch['punchType']}: GPS impreciso ({int(punch['accuracyMeters'])}m)")
    
    # Calculate summaries
    result = []
    for date_str, day_data in sorted(days.items(), reverse=True):
        date_obj = datetime.strptime(date_str, "%Y-%m-%d")
        
        # Check if scheduled workday
        is_workday_flag = False
        if active_workplace and active_workplace.get("workdays"):
            is_workday_flag = is_workday(active_workplace["workdays"], date_obj)
        
        # Calculate times
        gross_minutes = 0
        break_minutes = 0
        status = "not_started"
        
        punch_in = None
        punch_out = None
        break_pairs = []
        current_break_start = None
        
        for p in day_data["punches"]:
            if p["type"] == "IN":
                punch_in = p["occurredAt"]
                status = "working"
            elif p["type"] == "OUT":
                punch_out = p["occurredAt"]
                status = "finished"
            elif p["type"] == "BREAK_START":
                current_break_start = p["occurredAt"]
                status = "on_break"
            elif p["type"] == "BREAK_END" and current_break_start:
                break_pairs.append((current_break_start, p["occurredAt"]))
                current_break_start = None
                status = "working"
        
        if punch_in:
            if punch_out:
                delta = punch_out - punch_in
                gross_minutes = int(delta.total_seconds() / 60)
            else:
                delta = datetime.utcnow() - punch_in
                gross_minutes = int(delta.total_seconds() / 60)
        
        for start, end in break_pairs:
            delta = end - start
            break_minutes += int(delta.total_seconds() / 60)
        
        # Add current break if unclosed
        if current_break_start:
            delta = datetime.utcnow() - current_break_start
            break_minutes += int(delta.total_seconds() / 60)
        
        net_minutes = max(0, gross_minutes - break_minutes)
        
        # Add warning if not a scheduled workday
        if not is_workday_flag and punch_in:
            day_data["anomalies"].append("Dia não agendado como dia de trabalho")
        
        result.append(DayTimesheetResponse(
            date=date_str,
            workplaceName=day_data["workplaceName"],
            workplaceId=day_data["workplaceId"],
            isScheduledWorkday=is_workday_flag,
            punches=day_data["punches"],
            grossMinutes=gross_minutes,
            breakMinutes=break_minutes,
            netWorkedMinutes=net_minutes,
            netWorkedFormatted=format_minutes(net_minutes),
            status=status,
            anomalies=list(set(day_data["anomalies"]))
        ))
    
    return result

@api_router.get("/timesheet/today")
async def get_today_status(user = Depends(get_current_user)):
    """Get today's status"""
    
    today = get_today_date()
    today_date = datetime.utcnow()
    
    # Get active workplace
    workplace = None
    if user.get("activeWorkplaceId"):
        workplace = await db.workplaces.find_one({"_id": user["activeWorkplaceId"]})
    
    # Get today's punches
    punches = await db.punches.find({
        "userId": user["_id"],
        "date": today
    }).sort("occurredAt", 1).to_list(100)
    
    # Process punches
    punch_data = {
        "in": None,
        "out": None,
        "breaks": []
    }
    
    current_break_start = None
    
    for p in punches:
        if p["punchType"] == "IN":
            punch_data["in"] = p
        elif p["punchType"] == "OUT":
            punch_data["out"] = p
        elif p["punchType"] == "BREAK_START":
            current_break_start = p
        elif p["punchType"] == "BREAK_END" and current_break_start:
            punch_data["breaks"].append({
                "start": current_break_start,
                "end": p
            })
            current_break_start = None
    
    # If break is still open
    if current_break_start:
        punch_data["breaks"].append({
            "start": current_break_start,
            "end": None
        })
    
    # Calculate times
    gross_minutes = 0
    break_minutes = 0
    status = "not_started"
    
    if punch_data["in"]:
        status = "working"
        
        if current_break_start:
            status = "on_break"
        
        if punch_data["out"]:
            status = "finished"
            delta = punch_data["out"]["occurredAt"] - punch_data["in"]["occurredAt"]
            gross_minutes = int(delta.total_seconds() / 60)
        else:
            delta = datetime.utcnow() - punch_data["in"]["occurredAt"]
            gross_minutes = int(delta.total_seconds() / 60)
    
    for brk in punch_data["breaks"]:
        if brk["end"]:
            delta = brk["end"]["occurredAt"] - brk["start"]["occurredAt"]
        else:
            delta = datetime.utcnow() - brk["start"]["occurredAt"]
        break_minutes += int(delta.total_seconds() / 60)
    
    net_minutes = max(0, gross_minutes - break_minutes)
    
    # Check if scheduled workday
    is_workday_flag = False
    if workplace and workplace.get("workdays"):
        is_workday_flag = is_workday(workplace["workdays"], today_date)
    
    return {
        "date": today,
        "isScheduledWorkday": is_workday_flag,
        "workplace": {
            "id": str(workplace["_id"]) if workplace else None,
            "name": workplace["name"] if workplace else None,
            "latitude": workplace["latitude"] if workplace else None,
            "longitude": workplace["longitude"] if workplace else None,
            "radiusMeters": workplace["radiusMeters"] if workplace else None,
            "workdays": workplace.get("workdays") if workplace else None,
            "schedule": workplace.get("schedule") if workplace else None,
            "mapsLink": generate_maps_link(workplace["latitude"], workplace["longitude"]) if workplace else None
        } if workplace else None,
        "punchIn": {
            "occurredAt": punch_data["in"]["occurredAt"],
            "method": punch_data["in"]["method"],
            "outsideWorkplace": punch_data["in"]["outsideWorkplace"]
        } if punch_data["in"] else None,
        "punchOut": {
            "occurredAt": punch_data["out"]["occurredAt"],
            "method": punch_data["out"]["method"],
            "outsideWorkplace": punch_data["out"]["outsideWorkplace"]
        } if punch_data["out"] else None,
        "breaks": [
            {
                "startedAt": b["start"]["occurredAt"],
                "endedAt": b["end"]["occurredAt"] if b["end"] else None,
                "durationMinutes": int((b["end"]["occurredAt"] - b["start"]["occurredAt"]).total_seconds() / 60) if b["end"] else int((datetime.utcnow() - b["start"]["occurredAt"]).total_seconds() / 60)
            }
            for b in punch_data["breaks"]
        ],
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
    user = Depends(get_current_user)
):
    """Export timesheet as CSV with evidence data"""
    
    if not from_date:
        from_date = (datetime.utcnow() - timedelta(days=30)).strftime("%Y-%m-%d")
    if not to_date:
        to_date = datetime.utcnow().strftime("%Y-%m-%d")
    
    # Get user's workplaces
    workplaces = {str(w["_id"]): w async for w in db.workplaces.find({"userId": user["_id"]})}
    
    # Get punches
    punches = await db.punches.find({
        "userId": user["_id"],
        "date": {"$gte": from_date, "$lte": to_date}
    }).sort("occurredAt", 1).to_list(10000)
    
    # Group by date
    days = {}
    for punch in punches:
        date = punch["date"]
        if date not in days:
            days[date] = {
                "workplaceId": str(punch["workplaceId"]),
                "workplaceName": punch["workplaceName"],
                "punches": []
            }
        days[date]["punches"].append(punch)
    
    # Create CSV
    output = io.StringIO()
    writer = csv.writer(output)
    writer.writerow([
        "Data", "Local de Trabalho", "Dias de Trabalho Config.", "Link Mapa Local",
        "Entrada", "Método Entrada", "Fora Local Entrada", "Distância Entrada (m)", "Precisão Entrada (m)", "Link Mapa Entrada",
        "Saída", "Método Saída", "Fora Local Saída", "Distância Saída (m)", "Precisão Saída (m)", "Link Mapa Saída",
        "Pausas (min)", "Bruto (min)", "Líquido (min)", "Horas Trabalhadas", "Notas"
    ])
    
    for date_str in sorted(days.keys()):
        day_data = days[date_str]
        wp = workplaces.get(day_data["workplaceId"], {})
        
        # Get workdays config
        workdays_str = ""
        if wp.get("workdays"):
            wd = wp["workdays"]
            days_list = []
            if wd.get("monday"): days_list.append("Seg")
            if wd.get("tuesday"): days_list.append("Ter")
            if wd.get("wednesday"): days_list.append("Qua")
            if wd.get("thursday"): days_list.append("Qui")
            if wd.get("friday"): days_list.append("Sex")
            if wd.get("saturday"): days_list.append("Sáb")
            if wd.get("sunday"): days_list.append("Dom")
            workdays_str = ", ".join(days_list)
        
        wp_maps_link = generate_maps_link(wp["latitude"], wp["longitude"]) if wp else ""
        
        punch_in = None
        punch_out = None
        break_minutes = 0
        notes = []
        
        break_start = None
        for p in day_data["punches"]:
            if p["punchType"] == "IN":
                punch_in = p
            elif p["punchType"] == "OUT":
                punch_out = p
            elif p["punchType"] == "BREAK_START":
                break_start = p
            elif p["punchType"] == "BREAK_END" and break_start:
                delta = p["occurredAt"] - break_start["occurredAt"]
                break_minutes += int(delta.total_seconds() / 60)
                break_start = None
            
            if p.get("note"):
                notes.append(f"{p['punchType']}: {p['note']}")
        
        gross_minutes = 0
        if punch_in and punch_out:
            delta = punch_out["occurredAt"] - punch_in["occurredAt"]
            gross_minutes = int(delta.total_seconds() / 60)
        
        net_minutes = max(0, gross_minutes - break_minutes)
        
        writer.writerow([
            date_str,
            day_data["workplaceName"],
            workdays_str,
            wp_maps_link,
            punch_in["occurredAt"].strftime("%H:%M:%S") if punch_in else "",
            punch_in["method"] if punch_in else "",
            "Sim" if punch_in and punch_in["outsideWorkplace"] else "Não" if punch_in else "",
            int(punch_in["distanceToWorkplaceMeters"]) if punch_in else "",
            int(punch_in["accuracyMeters"]) if punch_in else "",
            generate_maps_link(punch_in["latitude"], punch_in["longitude"]) if punch_in else "",
            punch_out["occurredAt"].strftime("%H:%M:%S") if punch_out else "",
            punch_out["method"] if punch_out else "",
            "Sim" if punch_out and punch_out["outsideWorkplace"] else "Não" if punch_out else "",
            int(punch_out["distanceToWorkplaceMeters"]) if punch_out else "",
            int(punch_out["accuracyMeters"]) if punch_out else "",
            generate_maps_link(punch_out["latitude"], punch_out["longitude"]) if punch_out else "",
            break_minutes,
            gross_minutes,
            net_minutes,
            format_minutes(net_minutes),
            "; ".join(notes)
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
    user = Depends(get_current_user)
):
    """Export timesheet as Excel with formatting"""
    
    if not from_date:
        from_date = (datetime.utcnow() - timedelta(days=30)).strftime("%Y-%m-%d")
    if not to_date:
        to_date = datetime.utcnow().strftime("%Y-%m-%d")
    
    # Get data (same as CSV)
    workplaces = {str(w["_id"]): w async for w in db.workplaces.find({"userId": user["_id"]})}
    
    punches = await db.punches.find({
        "userId": user["_id"],
        "date": {"$gte": from_date, "$lte": to_date}
    }).sort("occurredAt", 1).to_list(10000)
    
    days = {}
    for punch in punches:
        date = punch["date"]
        if date not in days:
            days[date] = {
                "workplaceId": str(punch["workplaceId"]),
                "workplaceName": punch["workplaceName"],
                "punches": []
            }
        days[date]["punches"].append(punch)
    
    # Create workbook
    wb = Workbook()
    ws = wb.active
    ws.title = "Folha de Ponto"
    
    headers = [
        "Data", "Local de Trabalho", "Dias Config.", "Entrada", "Saída",
        "Pausas", "Bruto", "Líquido", "Fora Local", "Notas"
    ]
    ws.append(headers)
    
    # Style headers
    header_fill = PatternFill(start_color="1a73e8", end_color="1a73e8", fill_type="solid")
    header_font = Font(color="FFFFFF", bold=True)
    for cell in ws[1]:
        cell.fill = header_fill
        cell.font = header_font
    
    total_net = 0
    
    for date_str in sorted(days.keys()):
        day_data = days[date_str]
        wp = workplaces.get(day_data["workplaceId"], {})
        
        workdays_str = ""
        if wp.get("workdays"):
            wd = wp["workdays"]
            days_list = []
            if wd.get("monday"): days_list.append("Seg")
            if wd.get("tuesday"): days_list.append("Ter")
            if wd.get("wednesday"): days_list.append("Qua")
            if wd.get("thursday"): days_list.append("Qui")
            if wd.get("friday"): days_list.append("Sex")
            if wd.get("saturday"): days_list.append("Sáb")
            if wd.get("sunday"): days_list.append("Dom")
            workdays_str = ", ".join(days_list)
        
        punch_in = None
        punch_out = None
        break_minutes = 0
        outside_flags = []
        notes = []
        
        break_start = None
        for p in day_data["punches"]:
            if p["punchType"] == "IN":
                punch_in = p
                if p["outsideWorkplace"]:
                    outside_flags.append("Entrada")
            elif p["punchType"] == "OUT":
                punch_out = p
                if p["outsideWorkplace"]:
                    outside_flags.append("Saída")
            elif p["punchType"] == "BREAK_START":
                break_start = p
            elif p["punchType"] == "BREAK_END" and break_start:
                delta = p["occurredAt"] - break_start["occurredAt"]
                break_minutes += int(delta.total_seconds() / 60)
                break_start = None
            
            if p.get("note"):
                notes.append(p["note"])
        
        gross_minutes = 0
        if punch_in and punch_out:
            delta = punch_out["occurredAt"] - punch_in["occurredAt"]
            gross_minutes = int(delta.total_seconds() / 60)
        
        net_minutes = max(0, gross_minutes - break_minutes)
        total_net += net_minutes
        
        ws.append([
            date_str,
            day_data["workplaceName"],
            workdays_str,
            punch_in["occurredAt"].strftime("%H:%M") if punch_in else "-",
            punch_out["occurredAt"].strftime("%H:%M") if punch_out else "-",
            format_minutes(break_minutes),
            format_minutes(gross_minutes),
            format_minutes(net_minutes),
            ", ".join(outside_flags) if outside_flags else "-",
            "; ".join(notes) if notes else ""
        ])
    
    # Add total row
    ws.append([])
    ws.append(["", "", "", "", "", "", "TOTAL:", format_minutes(total_net), "", ""])
    
    for cell in ws[ws.max_row]:
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
        ws.column_dimensions[column_letter].width = min(max_length + 2, 25)
    
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

# ==================== REVERSE GEOCODING ====================

@api_router.get("/geocode/reverse")
async def reverse_geocode(lat: float, lng: float, user = Depends(get_current_user)):
    """Get address from coordinates (simplified - returns formatted coords)"""
    # In production, use a real geocoding service like Google Maps, Mapbox, etc.
    return {
        "latitude": lat,
        "longitude": lng,
        "address": f"Lat: {lat:.6f}, Lng: {lng:.6f}",
        "mapsLink": generate_maps_link(lat, lng)
    }

# ==================== HEALTH & SEED ====================

@api_router.get("/")
async def root():
    return {"message": "GeoPunch API v3.0", "status": "online"}

@api_router.get("/health")
async def health_check():
    return {"status": "healthy", "timestamp": datetime.utcnow(), "version": "3.0.0"}

@api_router.post("/seed")
async def seed_data():
    """Seed initial data"""
    
    # Check if test user exists
    test_user = await db.users.find_one({"email": "teste@geopunch.pt"})
    if not test_user:
        user_doc = {
            "email": "teste@geopunch.pt",
            "password_hash": hash_password("teste123"),
            "name": "Utilizador Teste",
            "employeeId": "EMP001",
            "role": "employee",
            "activeWorkplaceId": None,
            "createdAt": datetime.utcnow(),
            "lastLogin": None,
            "loginCount": 0
        }
        result = await db.users.insert_one(user_doc)
        test_user = user_doc
        test_user["_id"] = result.inserted_id
        
        # Create sample workplace
        workplace_doc = {
            "userId": test_user["_id"],
            "name": "Escritório Principal",
            "latitude": 38.7223,
            "longitude": -9.1393,
            "radiusMeters": 150,
            "workdays": {
                "monday": True,
                "tuesday": True,
                "wednesday": True,
                "thursday": True,
                "friday": True,
                "saturday": False,
                "sunday": False
            },
            "schedule": {
                "startTime": "09:00",
                "endTime": "18:00",
                "marginMinutes": 120
            },
            "locationLocked": True,
            "configuredAt": datetime.utcnow(),
            "createdAt": datetime.utcnow(),
            "versionHistory": []
        }
        wp_result = await db.workplaces.insert_one(workplace_doc)
        
        # Set as active
        await db.users.update_one(
            {"_id": test_user["_id"]},
            {"$set": {"activeWorkplaceId": wp_result.inserted_id}}
        )
        
        logger.info("Test user and workplace created")
    
    return {"message": "Dados de teste criados com sucesso"}

# Include router and CORS
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
    await db.users.create_index("email", unique=True)
    await db.punches.create_index([("userId", 1), ("date", 1), ("punchType", 1)])
    await db.workplaces.create_index([("userId", 1)])
    await db.geofence_events.create_index("eventId", unique=True)
    logger.info("Database indexes created")

@app.on_event("shutdown")
async def shutdown_db_client():
    client.close()

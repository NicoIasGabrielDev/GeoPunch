from fastapi import FastAPI, APIRouter, HTTPException, Depends, status
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from fastapi.responses import StreamingResponse
from dotenv import load_dotenv
from starlette.middleware.cors import CORSMiddleware
from motor.motor_asyncio import AsyncIOMotorClient
import os
import logging
from pathlib import Path
from pydantic import BaseModel, Field, EmailStr
from typing import List, Optional, Literal
import uuid
from datetime import datetime, timedelta, time
from passlib.context import CryptContext
from jose import JWTError, jwt
import io
import csv
from openpyxl import Workbook
from bson import ObjectId

ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / '.env')

# MongoDB connection
mongo_url = os.environ['MONGO_URL']
client = AsyncIOMotorClient(mongo_url)
db = client[os.environ.get('DB_NAME', 'geopunch')]

# JWT Configuration
SECRET_KEY = os.environ.get('JWT_SECRET', 'geopunch-secret-key-change-in-production')
ALGORITHM = "HS256"
ACCESS_TOKEN_EXPIRE_DAYS = 30

# Password hashing
pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")

# Security
security = HTTPBearer()

# Create the main app
app = FastAPI(title="GeoPunch API", version="1.0.0")

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
    token_type: str = "bearer"
    user: UserResponse

class WorkplaceCreate(BaseModel):
    name: str
    latitude: float
    longitude: float
    radiusMeters: int = 150
    startTime: str = "09:00"  # HH:MM format
    endTime: str = "18:00"
    allowedMarginMinutes: int = 120

class WorkplaceResponse(BaseModel):
    id: str
    name: str
    latitude: float
    longitude: float
    radiusMeters: int
    startTime: str
    endTime: str
    allowedMarginMinutes: int
    createdAt: datetime

class GeofenceEventCreate(BaseModel):
    eventId: str  # Client-generated unique ID for idempotency
    eventType: Literal["ENTER", "EXIT"]
    latitude: float
    longitude: float
    accuracy: float
    timestamp: Optional[datetime] = None

class ManualPunchCreate(BaseModel):
    punchType: Literal["CLOCK_IN", "CLOCK_OUT"]
    latitude: float
    longitude: float
    accuracy: float

class LunchBreakCreate(BaseModel):
    breakType: Literal["LUNCH_START", "LUNCH_END"]
    latitude: float
    longitude: float
    accuracy: float

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
    status: str  # not_started, working, on_lunch, finished

class AssignWorkplaceRequest(BaseModel):
    userId: str
    workplaceId: str

# ==================== HELPER FUNCTIONS ====================

def hash_password(password: str) -> str:
    return pwd_context.hash(password)

def verify_password(plain_password: str, hashed_password: str) -> bool:
    return pwd_context.verify(plain_password, hashed_password)

def create_access_token(data: dict) -> str:
    to_encode = data.copy()
    expire = datetime.utcnow() + timedelta(days=ACCESS_TOKEN_EXPIRE_DAYS)
    to_encode.update({"exp": expire})
    return jwt.encode(to_encode, SECRET_KEY, algorithm=ALGORITHM)

async def get_current_user(credentials: HTTPAuthorizationCredentials = Depends(security)):
    try:
        token = credentials.credentials
        payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
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

def is_within_time_window(current_time: time, target_time: time, margin_minutes: int) -> bool:
    """Check if current time is within [target - margin, target + margin]"""
    current_minutes = current_time.hour * 60 + current_time.minute
    target_minutes = target_time.hour * 60 + target_time.minute
    
    window_start = target_minutes - margin_minutes
    window_end = target_minutes + margin_minutes
    
    return window_start <= current_minutes <= window_end

def format_minutes(minutes: int) -> str:
    """Format minutes to HH:MM string"""
    hours = minutes // 60
    mins = minutes % 60
    return f"{hours:02d}:{mins:02d}"

def get_today_date() -> str:
    """Get today's date in YYYY-MM-DD format"""
    return datetime.utcnow().strftime("%Y-%m-%d")

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
        "createdAt": datetime.utcnow()
    }
    
    result = await db.users.insert_one(user_doc)
    user_doc["_id"] = result.inserted_id
    
    # Create token
    token = create_access_token({"sub": str(user_doc["_id"])})
    
    return TokenResponse(
        access_token=token,
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
    user = await db.users.find_one({"email": credentials.email.lower()})
    if not user or not verify_password(credentials.password, user["password_hash"]):
        raise HTTPException(status_code=401, detail="Email ou senha incorretos")
    
    token = create_access_token({"sub": str(user["_id"])})
    
    return TokenResponse(
        access_token=token,
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
            createdAt=w["createdAt"]
        )
        for w in workplaces
    ]

@api_router.post("/admin/workplaces", response_model=WorkplaceResponse)
async def create_workplace(workplace: WorkplaceCreate, user = Depends(get_admin_user)):
    workplace_doc = {
        "name": workplace.name,
        "latitude": workplace.latitude,
        "longitude": workplace.longitude,
        "radiusMeters": workplace.radiusMeters,
        "startTime": workplace.startTime,
        "endTime": workplace.endTime,
        "allowedMarginMinutes": workplace.allowedMarginMinutes,
        "createdAt": datetime.utcnow()
    }
    
    result = await db.workplaces.insert_one(workplace_doc)
    workplace_doc["_id"] = result.inserted_id
    
    return WorkplaceResponse(
        id=str(workplace_doc["_id"]),
        name=workplace_doc["name"],
        latitude=workplace_doc["latitude"],
        longitude=workplace_doc["longitude"],
        radiusMeters=workplace_doc["radiusMeters"],
        startTime=workplace_doc["startTime"],
        endTime=workplace_doc["endTime"],
        allowedMarginMinutes=workplace_doc["allowedMarginMinutes"],
        createdAt=workplace_doc["createdAt"]
    )

@api_router.put("/admin/workplaces/{workplace_id}", response_model=WorkplaceResponse)
async def update_workplace(workplace_id: str, workplace: WorkplaceCreate, user = Depends(get_admin_user)):
    result = await db.workplaces.find_one_and_update(
        {"_id": ObjectId(workplace_id)},
        {"$set": {
            "name": workplace.name,
            "latitude": workplace.latitude,
            "longitude": workplace.longitude,
            "radiusMeters": workplace.radiusMeters,
            "startTime": workplace.startTime,
            "endTime": workplace.endTime,
            "allowedMarginMinutes": workplace.allowedMarginMinutes
        }},
        return_document=True
    )
    
    if not result:
        raise HTTPException(status_code=404, detail="Local de trabalho não encontrado")
    
    return WorkplaceResponse(
        id=str(result["_id"]),
        name=result["name"],
        latitude=result["latitude"],
        longitude=result["longitude"],
        radiusMeters=result["radiusMeters"],
        startTime=result["startTime"],
        endTime=result["endTime"],
        allowedMarginMinutes=result["allowedMarginMinutes"],
        createdAt=result["createdAt"]
    )

@api_router.delete("/admin/workplaces/{workplace_id}")
async def delete_workplace(workplace_id: str, user = Depends(get_admin_user)):
    result = await db.workplaces.delete_one({"_id": ObjectId(workplace_id)})
    if result.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Local de trabalho não encontrado")
    return {"message": "Local de trabalho eliminado"}

@api_router.post("/admin/assign-workplace")
async def assign_workplace(request: AssignWorkplaceRequest, user = Depends(get_admin_user)):
    # Verify workplace exists
    workplace = await db.workplaces.find_one({"_id": ObjectId(request.workplaceId)})
    if not workplace:
        raise HTTPException(status_code=404, detail="Local de trabalho não encontrado")
    
    # Update user
    result = await db.users.update_one(
        {"_id": ObjectId(request.userId)},
        {"$set": {"workplaceId": ObjectId(request.workplaceId)}}
    )
    
    if result.modified_count == 0:
        raise HTTPException(status_code=404, detail="Utilizador não encontrado")
    
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
    
    event_timestamp = event.timestamp or datetime.utcnow()
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
    within_window = is_within_time_window(event_time, target_time, workplace["allowedMarginMinutes"])
    
    # Check if within geofence radius
    within_geofence = distance <= workplace["radiusMeters"]
    
    # Store raw geofence event
    geofence_doc = {
        "eventId": event.eventId,
        "userId": user["_id"],
        "workplaceId": workplace["_id"],
        "eventType": event.eventType,
        "timestamp": event_timestamp,
        "latitude": event.latitude,
        "longitude": event.longitude,
        "accuracy": event.accuracy,
        "distance": distance,
        "withinGeofence": within_geofence,
        "withinTimeWindow": within_window,
        "processed": True,
        "punchCreated": False,
        "reason": None
    }
    
    punch_created = False
    message = ""
    
    if not within_geofence:
        geofence_doc["reason"] = "Fora da área do local de trabalho"
        message = f"Fora da área do local de trabalho ({int(distance)}m de distância)"
    elif not within_window:
        geofence_doc["reason"] = "Fora do horário permitido"
        message = "Evento registado mas fora do horário permitido"
    else:
        # Check for existing punch of same type today
        existing_punch = await db.punch_events.find_one({
            "userId": user["_id"],
            "date": event_date,
            "eventType": punch_type
        })
        
        if existing_punch:
            geofence_doc["reason"] = f"{punch_type} já registado hoje"
            message = f"{punch_type} já registado hoje"
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
                        "method": "auto",
                        "source": f"geofence_{event.eventType.lower()}",
                        "latitude": event.latitude,
                        "longitude": event.longitude,
                        "accuracy": event.accuracy
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
                    "method": "auto",
                    "source": f"geofence_{event.eventType.lower()}",
                    "latitude": event.latitude,
                    "longitude": event.longitude,
                    "accuracy": event.accuracy
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
    
    now = datetime.utcnow()
    today = now.strftime("%Y-%m-%d")
    current_time = now.time()
    
    # Calculate distance
    distance = calculate_distance(
        punch.latitude, punch.longitude,
        workplace["latitude"], workplace["longitude"]
    )
    
    # Check if within geofence
    if distance > workplace["radiusMeters"]:
        raise HTTPException(
            status_code=400, 
            detail=f"Está fora da área do local de trabalho ({int(distance)}m de distância, máximo {workplace['radiusMeters']}m)"
        )
    
    # Check time window
    target_time = parse_time(workplace["startTime"] if punch.punchType == "CLOCK_IN" else workplace["endTime"])
    if not is_within_time_window(current_time, target_time, workplace["allowedMarginMinutes"]):
        raise HTTPException(
            status_code=400,
            detail="Fora do horário permitido para este tipo de registo"
        )
    
    # Check for existing punch
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
    
    # Create punch
    punch_doc = {
        "userId": user["_id"],
        "workplaceId": workplace["_id"],
        "date": today,
        "eventType": punch.punchType,
        "timestamp": now,
        "method": "manual",
        "source": "manual_request",
        "latitude": punch.latitude,
        "longitude": punch.longitude,
        "accuracy": punch.accuracy
    }
    
    result = await db.punch_events.insert_one(punch_doc)
    
    return {
        "success": True,
        "punchId": str(result.inserted_id),
        "eventType": punch.punchType,
        "timestamp": now,
        "message": f"{'Entrada' if punch.punchType == 'CLOCK_IN' else 'Saída'} registada com sucesso"
    }

# ==================== LUNCH BREAK ====================

@api_router.post("/break/manual")
async def manual_break(break_data: LunchBreakCreate, user = Depends(get_current_user)):
    """Process manual lunch break start/end"""
    
    # Get user's workplace
    if not user.get("workplaceId"):
        raise HTTPException(status_code=400, detail="Nenhum local de trabalho atribuído")
    
    workplace = await db.workplaces.find_one({"_id": ObjectId(user["workplaceId"])})
    if not workplace:
        raise HTTPException(status_code=404, detail="Local de trabalho não encontrado")
    
    now = datetime.utcnow()
    today = now.strftime("%Y-%m-%d")
    
    # Verify CLOCK_IN exists today
    clock_in = await db.punch_events.find_one({
        "userId": user["_id"],
        "date": today,
        "eventType": "CLOCK_IN"
    })
    
    if not clock_in:
        raise HTTPException(status_code=400, detail="Não é possível registar pausa sem entrada registada")
    
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
    
    outside_geofence = distance > workplace["radiusMeters"]
    
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
                raise HTTPException(status_code=400, detail="Pausa de almoço já iniciada")
            else:
                raise HTTPException(status_code=400, detail="Já registou uma pausa de almoço hoje")
    
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
    
    # Create break event
    break_doc = {
        "userId": user["_id"],
        "workplaceId": workplace["_id"],
        "date": today,
        "eventType": break_data.breakType,
        "timestamp": now,
        "method": "manual",
        "source": "manual_break",
        "latitude": break_data.latitude,
        "longitude": break_data.longitude,
        "accuracy": break_data.accuracy,
        "outsideGeofence": outside_geofence
    }
    
    result = await db.punch_events.insert_one(break_doc)
    
    return {
        "success": True,
        "breakId": str(result.inserted_id),
        "eventType": break_data.breakType,
        "timestamp": now,
        "outsideGeofence": outside_geofence,
        "message": f"{'Início' if break_data.breakType == 'LUNCH_START' else 'Fim'} de almoço registado{' (fora do local de trabalho)' if outside_geofence else ''}"
    }

# ==================== TIMESHEET ====================

@api_router.get("/timesheet")
async def get_timesheet(
    from_date: Optional[str] = None,
    to_date: Optional[str] = None,
    user = Depends(get_current_user)
):
    """Get timesheet with daily summaries"""
    
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
                "lunchEnd": None
            }
        
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
            status=status
        ))
    
    return result

@api_router.get("/timesheet/today")
async def get_today_status(user = Depends(get_current_user)):
    """Get today's status for the home screen"""
    
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
            "allowedMarginMinutes": workplace["allowedMarginMinutes"] if workplace else None
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
    """Export timesheet as CSV"""
    
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
        "Saída", "Método Saída", "Minutos Brutos", "Pausa (min)", "Minutos Líquidos", "Horas Trabalhadas"
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
                days[date] = {}
            days[date][event["eventType"]] = event
        
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
            
            writer.writerow([
                target_user["name"],
                target_user.get("employeeId", ""),
                date,
                workplace["name"] if workplace else "",
                clock_in.get("timestamp", "").isoformat() if clock_in.get("timestamp") else "",
                clock_in.get("method", ""),
                lunch_start.get("timestamp", "").isoformat() if lunch_start.get("timestamp") else "",
                lunch_end.get("timestamp", "").isoformat() if lunch_end.get("timestamp") else "",
                clock_out.get("timestamp", "").isoformat() if clock_out.get("timestamp") else "",
                clock_out.get("method", ""),
                gross_minutes,
                break_minutes,
                net_minutes,
                format_minutes(net_minutes)
            ])
    
    output.seek(0)
    
    return StreamingResponse(
        iter([output.getvalue()]),
        media_type="text/csv",
        headers={
            "Content-Disposition": f"attachment; filename=timesheet_{from_date}_{to_date}.csv"
        }
    )

@api_router.get("/export/timesheet.xlsx")
async def export_xlsx(
    from_date: Optional[str] = None,
    to_date: Optional[str] = None,
    user_id: Optional[str] = None,
    user = Depends(get_current_user)
):
    """Export timesheet as Excel XLSX"""
    
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
    
    # Headers
    headers = [
        "Funcionário", "ID Funcionário", "Data", "Local de Trabalho",
        "Entrada", "Método Entrada", "Início Almoço", "Fim Almoço",
        "Saída", "Método Saída", "Minutos Brutos", "Pausa (min)", "Minutos Líquidos", "Horas Trabalhadas"
    ]
    ws.append(headers)
    
    # Style headers
    for cell in ws[1]:
        cell.font = cell.font.copy(bold=True)
    
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
                days[date] = {}
            days[date][event["eventType"]] = event
        
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
                format_minutes(net_minutes)
            ])
    
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
        ws.column_dimensions[column_letter].width = max_length + 2
    
    # Save to buffer
    output = io.BytesIO()
    wb.save(output)
    output.seek(0)
    
    return StreamingResponse(
        iter([output.getvalue()]),
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={
            "Content-Disposition": f"attachment; filename=timesheet_{from_date}_{to_date}.xlsx"
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
            "createdAt": datetime.utcnow()
        }
        await db.users.insert_one(admin_doc)
        logger.info("Admin user created")
    
    # Check if sample workplace exists
    workplace = await db.workplaces.find_one({"name": "Escritório Central"})
    if not workplace:
        workplace_doc = {
            "name": "Escritório Central",
            "latitude": 38.7223,  # Lisbon coordinates
            "longitude": -9.1393,
            "radiusMeters": 150,
            "startTime": "09:00",
            "endTime": "18:00",
            "allowedMarginMinutes": 120,
            "createdAt": datetime.utcnow()
        }
        result = await db.workplaces.insert_one(workplace_doc)
        logger.info(f"Sample workplace created with id: {result.inserted_id}")
    
    return {"message": "Dados de teste criados com sucesso"}

# ==================== ROOT ====================

@api_router.get("/")
async def root():
    return {"message": "GeoPunch API v1.0", "status": "online"}

@api_router.get("/health")
async def health_check():
    return {"status": "healthy", "timestamp": datetime.utcnow()}

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
    # Create indexes
    await db.users.create_index("email", unique=True)
    await db.punch_events.create_index([("userId", 1), ("date", 1), ("eventType", 1)])
    await db.geofence_events.create_index("eventId", unique=True)
    logger.info("Database indexes created")

@app.on_event("shutdown")
async def shutdown_db_client():
    client.close()

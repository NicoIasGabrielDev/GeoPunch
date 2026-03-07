from fastapi import FastAPI, APIRouter, HTTPException, Depends, status, Request
from fastapi.responses import StreamingResponse
from dotenv import load_dotenv
from starlette.middleware.cors import CORSMiddleware
import os
import logging
from pathlib import Path
from pydantic import BaseModel, Field, EmailStr, validator
from typing import List, Optional, Literal, Dict
import uuid
from datetime import datetime, timedelta, time, timezone
import io
import csv
from openpyxl import Workbook
from openpyxl.styles import Font, Alignment, PatternFill, Border, Side
import asyncio
from collections import defaultdict
from database import db  # Import Supabase database wrapper
from auth_helper import get_current_user  # Import Supabase auth helper

ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / '.env')

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

class UserResponse(BaseModel):
    id: str
    email: str
    name: str
    employeeId: Optional[str] = None
    role: str
    activeWorkplaceId: Optional[str] = None
    createdAt: datetime

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
# Authentication is handled by Supabase Auth
# Users authenticate directly with Supabase and get a JWT token
# The backend validates the token and retrieves user profile

@api_router.get("/auth/me", response_model=UserResponse)
async def get_me(user = Depends(get_current_user)):
    """Get current authenticated user profile"""
    return UserResponse(
        id=user["id"],
        email=user["email"],
        name=user["name"],
        employeeId=user.get("employee_id"),
        role=user["role"],
        activeWorkplaceId=user.get("active_workplace_id"),
        createdAt=datetime.fromisoformat(user["created_at"])
    )

# ==================== WORKPLACE ENDPOINTS (USER-OWNED) ====================

@api_router.get("/workplaces", response_model=List[WorkplaceResponse])
async def list_user_workplaces(user = Depends(get_current_user)):
    """List all workplaces owned by the current user"""
    workplaces = await db.find_workplaces_by_user(user["id"])
    active_id = user.get("active_workplace_id")
    
    return [
        WorkplaceResponse(
            id=w["id"],
            name=w["name"],
            latitude=float(w["latitude"]),
            longitude=float(w["longitude"]),
            radiusMeters=w["radius_meters"],
            workdays=w.get("workdays", {}),
            schedule=w.get("schedule"),
            locationLocked=w.get("location_locked", True),
            configuredAt=datetime.fromisoformat(w.get("configured_at", w["created_at"])),
            isActive=w["id"] == active_id if active_id else False,
            createdAt=datetime.fromisoformat(w["created_at"])
        )
        for w in workplaces
    ]

@api_router.post("/workplaces", response_model=WorkplaceResponse)
async def create_workplace(workplace: WorkplaceCreate, user = Depends(get_current_user)):
    """Create a new workplace with LOCKED location"""
    now = datetime.utcnow().isoformat()
    
    workplace_doc = {
        "user_id": user["id"],
        "name": workplace.name,
        "latitude": workplace.latitude,
        "longitude": workplace.longitude,
        "radius_meters": workplace.radiusMeters,
        "workdays": workplace.workdays.dict(),
        "schedule": workplace.schedule.dict() if workplace.schedule else {"startTime": "09:00", "endTime": "18:00", "marginMinutes": 120},
        "location_locked": True,  # ALWAYS locked after creation
        "configured_at": now,
        "created_at": now
    }
    
    workplace_id = await db.create_workplace(workplace_doc)
    if not workplace_id:
        raise HTTPException(status_code=500, detail="Erro ao criar local de trabalho")
    
    # If this is the user's first workplace, set it as active
    user_workplaces_count = await db.count_user_workplaces(user["id"])
    is_first = user_workplaces_count == 1
    if is_first:
        await db.update_profile(user["id"], {"active_workplace_id": workplace_id})
    
    return WorkplaceResponse(
        id=workplace_id,
        name=workplace_doc["name"],
        latitude=workplace_doc["latitude"],
        longitude=workplace_doc["longitude"],
        radiusMeters=workplace_doc["radius_meters"],
        workdays=workplace_doc["workdays"],
        schedule=workplace_doc["schedule"],
        locationLocked=True,
        configuredAt=datetime.fromisoformat(workplace_doc["configured_at"]),
        isActive=is_first,
        createdAt=datetime.fromisoformat(workplace_doc["created_at"])
    )

@api_router.put("/workplaces/{workplace_id}", response_model=WorkplaceResponse)
async def update_workplace(workplace_id: str, update: WorkplaceUpdate, user = Depends(get_current_user)):
    """Update non-location fields only. Changes apply from next day."""
    workplace = await db.find_workplace_by_id(workplace_id, user["id"])
    
    if not workplace:
        raise HTTPException(status_code=404, detail="Local de trabalho não encontrado")
    
    # Build update dict (only non-location fields)
    update_dict = {}
    
    if update.name is not None:
        update_dict["name"] = update.name
    
    if update.radiusMeters is not None:
        update_dict["radius_meters"] = update.radiusMeters
    
    if update.workdays is not None:
        update_dict["workdays"] = update.workdays.dict()
    
    if update.schedule is not None:
        update_dict["schedule"] = update.schedule.dict()
    
    if update_dict:
        await db.update_workplace(workplace_id, update_dict)
    
    updated = await db.find_workplace_by_id(workplace_id, user["id"])
    active_id = user.get("active_workplace_id")
    
    return WorkplaceResponse(
        id=updated["id"],
        name=updated["name"],
        latitude=float(updated["latitude"]),
        longitude=float(updated["longitude"]),
        radiusMeters=updated["radius_meters"],
        workdays=updated.get("workdays", {}),
        schedule=updated.get("schedule"),
        locationLocked=True,
        configuredAt=datetime.fromisoformat(updated.get("configured_at", updated["created_at"])),
        isActive=updated["id"] == active_id if active_id else False,
        createdAt=datetime.fromisoformat(updated["created_at"])
    )

@api_router.post("/workplaces/{workplace_id}/activate")
async def set_active_workplace(workplace_id: str, user = Depends(get_current_user)):
    """Set a workplace as the active one"""
    workplace = await db.find_workplace_by_id(workplace_id, user["id"])
    
    if not workplace:
        raise HTTPException(status_code=404, detail="Local de trabalho não encontrado")
    
    await db.update_profile(user["id"], {"active_workplace_id": workplace_id})
    
    return {"message": f"'{workplace['name']}' definido como local de trabalho ativo"}

@api_router.get("/workplaces/active", response_model=Optional[WorkplaceResponse])
async def get_active_workplace(user = Depends(get_current_user)):
    """Get the currently active workplace"""
    active_workplace_id = user.get("active_workplace_id")
    if not active_workplace_id:
        return None
    
    workplace = await db.find_workplace_by_id(active_workplace_id, user["id"])
    if not workplace:
        return None
    
    return WorkplaceResponse(
        id=workplace["id"],
        name=workplace["name"],
        latitude=float(workplace["latitude"]),
        longitude=float(workplace["longitude"]),
        radiusMeters=workplace["radius_meters"],
        workdays=workplace.get("workdays", {}),
        schedule=workplace.get("schedule"),
        locationLocked=True,
        configuredAt=datetime.fromisoformat(workplace.get("configured_at", workplace["created_at"])),
        isActive=True,
        createdAt=datetime.fromisoformat(workplace["created_at"])
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
    active_workplace_id = user.get("active_workplace_id")
    if not active_workplace_id:
        raise HTTPException(status_code=400, detail="Nenhum local de trabalho ativo. Configure um local primeiro.")
    
    workplace = await db.find_workplace_by_id(active_workplace_id, user["id"])
    if not workplace:
        raise HTTPException(status_code=404, detail="Local de trabalho não encontrado")
    
    server_time = datetime.utcnow()
    device_time = punch.deviceTime or server_time
    today = server_time.strftime("%Y-%m-%d")
    
    # Calculate distance
    distance = calculate_distance(
        punch.latitude, punch.longitude,
        float(workplace["latitude"]), float(workplace["longitude"])
    )
    
    outside_workplace = distance > workplace["radius_meters"]
    
    # Validation for IN/OUT
    if punch.punchType == "IN":
        # Check if already punched in today
        existing_in = await db.find_punch({
            "user_id": user["id"],
            "date": today,
            "punch_type": "IN"
        })
        if existing_in:
            raise HTTPException(status_code=400, detail="Já registou entrada hoje")
    
    elif punch.punchType == "OUT":
        # Must have IN first
        punch_in = await db.find_punch({
            "user_id": user["id"],
            "date": today,
            "punch_type": "IN"
        })
        if not punch_in:
            raise HTTPException(status_code=400, detail="Não é possível registar saída sem entrada")
        
        # Check if already punched out
        existing_out = await db.find_punch({
            "user_id": user["id"],
            "date": today,
            "punch_type": "OUT"
        })
        if existing_out:
            raise HTTPException(status_code=400, detail="Já registou saída hoje")
        
        # Check for unclosed break - need to filter in Python
        all_breaks = await db.find_punches({
            "user_id": user["id"],
            "date": today
        })
        breaks = [b for b in all_breaks if b.get("punch_type") in ["BREAK_START", "BREAK_END"]]
        
        break_starts = len([b for b in breaks if b["punch_type"] == "BREAK_START"])
        break_ends = len([b for b in breaks if b["punch_type"] == "BREAK_END"])
        
        if break_starts > break_ends:
            raise HTTPException(status_code=400, detail="Termine a pausa antes de registar saída")
    
    elif punch.punchType == "BREAK_START":
        # Must have IN and no OUT
        punch_in = await db.find_punch({
            "user_id": user["id"],
            "date": today,
            "punch_type": "IN"
        })
        if not punch_in:
            raise HTTPException(status_code=400, detail="Não é possível iniciar pausa sem entrada")
        
        punch_out = await db.find_punch({
            "user_id": user["id"],
            "date": today,
            "punch_type": "OUT"
        })
        if punch_out:
            raise HTTPException(status_code=400, detail="Não é possível iniciar pausa após saída")
        
        # Check for unclosed break
        all_breaks = await db.find_punches({
            "user_id": user["id"],
            "date": today
        })
        breaks = [b for b in all_breaks if b.get("punch_type") in ["BREAK_START", "BREAK_END"]]
        
        break_starts = len([b for b in breaks if b["punch_type"] == "BREAK_START"])
        break_ends = len([b for b in breaks if b["punch_type"] == "BREAK_END"])
        
        if break_starts > break_ends:
            raise HTTPException(status_code=400, detail="Já tem uma pausa em curso")
    
    elif punch.punchType == "BREAK_END":
        # Must have unclosed break
        all_breaks = await db.find_punches({
            "user_id": user["id"],
            "date": today
        })
        breaks = [b for b in all_breaks if b.get("punch_type") in ["BREAK_START", "BREAK_END"]]
        
        break_starts = len([b for b in breaks if b["punch_type"] == "BREAK_START"])
        break_ends = len([b for b in breaks if b["punch_type"] == "BREAK_END"])
        
        if break_starts <= break_ends:
            raise HTTPException(status_code=400, detail="Nenhuma pausa em curso para terminar")
    
    # Create punch with evidence data
    punch_doc = {
        "user_id": user["id"],
        "workplace_id": workplace["id"],
        "workplace_name": workplace["name"],
        "date": today,
        "punch_type": punch.punchType,
        "occurred_at": device_time.isoformat(),
        "received_at": server_time.isoformat(),
        "latitude": punch.latitude,
        "longitude": punch.longitude,
        "accuracy_meters": punch.accuracy,
        "distance_to_workplace_meters": distance,
        "method": punch.method,
        "outside_workplace": outside_workplace,
        "note": punch.note
    }
    
    punch_id = await db.create_punch(punch_doc)
    if not punch_id:
        raise HTTPException(status_code=500, detail="Erro ao criar registo de ponto")
    
    return PunchResponse(
        id=punch_id,
        userId=user["id"],
        workplaceId=workplace["id"],
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
    existing = await db.find_geofence_event(event.eventId, user["id"])
    if existing:
        return {
            "processed": True,
            "duplicate": True,
            "suggestion": existing.get("suggestion"),
            "message": "Evento já processado"
        }
    
    active_workplace_id = user.get("active_workplace_id")
    if not active_workplace_id:
        return {
            "processed": True,
            "suggestion": None,
            "message": "Nenhum local de trabalho ativo"
        }
    
    workplace = await db.find_workplace_by_id(active_workplace_id, user["id"])
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
        float(workplace["latitude"]), float(workplace["longitude"])
    )
    
    # Determine suggestion based on event type
    suggestion = None
    message = ""
    
    if event.eventType == "ENTER":
        # Check if not already punched in
        existing_in = await db.find_punch({
            "user_id": user["id"],
            "date": today,
            "punch_type": "IN"
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
        existing_in = await db.find_punch({
            "user_id": user["id"],
            "date": today,
            "punch_type": "IN"
        })
        existing_out = await db.find_punch({
            "user_id": user["id"],
            "date": today,
            "punch_type": "OUT"
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
        "event_id": event.eventId,
        "user_id": user["id"],
        "workplace_id": workplace["id"],
        "event_type": event.eventType,
        "device_time": (event.deviceTime or server_time).isoformat(),
        "received_at": server_time.isoformat(),
        "latitude": event.latitude,
        "longitude": event.longitude,
        "accuracy": event.accuracy
    }
    
    await db.create_geofence_event(geofence_doc)
    
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
    
    # Get active workplace for workday info
    active_workplace = None
    active_workplace_id = user.get("active_workplace_id")
    if active_workplace_id:
        active_workplace = await db.find_workplace_by_id(active_workplace_id, user["id"])
    
    # Get all punches in date range
    punches_data = await db.find_punches_by_date_range(
        user["id"], 
        active_workplace_id if active_workplace_id else "dummy",
        from_date, 
        to_date
    )
    
    # Group by date
    days = {}
    for punch in punches_data:
        date = punch["date"]
        if date not in days:
            days[date] = {
                "punches": [],
                "workplaceId": punch["workplace_id"],
                "workplaceName": punch["workplace_name"],
                "anomalies": []
            }
        
        days[date]["punches"].append({
            "id": punch["id"],
            "type": punch["punch_type"],
            "occurredAt": datetime.fromisoformat(punch["occurred_at"]),
            "method": punch["method"],
            "outsideWorkplace": punch["outside_workplace"],
            "distance": float(punch["distance_to_workplace_meters"]),
            "accuracy": float(punch["accuracy_meters"]),
            "note": punch.get("note"),
            "mapsLink": generate_maps_link(float(punch["latitude"]), float(punch["longitude"]))
        })
        
        if punch["outside_workplace"]:
            days[date]["anomalies"].append(f"{punch['punch_type']}: fora do local")
        if float(punch["accuracy_meters"]) > 50:
            days[date]["anomalies"].append(f"{punch['punch_type']}: GPS impreciso ({int(float(punch['accuracy_meters']))}m)")
    
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
    active_workplace_id = user.get("active_workplace_id")
    if active_workplace_id:
        workplace = await db.find_workplace_by_id(active_workplace_id, user["id"])
    
    # Get today's punches
    punches_data = await db.find_punches({
        "user_id": user["id"],
        "date": today
    })
    
    # Convert to expected format and sort
    punches = []
    for p in punches_data:
        p_copy = p.copy()
        p_copy["occurredAt"] = datetime.fromisoformat(p["occurred_at"])
        punches.append(p_copy)
    
    punches.sort(key=lambda x: x["occurredAt"])
    
    # Process punches
    punch_data = {
        "in": None,
        "out": None,
        "breaks": []
    }
    
    current_break_start = None
    
    for p in punches:
        if p["punch_type"] == "IN":
            punch_data["in"] = p
        elif p["punch_type"] == "OUT":
            punch_data["out"] = p
        elif p["punch_type"] == "BREAK_START":
            current_break_start = p
        elif p["punch_type"] == "BREAK_END" and current_break_start:
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
            "id": workplace["id"] if workplace else None,
            "name": workplace["name"] if workplace else None,
            "latitude": float(workplace["latitude"]) if workplace else None,
            "longitude": float(workplace["longitude"]) if workplace else None,
            "radiusMeters": workplace["radius_meters"] if workplace else None,
            "workdays": workplace.get("workdays") if workplace else None,
            "schedule": workplace.get("schedule") if workplace else None,
            "mapsLink": generate_maps_link(float(workplace["latitude"]), float(workplace["longitude"])) if workplace else None
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
    workplaces_list = await db.find_workplaces_by_user(user["id"])
    workplaces = {w["id"]: w for w in workplaces_list}
    
    # Get punches
    active_workplace_id = user.get("active_workplace_id")
    punches_data = await db.find_punches_by_date_range(
        user["id"],
        active_workplace_id if active_workplace_id else "dummy",
        from_date,
        to_date
    )
    
    # Group by date
    days = {}
    for punch in punches_data:
        date = punch["date"]
        if date not in days:
            days[date] = {
                "workplaceId": punch["workplace_id"],
                "workplaceName": punch["workplace_name"],
                "punches": []
            }
        
        # Convert punch data
        punch_copy = punch.copy()
        punch_copy["occurredAt"] = datetime.fromisoformat(punch["occurred_at"])
        punch_copy["punchType"] = punch["punch_type"]
        punch_copy["outsideWorkplace"] = punch["outside_workplace"]
        punch_copy["distanceToWorkplaceMeters"] = float(punch["distance_to_workplace_meters"])
        punch_copy["accuracyMeters"] = float(punch["accuracy_meters"])
        days[date]["punches"].append(punch_copy)
    
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
    workplaces_list = await db.find_workplaces_by_user(user["id"])
    workplaces = {w["id"]: w for w in workplaces_list}
    
    active_workplace_id = user.get("active_workplace_id")
    punches_data = await db.find_punches_by_date_range(
        user["id"],
        active_workplace_id if active_workplace_id else "dummy",
        from_date,
        to_date
    )
    
    days = {}
    for punch in punches_data:
        date = punch["date"]
        if date not in days:
            days[date] = {
                "workplaceId": punch["workplace_id"],
                "workplaceName": punch["workplace_name"],
                "punches": []
            }
        
        # Convert punch data
        punch_copy = punch.copy()
        punch_copy["occurredAt"] = datetime.fromisoformat(punch["occurred_at"])
        punch_copy["punchType"] = punch["punch_type"]
        punch_copy["outsideWorkplace"] = punch["outside_workplace"]
        punch_copy["distanceToWorkplaceMeters"] = float(punch["distance_to_workplace_meters"])
        punch_copy["accuracyMeters"] = float(punch["accuracy_meters"])
        days[date]["punches"].append(punch_copy)
    
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
    """
    Seed initial data
    Note: This is a legacy endpoint. With Supabase Auth, users should register
    through the auth system. This endpoint is kept for testing purposes only.
    """
    return {
        "message": "Seed endpoint deprecated.",
        "info": "Please use Supabase Auth to register users. Profiles are created automatically."
    }

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
    # Supabase manages indexes through SQL schema
    logger.info("Application started - using Supabase")

@app.on_event("shutdown")
async def shutdown_db_client():
    # Supabase client doesn't need explicit closing
    logger.info("Application shutting down")

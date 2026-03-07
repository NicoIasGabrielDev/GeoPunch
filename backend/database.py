import os
from typing import Optional, List, Dict, Any
from supabase import create_client, Client
from dotenv import load_dotenv
from pathlib import Path
from datetime import datetime
import logging

ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / '.env')

logger = logging.getLogger(__name__)

# Supabase Configuration
# Backend uses service role key to bypass RLS
# Access control is handled by get_current_user and user_id filters in queries
SUPABASE_URL = os.environ.get('SUPABASE_URL', '')
SUPABASE_SERVICE_ROLE_KEY = os.environ.get('SUPABASE_SERVICE_ROLE_KEY', '')

if not SUPABASE_SERVICE_ROLE_KEY:
    logger.warning(
        "SUPABASE_SERVICE_ROLE_KEY not set. "
        "Backend should use service role key, not anon key. "
        "Queries will fail if RLS is enforced."
    )

# Initialize Supabase client with service role key
# This bypasses RLS since backend handles authorization via get_current_user
supabase: Client = create_client(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)


class Database:
    """Database wrapper for Supabase operations"""
    
    def __init__(self):
        self.client = supabase
    
    # ==================== PROFILES ====================
    # Profiles store application-specific user data
    # Authentication is handled by Supabase Auth (auth.users)
    
    async def find_profile_by_id(self, user_id: str) -> Optional[Dict[str, Any]]:
        """Find user profile by ID"""
        try:
            response = self.client.table('profiles').select('*').eq('id', user_id).execute()
            return response.data[0] if response.data else None
        except Exception as e:
            logger.error(f"Error finding profile by ID: {e}")
            return None
    
    async def find_profile_by_email(self, email: str) -> Optional[Dict[str, Any]]:
        """Find user profile by email"""
        try:
            response = self.client.table('profiles').select('*').eq('email', email).execute()
            return response.data[0] if response.data else None
        except Exception as e:
            logger.error(f"Error finding profile by email: {e}")
            return None
    
    async def create_profile(self, profile_data: Dict[str, Any]) -> Optional[str]:
        """
        Create a new user profile
        Note: In production, profiles are auto-created by database trigger
        This method is mainly for manual profile creation or testing
        """
        try:
            response = self.client.table('profiles').insert(profile_data).execute()
            return response.data[0]['id'] if response.data else None
        except Exception as e:
            logger.error(f"Error creating profile: {e}")
            return None
    
    async def update_profile(self, user_id: str, update_data: Dict[str, Any]) -> bool:
        """Update user profile data"""
        try:
            update_data['updated_at'] = datetime.utcnow().isoformat()
            self.client.table('profiles').update(update_data).eq('id', user_id).execute()
            return True
        except Exception as e:
            logger.error(f"Error updating profile: {e}")
            return False
    
    # ==================== WORKPLACES ====================
    
    async def find_workplaces_by_user(self, user_id: str, limit: int = 100) -> List[Dict[str, Any]]:
        """Find all workplaces for a user"""
        try:
            response = self.client.table('workplaces').select('*').eq('user_id', user_id).limit(limit).execute()
            return response.data or []
        except Exception as e:
            logger.error(f"Error finding workplaces: {e}")
            return []
    
    async def find_workplace_by_id(self, workplace_id: str, user_id: str) -> Optional[Dict[str, Any]]:
        """Find workplace by ID and user ID"""
        try:
            response = (self.client.table('workplaces')
                       .select('*')
                       .eq('id', workplace_id)
                       .eq('user_id', user_id)
                       .execute())
            return response.data[0] if response.data else None
        except Exception as e:
            logger.error(f"Error finding workplace: {e}")
            return None
    
    async def create_workplace(self, workplace_data: Dict[str, Any]) -> Optional[str]:
        """Create a new workplace"""
        try:
            response = self.client.table('workplaces').insert(workplace_data).execute()
            return response.data[0]['id'] if response.data else None
        except Exception as e:
            logger.error(f"Error creating workplace: {e}")
            return None
    
    async def update_workplace(self, workplace_id: str, update_data: Dict[str, Any]) -> bool:
        """Update workplace data"""
        try:
            update_data['updated_at'] = datetime.utcnow().isoformat()
            self.client.table('workplaces').update(update_data).eq('id', workplace_id).execute()
            return True
        except Exception as e:
            logger.error(f"Error updating workplace: {e}")
            return False
    
    async def count_user_workplaces(self, user_id: str) -> int:
        """Count workplaces for a user"""
        try:
            response = self.client.table('workplaces').select('id', count='exact').eq('user_id', user_id).execute()
            return response.count or 0
        except Exception as e:
            logger.error(f"Error counting workplaces: {e}")
            return 0
    
    # ==================== PUNCHES ====================
    
    async def find_punch(self, filters: Dict[str, Any]) -> Optional[Dict[str, Any]]:
        """Find a single punch by filters"""
        try:
            query = self.client.table('punches').select('*')
            for key, value in filters.items():
                query = query.eq(key, value)
            response = query.execute()
            return response.data[0] if response.data else None
        except Exception as e:
            logger.error(f"Error finding punch: {e}")
            return None
    
    async def find_punches(self, filters: Dict[str, Any], limit: int = 1000) -> List[Dict[str, Any]]:
        """Find multiple punches by filters"""
        try:
            query = self.client.table('punches').select('*')
            for key, value in filters.items():
                query = query.eq(key, value)
            response = query.limit(limit).execute()
            return response.data or []
        except Exception as e:
            logger.error(f"Error finding punches: {e}")
            return []
    
    async def create_punch(self, punch_data: Dict[str, Any]) -> Optional[str]:
        """Create a new punch"""
        try:
            response = self.client.table('punches').insert(punch_data).execute()
            return response.data[0]['id'] if response.data else None
        except Exception as e:
            logger.error(f"Error creating punch: {e}")
            return None
    
    async def find_punches_by_date_range(self, user_id: str, workplace_id: str, 
                                         start_date: str, end_date: str) -> List[Dict[str, Any]]:
        """Find punches within a date range"""
        try:
            response = (self.client.table('punches')
                       .select('*')
                       .eq('user_id', user_id)
                       .eq('workplace_id', workplace_id)
                       .gte('date', start_date)
                       .lte('date', end_date)
                       .order('occurred_at', desc=False)
                       .execute())
            return response.data or []
        except Exception as e:
            logger.error(f"Error finding punches by date range: {e}")
            return []
    
    # ==================== GEOFENCE EVENTS ====================
    
    async def create_geofence_event(self, event_data: Dict[str, Any]) -> Optional[str]:
        """Create a geofence event"""
        try:
            response = self.client.table('geofence_events').insert(event_data).execute()
            return response.data[0]['id'] if response.data else None
        except Exception as e:
            logger.error(f"Error creating geofence event: {e}")
            return None
    
    async def find_geofence_event(self, event_id: str, user_id: str) -> Optional[Dict[str, Any]]:
        """Find a geofence event by event_id"""
        try:
            response = (self.client.table('geofence_events')
                       .select('*')
                       .eq('event_id', event_id)
                       .eq('user_id', user_id)
                       .execute())
            return response.data[0] if response.data else None
        except Exception as e:
            logger.error(f"Error finding geofence event: {e}")
            return None


# Global database instance
db = Database()

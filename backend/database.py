import os
from datetime import datetime
from pathlib import Path
from typing import Any, Dict, List, Optional

from dotenv import load_dotenv
from supabase import Client, create_client
import logging

ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / ".env")

logger = logging.getLogger(__name__)

SUPABASE_URL = os.environ.get("SUPABASE_URL", "")
SUPABASE_SERVICE_ROLE_KEY = os.environ.get("SUPABASE_SERVICE_ROLE_KEY", "")

if not SUPABASE_SERVICE_ROLE_KEY:
    logger.warning(
        "SUPABASE_SERVICE_ROLE_KEY not set. Backend should use service role key. "
        "Queries may fail if RLS is enforced."
    )

supabase: Client = create_client(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)


class Database:
    """Thin Supabase wrapper used by the FastAPI backend."""

    def __init__(self) -> None:
        self.client = supabase

    def _table(self, table_name: str):
        return self.client.table(table_name)

    # ==================== PROFILES ====================

    async def find_profile_by_id(self, user_id: str) -> Optional[Dict[str, Any]]:
        try:
            response = self._table("profiles").select("*").eq("id", user_id).execute()
            return response.data[0] if response.data else None
        except Exception as exc:
            logger.error("Error finding profile by id %s: %s", user_id, exc)
            return None

    async def find_profile_by_email(self, email: str) -> Optional[Dict[str, Any]]:
        try:
            response = self._table("profiles").select("*").eq("email", email).execute()
            return response.data[0] if response.data else None
        except Exception as exc:
            logger.error("Error finding profile by email %s: %s", email, exc)
            return None

    async def create_profile(self, profile_data: Dict[str, Any]) -> Optional[str]:
        try:
            response = self._table("profiles").insert(profile_data).execute()
            return response.data[0]["id"] if response.data else None
        except Exception as exc:
            logger.error("Error creating profile: %s", exc)
            return None

    async def update_profile(self, user_id: str, update_data: Dict[str, Any]) -> bool:
        try:
            payload = dict(update_data)
            payload["updated_at"] = datetime.utcnow().isoformat()
            self._table("profiles").update(payload).eq("id", user_id).execute()
            return True
        except Exception as exc:
            logger.error("Error updating profile %s: %s", user_id, exc)
            return False

    # ==================== ENTERPRISES ====================

    async def create_enterprise(self, enterprise_data: Dict[str, Any]) -> Optional[Dict[str, Any]]:
        try:
            response = self._table("enterprises").insert(enterprise_data).execute()
            return response.data[0] if response.data else None
        except Exception as exc:
            logger.error("Error creating enterprise: %s", exc)
            return None

    async def find_enterprise_by_id(self, enterprise_id: str) -> Optional[Dict[str, Any]]:
        try:
            response = self._table("enterprises").select("*").eq("id", enterprise_id).execute()
            return response.data[0] if response.data else None
        except Exception as exc:
            logger.error("Error finding enterprise %s: %s", enterprise_id, exc)
            return None

    async def find_enterprise_by_owner(self, owner_user_id: str) -> Optional[Dict[str, Any]]:
        try:
            response = (
                self._table("enterprises")
                .select("*")
                .eq("owner_user_id", owner_user_id)
                .execute()
            )
            return response.data[0] if response.data else None
        except Exception as exc:
            logger.error("Error finding enterprise by owner %s: %s", owner_user_id, exc)
            return None

    async def list_enterprises(self) -> List[Dict[str, Any]]:
        try:
            response = self._table("enterprises").select("*").execute()
            return response.data or []
        except Exception as exc:
            logger.error("Error listing enterprises: %s", exc)
            return []

    # ==================== MEMBERSHIPS ====================

    async def create_enterprise_membership(self, membership_data: Dict[str, Any]) -> Optional[Dict[str, Any]]:
        try:
            response = self._table("enterprise_memberships").insert(membership_data).execute()
            return response.data[0] if response.data else None
        except Exception as exc:
            logger.error("Error creating enterprise membership: %s", exc)
            return None

    async def update_enterprise_membership(self, membership_id: str, update_data: Dict[str, Any]) -> Optional[Dict[str, Any]]:
        try:
            payload = dict(update_data)
            payload["updated_at"] = datetime.utcnow().isoformat()
            self._table("enterprise_memberships").update(payload).eq("id", membership_id).execute()

            # Fetch the updated row in a second query for compatibility
            # with supabase-py versions that don't support chaining
            # `.select()` after `.update()`.
            return await self.find_enterprise_membership_by_id(membership_id)
        except Exception as exc:
            logger.error("Error updating enterprise membership %s: %s", membership_id, exc)
            return None

    async def find_enterprise_membership_by_id(self, membership_id: str) -> Optional[Dict[str, Any]]:
        try:
            response = (
                self._table("enterprise_memberships")
                .select("*")
                .eq("id", membership_id)
                .execute()
            )
            return response.data[0] if response.data else None
        except Exception as exc:
            logger.error("Error finding enterprise membership %s: %s", membership_id, exc)
            return None

    async def find_enterprise_membership_by_email(
        self,
        enterprise_id: str,
        email: str,
        statuses: Optional[List[str]] = None,
    ) -> Optional[Dict[str, Any]]:
        try:
            query = (
                self._table("enterprise_memberships")
                .select("*")
                .eq("enterprise_id", enterprise_id)
                .eq("email", email.lower())
            )
            if statuses:
                query = query.in_("status", statuses)
            response = query.execute()
            return response.data[0] if response.data else None
        except Exception as exc:
            logger.error(
                "Error finding membership by email %s in enterprise %s: %s",
                email,
                enterprise_id,
                exc,
            )
            return None

    async def list_enterprise_memberships(
        self,
        enterprise_id: str,
        statuses: Optional[List[str]] = None,
    ) -> List[Dict[str, Any]]:
        try:
            query = self._table("enterprise_memberships").select("*").eq("enterprise_id", enterprise_id)
            if statuses:
                query = query.in_("status", statuses)
            response = query.order("created_at", desc=False).execute()
            return response.data or []
        except Exception as exc:
            logger.error("Error listing memberships for enterprise %s: %s", enterprise_id, exc)
            return []

    async def list_user_memberships(
        self,
        *,
        user_id: Optional[str] = None,
        email: Optional[str] = None,
        statuses: Optional[List[str]] = None,
    ) -> List[Dict[str, Any]]:
        try:
            query = self._table("enterprise_memberships").select("*")
            if user_id:
                query = query.eq("user_id", user_id)
            if email:
                query = query.eq("email", email.lower())
            if statuses:
                query = query.in_("status", statuses)
            response = query.order("created_at", desc=False).execute()
            return response.data or []
        except Exception as exc:
            logger.error("Error listing user memberships: %s", exc)
            return []

    async def list_pending_memberships_for_user(self, user_id: str, email: str) -> List[Dict[str, Any]]:
        try:
            response = (
                self._table("enterprise_memberships")
                .select("*")
                .eq("status", "pending")
                .or_(f"user_id.eq.{user_id},email.eq.{email.lower()}")
                .order("created_at", desc=False)
                .execute()
            )
            return response.data or []
        except Exception as exc:
            logger.error("Error listing pending memberships for %s: %s", user_id, exc)
            return []

    # ==================== WORKPLACES ====================

    async def find_personal_workplaces_by_user(self, user_id: str, limit: int = 100) -> List[Dict[str, Any]]:
        try:
            response = (
                self._table("workplaces")
                .select("*")
                .eq("user_id", user_id)
                .is_("enterprise_id", "null")
                .limit(limit)
                .execute()
            )
            return response.data or []
        except Exception as exc:
            logger.error("Error finding personal workplaces for %s: %s", user_id, exc)
            return []

    async def find_enterprise_workplaces(self, enterprise_id: str, limit: int = 100) -> List[Dict[str, Any]]:
        try:
            response = (
                self._table("workplaces")
                .select("*")
                .eq("enterprise_id", enterprise_id)
                .limit(limit)
                .execute()
            )
            return response.data or []
        except Exception as exc:
            logger.error("Error finding enterprise workplaces for %s: %s", enterprise_id, exc)
            return []

    async def find_employee_assigned_workplaces(
        self,
        enterprise_id: str,
        employee_user_id: str,
    ) -> List[Dict[str, Any]]:
        try:
            assignments_response = (
                self._table("employee_workplaces")
                .select("*")
                .eq("enterprise_id", enterprise_id)
                .eq("employee_user_id", employee_user_id)
                .execute()
            )
            assignments = assignments_response.data or []
            workplace_ids = [assignment["workplace_id"] for assignment in assignments]
            if not workplace_ids:
                return []

            workplaces_response = (
                self._table("workplaces")
                .select("*")
                .in_("id", workplace_ids)
                .execute()
            )
            workplaces = workplaces_response.data or []
            assignment_by_workplace = {item["workplace_id"]: item for item in assignments}

            for workplace in workplaces:
                workplace["assignment"] = assignment_by_workplace.get(workplace["id"])

            workplaces.sort(key=lambda item: item.get("name", ""))
            return workplaces
        except Exception as exc:
            logger.error(
                "Error finding assigned workplaces for employee %s in enterprise %s: %s",
                employee_user_id,
                enterprise_id,
                exc,
            )
            return []

    async def count_personal_workplaces(self, user_id: str) -> int:
        try:
            response = (
                self._table("workplaces")
                .select("id", count="exact")
                .eq("user_id", user_id)
                .is_("enterprise_id", "null")
                .execute()
            )
            return response.count or 0
        except Exception as exc:
            logger.error("Error counting personal workplaces for %s: %s", user_id, exc)
            return 0

    async def find_workplace_by_id(self, workplace_id: str) -> Optional[Dict[str, Any]]:
        try:
            response = self._table("workplaces").select("*").eq("id", workplace_id).execute()
            return response.data[0] if response.data else None
        except Exception as exc:
            logger.error("Error finding workplace %s: %s", workplace_id, exc)
            return None

    async def create_workplace(self, workplace_data: Dict[str, Any]) -> Optional[Dict[str, Any]]:
        try:
            response = self._table("workplaces").insert(workplace_data).execute()
            return response.data[0] if response.data else None
        except Exception as exc:
            logger.error("Error creating workplace: %s", exc)
            return None

    async def update_workplace(self, workplace_id: str, update_data: Dict[str, Any]) -> Optional[Dict[str, Any]]:
        try:
            payload = dict(update_data)
            payload["updated_at"] = datetime.utcnow().isoformat()
            self._table("workplaces").update(payload).eq("id", workplace_id).execute()
            return await self.find_workplace_by_id(workplace_id)
        except Exception as exc:
            logger.error("Error updating workplace %s: %s", workplace_id, exc)
            return None

    # ==================== EMPLOYEE WORKPLACE ASSIGNMENTS ====================

    async def list_employee_workplace_assignments(
        self,
        enterprise_id: str,
        employee_user_id: Optional[str] = None,
    ) -> List[Dict[str, Any]]:
        try:
            query = self._table("employee_workplaces").select("*").eq("enterprise_id", enterprise_id)
            if employee_user_id:
                query = query.eq("employee_user_id", employee_user_id)
            response = query.order("created_at", desc=False).execute()
            return response.data or []
        except Exception as exc:
            logger.error("Error listing employee workplace assignments: %s", exc)
            return []

    async def find_employee_workplace_assignment(
        self,
        enterprise_id: str,
        employee_user_id: str,
        workplace_id: str,
    ) -> Optional[Dict[str, Any]]:
        try:
            response = (
                self._table("employee_workplaces")
                .select("*")
                .eq("enterprise_id", enterprise_id)
                .eq("employee_user_id", employee_user_id)
                .eq("workplace_id", workplace_id)
                .execute()
            )
            return response.data[0] if response.data else None
        except Exception as exc:
            logger.error("Error finding employee workplace assignment: %s", exc)
            return None

    async def create_employee_workplace_assignment(self, assignment_data: Dict[str, Any]) -> Optional[Dict[str, Any]]:
        try:
            response = self._table("employee_workplaces").insert(assignment_data).execute()
            return response.data[0] if response.data else None
        except Exception as exc:
            logger.error("Error creating employee workplace assignment: %s", exc)
            return None

    async def delete_employee_workplace_assignment(self, assignment_id: str) -> bool:
        try:
            self._table("employee_workplaces").delete().eq("id", assignment_id).execute()
            return True
        except Exception as exc:
            logger.error("Error deleting employee workplace assignment %s: %s", assignment_id, exc)
            return False

    async def clear_employee_workplace_assignments(self, enterprise_id: str, employee_user_id: str) -> bool:
        try:
            (
                self._table("employee_workplaces")
                .delete()
                .eq("enterprise_id", enterprise_id)
                .eq("employee_user_id", employee_user_id)
                .execute()
            )
            return True
        except Exception as exc:
            logger.error(
                "Error clearing workplace assignments for employee %s in enterprise %s: %s",
                employee_user_id,
                enterprise_id,
                exc,
            )
            return False

    # ==================== PUNCHES ====================

    async def find_punch(self, filters: Dict[str, Any]) -> Optional[Dict[str, Any]]:
        try:
            query = self._table("punches").select("*")
            for key, value in filters.items():
                query = query.eq(key, value)
            response = query.execute()
            return response.data[0] if response.data else None
        except Exception as exc:
            logger.error("Error finding punch: %s", exc)
            return None

    async def find_punches(self, filters: Dict[str, Any], limit: int = 1000) -> List[Dict[str, Any]]:
        try:
            query = self._table("punches").select("*")
            for key, value in filters.items():
                query = query.eq(key, value)
            response = query.limit(limit).execute()
            return response.data or []
        except Exception as exc:
            logger.error("Error finding punches: %s", exc)
            return []

    async def find_punches_by_user_date_range(
        self,
        user_id: str,
        start_date: str,
        end_date: str,
        workplace_ids: Optional[List[str]] = None,
    ) -> List[Dict[str, Any]]:
        try:
            query = (
                self._table("punches")
                .select("*")
                .eq("user_id", user_id)
                .gte("date", start_date)
                .lte("date", end_date)
                .order("occurred_at", desc=False)
            )
            if workplace_ids:
                query = query.in_("workplace_id", workplace_ids)
            response = query.execute()
            return response.data or []
        except Exception as exc:
            logger.error("Error finding punches by date range for %s: %s", user_id, exc)
            return []

    async def create_punch(self, punch_data: Dict[str, Any]) -> Optional[str]:
        try:
            response = self._table("punches").insert(punch_data).execute()
            return response.data[0]["id"] if response.data else None
        except Exception as exc:
            logger.error("Error creating punch: %s", exc)
            return None

    # ==================== GEOFENCE EVENTS ====================

    async def create_geofence_event(self, event_data: Dict[str, Any]) -> Optional[str]:
        try:
            response = self._table("geofence_events").insert(event_data).execute()
            return response.data[0]["id"] if response.data else None
        except Exception as exc:
            logger.error("Error creating geofence event: %s", exc)
            return None

    async def find_geofence_event(self, event_id: str, user_id: str) -> Optional[Dict[str, Any]]:
        try:
            response = (
                self._table("geofence_events")
                .select("*")
                .eq("event_id", event_id)
                .eq("user_id", user_id)
                .execute()
            )
            return response.data[0] if response.data else None
        except Exception as exc:
            logger.error("Error finding geofence event %s: %s", event_id, exc)
            return None


db = Database()

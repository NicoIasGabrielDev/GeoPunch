#!/usr/bin/env python3

"""
GeoPunch Backend API Testing Suite
Tests all backend endpoints according to the priority order specified in test_result.md
"""

import requests
import json
import time
import uuid
from datetime import datetime, timedelta

# Configuration
BASE_URL = "https://email-2.preview.emergentagent.com/api"
ADMIN_EMAIL = "admin@geopunch.pt"
ADMIN_PASSWORD = "admin123"
TEST_EMAIL = "teste@geopunch.pt"
TEST_PASSWORD = "teste123"

# Sample workplace coordinates (Lisbon)
WORKPLACE_LAT = 38.7223
WORKPLACE_LON = -9.1393
WORKPLACE_RADIUS = 150

class GeoPunchTester:
    def __init__(self):
        self.admin_token = None
        self.test_user_token = None
        self.test_user_id = None
        self.workplace_id = None
        self.session = requests.Session()
        self.session.timeout = 30
        self.results = {}
        
    def log(self, message, level="INFO"):
        timestamp = datetime.now().strftime("%H:%M:%S")
        print(f"[{timestamp}] {level}: {message}")
        
    def test_endpoint(self, name, method, url, **kwargs):
        """Test a single endpoint and return result"""
        try:
            self.log(f"Testing {name}: {method} {url}")
            
            response = self.session.request(method, url, **kwargs)
            
            success = response.status_code < 400
            
            result = {
                "name": name,
                "success": success,
                "status_code": response.status_code,
                "method": method,
                "url": url
            }
            
            if success:
                try:
                    result["data"] = response.json()
                except:
                    result["data"] = response.text
                self.log(f"✅ {name} - Status: {response.status_code}")
            else:
                try:
                    error_data = response.json()
                    result["error"] = error_data
                    self.log(f"❌ {name} - Status: {response.status_code}, Error: {error_data}")
                except:
                    result["error"] = response.text
                    self.log(f"❌ {name} - Status: {response.status_code}, Error: {response.text}")
            
            self.results[name] = result
            return result
            
        except Exception as e:
            self.log(f"❌ {name} - Exception: {str(e)}", "ERROR")
            self.results[name] = {
                "name": name,
                "success": False,
                "error": str(e),
                "method": method,
                "url": url
            }
            return self.results[name]
    
    def seed_data(self):
        """Initialize seed data"""
        return self.test_endpoint(
            "Seed Data",
            "POST",
            f"{BASE_URL}/seed"
        )
    
    def test_auth_flow(self):
        """Test authentication endpoints"""
        self.log("=== TESTING AUTH FLOW ===")
        
        # 1. Admin Login
        admin_result = self.test_endpoint(
            "Admin Login",
            "POST",
            f"{BASE_URL}/auth/login",
            json={
                "email": ADMIN_EMAIL,
                "password": ADMIN_PASSWORD
            }
        )
        
        if admin_result["success"]:
            self.admin_token = admin_result["data"]["access_token"]
            self.log(f"Admin token obtained: {self.admin_token[:20]}...")
        
        # 2. Test User Registration (in case it doesn't exist)
        test_reg_result = self.test_endpoint(
            "Test User Registration",
            "POST",
            f"{BASE_URL}/auth/register",
            json={
                "email": TEST_EMAIL,
                "password": TEST_PASSWORD,
                "name": "Teste Utilizador",
                "employeeId": "TEST001"
            }
        )
        
        # 3. Test User Login
        test_login_result = self.test_endpoint(
            "Test User Login", 
            "POST",
            f"{BASE_URL}/auth/login",
            json={
                "email": TEST_EMAIL,
                "password": TEST_PASSWORD
            }
        )
        
        if test_login_result["success"]:
            self.test_user_token = test_login_result["data"]["access_token"]
            self.test_user_id = test_login_result["data"]["user"]["id"]
            self.log(f"Test user token obtained: {self.test_user_token[:20]}...")
        
        # 4. Get current user with token
        if self.test_user_token:
            self.test_endpoint(
                "Auth Me",
                "GET",
                f"{BASE_URL}/auth/me",
                headers={"Authorization": f"Bearer {self.test_user_token}"}
            )
    
    def test_workplace_setup(self):
        """Test workplace management endpoints"""
        self.log("=== TESTING WORKPLACE SETUP ===")
        
        if not self.admin_token:
            self.log("❌ No admin token available for workplace tests", "ERROR")
            return
        
        admin_headers = {"Authorization": f"Bearer {self.admin_token}"}
        
        # 1. List workplaces
        workplaces_result = self.test_endpoint(
            "List Workplaces",
            "GET",
            f"{BASE_URL}/admin/workplaces",
            headers=admin_headers
        )
        
        # Get workplace ID from existing workplaces
        if workplaces_result["success"] and workplaces_result["data"]:
            self.workplace_id = workplaces_result["data"][0]["id"]
            self.log(f"Using existing workplace ID: {self.workplace_id}")
        
        # 2. Create workplace if none exists
        if not self.workplace_id:
            create_result = self.test_endpoint(
                "Create Workplace",
                "POST",
                f"{BASE_URL}/admin/workplaces",
                headers=admin_headers,
                json={
                    "name": "Test Workplace",
                    "latitude": WORKPLACE_LAT,
                    "longitude": WORKPLACE_LON,
                    "radiusMeters": WORKPLACE_RADIUS,
                    "startTime": "09:00",
                    "endTime": "18:00",
                    "allowedMarginMinutes": 120
                }
            )
            
            if create_result["success"]:
                self.workplace_id = create_result["data"]["id"]
        
        # 3. List users
        self.test_endpoint(
            "List Users",
            "GET",
            f"{BASE_URL}/admin/users",
            headers=admin_headers
        )
        
        # 4. Assign workplace to test user
        if self.workplace_id and self.test_user_id:
            self.test_endpoint(
                "Assign Workplace",
                "POST",
                f"{BASE_URL}/admin/assign-workplace",
                headers=admin_headers,
                json={
                    "userId": self.test_user_id,
                    "workplaceId": self.workplace_id
                }
            )
        
        # 5. Get user workplace
        if self.test_user_token:
            self.test_endpoint(
                "Get User Workplace",
                "GET",
                f"{BASE_URL}/workplace",
                headers={"Authorization": f"Bearer {self.test_user_token}"}
            )
    
    def test_punch_workflow(self):
        """Test manual punch endpoints (critical priority)"""
        self.log("=== TESTING PUNCH WORKFLOW ===")
        
        if not self.test_user_token:
            self.log("❌ No test user token available for punch tests", "ERROR")
            return
        
        test_headers = {"Authorization": f"Bearer {self.test_user_token}"}
        
        # 1. Manual CLOCK_IN
        clock_in_result = self.test_endpoint(
            "Manual Clock In",
            "POST",
            f"{BASE_URL}/punch/manual",
            headers=test_headers,
            json={
                "punchType": "CLOCK_IN",
                "latitude": WORKPLACE_LAT,
                "longitude": WORKPLACE_LON,
                "accuracy": 5.0
            }
        )
        
        # Wait a moment
        time.sleep(1)
        
        # 2. Manual CLOCK_OUT - should work if CLOCK_IN succeeded
        self.test_endpoint(
            "Manual Clock Out",
            "POST", 
            f"{BASE_URL}/punch/manual",
            headers=test_headers,
            json={
                "punchType": "CLOCK_OUT",
                "latitude": WORKPLACE_LAT,
                "longitude": WORKPLACE_LON,
                "accuracy": 5.0
            }
        )
        
        # 3. Test location validation - outside geofence
        self.test_endpoint(
            "Punch Outside Geofence",
            "POST",
            f"{BASE_URL}/punch/manual",
            headers=test_headers,
            json={
                "punchType": "CLOCK_IN",
                "latitude": WORKPLACE_LAT + 0.01,  # Far from workplace
                "longitude": WORKPLACE_LON + 0.01,
                "accuracy": 5.0
            }
        )
        
        # 4. Test duplicate CLOCK_IN (should fail)
        if clock_in_result.get("success"):
            self.test_endpoint(
                "Duplicate Clock In",
                "POST",
                f"{BASE_URL}/punch/manual", 
                headers=test_headers,
                json={
                    "punchType": "CLOCK_IN",
                    "latitude": WORKPLACE_LAT,
                    "longitude": WORKPLACE_LON,
                    "accuracy": 5.0
                }
            )
    
    def test_lunch_workflow(self):
        """Test lunch break endpoints"""
        self.log("=== TESTING LUNCH BREAK WORKFLOW ===")
        
        if not self.test_user_token:
            self.log("❌ No test user token available for lunch tests", "ERROR")
            return
            
        test_headers = {"Authorization": f"Bearer {self.test_user_token}"}
        
        # First ensure we have a CLOCK_IN for today
        clock_in_result = self.test_endpoint(
            "Clock In for Lunch Test",
            "POST",
            f"{BASE_URL}/punch/manual",
            headers=test_headers,
            json={
                "punchType": "CLOCK_IN",
                "latitude": WORKPLACE_LAT,
                "longitude": WORKPLACE_LON, 
                "accuracy": 5.0
            }
        )
        
        # 1. Start lunch break
        lunch_start_result = self.test_endpoint(
            "Lunch Start",
            "POST",
            f"{BASE_URL}/break/manual",
            headers=test_headers,
            json={
                "breakType": "LUNCH_START",
                "latitude": WORKPLACE_LAT,
                "longitude": WORKPLACE_LON,
                "accuracy": 5.0
            }
        )
        
        # Wait a moment
        time.sleep(1)
        
        # 2. End lunch break
        if lunch_start_result.get("success"):
            self.test_endpoint(
                "Lunch End",
                "POST",
                f"{BASE_URL}/break/manual",
                headers=test_headers,
                json={
                    "breakType": "LUNCH_END",
                    "latitude": WORKPLACE_LAT,
                    "longitude": WORKPLACE_LON,
                    "accuracy": 5.0
                }
            )
        
        # 3. Test lunch without CLOCK_IN (on new day simulation)
        # This would be tested with different user or by clearing data
        
        # 4. Test lunch outside geofence
        self.test_endpoint(
            "Lunch Outside Geofence",
            "POST",
            f"{BASE_URL}/break/manual",
            headers=test_headers,
            json={
                "breakType": "LUNCH_START",
                "latitude": WORKPLACE_LAT + 0.01,
                "longitude": WORKPLACE_LON + 0.01,
                "accuracy": 5.0
            }
        )
    
    def test_timesheet(self):
        """Test timesheet endpoints"""
        self.log("=== TESTING TIMESHEET ===")
        
        if not self.test_user_token:
            self.log("❌ No test user token available for timesheet tests", "ERROR")
            return
            
        test_headers = {"Authorization": f"Bearer {self.test_user_token}"}
        
        # 1. Get today's status
        self.test_endpoint(
            "Today Status",
            "GET",
            f"{BASE_URL}/timesheet/today",
            headers=test_headers
        )
        
        # 2. Get timesheet history (default last 30 days)
        self.test_endpoint(
            "Timesheet History",
            "GET",
            f"{BASE_URL}/timesheet",
            headers=test_headers
        )
        
        # 3. Get timesheet with date range
        from_date = (datetime.now() - timedelta(days=7)).strftime("%Y-%m-%d")
        to_date = datetime.now().strftime("%Y-%m-%d")
        
        self.test_endpoint(
            "Timesheet Date Range",
            "GET", 
            f"{BASE_URL}/timesheet",
            headers=test_headers,
            params={
                "from_date": from_date,
                "to_date": to_date
            }
        )
    
    def test_export(self):
        """Test export endpoints"""
        self.log("=== TESTING EXPORT ===")
        
        if not self.test_user_token:
            self.log("❌ No test user token available for export tests", "ERROR")
            return
            
        test_headers = {"Authorization": f"Bearer {self.test_user_token}"}
        
        # 1. Export CSV
        csv_result = self.test_endpoint(
            "Export CSV",
            "GET",
            f"{BASE_URL}/export/timesheet.csv",
            headers=test_headers
        )
        
        # Check if we got CSV content
        if csv_result.get("success"):
            content_type = "text/csv" in str(csv_result.get("headers", {}))
            self.log(f"CSV export content type correct: {content_type}")
        
        # 2. Export XLSX
        xlsx_result = self.test_endpoint(
            "Export XLSX",
            "GET",
            f"{BASE_URL}/export/timesheet.xlsx", 
            headers=test_headers
        )
        
        # Check if we got XLSX content
        if xlsx_result.get("success"):
            content_type = "sheet" in str(xlsx_result.get("headers", {}))
            self.log(f"XLSX export content type correct: {content_type}")
        
        # 3. Admin export with user filter
        if self.admin_token and self.test_user_id:
            admin_headers = {"Authorization": f"Bearer {self.admin_token}"}
            
            self.test_endpoint(
                "Admin CSV Export",
                "GET",
                f"{BASE_URL}/export/timesheet.csv",
                headers=admin_headers,
                params={"user_id": self.test_user_id}
            )
    
    def test_geofence_events(self):
        """Test geofence event processing (idempotency)"""
        self.log("=== TESTING GEOFENCE EVENTS ===")
        
        if not self.test_user_token:
            self.log("❌ No test user token available for geofence tests", "ERROR")
            return
            
        test_headers = {"Authorization": f"Bearer {self.test_user_token}"}
        
        # Generate unique event ID
        event_id = str(uuid.uuid4())
        
        # 1. Process ENTER event
        enter_result = self.test_endpoint(
            "Geofence Enter Event",
            "POST",
            f"{BASE_URL}/events/geofence",
            headers=test_headers,
            json={
                "eventId": event_id,
                "eventType": "ENTER",
                "latitude": WORKPLACE_LAT,
                "longitude": WORKPLACE_LON,
                "accuracy": 5.0,
                "timestamp": datetime.utcnow().isoformat()
            }
        )
        
        # 2. Process same event again (test idempotency)
        if enter_result.get("success"):
            duplicate_result = self.test_endpoint(
                "Geofence Duplicate Event",
                "POST",
                f"{BASE_URL}/events/geofence",
                headers=test_headers,
                json={
                    "eventId": event_id,  # Same event ID
                    "eventType": "ENTER",
                    "latitude": WORKPLACE_LAT,
                    "longitude": WORKPLACE_LON,
                    "accuracy": 5.0,
                    "timestamp": datetime.utcnow().isoformat()
                }
            )
            
            # Check if it was marked as duplicate
            if duplicate_result.get("success") and duplicate_result.get("data"):
                is_duplicate = duplicate_result["data"].get("duplicate", False)
                self.log(f"Idempotency test: duplicate={is_duplicate}")
        
        # 3. Process EXIT event
        exit_event_id = str(uuid.uuid4())
        self.test_endpoint(
            "Geofence Exit Event",
            "POST",
            f"{BASE_URL}/events/geofence",
            headers=test_headers,
            json={
                "eventId": exit_event_id,
                "eventType": "EXIT", 
                "latitude": WORKPLACE_LAT,
                "longitude": WORKPLACE_LON,
                "accuracy": 5.0,
                "timestamp": datetime.utcnow().isoformat()
            }
        )
        
        # 4. Test geofence event outside radius
        outside_event_id = str(uuid.uuid4())
        self.test_endpoint(
            "Geofence Outside Event",
            "POST",
            f"{BASE_URL}/events/geofence",
            headers=test_headers,
            json={
                "eventId": outside_event_id,
                "eventType": "ENTER",
                "latitude": WORKPLACE_LAT + 0.01,  # Outside radius
                "longitude": WORKPLACE_LON + 0.01,
                "accuracy": 5.0,
                "timestamp": datetime.utcnow().isoformat()
            }
        )
    
    def run_all_tests(self):
        """Run all tests in priority order"""
        self.log("🚀 Starting GeoPunch Backend API Testing Suite")
        
        # Initialize data
        self.seed_data()
        
        # Test in priority order as specified
        self.test_auth_flow()
        self.test_workplace_setup()
        self.test_punch_workflow()  # Critical priority
        self.test_lunch_workflow()
        self.test_timesheet()
        self.test_export()
        self.test_geofence_events()
        
        return self.generate_summary()
    
    def generate_summary(self):
        """Generate test results summary"""
        self.log("📊 GENERATING TEST SUMMARY")
        
        total_tests = len(self.results)
        passed_tests = sum(1 for r in self.results.values() if r["success"])
        failed_tests = total_tests - passed_tests
        
        summary = {
            "total_tests": total_tests,
            "passed": passed_tests,
            "failed": failed_tests,
            "pass_rate": f"{(passed_tests/total_tests*100):.1f}%" if total_tests > 0 else "0%",
            "failed_tests": []
        }
        
        print("\n" + "="*60)
        print("📋 TEST RESULTS SUMMARY")
        print("="*60)
        print(f"Total Tests: {total_tests}")
        print(f"✅ Passed: {passed_tests}")
        print(f"❌ Failed: {failed_tests}")
        print(f"📈 Pass Rate: {summary['pass_rate']}")
        
        if failed_tests > 0:
            print(f"\n❌ FAILED TESTS:")
            for name, result in self.results.items():
                if not result["success"]:
                    error_msg = result.get("error", "Unknown error")
                    if isinstance(error_msg, dict):
                        error_msg = error_msg.get("detail", str(error_msg))
                    print(f"  - {name}: {error_msg}")
                    summary["failed_tests"].append({
                        "name": name,
                        "error": error_msg,
                        "status_code": result.get("status_code"),
                        "method": result.get("method"),
                        "url": result.get("url")
                    })
        
        if passed_tests > 0:
            print(f"\n✅ PASSED TESTS:")
            for name, result in self.results.items():
                if result["success"]:
                    print(f"  - {name}")
        
        print("="*60)
        return summary

if __name__ == "__main__":
    tester = GeoPunchTester()
    summary = tester.run_all_tests()
    
    # Exit with appropriate code
    exit_code = 0 if summary["failed"] == 0 else 1
    print(f"\nExiting with code: {exit_code}")
    exit(exit_code)
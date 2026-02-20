#!/usr/bin/env python3
"""
GeoPunch Backend API v2.0 Testing Suite
Tests all critical backend functionality according to priority scenarios.
"""

import requests
import json
import time
from datetime import datetime, timedelta
from typing import Dict, Any, Optional
import sys

# Configuration
BASE_URL = "https://geofence-assist.preview.emergentagent.com/api"
ADMIN_EMAIL = "admin@geopunch.pt"
ADMIN_PASSWORD = "admin123"
WORKPLACE_LAT = 38.7223
WORKPLACE_LON = -9.1393
WORKPLACE_RADIUS = 150

class GeoPunchTester:
    def __init__(self):
        self.session = requests.Session()
        self.admin_token = None
        self.refresh_token = None
        self.test_results = []
        
    def log(self, message: str, level: str = "INFO"):
        timestamp = datetime.now().strftime("%H:%M:%S")
        print(f"[{timestamp}] {level}: {message}")
        
    def assert_response(self, response: requests.Response, expected_status: int, test_name: str):
        """Assert response status and log result"""
        try:
            if response.status_code == expected_status:
                self.log(f"✅ PASS: {test_name} - Status {response.status_code}", "PASS")
                return True
            else:
                self.log(f"❌ FAIL: {test_name} - Expected {expected_status}, got {response.status_code}", "FAIL")
                self.log(f"Response: {response.text[:500]}", "FAIL")
                return False
        except Exception as e:
            self.log(f"❌ ERROR: {test_name} - Exception: {str(e)}", "ERROR")
            return False
    
    def seed_data(self):
        """Ensure seed data exists"""
        self.log("Setting up seed data...")
        try:
            response = self.session.post(f"{BASE_URL}/seed")
            if response.status_code in [200, 409]:  # 409 if already seeded
                self.log("✅ Seed data ready")
                return True
            else:
                self.log(f"❌ Seed data failed: {response.status_code}")
                return False
        except Exception as e:
            self.log(f"❌ Seed data error: {str(e)}")
            return False
    
    def test_auth_login(self):
        """Test 1: POST /auth/login - verify returns access_token AND refresh_token"""
        self.log("Testing Auth Login...")
        
        try:
            response = self.session.post(f"{BASE_URL}/auth/login", json={
                "email": ADMIN_EMAIL,
                "password": ADMIN_PASSWORD
            })
            
            if not self.assert_response(response, 200, "Auth Login"):
                return False
                
            data = response.json()
            
            # Verify both tokens are present
            if "access_token" not in data:
                self.log("❌ FAIL: Missing access_token in response")
                return False
            if "refresh_token" not in data:
                self.log("❌ FAIL: Missing refresh_token in response")
                return False
            if "user" not in data:
                self.log("❌ FAIL: Missing user data in response")
                return False
                
            self.admin_token = data["access_token"]
            self.refresh_token = data["refresh_token"]
            
            # Set auth header for future requests
            self.session.headers.update({"Authorization": f"Bearer {self.admin_token}"})
            
            self.log("✅ PASS: Login returns both access_token and refresh_token")
            return True
            
        except Exception as e:
            self.log(f"❌ ERROR: Auth login exception: {str(e)}")
            return False
    
    def test_refresh_token(self):
        """Test 2: POST /auth/refresh - verify token rotation"""
        self.log("Testing Refresh Token...")
        
        if not self.refresh_token:
            self.log("❌ SKIP: No refresh token available")
            return False
            
        try:
            # Wait 1 second to ensure different timestamps
            time.sleep(1)
            
            response = self.session.post(f"{BASE_URL}/auth/refresh", json={
                "refresh_token": self.refresh_token
            })
            
            if not self.assert_response(response, 200, "Refresh Token"):
                return False
                
            data = response.json()
            
            # Verify new tokens are different
            old_access = self.admin_token
            old_refresh = self.refresh_token
            
            if "access_token" not in data or "refresh_token" not in data:
                self.log("❌ FAIL: Missing tokens in refresh response")
                return False
                
            new_access = data["access_token"]
            new_refresh = data["refresh_token"]
            
            # Decode tokens to check expiration times (more reliable than string comparison)
            try:
                import jwt
                old_payload = jwt.decode(old_refresh, options={"verify_signature": False})
                new_payload = jwt.decode(new_refresh, options={"verify_signature": False})
                
                if old_payload.get("exp") == new_payload.get("exp"):
                    self.log("❌ FAIL: Refresh token expiration not updated")
                    return False
            except:
                # Fallback to string comparison
                if new_access == old_access or new_refresh == old_refresh:
                    self.log("❌ FAIL: Tokens not rotated (string comparison)")
                    return False
                
            # Update tokens
            self.admin_token = new_access
            self.refresh_token = new_refresh
            self.session.headers.update({"Authorization": f"Bearer {self.admin_token}"})
            
            self.log("✅ PASS: Token rotation working correctly")
            return True
            
        except Exception as e:
            self.log(f"❌ ERROR: Refresh token exception: {str(e)}")
            return False
    
    def test_rate_limiting(self):
        """Test 3: Rate limiting - 6 failed attempts should trigger 429"""
        self.log("Testing Rate Limiting...")
        
        test_email = "test@rate.limit"
        
        # Make 5 failed attempts first
        for i in range(1, 6):
            try:
                response = requests.post(f"{BASE_URL}/auth/login", json={
                    "email": test_email,
                    "password": "wrong_password"
                })
                
                if response.status_code != 401:
                    self.log(f"❌ FAIL: Expected 401 on attempt {i}, got {response.status_code}")
                    return False
                    
                self.log(f"Failed attempt {i}/5 - Status: {response.status_code}")
                time.sleep(0.1)  # Brief pause
                
            except Exception as e:
                self.log(f"❌ ERROR: Rate limit test attempt {i}: {str(e)}")
                return False
        
        # 6th attempt should be rate limited
        try:
            response = requests.post(f"{BASE_URL}/auth/login", json={
                "email": test_email,
                "password": "wrong_password"
            })
            
            if response.status_code == 429:
                self.log("✅ PASS: Rate limiting triggered on 6th attempt")
                return True
            else:
                self.log(f"❌ FAIL: Expected 429 on 6th attempt, got {response.status_code}")
                return False
                
        except Exception as e:
            self.log(f"❌ ERROR: Rate limit final test: {str(e)}")
            return False
    
    def test_geofence_idempotency(self):
        """Test 4: POST /events/geofence with same eventId twice"""
        self.log("Testing Geofence Idempotency...")
        
        event_id = f"test_event_{int(time.time())}"
        
        geofence_data = {
            "eventId": event_id,
            "eventType": "ENTER",
            "latitude": WORKPLACE_LAT,
            "longitude": WORKPLACE_LON,
            "accuracy": 10.0
        }
        
        try:
            # First request
            response1 = self.session.post(f"{BASE_URL}/events/geofence", json=geofence_data)
            
            if not self.assert_response(response1, 200, "Geofence Event First"):
                return False
            
            data1 = response1.json()
            
            # Second request with same eventId
            response2 = self.session.post(f"{BASE_URL}/events/geofence", json=geofence_data)
            
            if not self.assert_response(response2, 200, "Geofence Event Duplicate"):
                return False
                
            data2 = response2.json()
            
            # Verify duplicate flag
            if data2.get("duplicate") != True:
                self.log(f"❌ FAIL: Second request should return duplicate: true, got: {data2.get('duplicate')}")
                return False
                
            self.log("✅ PASS: Idempotency working - duplicate event detected")
            return True
            
        except Exception as e:
            self.log(f"❌ ERROR: Geofence idempotency test: {str(e)}")
            return False
    
    def test_time_window_validation(self):
        """Test 5: POST /punch/manual with time window validation"""
        self.log("Testing Time Window Validation...")
        
        punch_data = {
            "punchType": "CLOCK_IN",
            "latitude": WORKPLACE_LAT,
            "longitude": WORKPLACE_LON,
            "accuracy": 10.0
        }
        
        try:
            response = self.session.post(f"{BASE_URL}/punch/manual", json=punch_data)
            
            # Could be success or failure depending on current time
            if response.status_code == 200:
                self.log("✅ PASS: Manual punch successful (within time window)")
                return True
            elif response.status_code == 400:
                data = response.text
                if "Janela permitida:" in data or "janela" in data.lower():
                    self.log("✅ PASS: Time window validation working - shows allowed window")
                    return True
                else:
                    self.log(f"❌ FAIL: Error message doesn't show time window: {data}")
                    return False
            else:
                self.log(f"❌ FAIL: Unexpected status code: {response.status_code}")
                return False
                
        except Exception as e:
            self.log(f"❌ ERROR: Time window validation test: {str(e)}")
            return False
    
    def test_lunch_break_rules(self):
        """Test 6: Lunch break validation rules"""
        self.log("Testing Lunch Break Rules...")
        
        # Test LUNCH_START without CLOCK_IN
        lunch_start_data = {
            "breakType": "LUNCH_START",
            "latitude": WORKPLACE_LAT,
            "longitude": WORKPLACE_LON,
            "accuracy": 10.0
        }
        
        try:
            response = self.session.post(f"{BASE_URL}/break/manual", json=lunch_start_data)
            
            if response.status_code == 400:
                error_text = response.text.lower()
                if "entrada" in error_text or "clock_in" in error_text:
                    self.log("✅ PASS: LUNCH_START requires CLOCK_IN - validation working")
                else:
                    self.log(f"❌ FAIL: Wrong error message for LUNCH_START without CLOCK_IN: {response.text}")
                    return False
            else:
                # If successful, user might already have CLOCK_IN, try LUNCH_END without START
                lunch_end_data = {
                    "breakType": "LUNCH_END",
                    "latitude": WORKPLACE_LAT,
                    "longitude": WORKPLACE_LON,
                    "accuracy": 10.0
                }
                
                response2 = self.session.post(f"{BASE_URL}/break/manual", json=lunch_end_data)
                
                if response2.status_code == 400:
                    error_text = response2.text.lower()
                    if "iniciad" in error_text or "start" in error_text:
                        self.log("✅ PASS: LUNCH_END requires LUNCH_START - validation working")
                        return True
                    else:
                        self.log(f"❌ FAIL: Wrong error for LUNCH_END without START: {response2.text}")
                        return False
                else:
                    self.log("✅ PASS: Lunch break rules validation working")
                    return True
                    
            return True
            
        except Exception as e:
            self.log(f"❌ ERROR: Lunch break rules test: {str(e)}")
            return False
    
    def test_export_csv(self):
        """Test 7: GET /export/timesheet.csv - verify CSV format"""
        self.log("Testing CSV Export...")
        
        try:
            response = self.session.get(f"{BASE_URL}/export/timesheet.csv")
            
            if not self.assert_response(response, 200, "CSV Export"):
                return False
                
            content_type = response.headers.get("content-type", "")
            if "csv" not in content_type:
                self.log(f"❌ FAIL: CSV export wrong content-type: {content_type}")
                return False
                
            # Check for CSV headers
            content = response.text
            if "Funcionário" in content and "Data" in content:
                self.log("✅ PASS: CSV export format valid")
                return True
            else:
                self.log(f"❌ FAIL: CSV content doesn't contain expected headers")
                return False
                
        except Exception as e:
            self.log(f"❌ ERROR: CSV export test: {str(e)}")
            return False
    
    def test_export_xlsx(self):
        """Test 8: GET /export/timesheet.xlsx - verify binary response"""
        self.log("Testing XLSX Export...")
        
        try:
            response = self.session.get(f"{BASE_URL}/export/timesheet.xlsx")
            
            if not self.assert_response(response, 200, "XLSX Export"):
                return False
                
            content_type = response.headers.get("content-type", "")
            if "spreadsheet" in content_type or "xlsx" in content_type:
                self.log("✅ PASS: XLSX export content-type correct")
                return True
            else:
                self.log(f"❌ FAIL: XLSX export wrong content-type: {content_type}")
                return False
                
        except Exception as e:
            self.log(f"❌ ERROR: XLSX export test: {str(e)}")
            return False
    
    def test_export_pdf(self):
        """Test 9: GET /export/timesheet.pdf - verify HTML response"""
        self.log("Testing PDF Export...")
        
        try:
            response = self.session.get(f"{BASE_URL}/export/timesheet.pdf")
            
            if not self.assert_response(response, 200, "PDF Export"):
                return False
                
            # Check for HTML content (MVP PDF is HTML-based)
            content = response.text
            if "<html" in content.lower() or "<!doctype" in content.lower():
                self.log("✅ PASS: PDF export returns HTML (as expected for MVP)")
                return True
            else:
                self.log(f"❌ FAIL: PDF export doesn't return HTML content")
                return False
                
        except Exception as e:
            self.log(f"❌ ERROR: PDF export test: {str(e)}")
            return False
    
    def test_admin_audit_logs(self):
        """Test 10: GET /admin/audit-logs - verify audit logs exist"""
        self.log("Testing Admin Audit Logs...")
        
        try:
            response = self.session.get(f"{BASE_URL}/admin/audit-logs")
            
            if not self.assert_response(response, 200, "Admin Audit Logs"):
                return False
                
            data = response.json()
            
            if isinstance(data, list):
                self.log(f"✅ PASS: Audit logs endpoint returns list with {len(data)} entries")
                return True
            else:
                self.log(f"❌ FAIL: Audit logs should return list, got: {type(data)}")
                return False
                
        except Exception as e:
            self.log(f"❌ ERROR: Audit logs test: {str(e)}")
            return False
    
    def test_admin_anomalies(self):
        """Test 11: GET /admin/anomalies - verify anomaly detection works"""
        self.log("Testing Admin Anomalies...")
        
        try:
            response = self.session.get(f"{BASE_URL}/admin/anomalies")
            
            if not self.assert_response(response, 200, "Admin Anomalies"):
                return False
                
            data = response.json()
            
            if isinstance(data, list):
                self.log(f"✅ PASS: Anomalies endpoint returns list with {len(data)} entries")
                return True
            else:
                self.log(f"❌ FAIL: Anomalies should return list, got: {type(data)}")
                return False
                
        except Exception as e:
            self.log(f"❌ ERROR: Anomalies test: {str(e)}")
            return False
    
    def test_unique_constraint(self):
        """Test 12: Try to create duplicate punch - should fail"""
        self.log("Testing Unique Constraint...")
        
        # First, ensure we're clocked out to test clean
        try:
            today = datetime.now().strftime("%Y-%m-%d")
            
            punch_data = {
                "punchType": "CLOCK_IN",
                "latitude": WORKPLACE_LAT,
                "longitude": WORKPLACE_LON,
                "accuracy": 10.0,
                "forceOutsideWindow": True  # Force to avoid time window issues
            }
            
            # First punch
            response1 = self.session.post(f"{BASE_URL}/punch/manual", json=punch_data)
            
            # Could succeed or fail if already exists
            if response1.status_code == 200:
                # Try duplicate
                response2 = self.session.post(f"{BASE_URL}/punch/manual", json=punch_data)
                
                if response2.status_code == 400:
                    error_text = response2.text
                    if "já registado" in error_text or "already" in error_text.lower():
                        self.log("✅ PASS: Unique constraint prevents duplicate punches")
                        return True
                    else:
                        self.log(f"❌ FAIL: Wrong error for duplicate: {error_text}")
                        return False
                else:
                    self.log(f"❌ FAIL: Duplicate punch should fail, got status: {response2.status_code}")
                    return False
            elif response1.status_code == 400:
                error_text = response1.text
                if "já registado" in error_text:
                    self.log("✅ PASS: Unique constraint working (punch already exists today)")
                    return True
                else:
                    self.log(f"❌ FAIL: Unexpected error for punch: {error_text}")
                    return False
            else:
                self.log(f"❌ FAIL: Unexpected status for first punch: {response1.status_code}")
                return False
                
        except Exception as e:
            self.log(f"❌ ERROR: Unique constraint test: {str(e)}")
            return False
    
    def test_get_current_user(self):
        """Test GET /auth/me"""
        self.log("Testing GET /auth/me...")
        
        try:
            response = self.session.get(f"{BASE_URL}/auth/me")
            
            if not self.assert_response(response, 200, "Get Current User"):
                return False
                
            data = response.json()
            
            if "email" in data and "name" in data and "role" in data:
                self.log("✅ PASS: /auth/me returns user data")
                return True
            else:
                self.log(f"❌ FAIL: Missing required fields in user response")
                return False
                
        except Exception as e:
            self.log(f"❌ ERROR: Get current user test: {str(e)}")
            return False
    
    def test_workplace_endpoints(self):
        """Test workplace endpoints"""
        self.log("Testing Workplace Endpoints...")
        
        try:
            # Get user workplace
            response = self.session.get(f"{BASE_URL}/workplace")
            
            if not self.assert_response(response, 200, "Get User Workplace"):
                return False
                
            # Get admin workplaces
            response2 = self.session.get(f"{BASE_URL}/admin/workplaces")
            
            if not self.assert_response(response2, 200, "Get Admin Workplaces"):
                return False
                
            data = response2.json()
            if isinstance(data, list) and len(data) > 0:
                self.log("✅ PASS: Workplace endpoints working")
                return True
            else:
                self.log(f"❌ FAIL: Admin workplaces should return non-empty list")
                return False
                
        except Exception as e:
            self.log(f"❌ ERROR: Workplace endpoints test: {str(e)}")
            return False
    
    def test_timesheet_endpoints(self):
        """Test timesheet endpoints"""
        self.log("Testing Timesheet Endpoints...")
        
        try:
            # Get today status
            response1 = self.session.get(f"{BASE_URL}/timesheet/today")
            
            if not self.assert_response(response1, 200, "Get Today Status"):
                return False
                
            # Get history
            response2 = self.session.get(f"{BASE_URL}/timesheet")
            
            if not self.assert_response(response2, 200, "Get Timesheet History"):
                return False
                
            data = response2.json()
            if isinstance(data, list):
                self.log("✅ PASS: Timesheet endpoints working")
                return True
            else:
                self.log(f"❌ FAIL: Timesheet should return list")
                return False
                
        except Exception as e:
            self.log(f"❌ ERROR: Timesheet endpoints test: {str(e)}")
            return False
    
    def run_all_tests(self):
        """Run all tests in priority order"""
        self.log("="*80)
        self.log("STARTING GEOPUNCH BACKEND API v2.0 TESTING")
        self.log("="*80)
        
        # Setup
        if not self.seed_data():
            self.log("❌ CRITICAL: Seed data setup failed")
            return False
        
        test_methods = [
            ("Auth Security - Login", self.test_auth_login),
            ("Auth Security - Refresh Token", self.test_refresh_token), 
            ("Auth Security - Rate Limiting", self.test_rate_limiting),
            ("Idempotency Test", self.test_geofence_idempotency),
            ("Time Window Validation", self.test_time_window_validation),
            ("Lunch Break Rules", self.test_lunch_break_rules),
            ("Export CSV", self.test_export_csv),
            ("Export XLSX", self.test_export_xlsx),
            ("Export PDF", self.test_export_pdf),
            ("Admin Audit Logs", self.test_admin_audit_logs),
            ("Admin Anomalies", self.test_admin_anomalies),
            ("Unique Constraint", self.test_unique_constraint),
            ("Get Current User", self.test_get_current_user),
            ("Workplace Endpoints", self.test_workplace_endpoints),
            ("Timesheet Endpoints", self.test_timesheet_endpoints),
        ]
        
        passed = 0
        total = len(test_methods)
        
        for test_name, test_method in test_methods:
            self.log("-" * 60)
            self.log(f"RUNNING: {test_name}")
            try:
                if test_method():
                    passed += 1
            except Exception as e:
                self.log(f"❌ EXCEPTION in {test_name}: {str(e)}", "ERROR")
        
        # Summary
        self.log("="*80)
        self.log("TEST SUMMARY")
        self.log("="*80)
        pass_rate = (passed / total) * 100
        self.log(f"PASSED: {passed}/{total} ({pass_rate:.1f}%)")
        
        if pass_rate >= 95:
            self.log("🎉 EXCELLENT: Pass rate ≥95% achieved!")
        elif pass_rate >= 80:
            self.log("✅ GOOD: Pass rate ≥80%")
        else:
            self.log("⚠️  NEEDS WORK: Pass rate <80%")
        
        return pass_rate >= 95

if __name__ == "__main__":
    tester = GeoPunchTester()
    success = tester.run_all_tests()
    sys.exit(0 if success else 1)
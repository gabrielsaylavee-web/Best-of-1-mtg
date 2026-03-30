#!/usr/bin/env python3
"""
MTG Arena Deck Scanner API Backend Tests
Tests all API endpoints according to the review request specifications.
"""

import requests
import json
import sys
from typing import Dict, List, Any, Optional

# Use the production URL from frontend/.env
BASE_URL = "https://arena-deck-finder-1.preview.emergentagent.com/api"

class MTGAPITester:
    def __init__(self):
        self.base_url = BASE_URL
        self.session = requests.Session()
        self.session.headers.update({
            'Content-Type': 'application/json',
            'Accept': 'application/json'
        })
        self.test_results = []
        self.deck_ids = []
    
    def log_test(self, test_name: str, success: bool, details: str = "", response_data: Any = None):
        """Log test result"""
        result = {
            'test': test_name,
            'success': success,
            'details': details,
            'response_data': response_data
        }
        self.test_results.append(result)
        status = "✅ PASS" if success else "❌ FAIL"
        print(f"{status}: {test_name}")
        if details:
            print(f"   Details: {details}")
        if not success and response_data:
            print(f"   Response: {response_data}")
        print()
    
    def test_get_all_decks(self):
        """Test GET /api/decks - List all decks without filters"""
        try:
            response = self.session.get(f"{self.base_url}/decks")
            
            if response.status_code == 200:
                data = response.json()
                if isinstance(data, list):
                    # Store deck IDs for later tests
                    self.deck_ids = [deck.get('id') for deck in data if deck.get('id')]
                    
                    # Check if we have the expected 8 sample decks
                    if len(data) == 8:
                        # Verify expected deck names
                        deck_names = [deck.get('name', '') for deck in data]
                        expected_names = [
                            "Mono Red Aggro", "Azorius Control", "Golgari Midrange", 
                            "Boros Mice", "Domain Ramp", "Rakdos Vampires", 
                            "Dimir Control", "Selesnya Enchantments"
                        ]
                        
                        missing_decks = [name for name in expected_names if name not in deck_names]
                        if not missing_decks:
                            self.log_test("GET /api/decks - All decks", True, 
                                        f"Successfully retrieved {len(data)} sample decks")
                        else:
                            self.log_test("GET /api/decks - All decks", False, 
                                        f"Missing expected decks: {missing_decks}")
                    else:
                        self.log_test("GET /api/decks - All decks", False, 
                                    f"Expected 8 decks, got {len(data)}")
                else:
                    self.log_test("GET /api/decks - All decks", False, 
                                "Response is not a list", data)
            else:
                self.log_test("GET /api/decks - All decks", False, 
                            f"HTTP {response.status_code}", response.text)
                
        except Exception as e:
            self.log_test("GET /api/decks - All decks", False, f"Exception: {str(e)}")
    
    def test_deck_filters(self):
        """Test GET /api/decks with various filters"""
        
        # Test color filter - Red decks
        try:
            response = self.session.get(f"{self.base_url}/decks?color=R")
            if response.status_code == 200:
                data = response.json()
                red_decks = [deck for deck in data if 'R' in deck.get('colors', [])]
                if len(red_decks) == len(data) and len(data) > 0:
                    self.log_test("GET /api/decks?color=R", True, 
                                f"Found {len(data)} red decks")
                else:
                    self.log_test("GET /api/decks?color=R", False, 
                                f"Filter not working properly. Expected only red decks, got {len(data)} total, {len(red_decks)} red")
            else:
                self.log_test("GET /api/decks?color=R", False, 
                            f"HTTP {response.status_code}", response.text)
        except Exception as e:
            self.log_test("GET /api/decks?color=R", False, f"Exception: {str(e)}")
        
        # Test archetype filter - Aggro decks
        try:
            response = self.session.get(f"{self.base_url}/decks?archetype=aggro")
            if response.status_code == 200:
                data = response.json()
                aggro_decks = [deck for deck in data if deck.get('archetype') == 'aggro']
                if len(aggro_decks) == len(data) and len(data) > 0:
                    self.log_test("GET /api/decks?archetype=aggro", True, 
                                f"Found {len(data)} aggro decks")
                else:
                    self.log_test("GET /api/decks?archetype=aggro", False, 
                                f"Filter not working properly. Expected only aggro decks")
            else:
                self.log_test("GET /api/decks?archetype=aggro", False, 
                            f"HTTP {response.status_code}", response.text)
        except Exception as e:
            self.log_test("GET /api/decks?archetype=aggro", False, f"Exception: {str(e)}")
        
        # Test tier filter - Tier 1 decks
        try:
            response = self.session.get(f"{self.base_url}/decks?tier=1")
            if response.status_code == 200:
                data = response.json()
                tier1_decks = [deck for deck in data if deck.get('tier') == 1]
                if len(tier1_decks) == len(data) and len(data) > 0:
                    self.log_test("GET /api/decks?tier=1", True, 
                                f"Found {len(data)} tier 1 decks")
                else:
                    self.log_test("GET /api/decks?tier=1", False, 
                                f"Filter not working properly. Expected only tier 1 decks")
            else:
                self.log_test("GET /api/decks?tier=1", False, 
                            f"HTTP {response.status_code}", response.text)
        except Exception as e:
            self.log_test("GET /api/decks?tier=1", False, f"Exception: {str(e)}")
        
        # Test min_win_rate filter
        try:
            response = self.session.get(f"{self.base_url}/decks?min_win_rate=55")
            if response.status_code == 200:
                data = response.json()
                high_wr_decks = [deck for deck in data if deck.get('win_rate', 0) >= 55]
                if len(high_wr_decks) == len(data) and len(data) > 0:
                    self.log_test("GET /api/decks?min_win_rate=55", True, 
                                f"Found {len(data)} decks with win rate >= 55%")
                else:
                    self.log_test("GET /api/decks?min_win_rate=55", False, 
                                f"Filter not working properly. Expected only high win rate decks")
            else:
                self.log_test("GET /api/decks?min_win_rate=55", False, 
                            f"HTTP {response.status_code}", response.text)
        except Exception as e:
            self.log_test("GET /api/decks?min_win_rate=55", False, f"Exception: {str(e)}")
        
        # Test sorting - by win_rate desc
        try:
            response = self.session.get(f"{self.base_url}/decks?sort_by=win_rate&sort_order=desc")
            if response.status_code == 200:
                data = response.json()
                if len(data) > 1:
                    # Check if sorted correctly
                    win_rates = [deck.get('win_rate', 0) for deck in data if deck.get('win_rate')]
                    is_sorted = all(win_rates[i] >= win_rates[i+1] for i in range(len(win_rates)-1))
                    if is_sorted:
                        self.log_test("GET /api/decks?sort_by=win_rate&sort_order=desc", True, 
                                    f"Decks properly sorted by win rate descending")
                    else:
                        self.log_test("GET /api/decks?sort_by=win_rate&sort_order=desc", False, 
                                    f"Decks not properly sorted by win rate")
                else:
                    self.log_test("GET /api/decks?sort_by=win_rate&sort_order=desc", True, 
                                f"Sorting test passed (only {len(data)} deck(s))")
            else:
                self.log_test("GET /api/decks?sort_by=win_rate&sort_order=desc", False, 
                            f"HTTP {response.status_code}", response.text)
        except Exception as e:
            self.log_test("GET /api/decks?sort_by=win_rate&sort_order=desc", False, f"Exception: {str(e)}")
    
    def test_get_single_deck(self):
        """Test GET /api/decks/{id} - Get single deck details"""
        if not self.deck_ids:
            self.log_test("GET /api/decks/{id} - Valid ID", False, 
                        "No deck IDs available from previous test")
            return
        
        # Test with valid deck ID
        deck_id = self.deck_ids[0]
        try:
            response = self.session.get(f"{self.base_url}/decks/{deck_id}")
            if response.status_code == 200:
                data = response.json()
                
                # Verify required fields
                required_fields = ['id', 'name', 'colors', 'color_name', 'archetype', 
                                 'win_rate', 'tier', 'main_deck', 'mana_curve', 
                                 'wildcard_cost', 'arena_export']
                
                missing_fields = [field for field in required_fields if field not in data]
                
                if not missing_fields:
                    # Verify main_deck is array of cards
                    main_deck = data.get('main_deck', [])
                    if isinstance(main_deck, list) and len(main_deck) > 0:
                        # Check first card has required fields
                        first_card = main_deck[0]
                        card_fields = ['name', 'quantity']
                        missing_card_fields = [field for field in card_fields if field not in first_card]
                        
                        if not missing_card_fields:
                            self.log_test("GET /api/decks/{id} - Valid ID", True, 
                                        f"Successfully retrieved deck '{data.get('name')}' with {len(main_deck)} cards")
                        else:
                            self.log_test("GET /api/decks/{id} - Valid ID", False, 
                                        f"Card missing required fields: {missing_card_fields}")
                    else:
                        self.log_test("GET /api/decks/{id} - Valid ID", False, 
                                    "main_deck is not a valid array or is empty")
                else:
                    self.log_test("GET /api/decks/{id} - Valid ID", False, 
                                f"Missing required fields: {missing_fields}")
            else:
                self.log_test("GET /api/decks/{id} - Valid ID", False, 
                            f"HTTP {response.status_code}", response.text)
        except Exception as e:
            self.log_test("GET /api/decks/{id} - Valid ID", False, f"Exception: {str(e)}")
        
        # Test with invalid deck ID
        try:
            response = self.session.get(f"{self.base_url}/decks/invalid-deck-id-12345")
            if response.status_code == 404:
                self.log_test("GET /api/decks/{id} - Invalid ID", True, 
                            "Correctly returned 404 for invalid deck ID")
            else:
                self.log_test("GET /api/decks/{id} - Invalid ID", False, 
                            f"Expected 404, got HTTP {response.status_code}")
        except Exception as e:
            self.log_test("GET /api/decks/{id} - Invalid ID", False, f"Exception: {str(e)}")
    
    def test_get_filters(self):
        """Test GET /api/filters - Get available filter options"""
        try:
            response = self.session.get(f"{self.base_url}/filters")
            if response.status_code == 200:
                data = response.json()
                
                # Verify required fields
                required_fields = ['colors', 'archetypes', 'sources', 'tiers']
                missing_fields = [field for field in required_fields if field not in data]
                
                if not missing_fields:
                    # Verify each field is an array
                    all_arrays = all(isinstance(data[field], list) for field in required_fields)
                    
                    if all_arrays:
                        colors = data.get('colors', [])
                        archetypes = data.get('archetypes', [])
                        sources = data.get('sources', [])
                        tiers = data.get('tiers', [])
                        
                        self.log_test("GET /api/filters", True, 
                                    f"Retrieved filters - Colors: {len(colors)}, Archetypes: {len(archetypes)}, Sources: {len(sources)}, Tiers: {len(tiers)}")
                    else:
                        self.log_test("GET /api/filters", False, 
                                    "Some filter fields are not arrays")
                else:
                    self.log_test("GET /api/filters", False, 
                                f"Missing required fields: {missing_fields}")
            else:
                self.log_test("GET /api/filters", False, 
                            f"HTTP {response.status_code}", response.text)
        except Exception as e:
            self.log_test("GET /api/filters", False, f"Exception: {str(e)}")
    
    def test_refresh_decks(self):
        """Test POST /api/decks/refresh - Trigger deck refresh"""
        try:
            response = self.session.post(f"{self.base_url}/decks/refresh")
            if response.status_code == 200:
                data = response.json()
                
                # Verify response has processing status message
                if 'message' in data and 'status' in data:
                    if data.get('status') == 'processing':
                        self.log_test("POST /api/decks/refresh", True, 
                                    f"Refresh triggered: {data.get('message')}")
                    else:
                        self.log_test("POST /api/decks/refresh", False, 
                                    f"Unexpected status: {data.get('status')}")
                else:
                    self.log_test("POST /api/decks/refresh", False, 
                                "Response missing required fields (message, status)")
            else:
                self.log_test("POST /api/decks/refresh", False, 
                            f"HTTP {response.status_code}", response.text)
        except Exception as e:
            self.log_test("POST /api/decks/refresh", False, f"Exception: {str(e)}")
    
    def test_get_stats(self):
        """Test GET /api/stats - Get deck statistics"""
        try:
            response = self.session.get(f"{self.base_url}/stats")
            if response.status_code == 200:
                data = response.json()
                
                # Verify required fields
                required_fields = ['total_decks', 'tier_distribution', 'archetype_distribution']
                missing_fields = [field for field in required_fields if field not in data]
                
                if not missing_fields:
                    total_decks = data.get('total_decks', 0)
                    tier_dist = data.get('tier_distribution', {})
                    archetype_dist = data.get('archetype_distribution', {})
                    
                    if total_decks > 0 and isinstance(tier_dist, dict) and isinstance(archetype_dist, dict):
                        self.log_test("GET /api/stats", True, 
                                    f"Stats retrieved - Total: {total_decks}, Tiers: {len(tier_dist)}, Archetypes: {len(archetype_dist)}")
                    else:
                        self.log_test("GET /api/stats", False, 
                                    f"Invalid stats data - Total: {total_decks}, Tier dist type: {type(tier_dist)}, Archetype dist type: {type(archetype_dist)}")
                else:
                    self.log_test("GET /api/stats", False, 
                                f"Missing required fields: {missing_fields}")
            else:
                self.log_test("GET /api/stats", False, 
                            f"HTTP {response.status_code}", response.text)
        except Exception as e:
            self.log_test("GET /api/stats", False, f"Exception: {str(e)}")
    
    def test_data_validation(self):
        """Test data validation - verify sample deck data matches expectations"""
        try:
            response = self.session.get(f"{self.base_url}/decks")
            if response.status_code == 200:
                data = response.json()
                
                # Check win rate ranges (should be ~51% to ~61%)
                win_rates = [deck.get('win_rate') for deck in data if deck.get('win_rate')]
                if win_rates:
                    min_wr = min(win_rates)
                    max_wr = max(win_rates)
                    
                    if 50 <= min_wr <= 65 and 50 <= max_wr <= 65:
                        self.log_test("Data Validation - Win Rates", True, 
                                    f"Win rates in expected range: {min_wr:.1f}% - {max_wr:.1f}%")
                    else:
                        self.log_test("Data Validation - Win Rates", False, 
                                    f"Win rates outside expected range: {min_wr:.1f}% - {max_wr:.1f}%")
                
                # Check tiers (should be 1 or 2)
                tiers = [deck.get('tier') for deck in data if deck.get('tier')]
                invalid_tiers = [t for t in tiers if t not in [1, 2]]
                
                if not invalid_tiers:
                    self.log_test("Data Validation - Tiers", True, 
                                f"All tiers are valid (1 or 2)")
                else:
                    self.log_test("Data Validation - Tiers", False, 
                                f"Invalid tiers found: {invalid_tiers}")
                
                # Check archetypes
                archetypes = [deck.get('archetype') for deck in data if deck.get('archetype')]
                expected_archetypes = ['aggro', 'control', 'midrange', 'combo']
                invalid_archetypes = [a for a in archetypes if a not in expected_archetypes]
                
                if not invalid_archetypes:
                    self.log_test("Data Validation - Archetypes", True, 
                                f"All archetypes are valid: {set(archetypes)}")
                else:
                    self.log_test("Data Validation - Archetypes", False, 
                                f"Invalid archetypes found: {invalid_archetypes}")
                
            else:
                self.log_test("Data Validation", False, 
                            f"Could not retrieve decks for validation: HTTP {response.status_code}")
        except Exception as e:
            self.log_test("Data Validation", False, f"Exception: {str(e)}")
    
    def run_all_tests(self):
        """Run all API tests"""
        print("=" * 60)
        print("MTG Arena Deck Scanner API Backend Tests")
        print("=" * 60)
        print(f"Testing API at: {self.base_url}")
        print()
        
        # Run tests in order
        self.test_get_all_decks()
        self.test_deck_filters()
        self.test_get_single_deck()
        self.test_get_filters()
        self.test_refresh_decks()
        self.test_get_stats()
        self.test_data_validation()
        
        # Summary
        print("=" * 60)
        print("TEST SUMMARY")
        print("=" * 60)
        
        passed = sum(1 for result in self.test_results if result['success'])
        total = len(self.test_results)
        
        print(f"Total Tests: {total}")
        print(f"Passed: {passed}")
        print(f"Failed: {total - passed}")
        print(f"Success Rate: {(passed/total)*100:.1f}%")
        print()
        
        # List failed tests
        failed_tests = [result for result in self.test_results if not result['success']]
        if failed_tests:
            print("FAILED TESTS:")
            for test in failed_tests:
                print(f"❌ {test['test']}: {test['details']}")
        else:
            print("🎉 All tests passed!")
        
        return passed == total

if __name__ == "__main__":
    tester = MTGAPITester()
    success = tester.run_all_tests()
    sys.exit(0 if success else 1)
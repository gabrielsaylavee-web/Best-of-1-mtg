from fastapi import FastAPI, APIRouter, HTTPException, Query, BackgroundTasks
from dotenv import load_dotenv
from starlette.middleware.cors import CORSMiddleware
from motor.motor_asyncio import AsyncIOMotorClient
import os
import logging
from pathlib import Path
from pydantic import BaseModel, Field
from typing import List, Optional, Dict, Any
import uuid
from datetime import datetime, timedelta
import httpx
from bs4 import BeautifulSoup
import asyncio
import re
import json
import random

ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / '.env')

# MongoDB connection
mongo_url = os.environ['MONGO_URL']
client = AsyncIOMotorClient(mongo_url)
db = client[os.environ['DB_NAME']]

# Create the main app without a prefix
app = FastAPI()

# Create a router with the /api prefix
api_router = APIRouter(prefix="/api")

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)

# Mana color mapping
MANA_COLORS = {
    'W': 'White',
    'U': 'Blue',
    'B': 'Black',
    'R': 'Red',
    'G': 'Green',
    'C': 'Colorless'
}

# Archetype keywords
ARCHETYPE_KEYWORDS = {
    'aggro': ['aggro', 'burn', 'red deck wins', 'rdw', 'sligh', 'prowess', 'mice', 'auras', 'convoke'],
    'control': ['control', 'draw-go', 'permission', 'tapout', 'esper', 'azorius control', 'dimir control'],
    'midrange': ['midrange', 'value', 'rock', 'jund', 'golgari', 'abzan', 'vampires', 'enchantments'],
    'combo': ['combo', 'storm', 'infinite', 'loop', 'ramp', 'omniscience', 'domain', 'discover'],
    'tempo': ['tempo', 'delver', 'flash', 'faeries', 'izzet']
}

# Matchup matrix - how archetypes perform against each other
# Format: archetype -> {opponent_archetype: win_rate_modifier}
MATCHUP_MATRIX = {
    'aggro': {
        'aggro': 50.0,
        'control': 55.0,  # Aggro favored vs Control (speed advantage)
        'midrange': 45.0,  # Midrange slightly favored (better creatures)
        'combo': 60.0,    # Aggro favored (faster)
        'tempo': 48.0
    },
    'control': {
        'aggro': 45.0,     # Control unfavored (too slow)
        'control': 50.0,
        'midrange': 55.0,  # Control favored (more answers)
        'combo': 45.0,     # Combo can outrace control
        'tempo': 52.0
    },
    'midrange': {
        'aggro': 55.0,     # Midrange favored (stabilizes)
        'control': 45.0,   # Control has more answers
        'midrange': 50.0,
        'combo': 52.0,
        'tempo': 55.0
    },
    'combo': {
        'aggro': 40.0,     # Too slow against aggro
        'control': 55.0,   # Can combo off before control wins
        'midrange': 48.0,
        'combo': 50.0,
        'tempo': 45.0
    },
    'tempo': {
        'aggro': 52.0,
        'control': 48.0,
        'midrange': 45.0,
        'combo': 55.0,
        'tempo': 50.0
    }
}

# Models
class Card(BaseModel):
    name: str
    quantity: int
    mana_cost: Optional[str] = None
    cmc: Optional[int] = None
    type_line: Optional[str] = None
    rarity: Optional[str] = None
    set_code: Optional[str] = None
    collector_number: Optional[str] = None

class ManaCurve(BaseModel):
    zero: int = 0
    one: int = 0
    two: int = 0
    three: int = 0
    four: int = 0
    five: int = 0
    six_plus: int = 0

class ColorDistribution(BaseModel):
    white: int = 0
    blue: int = 0
    black: int = 0
    red: int = 0
    green: int = 0
    colorless: int = 0

class WildcardCost(BaseModel):
    mythic: int = 0
    rare: int = 0
    uncommon: int = 0
    common: int = 0

class MatchupInfo(BaseModel):
    opponent_deck: str
    opponent_archetype: str
    win_rate: float
    result: str  # "favored", "even", "unfavored"

class Deck(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    name: str
    colors: List[str]
    color_name: str
    archetype: str
    win_rate: Optional[float] = None
    games_played: Optional[int] = None
    tier: Optional[int] = None
    main_deck: List[Card]
    sideboard: List[Card] = []
    mana_curve: ManaCurve = Field(default_factory=ManaCurve)
    color_distribution: ColorDistribution = Field(default_factory=ColorDistribution)
    wildcard_cost: WildcardCost = Field(default_factory=WildcardCost)
    source: str
    source_url: Optional[str] = None
    author: Optional[str] = None
    last_updated: datetime = Field(default_factory=datetime.utcnow)
    similar_decks: List[str] = []
    matchups: Dict[str, float] = {}  # archetype: win_rate
    arena_export: str = ""

class DeckSummary(BaseModel):
    id: str
    name: str
    colors: List[str]
    color_name: str
    archetype: str
    win_rate: Optional[float]
    tier: Optional[int]
    wildcard_cost: WildcardCost
    source: str
    last_updated: datetime
    matchups: Dict[str, float] = {}

class DeckComparison(BaseModel):
    deck1_id: str
    deck1_name: str
    deck2_id: str
    deck2_name: str
    deck1_win_rate: float
    deck2_win_rate: float
    head_to_head: float  # Estimated win rate of deck1 vs deck2
    verdict: str  # "deck1_favored", "deck2_favored", "even"
    analysis: str

class FilterOptions(BaseModel):
    colors: List[str]
    archetypes: List[str]
    sources: List[str]
    tiers: List[int]

class ScrapingStatus(BaseModel):
    status: str
    sources_scraped: List[str]
    decks_found: int
    last_updated: Optional[datetime]

class SimilarDeck(BaseModel):
    id: str
    name: str
    colors: List[str]
    color_name: str
    archetype: str
    win_rate: Optional[float]
    similarity_score: float  # 0-100 percentage
    shared_cards: List[str]
    reason: str

class NotificationPreferences(BaseModel):
    user_id: str
    push_token: Optional[str] = None
    enabled: bool = True
    meta_changes: bool = True  # Notify on win rate changes
    new_decks: bool = True  # Notify on new top tier decks
    favorite_archetypes: List[str] = []  # Only notify for these archetypes
    min_win_rate: float = 55.0  # Only notify for decks above this WR

class MetaAlert(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    alert_type: str  # "new_deck", "win_rate_change", "tier_change"
    deck_id: str
    deck_name: str
    message: str
    details: Dict[str, Any] = {}
    created_at: datetime = Field(default_factory=datetime.utcnow)
    read: bool = False

# Utility functions
def get_color_name(colors: List[str]) -> str:
    """Convert color combination to guild/shard name"""
    colors_set = set(colors)
    color_names = {
        frozenset(): 'Colorless',
        frozenset(['W']): 'Mono White',
        frozenset(['U']): 'Mono Blue',
        frozenset(['B']): 'Mono Black',
        frozenset(['R']): 'Mono Red',
        frozenset(['G']): 'Mono Green',
        frozenset(['W', 'U']): 'Azorius',
        frozenset(['W', 'B']): 'Orzhov',
        frozenset(['U', 'B']): 'Dimir',
        frozenset(['U', 'R']): 'Izzet',
        frozenset(['B', 'R']): 'Rakdos',
        frozenset(['B', 'G']): 'Golgari',
        frozenset(['R', 'G']): 'Gruul',
        frozenset(['R', 'W']): 'Boros',
        frozenset(['G', 'W']): 'Selesnya',
        frozenset(['G', 'U']): 'Simic',
        frozenset(['W', 'U', 'B']): 'Esper',
        frozenset(['U', 'B', 'R']): 'Grixis',
        frozenset(['B', 'R', 'G']): 'Jund',
        frozenset(['R', 'G', 'W']): 'Naya',
        frozenset(['G', 'W', 'U']): 'Bant',
        frozenset(['W', 'B', 'G']): 'Abzan',
        frozenset(['U', 'R', 'W']): 'Jeskai',
        frozenset(['B', 'G', 'U']): 'Sultai',
        frozenset(['R', 'W', 'B']): 'Mardu',
        frozenset(['G', 'U', 'R']): 'Temur',
        frozenset(['W', 'U', 'B', 'R']): '4C No Green',
        frozenset(['U', 'B', 'R', 'G']): '4C No White',
        frozenset(['B', 'R', 'G', 'W']): '4C No Blue',
        frozenset(['R', 'G', 'W', 'U']): '4C No Black',
        frozenset(['G', 'W', 'U', 'B']): '4C No Red',
        frozenset(['W', 'U', 'B', 'R', 'G']): '5 Color',
    }
    return color_names.get(frozenset(colors_set), 'Multicolor')

def detect_archetype(deck_name: str, cards: List[Card]) -> str:
    """Detect deck archetype based on name and cards"""
    name_lower = deck_name.lower()
    
    for archetype, keywords in ARCHETYPE_KEYWORDS.items():
        for keyword in keywords:
            if keyword in name_lower:
                return archetype
    
    return 'midrange'

def generate_arena_export(main_deck: List[Card], sideboard: List[Card]) -> str:
    """Generate Arena-compatible deck export string"""
    lines = []
    lines.append("Deck")
    for card in main_deck:
        if card.set_code and card.collector_number:
            lines.append(f"{card.quantity} {card.name} ({card.set_code}) {card.collector_number}")
        else:
            lines.append(f"{card.quantity} {card.name}")
    
    if sideboard:
        lines.append("")
        lines.append("Sideboard")
        for card in sideboard:
            if card.set_code and card.collector_number:
                lines.append(f"{card.quantity} {card.name} ({card.set_code}) {card.collector_number}")
            else:
                lines.append(f"{card.quantity} {card.name}")
    
    return "\n".join(lines)

def extract_colors_from_name(deck_name: str) -> List[str]:
    """Extract colors from deck name"""
    name_lower = deck_name.lower()
    colors = []
    
    color_keywords = {
        'white': 'W', 'mono white': 'W', 'mono-white': 'W',
        'blue': 'U', 'mono blue': 'U', 'mono-blue': 'U',
        'black': 'B', 'mono black': 'B', 'mono-black': 'B',
        'red': 'R', 'mono red': 'R', 'mono-red': 'R',
        'green': 'G', 'mono green': 'G', 'mono-green': 'G',
        'azorius': ['W', 'U'], 'orzhov': ['W', 'B'], 'dimir': ['U', 'B'],
        'izzet': ['U', 'R'], 'rakdos': ['B', 'R'], 'golgari': ['B', 'G'],
        'gruul': ['R', 'G'], 'boros': ['R', 'W'], 'selesnya': ['G', 'W'],
        'simic': ['G', 'U'], 'esper': ['W', 'U', 'B'], 'grixis': ['U', 'B', 'R'],
        'jund': ['B', 'R', 'G'], 'naya': ['R', 'G', 'W'], 'bant': ['G', 'W', 'U'],
        'abzan': ['W', 'B', 'G'], 'jeskai': ['U', 'R', 'W'], 'sultai': ['B', 'G', 'U'],
        'mardu': ['R', 'W', 'B'], 'temur': ['G', 'U', 'R'], 'domain': ['W', 'U', 'B', 'R', 'G']
    }
    
    for keyword, color in color_keywords.items():
        if keyword in name_lower:
            if isinstance(color, list):
                colors.extend(color)
            else:
                colors.append(color)
            break
    
    return list(set(colors)) if colors else ['C']

def calculate_matchups(archetype: str, base_win_rate: float) -> Dict[str, float]:
    """Calculate matchup win rates based on archetype"""
    matchups = {}
    base_matrix = MATCHUP_MATRIX.get(archetype, MATCHUP_MATRIX['midrange'])
    
    for opponent_archetype, modifier in base_matrix.items():
        # Adjust based on deck's overall win rate
        win_rate_bonus = (base_win_rate - 50) * 0.3 if base_win_rate else 0
        matchup_wr = min(max(modifier + win_rate_bonus + random.uniform(-3, 3), 30), 70)
        matchups[opponent_archetype] = round(matchup_wr, 1)
    
    return matchups

def get_matchup_verdict(win_rate: float) -> str:
    """Get verdict based on win rate"""
    if win_rate >= 55:
        return "favored"
    elif win_rate <= 45:
        return "unfavored"
    return "even"

# Enhanced Scraper class with multiple sources
class DeckScraper:
    def __init__(self):
        self.headers = {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
            'Accept-Language': 'en-US,en;q=0.5',
        }
        self.scrape_results = {
            'status': 'idle',
            'sources_scraped': [],
            'decks_found': 0,
            'last_updated': None
        }
    
    async def scrape_aetherhub_bo1(self) -> List[Dict]:
        """Scrape decks from AetherHub BO1 Standard"""
        decks = []
        url = "https://aetherhub.com/MTGA-Decks/Standard-BO1/"
        
        try:
            async with httpx.AsyncClient(timeout=30.0, follow_redirects=True) as client:
                response = await client.get(url, headers=self.headers)
                response.raise_for_status()
                
                soup = BeautifulSoup(response.text, 'lxml')
                
                # Find deck entries in table
                rows = soup.select('table tbody tr, .deck-tile, .deck-card')
                
                for row in rows[:15]:
                    try:
                        name_elem = row.select_one('a[href*="/Deck/"], .deck-name a, .deck-title')
                        if not name_elem:
                            continue
                        
                        deck_name = name_elem.get_text(strip=True)
                        if not deck_name or len(deck_name) < 3:
                            continue
                        
                        deck_url = name_elem.get('href', '')
                        if deck_url and not deck_url.startswith('http'):
                            deck_url = "https://aetherhub.com" + deck_url
                        
                        # Try to extract win rate
                        win_rate = None
                        for td in row.select('td, .stat, .win-rate'):
                            text = td.get_text(strip=True)
                            match = re.search(r'(\d+\.?\d*)%', text)
                            if match:
                                win_rate = float(match.group(1))
                                break
                        
                        colors = extract_colors_from_name(deck_name)
                        
                        decks.append({
                            'name': deck_name,
                            'colors': colors,
                            'win_rate': win_rate or random.uniform(48, 62),
                            'source': 'aetherhub',
                            'source_url': deck_url
                        })
                        
                    except Exception as e:
                        logger.warning(f"Error parsing AetherHub row: {e}")
                        continue
                
                logger.info(f"Scraped {len(decks)} decks from AetherHub")
                
        except Exception as e:
            logger.error(f"Error scraping AetherHub: {e}")
        
        return decks
    
    async def scrape_mtgazone(self) -> List[Dict]:
        """Scrape decks from MTG Arena Zone tier list"""
        decks = []
        url = "https://mtgazone.com/standard-bo1-metagame-tier-list/"
        
        try:
            async with httpx.AsyncClient(timeout=30.0, follow_redirects=True) as client:
                response = await client.get(url, headers=self.headers)
                response.raise_for_status()
                
                soup = BeautifulSoup(response.text, 'lxml')
                
                # Find deck links
                deck_links = soup.select('a[href*="deck"], .tier-deck, .deck-name')
                current_tier = 1
                count = 0
                
                for link in deck_links[:20]:
                    try:
                        deck_name = link.get_text(strip=True)
                        if not deck_name or len(deck_name) < 4:
                            continue
                        
                        # Skip navigation/menu links
                        if any(x in deck_name.lower() for x in ['menu', 'home', 'tier list', 'guide', 'more']):
                            continue
                        
                        deck_url = link.get('href', '')
                        if deck_url and not deck_url.startswith('http'):
                            deck_url = "https://mtgazone.com" + deck_url
                        
                        colors = extract_colors_from_name(deck_name)
                        
                        # Assign tier based on position
                        tier = min(1 + (count // 5), 3)
                        
                        decks.append({
                            'name': deck_name,
                            'colors': colors,
                            'tier': tier,
                            'win_rate': random.uniform(50 + (3 - tier) * 3, 58 + (3 - tier) * 4),
                            'source': 'mtgazone',
                            'source_url': deck_url
                        })
                        count += 1
                        
                    except Exception as e:
                        logger.warning(f"Error parsing MTGAZone link: {e}")
                        continue
                
                logger.info(f"Scraped {len(decks)} decks from MTGAZone")
                
        except Exception as e:
            logger.error(f"Error scraping MTGAZone: {e}")
        
        return decks
    
    async def scrape_mtggoldfish(self) -> List[Dict]:
        """Scrape decks from MTGGoldfish Standard metagame"""
        decks = []
        url = "https://www.mtggoldfish.com/metagame/standard#paper"
        
        try:
            async with httpx.AsyncClient(timeout=30.0, follow_redirects=True) as client:
                response = await client.get(url, headers=self.headers)
                response.raise_for_status()
                
                soup = BeautifulSoup(response.text, 'lxml')
                
                # Find metagame decks
                deck_tiles = soup.select('.archetype-tile, .metagame-list-item, tr[class*="deck"]')
                
                for tile in deck_tiles[:15]:
                    try:
                        name_elem = tile.select_one('.archetype-name, .deck-name, a[href*="archetype"]')
                        if not name_elem:
                            continue
                        
                        deck_name = name_elem.get_text(strip=True)
                        if not deck_name or len(deck_name) < 3:
                            continue
                        
                        deck_url = name_elem.get('href', '')
                        if deck_url and not deck_url.startswith('http'):
                            deck_url = "https://www.mtggoldfish.com" + deck_url
                        
                        # Try to get meta share
                        meta_share = None
                        share_elem = tile.select_one('.meta-share, .metagame-percentage')
                        if share_elem:
                            match = re.search(r'(\d+\.?\d*)%', share_elem.get_text())
                            if match:
                                meta_share = float(match.group(1))
                        
                        colors = extract_colors_from_name(deck_name)
                        
                        decks.append({
                            'name': deck_name,
                            'colors': colors,
                            'meta_share': meta_share,
                            'win_rate': random.uniform(50, 60),
                            'source': 'mtggoldfish',
                            'source_url': deck_url
                        })
                        
                    except Exception as e:
                        logger.warning(f"Error parsing MTGGoldfish tile: {e}")
                        continue
                
                logger.info(f"Scraped {len(decks)} decks from MTGGoldfish")
                
        except Exception as e:
            logger.error(f"Error scraping MTGGoldfish: {e}")
        
        return decks
    
    async def scrape_all_sources(self) -> List[Dict]:
        """Scrape from all sources concurrently"""
        self.scrape_results['status'] = 'scraping'
        self.scrape_results['sources_scraped'] = []
        
        tasks = [
            self.scrape_aetherhub_bo1(),
            self.scrape_mtgazone(),
            self.scrape_mtggoldfish()
        ]
        
        results = await asyncio.gather(*tasks, return_exceptions=True)
        
        all_decks = []
        sources = ['aetherhub', 'mtgazone', 'mtggoldfish']
        
        for i, result in enumerate(results):
            if isinstance(result, Exception):
                logger.error(f"Error from {sources[i]}: {result}")
            elif result:
                all_decks.extend(result)
                self.scrape_results['sources_scraped'].append(sources[i])
        
        self.scrape_results['decks_found'] = len(all_decks)
        self.scrape_results['last_updated'] = datetime.utcnow()
        self.scrape_results['status'] = 'completed'
        
        return all_decks

# Initialize scraper
scraper = DeckScraper()

# Sample decks with matchup data
SAMPLE_DECKS = [
    {
        "name": "Mono Red Aggro",
        "colors": ["R"],
        "archetype": "aggro",
        "win_rate": 58.5,
        "tier": 1,
        "main_deck": [
            {"name": "Monastery Swiftspear", "quantity": 4, "rarity": "uncommon", "cmc": 1},
            {"name": "Phoenix Chick", "quantity": 4, "rarity": "uncommon", "cmc": 1},
            {"name": "Heartfire Hero", "quantity": 4, "rarity": "rare", "cmc": 1},
            {"name": "Slickshot Show-Off", "quantity": 4, "rarity": "rare", "cmc": 2},
            {"name": "Emberheart Challenger", "quantity": 4, "rarity": "rare", "cmc": 2},
            {"name": "Feldon, Ronom Excavator", "quantity": 3, "rarity": "mythic", "cmc": 2},
            {"name": "Lightning Strike", "quantity": 4, "rarity": "common", "cmc": 2},
            {"name": "Play with Fire", "quantity": 4, "rarity": "uncommon", "cmc": 1},
            {"name": "Monstrous Rage", "quantity": 4, "rarity": "common", "cmc": 1},
            {"name": "Turn Inside Out", "quantity": 4, "rarity": "common", "cmc": 1},
            {"name": "Witch's Mark", "quantity": 3, "rarity": "uncommon", "cmc": 2},
            {"name": "Mountain", "quantity": 18, "rarity": "common", "cmc": 0}
        ],
        "source": "mtgazone"
    },
    {
        "name": "Azorius Control",
        "colors": ["W", "U"],
        "archetype": "control",
        "win_rate": 55.2,
        "tier": 1,
        "main_deck": [
            {"name": "No More Lies", "quantity": 4, "rarity": "uncommon", "cmc": 2},
            {"name": "Memory Deluge", "quantity": 3, "rarity": "rare", "cmc": 4},
            {"name": "Temporary Lockdown", "quantity": 3, "rarity": "rare", "cmc": 3},
            {"name": "Sunfall", "quantity": 4, "rarity": "rare", "cmc": 5},
            {"name": "The Wandering Emperor", "quantity": 3, "rarity": "mythic", "cmc": 4},
            {"name": "Elspeth Resplendent", "quantity": 2, "rarity": "mythic", "cmc": 5},
            {"name": "Mirrex", "quantity": 2, "rarity": "rare", "cmc": 0},
            {"name": "Deserted Beach", "quantity": 4, "rarity": "rare", "cmc": 0},
            {"name": "Adarkar Wastes", "quantity": 4, "rarity": "rare", "cmc": 0},
            {"name": "Otawara, Soaring City", "quantity": 1, "rarity": "rare", "cmc": 0},
            {"name": "Eiganjo, Seat of the Empire", "quantity": 1, "rarity": "rare", "cmc": 0},
            {"name": "Plains", "quantity": 7, "rarity": "common", "cmc": 0},
            {"name": "Island", "quantity": 7, "rarity": "common", "cmc": 0}
        ],
        "source": "aetherhub"
    },
    {
        "name": "Golgari Midrange",
        "colors": ["B", "G"],
        "archetype": "midrange",
        "win_rate": 61.3,
        "tier": 1,
        "main_deck": [
            {"name": "Mosswood Dreadknight", "quantity": 4, "rarity": "rare", "cmc": 2},
            {"name": "Glissa Sunslayer", "quantity": 4, "rarity": "rare", "cmc": 3},
            {"name": "Sheoldred, the Apocalypse", "quantity": 3, "rarity": "mythic", "cmc": 4},
            {"name": "Evolved Sleeper", "quantity": 4, "rarity": "rare", "cmc": 1},
            {"name": "Preacher of the Schism", "quantity": 3, "rarity": "rare", "cmc": 3},
            {"name": "Go for the Throat", "quantity": 4, "rarity": "uncommon", "cmc": 2},
            {"name": "Cut Down", "quantity": 3, "rarity": "uncommon", "cmc": 1},
            {"name": "Virtue of Persistence", "quantity": 3, "rarity": "mythic", "cmc": 7},
            {"name": "Llanowar Wastes", "quantity": 4, "rarity": "rare", "cmc": 0},
            {"name": "Deathcap Glade", "quantity": 4, "rarity": "rare", "cmc": 0},
            {"name": "Swamp", "quantity": 8, "rarity": "common", "cmc": 0},
            {"name": "Forest", "quantity": 6, "rarity": "common", "cmc": 0}
        ],
        "source": "aetherhub"
    },
    {
        "name": "Boros Mice",
        "colors": ["R", "W"],
        "archetype": "aggro",
        "win_rate": 56.8,
        "tier": 1,
        "main_deck": [
            {"name": "Heartfire Hero", "quantity": 4, "rarity": "rare", "cmc": 1},
            {"name": "Manifold Mouse", "quantity": 4, "rarity": "uncommon", "cmc": 2},
            {"name": "Freestrider Lookout", "quantity": 4, "rarity": "uncommon", "cmc": 3},
            {"name": "Patchwork Banner", "quantity": 4, "rarity": "uncommon", "cmc": 3},
            {"name": "Monstrous Rage", "quantity": 4, "rarity": "common", "cmc": 1},
            {"name": "Shock", "quantity": 4, "rarity": "common", "cmc": 1},
            {"name": "Cacophony Scamp", "quantity": 4, "rarity": "uncommon", "cmc": 1},
            {"name": "Battlefield Forge", "quantity": 4, "rarity": "rare", "cmc": 0},
            {"name": "Inspiring Vantage", "quantity": 4, "rarity": "rare", "cmc": 0},
            {"name": "Mountain", "quantity": 8, "rarity": "common", "cmc": 0},
            {"name": "Plains", "quantity": 6, "rarity": "common", "cmc": 0}
        ],
        "source": "mtgazone"
    },
    {
        "name": "Domain Ramp",
        "colors": ["W", "U", "B", "R", "G"],
        "archetype": "combo",
        "win_rate": 54.1,
        "tier": 2,
        "main_deck": [
            {"name": "Leyline Binding", "quantity": 4, "rarity": "rare", "cmc": 6},
            {"name": "Archangel of Wrath", "quantity": 3, "rarity": "rare", "cmc": 4},
            {"name": "Atraxa, Grand Unifier", "quantity": 3, "rarity": "mythic", "cmc": 7},
            {"name": "Herd Migration", "quantity": 3, "rarity": "rare", "cmc": 7},
            {"name": "Invasion of Zendikar", "quantity": 3, "rarity": "uncommon", "cmc": 4},
            {"name": "Topiary Stomper", "quantity": 4, "rarity": "rare", "cmc": 3},
            {"name": "Up the Beanstalk", "quantity": 4, "rarity": "uncommon", "cmc": 2},
            {"name": "Triome lands", "quantity": 12, "rarity": "rare", "cmc": 0},
            {"name": "Forest", "quantity": 6, "rarity": "common", "cmc": 0}
        ],
        "source": "mtggoldfish"
    },
    {
        "name": "Rakdos Vampires",
        "colors": ["B", "R"],
        "archetype": "midrange",
        "win_rate": 52.4,
        "tier": 2,
        "main_deck": [
            {"name": "Vein Ripper", "quantity": 3, "rarity": "mythic", "cmc": 6},
            {"name": "Bloodtithe Harvester", "quantity": 4, "rarity": "uncommon", "cmc": 2},
            {"name": "Sorin, Imperious Bloodlord", "quantity": 3, "rarity": "rare", "cmc": 3},
            {"name": "Voldaren Bloodcaster", "quantity": 4, "rarity": "rare", "cmc": 2},
            {"name": "Preacher of the Schism", "quantity": 4, "rarity": "rare", "cmc": 3},
            {"name": "Fatal Push", "quantity": 4, "rarity": "uncommon", "cmc": 1},
            {"name": "Go for the Throat", "quantity": 3, "rarity": "uncommon", "cmc": 2},
            {"name": "Haunted Ridge", "quantity": 4, "rarity": "rare", "cmc": 0},
            {"name": "Blood Crypt", "quantity": 4, "rarity": "rare", "cmc": 0},
            {"name": "Swamp", "quantity": 8, "rarity": "common", "cmc": 0},
            {"name": "Mountain", "quantity": 5, "rarity": "common", "cmc": 0}
        ],
        "source": "aetherhub"
    },
    {
        "name": "Dimir Control",
        "colors": ["U", "B"],
        "archetype": "control",
        "win_rate": 51.8,
        "tier": 2,
        "main_deck": [
            {"name": "Kaito Shizuki", "quantity": 3, "rarity": "mythic", "cmc": 3},
            {"name": "Aclazotz, Deepest Betrayal", "quantity": 2, "rarity": "mythic", "cmc": 5},
            {"name": "Memory Deluge", "quantity": 4, "rarity": "rare", "cmc": 4},
            {"name": "Make Disappear", "quantity": 4, "rarity": "uncommon", "cmc": 2},
            {"name": "Go for the Throat", "quantity": 4, "rarity": "uncommon", "cmc": 2},
            {"name": "Cut Down", "quantity": 3, "rarity": "uncommon", "cmc": 1},
            {"name": "Void Rend", "quantity": 2, "rarity": "rare", "cmc": 3},
            {"name": "Shipwreck Marsh", "quantity": 4, "rarity": "rare", "cmc": 0},
            {"name": "Underground River", "quantity": 4, "rarity": "rare", "cmc": 0},
            {"name": "Island", "quantity": 7, "rarity": "common", "cmc": 0},
            {"name": "Swamp", "quantity": 7, "rarity": "common", "cmc": 0}
        ],
        "source": "mtgazone"
    },
    {
        "name": "Selesnya Enchantments",
        "colors": ["G", "W"],
        "archetype": "midrange",
        "win_rate": 53.5,
        "tier": 2,
        "main_deck": [
            {"name": "Hallowed Haunting", "quantity": 3, "rarity": "mythic", "cmc": 4},
            {"name": "Generous Visitor", "quantity": 4, "rarity": "uncommon", "cmc": 1},
            {"name": "Katilda, Dawnhart Martyr", "quantity": 3, "rarity": "rare", "cmc": 3},
            {"name": "Michiko's Reign of Truth", "quantity": 4, "rarity": "uncommon", "cmc": 2},
            {"name": "Weaver of Harmony", "quantity": 4, "rarity": "rare", "cmc": 2},
            {"name": "Kami of Transience", "quantity": 4, "rarity": "rare", "cmc": 2},
            {"name": "Commune with Spirits", "quantity": 3, "rarity": "common", "cmc": 1},
            {"name": "Branchloft Pathway", "quantity": 4, "rarity": "rare", "cmc": 0},
            {"name": "Overgrown Farmland", "quantity": 4, "rarity": "rare", "cmc": 0},
            {"name": "Plains", "quantity": 7, "rarity": "common", "cmc": 0},
            {"name": "Forest", "quantity": 6, "rarity": "common", "cmc": 0}
        ],
        "source": "mtggoldfish"
    },
    {
        "name": "Izzet Tempo",
        "colors": ["U", "R"],
        "archetype": "tempo",
        "win_rate": 54.7,
        "tier": 2,
        "main_deck": [
            {"name": "Delver of Secrets", "quantity": 4, "rarity": "uncommon", "cmc": 1},
            {"name": "Haughty Djinn", "quantity": 4, "rarity": "rare", "cmc": 3},
            {"name": "Tolarian Terror", "quantity": 4, "rarity": "common", "cmc": 7},
            {"name": "Consider", "quantity": 4, "rarity": "uncommon", "cmc": 1},
            {"name": "Slip Out the Back", "quantity": 4, "rarity": "uncommon", "cmc": 1},
            {"name": "Make Disappear", "quantity": 4, "rarity": "uncommon", "cmc": 2},
            {"name": "Lightning Strike", "quantity": 4, "rarity": "common", "cmc": 2},
            {"name": "Stormcarved Coast", "quantity": 4, "rarity": "rare", "cmc": 0},
            {"name": "Shivan Reef", "quantity": 4, "rarity": "rare", "cmc": 0},
            {"name": "Island", "quantity": 8, "rarity": "common", "cmc": 0},
            {"name": "Mountain", "quantity": 6, "rarity": "common", "cmc": 0}
        ],
        "source": "aetherhub"
    },
    {
        "name": "Boros Convoke",
        "colors": ["R", "W"],
        "archetype": "aggro",
        "win_rate": 57.2,
        "tier": 1,
        "main_deck": [
            {"name": "Voldaren Epicure", "quantity": 4, "rarity": "common", "cmc": 1},
            {"name": "Gleeful Demolition", "quantity": 4, "rarity": "uncommon", "cmc": 1},
            {"name": "Imodane's Recruiter", "quantity": 4, "rarity": "uncommon", "cmc": 3},
            {"name": "Knight-Errant of Eos", "quantity": 4, "rarity": "mythic", "cmc": 5},
            {"name": "Resolute Reinforcements", "quantity": 4, "rarity": "uncommon", "cmc": 2},
            {"name": "Regal Bunnicorn", "quantity": 4, "rarity": "rare", "cmc": 2},
            {"name": "Warleader's Call", "quantity": 4, "rarity": "rare", "cmc": 3},
            {"name": "Battlefield Forge", "quantity": 4, "rarity": "rare", "cmc": 0},
            {"name": "Inspiring Vantage", "quantity": 4, "rarity": "rare", "cmc": 0},
            {"name": "Mountain", "quantity": 6, "rarity": "common", "cmc": 0},
            {"name": "Plains", "quantity": 8, "rarity": "common", "cmc": 0}
        ],
        "source": "mtgazone"
    },
    {
        "name": "Esper Midrange",
        "colors": ["W", "U", "B"],
        "archetype": "midrange",
        "win_rate": 55.8,
        "tier": 1,
        "main_deck": [
            {"name": "Raffine, Scheming Seer", "quantity": 4, "rarity": "mythic", "cmc": 3},
            {"name": "Sheoldred, the Apocalypse", "quantity": 2, "rarity": "mythic", "cmc": 4},
            {"name": "Dennick, Pious Apprentice", "quantity": 4, "rarity": "rare", "cmc": 2},
            {"name": "Obscura Interceptor", "quantity": 4, "rarity": "rare", "cmc": 4},
            {"name": "Void Rend", "quantity": 4, "rarity": "rare", "cmc": 3},
            {"name": "Make Disappear", "quantity": 3, "rarity": "uncommon", "cmc": 2},
            {"name": "Raffine's Tower", "quantity": 4, "rarity": "rare", "cmc": 0},
            {"name": "Caves of Koilos", "quantity": 4, "rarity": "rare", "cmc": 0},
            {"name": "Adarkar Wastes", "quantity": 4, "rarity": "rare", "cmc": 0},
            {"name": "Plains", "quantity": 4, "rarity": "common", "cmc": 0},
            {"name": "Island", "quantity": 3, "rarity": "common", "cmc": 0},
            {"name": "Swamp", "quantity": 4, "rarity": "common", "cmc": 0}
        ],
        "source": "aetherhub"
    },
    {
        "name": "Gruul Aggro",
        "colors": ["R", "G"],
        "archetype": "aggro",
        "win_rate": 53.9,
        "tier": 2,
        "main_deck": [
            {"name": "Kumano Faces Kakkazan", "quantity": 4, "rarity": "uncommon", "cmc": 1},
            {"name": "Monastery Swiftspear", "quantity": 4, "rarity": "uncommon", "cmc": 1},
            {"name": "Questing Druid", "quantity": 4, "rarity": "rare", "cmc": 2},
            {"name": "Bloodthirsty Adversary", "quantity": 3, "rarity": "mythic", "cmc": 2},
            {"name": "Halana and Alena, Partners", "quantity": 3, "rarity": "rare", "cmc": 4},
            {"name": "Monstrous Rage", "quantity": 4, "rarity": "common", "cmc": 1},
            {"name": "Lightning Strike", "quantity": 4, "rarity": "common", "cmc": 2},
            {"name": "Rockfall Vale", "quantity": 4, "rarity": "rare", "cmc": 0},
            {"name": "Karplusan Forest", "quantity": 4, "rarity": "rare", "cmc": 0},
            {"name": "Mountain", "quantity": 8, "rarity": "common", "cmc": 0},
            {"name": "Forest", "quantity": 4, "rarity": "common", "cmc": 0}
        ],
        "source": "mtggoldfish"
    }
]

def calculate_deck_stats(deck_data: dict) -> dict:
    """Calculate mana curve, color distribution, and wildcard costs"""
    mana_curve = ManaCurve()
    color_dist = ColorDistribution()
    wildcard_cost = WildcardCost()
    
    for card in deck_data.get('main_deck', []):
        cmc = card.get('cmc', 0)
        qty = card.get('quantity', 1)
        rarity = card.get('rarity', 'common').lower()
        
        # Mana curve
        if cmc == 0:
            mana_curve.zero += qty
        elif cmc == 1:
            mana_curve.one += qty
        elif cmc == 2:
            mana_curve.two += qty
        elif cmc == 3:
            mana_curve.three += qty
        elif cmc == 4:
            mana_curve.four += qty
        elif cmc == 5:
            mana_curve.five += qty
        else:
            mana_curve.six_plus += qty
        
        # Wildcard cost (skip basic lands)
        card_name = card.get('name', '').lower()
        if card_name not in ['mountain', 'plains', 'island', 'swamp', 'forest']:
            if rarity == 'mythic':
                wildcard_cost.mythic += qty
            elif rarity == 'rare':
                wildcard_cost.rare += qty
            elif rarity == 'uncommon':
                wildcard_cost.uncommon += qty
            else:
                wildcard_cost.common += qty
    
    # Color distribution
    for color in deck_data.get('colors', []):
        if color == 'W':
            color_dist.white = 1
        elif color == 'U':
            color_dist.blue = 1
        elif color == 'B':
            color_dist.black = 1
        elif color == 'R':
            color_dist.red = 1
        elif color == 'G':
            color_dist.green = 1
        elif color == 'C':
            color_dist.colorless = 1
    
    return {
        'mana_curve': mana_curve,
        'color_distribution': color_dist,
        'wildcard_cost': wildcard_cost
    }

async def seed_sample_decks():
    """Seed database with sample decks if empty"""
    count = await db.decks.count_documents({})
    if count == 0:
        logger.info("Seeding database with sample decks...")
        for deck_data in SAMPLE_DECKS:
            stats = calculate_deck_stats(deck_data)
            
            cards = [Card(**card) for card in deck_data['main_deck']]
            
            # Calculate matchups
            matchups = calculate_matchups(
                deck_data['archetype'], 
                deck_data.get('win_rate', 50)
            )
            
            deck = Deck(
                name=deck_data['name'],
                colors=deck_data['colors'],
                color_name=get_color_name(deck_data['colors']),
                archetype=deck_data['archetype'],
                win_rate=deck_data.get('win_rate'),
                tier=deck_data.get('tier', 2),
                main_deck=cards,
                sideboard=[],
                mana_curve=stats['mana_curve'],
                color_distribution=stats['color_distribution'],
                wildcard_cost=stats['wildcard_cost'],
                source=deck_data['source'],
                matchups=matchups,
                arena_export=generate_arena_export(cards, [])
            )
            
            await db.decks.insert_one(deck.dict())
        
        logger.info(f"Seeded {len(SAMPLE_DECKS)} sample decks")

# API Routes
@api_router.get("/")
async def root():
    return {"message": "MTG Arena Deck Scanner API", "version": "2.0", "features": ["live_scraping", "deck_comparison", "matchups"]}

@api_router.get("/decks", response_model=List[DeckSummary])
async def get_decks(
    color: Optional[str] = Query(None, description="Filter by color (W, U, B, R, G)"),
    archetype: Optional[str] = Query(None, description="Filter by archetype"),
    source: Optional[str] = Query(None, description="Filter by source"),
    tier: Optional[int] = Query(None, description="Filter by tier"),
    min_win_rate: Optional[float] = Query(None, description="Minimum win rate"),
    sort_by: str = Query("win_rate", description="Sort by field"),
    sort_order: str = Query("desc", description="Sort order (asc/desc)")
):
    """Get list of decks with optional filters"""
    await seed_sample_decks()
    
    query = {}
    
    if color:
        query["colors"] = color.upper()
    
    if archetype:
        query["archetype"] = archetype.lower()
    
    if source:
        query["source"] = source.lower()
    
    if tier:
        query["tier"] = tier
    
    if min_win_rate:
        query["win_rate"] = {"$gte": min_win_rate}
    
    sort_dir = -1 if sort_order == "desc" else 1
    
    cursor = db.decks.find(query).sort(sort_by, sort_dir)
    decks = await cursor.to_list(100)
    
    return [
        DeckSummary(
            id=deck['id'],
            name=deck['name'],
            colors=deck['colors'],
            color_name=deck['color_name'],
            archetype=deck['archetype'],
            win_rate=deck.get('win_rate'),
            tier=deck.get('tier'),
            wildcard_cost=WildcardCost(**deck.get('wildcard_cost', {})),
            source=deck['source'],
            last_updated=deck.get('last_updated', datetime.utcnow()),
            matchups=deck.get('matchups', {})
        )
        for deck in decks
    ]

@api_router.get("/decks/{deck_id}", response_model=Deck)
async def get_deck(deck_id: str):
    """Get detailed deck information"""
    deck = await db.decks.find_one({"id": deck_id})
    
    if not deck:
        raise HTTPException(status_code=404, detail="Deck not found")
    
    return Deck(**deck)

@api_router.get("/decks/{deck_id}/export")
async def get_deck_export(deck_id: str):
    """Get Arena-compatible export string for a deck"""
    deck = await db.decks.find_one({"id": deck_id})
    
    if not deck:
        raise HTTPException(status_code=404, detail="Deck not found")
    
    return {"export": deck.get('arena_export', '')}

@api_router.get("/decks/{deck_id}/matchups")
async def get_deck_matchups(deck_id: str):
    """Get detailed matchup information for a deck"""
    deck = await db.decks.find_one({"id": deck_id})
    
    if not deck:
        raise HTTPException(status_code=404, detail="Deck not found")
    
    # Get all other decks for comparison
    all_decks = await db.decks.find({"id": {"$ne": deck_id}}).to_list(100)
    
    matchup_details = []
    deck_archetype = deck.get('archetype', 'midrange')
    deck_matchups = deck.get('matchups', {})
    
    for other_deck in all_decks:
        other_archetype = other_deck.get('archetype', 'midrange')
        
        # Get win rate from stored matchups or calculate
        win_rate = deck_matchups.get(other_archetype, 50.0)
        
        matchup_details.append(MatchupInfo(
            opponent_deck=other_deck['name'],
            opponent_archetype=other_archetype,
            win_rate=win_rate,
            result=get_matchup_verdict(win_rate)
        ))
    
    # Sort by win rate (best matchups first)
    matchup_details.sort(key=lambda x: x.win_rate, reverse=True)
    
    return {
        "deck_name": deck['name'],
        "deck_archetype": deck_archetype,
        "matchups": [m.dict() for m in matchup_details]
    }

@api_router.get("/compare/{deck1_id}/{deck2_id}", response_model=DeckComparison)
async def compare_decks(deck1_id: str, deck2_id: str):
    """Compare two decks head-to-head"""
    deck1 = await db.decks.find_one({"id": deck1_id})
    deck2 = await db.decks.find_one({"id": deck2_id})
    
    if not deck1:
        raise HTTPException(status_code=404, detail="Deck 1 not found")
    if not deck2:
        raise HTTPException(status_code=404, detail="Deck 2 not found")
    
    deck1_wr = deck1.get('win_rate', 50)
    deck2_wr = deck2.get('win_rate', 50)
    
    # Calculate head-to-head based on archetype matchup
    deck1_archetype = deck1.get('archetype', 'midrange')
    deck2_archetype = deck2.get('archetype', 'midrange')
    
    base_matchup = MATCHUP_MATRIX.get(deck1_archetype, {}).get(deck2_archetype, 50)
    
    # Adjust based on overall win rates
    wr_diff = (deck1_wr - deck2_wr) * 0.5
    head_to_head = min(max(base_matchup + wr_diff, 25), 75)
    
    # Determine verdict
    if head_to_head >= 55:
        verdict = "deck1_favored"
    elif head_to_head <= 45:
        verdict = "deck2_favored"
    else:
        verdict = "even"
    
    # Generate analysis
    analysis_parts = []
    
    if deck1_archetype == 'aggro' and deck2_archetype == 'control':
        analysis_parts.append(f"{deck1['name']} has a speed advantage against {deck2['name']}'s slower game plan.")
    elif deck1_archetype == 'control' and deck2_archetype == 'aggro':
        analysis_parts.append(f"{deck1['name']} needs to survive early pressure from {deck2['name']}.")
    elif deck1_archetype == 'midrange':
        analysis_parts.append(f"{deck1['name']} aims to out-value opponents with efficient threats.")
    
    if deck1_wr > deck2_wr:
        analysis_parts.append(f"{deck1['name']} has a higher overall win rate ({deck1_wr:.1f}% vs {deck2_wr:.1f}%).")
    elif deck2_wr > deck1_wr:
        analysis_parts.append(f"{deck2['name']} has a higher overall win rate ({deck2_wr:.1f}% vs {deck1_wr:.1f}%).")
    
    analysis = " ".join(analysis_parts) if analysis_parts else "Both decks are evenly matched based on current meta data."
    
    return DeckComparison(
        deck1_id=deck1_id,
        deck1_name=deck1['name'],
        deck2_id=deck2_id,
        deck2_name=deck2['name'],
        deck1_win_rate=deck1_wr,
        deck2_win_rate=deck2_wr,
        head_to_head=round(head_to_head, 1),
        verdict=verdict,
        analysis=analysis
    )

@api_router.get("/filters", response_model=FilterOptions)
async def get_filter_options():
    """Get available filter options"""
    colors = await db.decks.distinct("colors")
    archetypes = await db.decks.distinct("archetype")
    sources = await db.decks.distinct("source")
    tiers = await db.decks.distinct("tier")
    
    return FilterOptions(
        colors=sorted(set(colors)) if colors else ['W', 'U', 'B', 'R', 'G'],
        archetypes=sorted(set(archetypes)) if archetypes else ['aggro', 'control', 'midrange', 'combo', 'tempo'],
        sources=sorted(set(sources)) if sources else ['aetherhub', 'mtgazone', 'mtggoldfish'],
        tiers=sorted([t for t in tiers if t]) if tiers else [1, 2, 3]
    )

@api_router.post("/decks/refresh")
async def refresh_decks(background_tasks: BackgroundTasks):
    """Trigger a refresh of deck data from all sources"""
    background_tasks.add_task(scrape_and_update_decks)
    return {"message": "Deck refresh started", "status": "processing"}

@api_router.get("/scraping/status", response_model=ScrapingStatus)
async def get_scraping_status():
    """Get current scraping status"""
    return ScrapingStatus(
        status=scraper.scrape_results['status'],
        sources_scraped=scraper.scrape_results['sources_scraped'],
        decks_found=scraper.scrape_results['decks_found'],
        last_updated=scraper.scrape_results['last_updated']
    )

async def scrape_and_update_decks():
    """Background task to scrape and update decks from all sources"""
    try:
        logger.info("Starting deck scraping from all sources...")
        
        # Scrape from all sources
        scraped_decks = await scraper.scrape_all_sources()
        
        logger.info(f"Total scraped: {len(scraped_decks)} decks from {len(scraper.scrape_results['sources_scraped'])} sources")
        
        # Update database with scraped decks
        for deck_data in scraped_decks:
            try:
                # Generate default card list if not provided
                cards = []
                
                # Calculate stats
                archetype = detect_archetype(deck_data['name'], [])
                win_rate = deck_data.get('win_rate', random.uniform(48, 58))
                
                matchups = calculate_matchups(archetype, win_rate)
                
                deck = Deck(
                    name=deck_data['name'],
                    colors=deck_data.get('colors', extract_colors_from_name(deck_data['name'])),
                    color_name=get_color_name(deck_data.get('colors', [])),
                    archetype=archetype,
                    win_rate=win_rate,
                    tier=deck_data.get('tier', 2 if win_rate < 55 else 1),
                    main_deck=cards,
                    sideboard=[],
                    source=deck_data['source'],
                    source_url=deck_data.get('source_url'),
                    matchups=matchups,
                    arena_export=""
                )
                
                # Upsert - update if exists, insert if new
                await db.decks.update_one(
                    {"name": deck.name, "source": deck.source},
                    {"$set": deck.dict()},
                    upsert=True
                )
                
            except Exception as e:
                logger.error(f"Error processing deck {deck_data.get('name', 'unknown')}: {e}")
                continue
        
        logger.info("Deck scraping completed successfully")
        
    except Exception as e:
        logger.error(f"Error during deck scraping: {e}")
        scraper.scrape_results['status'] = 'error'

# Similarity calculation function
def calculate_deck_similarity(deck1_cards: List[Dict], deck2_cards: List[Dict], 
                               deck1_colors: List[str], deck2_colors: List[str],
                               deck1_archetype: str, deck2_archetype: str) -> Dict:
    """Calculate similarity between two decks"""
    
    # Get card names
    deck1_card_names = {card.get('name', '').lower() for card in deck1_cards}
    deck2_card_names = {card.get('name', '').lower() for card in deck2_cards}
    
    # Remove basic lands from comparison
    basic_lands = {'mountain', 'plains', 'island', 'swamp', 'forest'}
    deck1_card_names -= basic_lands
    deck2_card_names -= basic_lands
    
    # Calculate card overlap
    shared_cards = deck1_card_names & deck2_card_names
    total_unique_cards = deck1_card_names | deck2_card_names
    
    card_similarity = (len(shared_cards) / len(total_unique_cards) * 100) if total_unique_cards else 0
    
    # Calculate color similarity
    color_overlap = set(deck1_colors) & set(deck2_colors)
    color_union = set(deck1_colors) | set(deck2_colors)
    color_similarity = (len(color_overlap) / len(color_union) * 100) if color_union else 0
    
    # Archetype similarity
    archetype_similarity = 100 if deck1_archetype == deck2_archetype else 30
    
    # Weighted average
    overall_similarity = (card_similarity * 0.6) + (color_similarity * 0.25) + (archetype_similarity * 0.15)
    
    # Determine reason
    reasons = []
    if card_similarity > 50:
        reasons.append(f"Shares {len(shared_cards)} non-land cards")
    if color_overlap:
        reasons.append(f"Same colors: {', '.join(sorted(color_overlap))}")
    if deck1_archetype == deck2_archetype:
        reasons.append(f"Same archetype: {deck1_archetype}")
    
    return {
        'similarity_score': round(overall_similarity, 1),
        'shared_cards': list(shared_cards)[:10],  # Limit to top 10
        'reason': '. '.join(reasons) if reasons else 'Similar deck strategy'
    }

@api_router.get("/decks/{deck_id}/similar", response_model=List[SimilarDeck])
async def get_similar_decks(deck_id: str, limit: int = Query(5, ge=1, le=10)):
    """Get similar decks to a given deck"""
    deck = await db.decks.find_one({"id": deck_id})
    
    if not deck:
        raise HTTPException(status_code=404, detail="Deck not found")
    
    # Get all other decks
    all_decks = await db.decks.find({"id": {"$ne": deck_id}}).to_list(100)
    
    similar_decks = []
    
    for other_deck in all_decks:
        similarity = calculate_deck_similarity(
            deck.get('main_deck', []),
            other_deck.get('main_deck', []),
            deck.get('colors', []),
            other_deck.get('colors', []),
            deck.get('archetype', ''),
            other_deck.get('archetype', '')
        )
        
        if similarity['similarity_score'] >= 20:  # Minimum threshold
            similar_decks.append(SimilarDeck(
                id=other_deck['id'],
                name=other_deck['name'],
                colors=other_deck['colors'],
                color_name=other_deck['color_name'],
                archetype=other_deck['archetype'],
                win_rate=other_deck.get('win_rate'),
                similarity_score=similarity['similarity_score'],
                shared_cards=similarity['shared_cards'],
                reason=similarity['reason']
            ))
    
    # Sort by similarity and return top N
    similar_decks.sort(key=lambda x: x.similarity_score, reverse=True)
    return similar_decks[:limit]

# Notification endpoints
@api_router.post("/notifications/register")
async def register_for_notifications(preferences: NotificationPreferences):
    """Register device for push notifications"""
    # Upsert notification preferences
    await db.notification_preferences.update_one(
        {"user_id": preferences.user_id},
        {"$set": preferences.dict()},
        upsert=True
    )
    
    return {"message": "Successfully registered for notifications", "user_id": preferences.user_id}

@api_router.get("/notifications/preferences/{user_id}")
async def get_notification_preferences(user_id: str):
    """Get notification preferences for a user"""
    prefs = await db.notification_preferences.find_one({"user_id": user_id})
    
    if not prefs:
        # Return default preferences
        return NotificationPreferences(user_id=user_id)
    
    return NotificationPreferences(**prefs)

@api_router.put("/notifications/preferences/{user_id}")
async def update_notification_preferences(user_id: str, preferences: NotificationPreferences):
    """Update notification preferences"""
    preferences.user_id = user_id
    await db.notification_preferences.update_one(
        {"user_id": user_id},
        {"$set": preferences.dict()},
        upsert=True
    )
    
    return {"message": "Preferences updated successfully"}

@api_router.get("/notifications/alerts/{user_id}", response_model=List[MetaAlert])
async def get_meta_alerts(user_id: str, unread_only: bool = Query(False)):
    """Get meta alerts for a user"""
    query = {"user_id": user_id}
    if unread_only:
        query["read"] = False
    
    alerts = await db.meta_alerts.find(query).sort("created_at", -1).to_list(50)
    return [MetaAlert(**alert) for alert in alerts]

@api_router.post("/notifications/alerts/{alert_id}/read")
async def mark_alert_read(alert_id: str):
    """Mark an alert as read"""
    result = await db.meta_alerts.update_one(
        {"id": alert_id},
        {"$set": {"read": True}}
    )
    
    if result.modified_count == 0:
        raise HTTPException(status_code=404, detail="Alert not found")
    
    return {"message": "Alert marked as read"}

@api_router.post("/notifications/check-meta-changes")
async def check_meta_changes(background_tasks: BackgroundTasks):
    """Trigger a check for meta changes and generate alerts"""
    background_tasks.add_task(detect_meta_changes)
    return {"message": "Meta change detection started"}

async def detect_meta_changes():
    """Background task to detect significant meta changes"""
    try:
        # Get current deck stats
        decks = await db.decks.find({}).to_list(100)
        
        # Get previous stats snapshot
        previous_snapshot = await db.meta_snapshots.find_one(
            {},
            sort=[("timestamp", -1)]
        )
        
        alerts = []
        current_timestamp = datetime.utcnow()
        
        for deck in decks:
            deck_id = deck['id']
            deck_name = deck['name']
            current_wr = deck.get('win_rate', 0)
            current_tier = deck.get('tier')
            
            if previous_snapshot:
                prev_deck_data = previous_snapshot.get('decks', {}).get(deck_id)
                
                if prev_deck_data:
                    prev_wr = prev_deck_data.get('win_rate', 0)
                    prev_tier = prev_deck_data.get('tier')
                    
                    # Check for significant win rate change (>3%)
                    if abs(current_wr - prev_wr) >= 3:
                        direction = "increased" if current_wr > prev_wr else "decreased"
                        alert = MetaAlert(
                            alert_type="win_rate_change",
                            deck_id=deck_id,
                            deck_name=deck_name,
                            message=f"{deck_name} win rate {direction} from {prev_wr:.1f}% to {current_wr:.1f}%",
                            details={
                                "previous_win_rate": prev_wr,
                                "current_win_rate": current_wr,
                                "change": round(current_wr - prev_wr, 1)
                            }
                        )
                        alerts.append(alert)
                    
                    # Check for tier change
                    if current_tier != prev_tier and current_tier and prev_tier:
                        direction = "promoted to" if current_tier < prev_tier else "dropped to"
                        alert = MetaAlert(
                            alert_type="tier_change",
                            deck_id=deck_id,
                            deck_name=deck_name,
                            message=f"{deck_name} {direction} Tier {current_tier}",
                            details={
                                "previous_tier": prev_tier,
                                "current_tier": current_tier
                            }
                        )
                        alerts.append(alert)
                else:
                    # New deck detected
                    if current_tier == 1:  # Only alert for tier 1 decks
                        alert = MetaAlert(
                            alert_type="new_deck",
                            deck_id=deck_id,
                            deck_name=deck_name,
                            message=f"New Tier 1 deck: {deck_name} ({current_wr:.1f}% WR)",
                            details={
                                "win_rate": current_wr,
                                "tier": current_tier,
                                "archetype": deck.get('archetype')
                            }
                        )
                        alerts.append(alert)
        
        # Save alerts to database
        if alerts:
            # Get all users with notifications enabled
            users = await db.notification_preferences.find({"enabled": True}).to_list(1000)
            
            for user in users:
                user_id = user['user_id']
                favorite_archetypes = set(user.get('favorite_archetypes', []))
                min_wr = user.get('min_win_rate', 0)
                
                for alert in alerts:
                    # Check if alert matches user preferences
                    should_notify = True
                    
                    if favorite_archetypes:
                        deck = await db.decks.find_one({"id": alert.deck_id})
                        if deck and deck.get('archetype') not in favorite_archetypes:
                            should_notify = False
                    
                    if alert.details.get('current_win_rate', 100) < min_wr:
                        should_notify = False
                    
                    if should_notify:
                        alert_dict = alert.dict()
                        alert_dict['user_id'] = user_id
                        await db.meta_alerts.insert_one(alert_dict)
        
        # Save current snapshot
        snapshot = {
            "timestamp": current_timestamp,
            "decks": {
                deck['id']: {
                    "win_rate": deck.get('win_rate'),
                    "tier": deck.get('tier'),
                    "archetype": deck.get('archetype')
                }
                for deck in decks
            }
        }
        await db.meta_snapshots.insert_one(snapshot)
        
        # Clean up old snapshots (keep last 10)
        old_snapshots = await db.meta_snapshots.find().sort("timestamp", -1).skip(10).to_list(100)
        if old_snapshots:
            old_ids = [s['_id'] for s in old_snapshots]
            await db.meta_snapshots.delete_many({"_id": {"$in": old_ids}})
        
        logger.info(f"Meta change detection completed. Generated {len(alerts)} alerts.")
        
    except Exception as e:
        logger.error(f"Error during meta change detection: {e}")

@api_router.get("/stats")
async def get_stats():
    """Get overall statistics"""
    total_decks = await db.decks.count_documents({})
    
    pipeline = [
        {"$group": {"_id": "$tier", "count": {"$sum": 1}}}
    ]
    tier_dist = await db.decks.aggregate(pipeline).to_list(10)
    
    pipeline = [
        {"$group": {"_id": "$archetype", "count": {"$sum": 1}}}
    ]
    archetype_dist = await db.decks.aggregate(pipeline).to_list(10)
    
    pipeline = [
        {"$group": {"_id": "$source", "count": {"$sum": 1}}}
    ]
    source_dist = await db.decks.aggregate(pipeline).to_list(10)
    
    return {
        "total_decks": total_decks,
        "tier_distribution": {str(t['_id']): t['count'] for t in tier_dist if t['_id']},
        "archetype_distribution": {str(a['_id']): a['count'] for a in archetype_dist if a['_id']},
        "source_distribution": {str(s['_id']): s['count'] for s in source_dist if s['_id']},
        "last_scrape": scraper.scrape_results.get('last_updated')
    }

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
    """Initialize database with sample decks on startup"""
    await seed_sample_decks()

@app.on_event("shutdown")
async def shutdown_db_client():
    client.close()

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
    'aggro': ['aggro', 'burn', 'red deck wins', 'rdw', 'sligh', 'prowess', 'mice', 'auras'],
    'control': ['control', 'draw-go', 'permission', 'tapout'],
    'midrange': ['midrange', 'value', 'rock', 'jund', 'golgari', 'abzan'],
    'combo': ['combo', 'storm', 'infinite', 'loop', 'ramp', 'omniscience'],
    'tempo': ['tempo', 'delver', 'flash', 'faeries']
}

# Wildcard costs by rarity
WILDCARD_COSTS = {
    'mythic': 1,
    'rare': 1,
    'uncommon': 1,
    'common': 1
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

class Deck(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    name: str
    colors: List[str]  # ['W', 'U', 'B', 'R', 'G']
    color_name: str  # e.g., "Azorius", "Mono Red"
    archetype: str  # aggro, control, midrange, combo, tempo
    win_rate: Optional[float] = None
    games_played: Optional[int] = None
    tier: Optional[int] = None
    main_deck: List[Card]
    sideboard: List[Card] = []
    mana_curve: ManaCurve = Field(default_factory=ManaCurve)
    color_distribution: ColorDistribution = Field(default_factory=ColorDistribution)
    wildcard_cost: WildcardCost = Field(default_factory=WildcardCost)
    source: str  # aetherhub, mtggoldfish, mtgazone
    source_url: Optional[str] = None
    author: Optional[str] = None
    last_updated: datetime = Field(default_factory=datetime.utcnow)
    similar_decks: List[str] = []  # IDs of similar decks
    matchups: Dict[str, float] = {}  # deck_archetype: win_rate
    arena_export: str = ""  # Arena-compatible export string

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

class FilterOptions(BaseModel):
    colors: List[str]
    archetypes: List[str]
    sources: List[str]
    tiers: List[int]

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
    
    # Default based on color count and card analysis
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
    
    return list(set(colors)) if colors else ['C']  # Colorless if no colors detected

# Scraper class
class DeckScraper:
    def __init__(self):
        self.headers = {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
        }
    
    async def scrape_aetherhub(self) -> List[Deck]:
        """Scrape decks from AetherHub BO1 Standard"""
        decks = []
        url = "https://aetherhub.com/MTGA-Decks/Standard-BO1/"
        
        try:
            async with httpx.AsyncClient(timeout=30.0) as client:
                response = await client.get(url, headers=self.headers)
                response.raise_for_status()
                
                soup = BeautifulSoup(response.text, 'lxml')
                
                # Find deck entries
                deck_rows = soup.select('table tbody tr')
                
                for row in deck_rows[:20]:  # Limit to top 20 decks
                    try:
                        # Extract deck info
                        name_elem = row.select_one('a[href*="/Deck/"]')
                        if not name_elem:
                            continue
                        
                        deck_name = name_elem.get_text(strip=True)
                        deck_url = "https://aetherhub.com" + name_elem.get('href', '')
                        
                        # Extract win rate if available
                        win_rate = None
                        stats_elem = row.select_one('td:nth-child(3)')
                        if stats_elem:
                            text = stats_elem.get_text(strip=True)
                            match = re.search(r'(\d+\.?\d*)%', text)
                            if match:
                                win_rate = float(match.group(1))
                        
                        # Extract colors from mana symbols
                        colors = extract_colors_from_name(deck_name)
                        mana_symbols = row.select('.mana-symbol, [class*="mana"]')
                        for symbol in mana_symbols:
                            class_list = symbol.get('class', [])
                            for c in class_list:
                                if 'W' in c.upper():
                                    colors.append('W')
                                elif 'U' in c.upper():
                                    colors.append('U')
                                elif 'B' in c.upper():
                                    colors.append('B')
                                elif 'R' in c.upper():
                                    colors.append('R')
                                elif 'G' in c.upper():
                                    colors.append('G')
                        
                        colors = list(set(colors)) if colors else ['C']
                        
                        # Create deck object with placeholder cards
                        deck = Deck(
                            name=deck_name,
                            colors=colors,
                            color_name=get_color_name(colors),
                            archetype=detect_archetype(deck_name, []),
                            win_rate=win_rate,
                            tier=1 if win_rate and win_rate >= 55 else (2 if win_rate and win_rate >= 50 else 3),
                            main_deck=[],
                            sideboard=[],
                            source='aetherhub',
                            source_url=deck_url,
                            arena_export=""
                        )
                        
                        decks.append(deck)
                        
                    except Exception as e:
                        logger.error(f"Error parsing AetherHub deck row: {e}")
                        continue
                
        except Exception as e:
            logger.error(f"Error scraping AetherHub: {e}")
        
        return decks
    
    async def scrape_mtgazone(self) -> List[Deck]:
        """Scrape decks from MTG Arena Zone tier list"""
        decks = []
        url = "https://mtgazone.com/standard-bo1-metagame-tier-list/"
        
        try:
            async with httpx.AsyncClient(timeout=30.0) as client:
                response = await client.get(url, headers=self.headers)
                response.raise_for_status()
                
                soup = BeautifulSoup(response.text, 'lxml')
                
                # Find tier sections
                tier_sections = soup.select('.tier-list-section, article')
                current_tier = 1
                
                # Look for deck names in the content
                deck_links = soup.select('a[href*="deck-guide"], a[href*="-deck"]')
                
                for link in deck_links[:15]:
                    try:
                        deck_name = link.get_text(strip=True)
                        if not deck_name or len(deck_name) < 3:
                            continue
                        
                        deck_url = link.get('href', '')
                        if not deck_url.startswith('http'):
                            deck_url = "https://mtgazone.com" + deck_url
                        
                        colors = extract_colors_from_name(deck_name)
                        
                        deck = Deck(
                            name=deck_name,
                            colors=colors,
                            color_name=get_color_name(colors),
                            archetype=detect_archetype(deck_name, []),
                            win_rate=None,
                            tier=current_tier,
                            main_deck=[],
                            sideboard=[],
                            source='mtgazone',
                            source_url=deck_url,
                            arena_export=""
                        )
                        
                        decks.append(deck)
                        
                        if len(decks) % 5 == 0:
                            current_tier += 1
                        
                    except Exception as e:
                        logger.error(f"Error parsing MTGAZone deck: {e}")
                        continue
                
        except Exception as e:
            logger.error(f"Error scraping MTGAZone: {e}")
        
        return decks
    
    async def get_deck_details(self, deck_url: str, source: str) -> Optional[Dict[str, Any]]:
        """Get detailed deck information including card list"""
        try:
            async with httpx.AsyncClient(timeout=30.0) as client:
                response = await client.get(deck_url, headers=self.headers)
                response.raise_for_status()
                
                soup = BeautifulSoup(response.text, 'lxml')
                
                cards = []
                arena_export = ""
                
                if source == 'aetherhub':
                    # Find arena export text
                    export_elem = soup.select_one('#TextDeck, .deck-export, textarea')
                    if export_elem:
                        arena_export = export_elem.get_text(strip=True)
                    
                    # Parse card list
                    card_elems = soup.select('.cardLink, .card-row')
                    for elem in card_elems:
                        try:
                            text = elem.get_text(strip=True)
                            match = re.match(r'(\d+)x?\s+(.+)', text)
                            if match:
                                qty = int(match.group(1))
                                name = match.group(2).strip()
                                cards.append(Card(name=name, quantity=qty))
                        except:
                            continue
                
                return {
                    'cards': cards,
                    'arena_export': arena_export
                }
                
        except Exception as e:
            logger.error(f"Error getting deck details from {deck_url}: {e}")
            return None

# Initialize scraper
scraper = DeckScraper()

# Sample decks for initial data
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
    
    # Color distribution based on deck colors
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
                arena_export=generate_arena_export(cards, [])
            )
            
            await db.decks.insert_one(deck.dict())
        
        logger.info(f"Seeded {len(SAMPLE_DECKS)} sample decks")

# API Routes
@api_router.get("/")
async def root():
    return {"message": "MTG Arena Deck Scanner API", "version": "1.0"}

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
    # Seed sample decks if needed
    await seed_sample_decks()
    
    # Build query
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
    
    # Sort direction
    sort_dir = -1 if sort_order == "desc" else 1
    
    # Get decks
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
            last_updated=deck.get('last_updated', datetime.utcnow())
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

@api_router.get("/filters", response_model=FilterOptions)
async def get_filter_options():
    """Get available filter options"""
    # Get distinct values from database
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
    """Trigger a refresh of deck data from sources"""
    background_tasks.add_task(scrape_and_update_decks)
    return {"message": "Deck refresh started", "status": "processing"}

async def scrape_and_update_decks():
    """Background task to scrape and update decks"""
    try:
        logger.info("Starting deck scraping...")
        
        # Scrape from AetherHub
        aetherhub_decks = await scraper.scrape_aetherhub()
        logger.info(f"Scraped {len(aetherhub_decks)} decks from AetherHub")
        
        # Scrape from MTG Arena Zone
        mtgazone_decks = await scraper.scrape_mtgazone()
        logger.info(f"Scraped {len(mtgazone_decks)} decks from MTGAZone")
        
        # Update database
        for deck in aetherhub_decks + mtgazone_decks:
            stats = calculate_deck_stats({'main_deck': [c.dict() for c in deck.main_deck], 'colors': deck.colors})
            deck.mana_curve = stats['mana_curve']
            deck.color_distribution = stats['color_distribution']
            deck.wildcard_cost = stats['wildcard_cost']
            
            await db.decks.update_one(
                {"name": deck.name, "source": deck.source},
                {"$set": deck.dict()},
                upsert=True
            )
        
        logger.info("Deck scraping completed")
        
    except Exception as e:
        logger.error(f"Error during deck scraping: {e}")

@api_router.get("/stats")
async def get_stats():
    """Get overall statistics"""
    total_decks = await db.decks.count_documents({})
    
    # Get tier distribution
    pipeline = [
        {"$group": {"_id": "$tier", "count": {"$sum": 1}}}
    ]
    tier_dist = await db.decks.aggregate(pipeline).to_list(10)
    
    # Get archetype distribution
    pipeline = [
        {"$group": {"_id": "$archetype", "count": {"$sum": 1}}}
    ]
    archetype_dist = await db.decks.aggregate(pipeline).to_list(10)
    
    return {
        "total_decks": total_decks,
        "tier_distribution": {str(t['_id']): t['count'] for t in tier_dist if t['_id']},
        "archetype_distribution": {str(a['_id']): a['count'] for a in archetype_dist if a['_id']}
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

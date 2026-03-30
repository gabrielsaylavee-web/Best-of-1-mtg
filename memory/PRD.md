# MTG Arena Deck Scanner - Product Requirements Document

## Overview
Mobile application that scans the internet for the best MTG Arena Best of One (BO1) Standard decks, displaying comprehensive deck information including win rates, mana curves, wildcard costs, and Arena-compatible export functionality.

## Target Users
- MTG Arena players looking for competitive BO1 Standard decks
- Players who want to quickly find and import top-performing decks
- Budget-conscious players who want to evaluate wildcard costs

## Core Features

### 1. Deck Discovery
- Browse top-performing BO1 Standard decks
- View deck statistics (win rate, tier ranking)
- Filter by color, archetype, tier
- Pull-to-refresh to get latest data

### 2. Deck Details
- Full card list with rarities
- Mana curve visualization
- Wildcard cost breakdown (Mythic/Rare/Uncommon/Common)
- Color distribution
- Source attribution

### 3. Arena Export
- One-tap copy to clipboard in Arena format
- Direct import into MTG Arena

## Data Sources
- AetherHub (primary)
- MTG Arena Zone
- MTGGoldfish
- Community aggregation

## Technical Architecture

### Backend (FastAPI + MongoDB)
- Web scraper for deck data aggregation
- Caching layer to reduce external requests
- REST API endpoints for deck listing and details
- Background job for periodic data refresh

### Frontend (Expo React Native)
- FlashList for performant deck listing
- React Query for data fetching and caching
- Filter modal with bottom sheet pattern
- Clipboard integration for Arena export

## MVP Scope
- [x] Sample deck database with real deck archetypes
- [x] Deck list with filters (color, archetype, tier)
- [x] Deck detail view with full information
- [x] Copy to Arena functionality
- [x] Mana curve visualization
- [x] Wildcard cost display

## Future Enhancements
- Live web scraping from multiple sources
- Deck comparison feature
- Favorite decks (local storage)
- Push notifications for meta changes
- Budget recommendations

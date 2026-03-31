import React, { useCallback, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
  Alert,
  Platform,
} from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import * as Clipboard from 'expo-clipboard';
import axios from 'axios';

const API_URL = process.env.EXPO_PUBLIC_BACKEND_URL || '';

// Types
interface Card {
  name: string;
  quantity: number;
  mana_cost: string | null;
  cmc: number | null;
  type_line: string | null;
  rarity: string | null;
  set_code: string | null;
  collector_number: string | null;
}

interface ManaCurve {
  zero: number;
  one: number;
  two: number;
  three: number;
  four: number;
  five: number;
  six_plus: number;
}

interface ColorDistribution {
  white: number;
  blue: number;
  black: number;
  red: number;
  green: number;
  colorless: number;
}

interface SimilarDeck {
  id: string;
  name: string;
  colors: string[];
  color_name: string;
  archetype: string;
  win_rate: number | null;
  similarity_score: number;
  shared_cards: string[];
  reason: string;
}

interface WildcardCost {
  mythic: number;
  rare: number;
  uncommon: number;
  common: number;
}

interface MatchupInfo {
  opponent_deck: string;
  opponent_archetype: string;
  win_rate: number;
  result: string;
}

interface MatchupsResponse {
  deck_name: string;
  deck_archetype: string;
  matchups: MatchupInfo[];
}

interface Deck {
  id: string;
  name: string;
  colors: string[];
  color_name: string;
  archetype: string;
  win_rate: number | null;
  games_played: number | null;
  tier: number | null;
  main_deck: Card[];
  sideboard: Card[];
  mana_curve: ManaCurve;
  color_distribution: ColorDistribution;
  wildcard_cost: WildcardCost;
  source: string;
  source_url: string | null;
  author: string | null;
  last_updated: string;
  similar_decks: string[];
  matchups: Record<string, number>;
  arena_export: string;
}

// Color mapping
const MANA_COLORS: Record<string, string> = {
  W: '#F9FAF4',
  U: '#0E68AB',
  B: '#150B00',
  R: '#D3202A',
  G: '#00733E',
  C: '#CBC2BF',
};

const MANA_BORDER_COLORS: Record<string, string> = {
  W: '#E0E0E0',
  U: '#0A4F82',
  B: '#463D3D',
  R: '#A11A22',
  G: '#005C32',
  C: '#9E9E9E',
};

const RARITY_COLORS: Record<string, string> = {
  mythic: '#FF6B00',
  rare: '#FFD700',
  uncommon: '#C0C0C0',
  common: '#1A1A1A',
};

const MATCHUP_COLORS = {
  favored: '#4CAF50',
  even: '#FFC107',
  unfavored: '#F44336',
};

// API functions
const fetchDeck = async (id: string): Promise<Deck> => {
  const response = await axios.get(`${API_URL}/api/decks/${id}`);
  return response.data;
};

const fetchMatchups = async (id: string): Promise<MatchupsResponse> => {
  const response = await axios.get(`${API_URL}/api/decks/${id}/matchups`);
  return response.data;
};

const fetchSimilarDecks = async (id: string): Promise<SimilarDeck[]> => {
  const response = await axios.get(`${API_URL}/api/decks/${id}/similar`);
  return response.data;
};

// Mana Symbol Component
const ManaSymbol = ({ color, size = 28 }: { color: string; size?: number }) => (
  <View
    style={[
      styles.manaSymbol,
      {
        width: size,
        height: size,
        borderRadius: size / 2,
        backgroundColor: MANA_COLORS[color] || MANA_COLORS.C,
        borderColor: MANA_BORDER_COLORS[color] || MANA_BORDER_COLORS.C,
      },
    ]}
  >
    <Text
      style={[
        styles.manaText,
        {
          fontSize: size * 0.5,
          color: color === 'W' || color === 'C' ? '#000' : '#FFF',
        },
      ]}
    >
      {color}
    </Text>
  </View>
);

// Mana Curve Bar Component
const ManaCurveBar = ({ value, maxValue, label }: { value: number; maxValue: number; label: string }) => {
  const height = maxValue > 0 ? (value / maxValue) * 100 : 0;
  
  return (
    <View style={styles.curveBarContainer}>
      <View style={styles.curveBarWrapper}>
        <View style={[styles.curveBar, { height: `${height}%` }]} />
      </View>
      <Text style={styles.curveBarValue}>{value}</Text>
      <Text style={styles.curveBarLabel}>{label}</Text>
    </View>
  );
};

// Card Row Component
const CardRow = ({ card }: { card: Card }) => (
  <View style={styles.cardRow}>
    <Text style={styles.cardQuantity}>{card.quantity}x</Text>
    <Text style={styles.cardName} numberOfLines={1}>
      {card.name}
    </Text>
    {card.rarity && (
      <View
        style={[
          styles.rarityDot,
          { backgroundColor: RARITY_COLORS[card.rarity.toLowerCase()] || RARITY_COLORS.common },
        ]}
      />
    )}
  </View>
);

// Section Header Component
const SectionHeader = ({ title, icon }: { title: string; icon: string }) => (
  <View style={styles.sectionHeader}>
    <Ionicons name={icon as any} size={20} color="#6366F1" />
    <Text style={styles.sectionTitle}>{title}</Text>
  </View>
);

// Matchup Row Component
const MatchupRow = ({ matchup }: { matchup: MatchupInfo }) => {
  const resultColor = MATCHUP_COLORS[matchup.result as keyof typeof MATCHUP_COLORS] || MATCHUP_COLORS.even;
  const resultIcon = matchup.result === 'favored' ? 'arrow-up' : matchup.result === 'unfavored' ? 'arrow-down' : 'remove';
  
  return (
    <View style={styles.matchupRow}>
      <View style={styles.matchupInfo}>
        <Text style={styles.matchupDeckName} numberOfLines={1}>{matchup.opponent_deck}</Text>
        <Text style={styles.matchupArchetype}>{matchup.opponent_archetype}</Text>
      </View>
      <View style={[styles.matchupResult, { backgroundColor: resultColor }]}>
        <Ionicons name={resultIcon} size={14} color="#fff" />
        <Text style={styles.matchupWinRate}>{matchup.win_rate.toFixed(0)}%</Text>
      </View>
    </View>
  );
};

// Main Component
export default function DeckDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [copying, setCopying] = useState(false);
  const [activeTab, setActiveTab] = useState<'cards' | 'matchups' | 'similar'>('cards');
  
  const { data: deck, isLoading, error } = useQuery({
    queryKey: ['deck', id],
    queryFn: () => fetchDeck(id!),
    enabled: !!id,
  });
  
  const { data: matchupsData, isLoading: matchupsLoading } = useQuery({
    queryKey: ['matchups', id],
    queryFn: () => fetchMatchups(id!),
    enabled: !!id && activeTab === 'matchups',
  });

  const { data: similarDecks, isLoading: similarLoading } = useQuery({
    queryKey: ['similar', id],
    queryFn: () => fetchSimilarDecks(id!),
    enabled: !!id && activeTab === 'similar',
  });
  
  const handleCopyToArena = useCallback(async () => {
    if (!deck?.arena_export) {
      Alert.alert('Error', 'No deck export available');
      return;
    }
    
    setCopying(true);
    try {
      await Clipboard.setStringAsync(deck.arena_export);
      Alert.alert(
        'Copied!',
        'Deck copied to clipboard. Open MTG Arena and import your deck.',
        [{ text: 'OK' }]
      );
    } catch (error) {
      Alert.alert('Error', 'Failed to copy deck to clipboard');
    } finally {
      setCopying(false);
    }
  }, [deck]);

  const handleSimilarDeckPress = useCallback((deckId: string) => {
    router.push(`/deck/${deckId}`);
  }, [router]);
  
  if (isLoading) {
    return (
      <View style={[styles.container, styles.centerContent]}>
        <ActivityIndicator size="large" color="#6366F1" />
        <Text style={styles.loadingText}>Loading deck...</Text>
      </View>
    );
  }
  
  if (error || !deck) {
    return (
      <View style={[styles.container, styles.centerContent]}>
        <Ionicons name="alert-circle" size={48} color="#F44336" />
        <Text style={styles.errorText}>Failed to load deck</Text>
        <TouchableOpacity style={styles.retryButton} onPress={() => router.back()}>
          <Text style={styles.retryButtonText}>Go Back</Text>
        </TouchableOpacity>
      </View>
    );
  }
  
  const manaCurveValues = [
    deck.mana_curve.zero,
    deck.mana_curve.one,
    deck.mana_curve.two,
    deck.mana_curve.three,
    deck.mana_curve.four,
    deck.mana_curve.five,
    deck.mana_curve.six_plus,
  ];
  const maxCurveValue = Math.max(...manaCurveValues, 1);
  
  const totalWildcards =
    deck.wildcard_cost.mythic +
    deck.wildcard_cost.rare +
    deck.wildcard_cost.uncommon +
    deck.wildcard_cost.common;
  
  // Categorize matchups
  const favoredMatchups = matchupsData?.matchups.filter(m => m.result === 'favored') || [];
  const evenMatchups = matchupsData?.matchups.filter(m => m.result === 'even') || [];
  const unfavoredMatchups = matchupsData?.matchups.filter(m => m.result === 'unfavored') || [];
  
  return (
    <View style={[styles.container, { paddingBottom: insets.bottom }]}>
      <ScrollView style={styles.scrollView} showsVerticalScrollIndicator={false}>
        {/* Header Card */}
        <View style={styles.headerCard}>
          <View style={styles.headerTop}>
            <View style={styles.manaRow}>
              {deck.colors.map((color, index) => (
                <ManaSymbol key={`${color}-${index}`} color={color} size={32} />
              ))}
            </View>
            {deck.tier && (
              <View
                style={[
                  styles.tierBadge,
                  {
                    backgroundColor:
                      deck.tier === 1 ? '#FFD700' : deck.tier === 2 ? '#C0C0C0' : '#CD7F32',
                  },
                ]}
              >
                <Text style={styles.tierText}>Tier {deck.tier}</Text>
              </View>
            )}
          </View>
          
          <Text style={styles.deckTitle}>{deck.name}</Text>
          <Text style={styles.colorName}>{deck.color_name}</Text>
          
          <View style={styles.metaRow}>
            <View style={styles.metaItem}>
              <Ionicons name="game-controller" size={16} color="#888" />
              <Text style={styles.metaText}>{deck.archetype}</Text>
            </View>
            <View style={styles.metaItem}>
              <Ionicons name="globe" size={16} color="#888" />
              <Text style={styles.metaText}>{deck.source}</Text>
            </View>
          </View>
          
          {deck.win_rate && (
            <View style={styles.winRateContainer}>
              <Text style={styles.winRateLabel}>Win Rate</Text>
              <Text
                style={[
                  styles.winRateValue,
                  {
                    color:
                      deck.win_rate >= 55
                        ? '#4CAF50'
                        : deck.win_rate >= 50
                        ? '#FFC107'
                        : '#F44336',
                  },
                ]}
              >
                {deck.win_rate.toFixed(1)}%
              </Text>
            </View>
          )}
        </View>
        
        {/* Tab Switcher */}
        <View style={styles.tabContainer}>
          <TouchableOpacity
            style={[styles.tab, activeTab === 'cards' && styles.activeTab]}
            onPress={() => setActiveTab('cards')}
          >
            <Ionicons name="albums" size={18} color={activeTab === 'cards' ? '#6366F1' : '#888'} />
            <Text style={[styles.tabText, activeTab === 'cards' && styles.activeTabText]}>Cards</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.tab, activeTab === 'matchups' && styles.activeTab]}
            onPress={() => setActiveTab('matchups')}
          >
            <Ionicons name="git-compare" size={18} color={activeTab === 'matchups' ? '#6366F1' : '#888'} />
            <Text style={[styles.tabText, activeTab === 'matchups' && styles.activeTabText]}>Matchups</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.tab, activeTab === 'similar' && styles.activeTab]}
            onPress={() => setActiveTab('similar')}
          >
            <Ionicons name="layers" size={18} color={activeTab === 'similar' ? '#6366F1' : '#888'} />
            <Text style={[styles.tabText, activeTab === 'similar' && styles.activeTabText]}>Similar</Text>
          </TouchableOpacity>
        </View>
        
        {activeTab === 'cards' ? (
          <>
            {/* Wildcard Cost */}
            <View style={styles.section}>
              <SectionHeader title="Wildcard Cost" icon="diamond" />
              <View style={styles.wildcardGrid}>
                <View style={styles.wildcardBox}>
                  <View style={[styles.wildcardIcon, { backgroundColor: '#FF6B00' }]} />
                  <Text style={styles.wildcardValue}>{deck.wildcard_cost.mythic}</Text>
                  <Text style={styles.wildcardLabel}>Mythic</Text>
                </View>
                <View style={styles.wildcardBox}>
                  <View style={[styles.wildcardIcon, { backgroundColor: '#FFD700' }]} />
                  <Text style={styles.wildcardValue}>{deck.wildcard_cost.rare}</Text>
                  <Text style={styles.wildcardLabel}>Rare</Text>
                </View>
                <View style={styles.wildcardBox}>
                  <View style={[styles.wildcardIcon, { backgroundColor: '#C0C0C0' }]} />
                  <Text style={styles.wildcardValue}>{deck.wildcard_cost.uncommon}</Text>
                  <Text style={styles.wildcardLabel}>Uncommon</Text>
                </View>
                <View style={styles.wildcardBox}>
                  <View style={[styles.wildcardIcon, { backgroundColor: '#666' }]} />
                  <Text style={styles.wildcardValue}>{deck.wildcard_cost.common}</Text>
                  <Text style={styles.wildcardLabel}>Common</Text>
                </View>
              </View>
              <Text style={styles.totalWildcards}>Total: {totalWildcards} wildcards</Text>
            </View>
            
            {/* Mana Curve */}
            <View style={styles.section}>
              <SectionHeader title="Mana Curve" icon="bar-chart" />
              <View style={styles.curveContainer}>
                <ManaCurveBar value={deck.mana_curve.zero} maxValue={maxCurveValue} label="0" />
                <ManaCurveBar value={deck.mana_curve.one} maxValue={maxCurveValue} label="1" />
                <ManaCurveBar value={deck.mana_curve.two} maxValue={maxCurveValue} label="2" />
                <ManaCurveBar value={deck.mana_curve.three} maxValue={maxCurveValue} label="3" />
                <ManaCurveBar value={deck.mana_curve.four} maxValue={maxCurveValue} label="4" />
                <ManaCurveBar value={deck.mana_curve.five} maxValue={maxCurveValue} label="5" />
                <ManaCurveBar value={deck.mana_curve.six_plus} maxValue={maxCurveValue} label="6+" />
              </View>
            </View>
            
            {/* Main Deck */}
            <View style={styles.section}>
              <SectionHeader title={`Main Deck (${deck.main_deck.reduce((sum, c) => sum + c.quantity, 0)} cards)`} icon="albums" />
              <View style={styles.cardList}>
                {deck.main_deck.map((card, index) => (
                  <CardRow key={`${card.name}-${index}`} card={card} />
                ))}
              </View>
            </View>
            
            {/* Sideboard */}
            {deck.sideboard.length > 0 && (
              <View style={styles.section}>
                <SectionHeader title={`Sideboard (${deck.sideboard.reduce((sum, c) => sum + c.quantity, 0)} cards)`} icon="copy" />
                <View style={styles.cardList}>
                  {deck.sideboard.map((card, index) => (
                    <CardRow key={`sb-${card.name}-${index}`} card={card} />
                  ))}
                </View>
              </View>
            )}
          </>
        ) : null}

        {activeTab === 'matchups' && (
          <>
            {/* Matchups Tab */}
            {matchupsLoading ? (
              <View style={[styles.section, styles.centerContent]}>
                <ActivityIndicator size="small" color="#6366F1" />
                <Text style={styles.loadingText}>Loading matchups...</Text>
              </View>
            ) : (
              <>
                {/* Favored Matchups */}
                {favoredMatchups.length > 0 && (
                  <View style={styles.section}>
                    <View style={styles.matchupHeader}>
                      <Ionicons name="arrow-up-circle" size={20} color="#4CAF50" />
                      <Text style={[styles.sectionTitle, { color: '#4CAF50' }]}>Good Against</Text>
                    </View>
                    {favoredMatchups.map((matchup, index) => (
                      <MatchupRow key={`fav-${index}`} matchup={matchup} />
                    ))}
                  </View>
                )}
                
                {/* Even Matchups */}
                {evenMatchups.length > 0 && (
                  <View style={styles.section}>
                    <View style={styles.matchupHeader}>
                      <Ionicons name="remove-circle" size={20} color="#FFC107" />
                      <Text style={[styles.sectionTitle, { color: '#FFC107' }]}>Even Matchups</Text>
                    </View>
                    {evenMatchups.map((matchup, index) => (
                      <MatchupRow key={`even-${index}`} matchup={matchup} />
                    ))}
                  </View>
                )}
                
                {/* Unfavored Matchups */}
                {unfavoredMatchups.length > 0 && (
                  <View style={styles.section}>
                    <View style={styles.matchupHeader}>
                      <Ionicons name="arrow-down-circle" size={20} color="#F44336" />
                      <Text style={[styles.sectionTitle, { color: '#F44336' }]}>Bad Against</Text>
                    </View>
                    {unfavoredMatchups.map((matchup, index) => (
                      <MatchupRow key={`unfav-${index}`} matchup={matchup} />
                    ))}
                  </View>
                )}
                
                {!favoredMatchups.length && !evenMatchups.length && !unfavoredMatchups.length && (
                  <View style={[styles.section, styles.centerContent]}>
                    <Ionicons name="analytics" size={48} color="#666" />
                    <Text style={styles.emptyText}>No matchup data available</Text>
                  </View>
                )}
              </>
            )}
          </>
        )}

        {activeTab === 'similar' && (
          <>
            {/* Similar Decks Tab */}
            {similarLoading ? (
              <View style={[styles.section, styles.centerContent]}>
                <ActivityIndicator size="small" color="#6366F1" />
                <Text style={styles.loadingText}>Finding similar decks...</Text>
              </View>
            ) : (
              <>
                {similarDecks && similarDecks.length > 0 ? (
                  <View style={styles.section}>
                    <View style={styles.matchupHeader}>
                      <Ionicons name="layers" size={20} color="#6366F1" />
                      <Text style={[styles.sectionTitle, { color: '#6366F1' }]}>
                        Similar Decks ({similarDecks.length})
                      </Text>
                    </View>
                    {similarDecks.map((similar, index) => (
                      <TouchableOpacity
                        key={`similar-${index}`}
                        style={styles.similarDeckCard}
                        onPress={() => handleSimilarDeckPress(similar.id)}
                      >
                        <View style={styles.similarDeckHeader}>
                          <View style={styles.manaRowSmall}>
                            {similar.colors.map((c, i) => (
                              <ManaSymbol key={`sim-${c}-${i}`} color={c} size={20} />
                            ))}
                          </View>
                          <View style={styles.similarityBadge}>
                            <Text style={styles.similarityText}>
                              {similar.similarity_score.toFixed(0)}% match
                            </Text>
                          </View>
                        </View>
                        <Text style={styles.similarDeckName}>{similar.name}</Text>
                        <Text style={styles.similarDeckMeta}>
                          {similar.color_name} • {similar.archetype}
                          {similar.win_rate ? ` • ${similar.win_rate.toFixed(1)}% WR` : ''}
                        </Text>
                        <Text style={styles.similarReason}>{similar.reason}</Text>
                        {similar.shared_cards.length > 0 && (
                          <View style={styles.sharedCardsContainer}>
                            <Text style={styles.sharedCardsLabel}>Shared cards:</Text>
                            <Text style={styles.sharedCardsList} numberOfLines={2}>
                              {similar.shared_cards.slice(0, 5).join(', ')}
                              {similar.shared_cards.length > 5 ? ` +${similar.shared_cards.length - 5} more` : ''}
                            </Text>
                          </View>
                        )}
                        <View style={styles.viewDeckRow}>
                          <Text style={styles.viewDeckText}>View deck</Text>
                          <Ionicons name="chevron-forward" size={16} color="#6366F1" />
                        </View>
                      </TouchableOpacity>
                    ))}
                  </View>
                ) : (
                  <View style={[styles.section, styles.centerContent]}>
                    <Ionicons name="layers-outline" size={48} color="#666" />
                    <Text style={styles.emptyText}>No similar decks found</Text>
                    <Text style={styles.emptySubtext}>This deck has a unique strategy!</Text>
                  </View>
                )}
              </>
            )}
          </>
        )}
        
        {/* Source Info */}
        <View style={styles.sourceInfo}>
          <Text style={styles.sourceLabel}>Source: {deck.source}</Text>
          <Text style={styles.lastUpdated}>
            Last updated: {new Date(deck.last_updated).toLocaleDateString()}
          </Text>
        </View>
        
        <View style={{ height: 100 }} />
      </ScrollView>
      
      {/* Copy Button */}
      <View style={[styles.copyButtonContainer, { paddingBottom: insets.bottom + 16 }]}>
        <TouchableOpacity
          style={styles.copyButton}
          onPress={handleCopyToArena}
          disabled={copying}
          activeOpacity={0.8}
        >
          {copying ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <>
              <Ionicons name="copy" size={20} color="#fff" />
              <Text style={styles.copyButtonText}>Copy to Arena</Text>
            </>
          )}
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0f0f1a',
  },
  centerContent: {
    justifyContent: 'center',
    alignItems: 'center',
  },
  scrollView: {
    flex: 1,
  },
  headerCard: {
    backgroundColor: '#1a1a2e',
    margin: 16,
    borderRadius: 16,
    padding: 20,
    borderWidth: 1,
    borderColor: '#2a2a40',
  },
  headerTop: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: 16,
  },
  manaRow: {
    flexDirection: 'row',
  },
  manaSymbol: {
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 6,
    borderWidth: 2,
  },
  manaText: {
    fontWeight: 'bold',
  },
  tierBadge: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 8,
  },
  tierText: {
    color: '#000',
    fontWeight: 'bold',
    fontSize: 14,
  },
  deckTitle: {
    color: '#fff',
    fontSize: 24,
    fontWeight: 'bold',
    marginBottom: 4,
  },
  colorName: {
    color: '#888',
    fontSize: 16,
    marginBottom: 16,
  },
  metaRow: {
    flexDirection: 'row',
    marginBottom: 16,
  },
  metaItem: {
    flexDirection: 'row',
    alignItems: 'center',
    marginRight: 20,
  },
  metaText: {
    color: '#888',
    marginLeft: 6,
    textTransform: 'capitalize',
  },
  winRateContainer: {
    backgroundColor: '#0f0f1a',
    borderRadius: 12,
    padding: 16,
    alignItems: 'center',
  },
  winRateLabel: {
    color: '#888',
    fontSize: 14,
    marginBottom: 4,
  },
  winRateValue: {
    fontSize: 32,
    fontWeight: 'bold',
  },
  tabContainer: {
    flexDirection: 'row',
    marginHorizontal: 16,
    marginBottom: 16,
    backgroundColor: '#1a1a2e',
    borderRadius: 12,
    padding: 4,
  },
  tab: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 12,
    borderRadius: 10,
  },
  activeTab: {
    backgroundColor: '#2a2a40',
  },
  tabText: {
    color: '#888',
    fontSize: 14,
    fontWeight: '600',
    marginLeft: 6,
  },
  activeTabText: {
    color: '#6366F1',
  },
  section: {
    backgroundColor: '#1a1a2e',
    marginHorizontal: 16,
    marginBottom: 16,
    borderRadius: 12,
    padding: 16,
    borderWidth: 1,
    borderColor: '#2a2a40',
  },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 16,
  },
  sectionTitle: {
    color: '#fff',
    fontSize: 18,
    fontWeight: '600',
    marginLeft: 8,
  },
  wildcardGrid: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  wildcardBox: {
    alignItems: 'center',
    flex: 1,
  },
  wildcardIcon: {
    width: 24,
    height: 24,
    borderRadius: 12,
    marginBottom: 8,
  },
  wildcardValue: {
    color: '#fff',
    fontSize: 20,
    fontWeight: 'bold',
  },
  wildcardLabel: {
    color: '#888',
    fontSize: 12,
    marginTop: 4,
  },
  totalWildcards: {
    color: '#666',
    textAlign: 'center',
    marginTop: 16,
    fontSize: 14,
  },
  curveContainer: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-end',
    height: 140,
  },
  curveBarContainer: {
    alignItems: 'center',
    flex: 1,
  },
  curveBarWrapper: {
    width: 24,
    height: 80,
    backgroundColor: '#2a2a40',
    borderRadius: 4,
    justifyContent: 'flex-end',
    overflow: 'hidden',
  },
  curveBar: {
    backgroundColor: '#6366F1',
    borderRadius: 4,
    width: '100%',
  },
  curveBarValue: {
    color: '#fff',
    fontSize: 14,
    fontWeight: 'bold',
    marginTop: 8,
  },
  curveBarLabel: {
    color: '#888',
    fontSize: 12,
  },
  cardList: {
    backgroundColor: '#0f0f1a',
    borderRadius: 8,
    padding: 12,
  },
  cardRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: '#2a2a40',
  },
  cardQuantity: {
    color: '#6366F1',
    fontSize: 14,
    fontWeight: 'bold',
    width: 32,
  },
  cardName: {
    color: '#fff',
    fontSize: 14,
    flex: 1,
  },
  rarityDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    marginLeft: 8,
  },
  matchupHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 12,
  },
  matchupRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: '#2a2a40',
  },
  matchupInfo: {
    flex: 1,
  },
  matchupDeckName: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '500',
  },
  matchupArchetype: {
    color: '#888',
    fontSize: 12,
    textTransform: 'capitalize',
    marginTop: 2,
  },
  matchupResult: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 16,
  },
  matchupWinRate: {
    color: '#fff',
    fontSize: 12,
    fontWeight: 'bold',
    marginLeft: 4,
  },
  sourceInfo: {
    alignItems: 'center',
    padding: 16,
  },
  sourceLabel: {
    color: '#666',
    fontSize: 12,
    textTransform: 'capitalize',
  },
  lastUpdated: {
    color: '#444',
    fontSize: 11,
    marginTop: 4,
  },
  copyButtonContainer: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    paddingHorizontal: 16,
    paddingTop: 16,
    backgroundColor: 'rgba(15, 15, 26, 0.95)',
    borderTopWidth: 1,
    borderTopColor: '#2a2a40',
  },
  copyButton: {
    backgroundColor: '#6366F1',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 16,
    borderRadius: 12,
  },
  copyButtonText: {
    color: '#fff',
    fontSize: 18,
    fontWeight: 'bold',
    marginLeft: 8,
  },
  loadingText: {
    color: '#888',
    marginTop: 12,
  },
  errorText: {
    color: '#F44336',
    marginTop: 12,
    fontSize: 16,
  },
  retryButton: {
    backgroundColor: '#6366F1',
    paddingHorizontal: 24,
    paddingVertical: 12,
    borderRadius: 8,
    marginTop: 16,
  },
  retryButtonText: {
    color: '#fff',
    fontWeight: 'bold',
  },
  emptyText: {
    color: '#888',
    fontSize: 14,
    marginTop: 12,
  },
  emptySubtext: {
    color: '#666',
    fontSize: 12,
    marginTop: 4,
  },
  manaRowSmall: {
    flexDirection: 'row',
  },
  similarDeckCard: {
    backgroundColor: '#0f0f1a',
    borderRadius: 12,
    padding: 16,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: '#2a2a40',
  },
  similarDeckHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  similarityBadge: {
    backgroundColor: '#6366F1',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 12,
  },
  similarityText: {
    color: '#fff',
    fontSize: 12,
    fontWeight: 'bold',
  },
  similarDeckName: {
    color: '#fff',
    fontSize: 16,
    fontWeight: 'bold',
    marginBottom: 4,
  },
  similarDeckMeta: {
    color: '#888',
    fontSize: 13,
    marginBottom: 8,
    textTransform: 'capitalize',
  },
  similarReason: {
    color: '#aaa',
    fontSize: 12,
    fontStyle: 'italic',
    marginBottom: 8,
  },
  sharedCardsContainer: {
    backgroundColor: '#1a1a2e',
    borderRadius: 8,
    padding: 10,
    marginBottom: 8,
  },
  sharedCardsLabel: {
    color: '#6366F1',
    fontSize: 11,
    fontWeight: '600',
    marginBottom: 4,
  },
  sharedCardsList: {
    color: '#ccc',
    fontSize: 12,
    textTransform: 'capitalize',
  },
  viewDeckRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-end',
  },
  viewDeckText: {
    color: '#6366F1',
    fontSize: 13,
    fontWeight: '600',
    marginRight: 4,
  },
});

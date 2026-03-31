import React, { useState, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  RefreshControl,
  ActivityIndicator,
  ScrollView,
  Modal,
  Platform,
} from 'react-native';
import { FlashList } from '@shopify/flash-list';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import axios from 'axios';

const API_URL = process.env.EXPO_PUBLIC_BACKEND_URL || '';

// Types
interface WildcardCost {
  mythic: number;
  rare: number;
  uncommon: number;
  common: number;
}

interface DeckSummary {
  id: string;
  name: string;
  colors: string[];
  color_name: string;
  archetype: string;
  win_rate: number | null;
  tier: number | null;
  wildcard_cost: WildcardCost;
  source: string;
  last_updated: string;
  matchups: Record<string, number>;
}

interface FilterOptions {
  colors: string[];
  archetypes: string[];
  sources: string[];
  tiers: number[];
}

interface Filters {
  color: string | null;
  archetype: string | null;
  tier: number | null;
}

interface DeckComparison {
  deck1_id: string;
  deck1_name: string;
  deck2_id: string;
  deck2_name: string;
  deck1_win_rate: number;
  deck2_win_rate: number;
  head_to_head: number;
  verdict: string;
  analysis: string;
}

// Color mapping for mana symbols
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

// Tier colors
const TIER_COLORS: Record<number, string> = {
  1: '#FFD700',
  2: '#C0C0C0',
  3: '#CD7F32',
};

// API functions
const fetchDecks = async (filters: Filters): Promise<DeckSummary[]> => {
  const params = new URLSearchParams();
  if (filters.color) params.append('color', filters.color);
  if (filters.archetype) params.append('archetype', filters.archetype);
  if (filters.tier) params.append('tier', filters.tier.toString());
  params.append('sort_by', 'win_rate');
  params.append('sort_order', 'desc');
  
  const response = await axios.get(`${API_URL}/api/decks?${params.toString()}`);
  return response.data;
};

const fetchFilterOptions = async (): Promise<FilterOptions> => {
  const response = await axios.get(`${API_URL}/api/filters`);
  return response.data;
};

const refreshDecks = async (): Promise<void> => {
  await axios.post(`${API_URL}/api/decks/refresh`);
};

const compareDecks = async (deck1Id: string, deck2Id: string): Promise<DeckComparison> => {
  const response = await axios.get(`${API_URL}/api/compare/${deck1Id}/${deck2Id}`);
  return response.data;
};

// Mana Symbol Component
const ManaSymbol = ({ color }: { color: string }) => (
  <View
    style={[
      styles.manaSymbol,
      {
        backgroundColor: MANA_COLORS[color] || MANA_COLORS.C,
        borderColor: MANA_BORDER_COLORS[color] || MANA_BORDER_COLORS.C,
      },
    ]}
  >
    <Text
      style={[
        styles.manaText,
        { color: color === 'W' || color === 'C' ? '#000' : '#FFF' },
      ]}
    >
      {color}
    </Text>
  </View>
);

// Tier Badge Component
const TierBadge = ({ tier }: { tier: number | null }) => {
  if (!tier) return null;
  
  return (
    <View style={[styles.tierBadge, { backgroundColor: TIER_COLORS[tier] || TIER_COLORS[3] }]}>
      <Text style={styles.tierText}>T{tier}</Text>
    </View>
  );
};

// Win Rate Badge Component
const WinRateBadge = ({ winRate }: { winRate: number | null }) => {
  if (winRate === null) return null;
  
  const color = winRate >= 55 ? '#4CAF50' : winRate >= 50 ? '#FFC107' : '#F44336';
  
  return (
    <View style={[styles.winRateBadge, { backgroundColor: color }]}>
      <Text style={styles.winRateText}>{winRate.toFixed(1)}%</Text>
    </View>
  );
};

// Wildcard Cost Component
const WildcardCostDisplay = ({ cost }: { cost: WildcardCost }) => (
  <View style={styles.wildcardContainer}>
    {cost.mythic > 0 && (
      <View style={styles.wildcardItem}>
        <View style={[styles.wildcardDot, { backgroundColor: '#FF6B00' }]} />
        <Text style={styles.wildcardText}>{cost.mythic}</Text>
      </View>
    )}
    {cost.rare > 0 && (
      <View style={styles.wildcardItem}>
        <View style={[styles.wildcardDot, { backgroundColor: '#FFD700' }]} />
        <Text style={styles.wildcardText}>{cost.rare}</Text>
      </View>
    )}
    {cost.uncommon > 0 && (
      <View style={styles.wildcardItem}>
        <View style={[styles.wildcardDot, { backgroundColor: '#C0C0C0' }]} />
        <Text style={styles.wildcardText}>{cost.uncommon}</Text>
      </View>
    )}
    {cost.common > 0 && (
      <View style={styles.wildcardItem}>
        <View style={[styles.wildcardDot, { backgroundColor: '#1A1A1A' }]} />
        <Text style={styles.wildcardText}>{cost.common}</Text>
      </View>
    )}
  </View>
);

// Deck Card Component
const DeckCard = ({ 
  deck, 
  onPress, 
  onLongPress,
  isSelected,
  compareMode 
}: { 
  deck: DeckSummary; 
  onPress: () => void;
  onLongPress?: () => void;
  isSelected?: boolean;
  compareMode?: boolean;
}) => (
  <TouchableOpacity 
    style={[
      styles.deckCard, 
      isSelected && styles.deckCardSelected
    ]} 
    onPress={onPress}
    onLongPress={onLongPress}
    activeOpacity={0.7}
  >
    {compareMode && (
      <View style={[styles.selectIndicator, isSelected && styles.selectIndicatorActive]}>
        {isSelected && <Ionicons name="checkmark" size={16} color="#fff" />}
      </View>
    )}
    <View style={styles.deckCardHeader}>
      <View style={styles.deckCardTitleRow}>
        <TierBadge tier={deck.tier} />
        <Text style={styles.deckName} numberOfLines={1}>
          {deck.name}
        </Text>
      </View>
      <WinRateBadge winRate={deck.win_rate} />
    </View>
    
    <View style={styles.deckCardBody}>
      <View style={styles.manaRow}>
        {deck.colors.map((color, index) => (
          <ManaSymbol key={`${color}-${index}`} color={color} />
        ))}
        <Text style={styles.colorName}>{deck.color_name}</Text>
      </View>
      
      <View style={styles.deckMeta}>
        <View style={styles.archetypeBadge}>
          <Text style={styles.archetypeText}>{deck.archetype}</Text>
        </View>
        <Text style={styles.sourceText}>{deck.source}</Text>
      </View>
    </View>
    
    <View style={styles.deckCardFooter}>
      <WildcardCostDisplay cost={deck.wildcard_cost} />
      <Ionicons name="chevron-forward" size={20} color="#666" />
    </View>
  </TouchableOpacity>
);

// Filter Chip Component
const FilterChip = ({
  label,
  selected,
  onPress,
}: {
  label: string;
  selected: boolean;
  onPress: () => void;
}) => (
  <TouchableOpacity
    style={[styles.filterChip, selected && styles.filterChipSelected]}
    onPress={onPress}
  >
    <Text style={[styles.filterChipText, selected && styles.filterChipTextSelected]}>
      {label}
    </Text>
  </TouchableOpacity>
);

// Filter Modal Component
const FilterModal = ({
  visible,
  onClose,
  options,
  filters,
  onApply,
}: {
  visible: boolean;
  onClose: () => void;
  options: FilterOptions | undefined;
  filters: Filters;
  onApply: (filters: Filters) => void;
}) => {
  const [localFilters, setLocalFilters] = useState<Filters>(filters);
  
  const handleReset = () => {
    setLocalFilters({ color: null, archetype: null, tier: null });
  };
  
  const handleApply = () => {
    onApply(localFilters);
    onClose();
  };
  
  return (
    <Modal visible={visible} animationType="slide" transparent>
      <View style={styles.modalOverlay}>
        <View style={styles.modalContent}>
          <View style={styles.modalHeader}>
            <Text style={styles.modalTitle}>Filters</Text>
            <TouchableOpacity onPress={onClose}>
              <Ionicons name="close" size={24} color="#fff" />
            </TouchableOpacity>
          </View>
          
          <ScrollView style={styles.modalBody}>
            <Text style={styles.filterLabel}>Color</Text>
            <View style={styles.filterChipContainer}>
              <FilterChip
                label="All"
                selected={!localFilters.color}
                onPress={() => setLocalFilters({ ...localFilters, color: null })}
              />
              {options?.colors.map((color) => (
                <FilterChip
                  key={color}
                  label={color}
                  selected={localFilters.color === color}
                  onPress={() => setLocalFilters({ ...localFilters, color })}
                />
              ))}
            </View>
            
            <Text style={styles.filterLabel}>Archetype</Text>
            <View style={styles.filterChipContainer}>
              <FilterChip
                label="All"
                selected={!localFilters.archetype}
                onPress={() => setLocalFilters({ ...localFilters, archetype: null })}
              />
              {options?.archetypes.map((archetype) => (
                <FilterChip
                  key={archetype}
                  label={archetype.charAt(0).toUpperCase() + archetype.slice(1)}
                  selected={localFilters.archetype === archetype}
                  onPress={() => setLocalFilters({ ...localFilters, archetype })}
                />
              ))}
            </View>
            
            <Text style={styles.filterLabel}>Tier</Text>
            <View style={styles.filterChipContainer}>
              <FilterChip
                label="All"
                selected={!localFilters.tier}
                onPress={() => setLocalFilters({ ...localFilters, tier: null })}
              />
              {options?.tiers.map((tier) => (
                <FilterChip
                  key={tier}
                  label={`Tier ${tier}`}
                  selected={localFilters.tier === tier}
                  onPress={() => setLocalFilters({ ...localFilters, tier })}
                />
              ))}
            </View>
          </ScrollView>
          
          <View style={styles.modalFooter}>
            <TouchableOpacity style={styles.resetButton} onPress={handleReset}>
              <Text style={styles.resetButtonText}>Reset</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.applyButton} onPress={handleApply}>
              <Text style={styles.applyButtonText}>Apply</Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
  );
};

// Comparison Modal Component
const ComparisonModal = ({
  visible,
  onClose,
  deck1,
  deck2,
}: {
  visible: boolean;
  onClose: () => void;
  deck1: DeckSummary | null;
  deck2: DeckSummary | null;
}) => {
  const [comparison, setComparison] = useState<DeckComparison | null>(null);
  const [loading, setLoading] = useState(false);

  React.useEffect(() => {
    if (visible && deck1 && deck2) {
      setLoading(true);
      compareDecks(deck1.id, deck2.id)
        .then(setComparison)
        .catch(console.error)
        .finally(() => setLoading(false));
    }
  }, [visible, deck1, deck2]);

  if (!deck1 || !deck2) return null;

  const getVerdictText = (verdict: string) => {
    if (verdict === 'deck1_favored') return `${deck1.name} is favored`;
    if (verdict === 'deck2_favored') return `${deck2.name} is favored`;
    return 'Even matchup';
  };

  const getVerdictColor = (verdict: string) => {
    if (verdict === 'even') return '#FFC107';
    return '#6366F1';
  };

  return (
    <Modal visible={visible} animationType="slide" transparent>
      <View style={styles.modalOverlay}>
        <View style={styles.comparisonModalContent}>
          <View style={styles.modalHeader}>
            <Text style={styles.modalTitle}>Deck Comparison</Text>
            <TouchableOpacity onPress={onClose}>
              <Ionicons name="close" size={24} color="#fff" />
            </TouchableOpacity>
          </View>

          {loading ? (
            <View style={styles.comparisonLoading}>
              <ActivityIndicator size="large" color="#6366F1" />
              <Text style={styles.loadingText}>Analyzing matchup...</Text>
            </View>
          ) : comparison ? (
            <ScrollView style={styles.comparisonBody}>
              {/* Deck 1 */}
              <View style={styles.comparisonDeck}>
                <View style={styles.comparisonDeckHeader}>
                  <View style={styles.manaRowSmall}>
                    {deck1.colors.map((c, i) => (
                      <ManaSymbol key={`d1-${c}-${i}`} color={c} />
                    ))}
                  </View>
                  <Text style={styles.comparisonDeckName}>{deck1.name}</Text>
                </View>
                <Text style={styles.comparisonWinRate}>
                  {comparison.deck1_win_rate.toFixed(1)}% WR
                </Text>
              </View>

              {/* VS Badge */}
              <View style={styles.vsBadge}>
                <Text style={styles.vsText}>VS</Text>
              </View>

              {/* Deck 2 */}
              <View style={styles.comparisonDeck}>
                <View style={styles.comparisonDeckHeader}>
                  <View style={styles.manaRowSmall}>
                    {deck2.colors.map((c, i) => (
                      <ManaSymbol key={`d2-${c}-${i}`} color={c} />
                    ))}
                  </View>
                  <Text style={styles.comparisonDeckName}>{deck2.name}</Text>
                </View>
                <Text style={styles.comparisonWinRate}>
                  {comparison.deck2_win_rate.toFixed(1)}% WR
                </Text>
              </View>

              {/* Head to Head */}
              <View style={styles.headToHead}>
                <Text style={styles.headToHeadLabel}>Head-to-Head Prediction</Text>
                <View style={styles.headToHeadBar}>
                  <View 
                    style={[
                      styles.headToHeadFill, 
                      { width: `${comparison.head_to_head}%` }
                    ]} 
                  />
                </View>
                <View style={styles.headToHeadLabels}>
                  <Text style={styles.headToHeadPercent}>{comparison.head_to_head.toFixed(0)}%</Text>
                  <Text style={styles.headToHeadPercent}>{(100 - comparison.head_to_head).toFixed(0)}%</Text>
                </View>
                <View style={styles.headToHeadNames}>
                  <Text style={styles.headToHeadDeckName} numberOfLines={1}>{deck1.name}</Text>
                  <Text style={styles.headToHeadDeckName} numberOfLines={1}>{deck2.name}</Text>
                </View>
              </View>

              {/* Verdict */}
              <View style={[styles.verdict, { backgroundColor: getVerdictColor(comparison.verdict) }]}>
                <Ionicons 
                  name={comparison.verdict === 'even' ? 'swap-horizontal' : 'trophy'} 
                  size={24} 
                  color="#fff" 
                />
                <Text style={styles.verdictText}>{getVerdictText(comparison.verdict)}</Text>
              </View>

              {/* Analysis */}
              <View style={styles.analysisBox}>
                <Text style={styles.analysisLabel}>Analysis</Text>
                <Text style={styles.analysisText}>{comparison.analysis}</Text>
              </View>
            </ScrollView>
          ) : null}

          <TouchableOpacity style={styles.closeCompareButton} onPress={onClose}>
            <Text style={styles.closeCompareText}>Close</Text>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
};

// Main Component
export default function HomeScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const queryClient = useQueryClient();
  
  const [filters, setFilters] = useState<Filters>({
    color: null,
    archetype: null,
    tier: null,
  });
  const [filterModalVisible, setFilterModalVisible] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [compareMode, setCompareMode] = useState(false);
  const [selectedDecks, setSelectedDecks] = useState<DeckSummary[]>([]);
  const [comparisonModalVisible, setComparisonModalVisible] = useState(false);
  
  const {
    data: decks,
    isLoading,
    error,
    refetch,
  } = useQuery({
    queryKey: ['decks', filters],
    queryFn: () => fetchDecks(filters),
  });
  
  const { data: filterOptions } = useQuery({
    queryKey: ['filterOptions'],
    queryFn: fetchFilterOptions,
  });
  
  const handleRefresh = useCallback(async () => {
    setIsRefreshing(true);
    try {
      await refreshDecks();
      await new Promise((resolve) => setTimeout(resolve, 2000));
      await refetch();
    } catch (error) {
      console.error('Error refreshing decks:', error);
    } finally {
      setIsRefreshing(false);
    }
  }, [refetch]);
  
  const handleDeckPress = useCallback(
    (deck: DeckSummary) => {
      if (compareMode) {
        if (selectedDecks.find(d => d.id === deck.id)) {
          setSelectedDecks(selectedDecks.filter(d => d.id !== deck.id));
        } else if (selectedDecks.length < 2) {
          setSelectedDecks([...selectedDecks, deck]);
        }
      } else {
        router.push(`/deck/${deck.id}`);
      }
    },
    [router, compareMode, selectedDecks]
  );

  const handleCompare = useCallback(() => {
    if (selectedDecks.length === 2) {
      setComparisonModalVisible(true);
    }
  }, [selectedDecks]);

  const toggleCompareMode = useCallback(() => {
    setCompareMode(!compareMode);
    setSelectedDecks([]);
  }, [compareMode]);
  
  const activeFiltersCount = [filters.color, filters.archetype, filters.tier].filter(
    Boolean
  ).length;
  
  const renderDeckItem = useCallback(
    ({ item }: { item: DeckSummary }) => (
      <DeckCard 
        deck={item} 
        onPress={() => handleDeckPress(item)}
        compareMode={compareMode}
        isSelected={selectedDecks.some(d => d.id === item.id)}
      />
    ),
    [handleDeckPress, compareMode, selectedDecks]
  );
  
  if (error) {
    return (
      <View style={[styles.container, styles.centerContent]}>
        <Ionicons name="alert-circle" size={48} color="#F44336" />
        <Text style={styles.errorText}>Failed to load decks</Text>
        <TouchableOpacity style={styles.retryButton} onPress={() => refetch()}>
          <Text style={styles.retryButtonText}>Retry</Text>
        </TouchableOpacity>
      </View>
    );
  }
  
  return (
    <View style={[styles.container, { paddingBottom: insets.bottom }]}>
      {/* Header Actions */}
      <View style={styles.headerActions}>
        <TouchableOpacity
          style={styles.filterButton}
          onPress={() => setFilterModalVisible(true)}
        >
          <Ionicons name="filter" size={20} color="#fff" />
          <Text style={styles.filterButtonText}>Filters</Text>
          {activeFiltersCount > 0 && (
            <View style={styles.filterBadge}>
              <Text style={styles.filterBadgeText}>{activeFiltersCount}</Text>
            </View>
          )}
        </TouchableOpacity>

        <View style={styles.headerRight}>
          <TouchableOpacity
            style={styles.notificationButton}
            onPress={() => router.push('/notifications')}
          >
            <Ionicons name="notifications" size={20} color="#fff" />
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.compareButton, compareMode && styles.compareButtonActive]}
            onPress={toggleCompareMode}
          >
            <Ionicons name="git-compare" size={20} color={compareMode ? '#6366F1' : '#fff'} />
          </TouchableOpacity>
          
          <TouchableOpacity
            style={styles.refreshButton}
            onPress={handleRefresh}
            disabled={isRefreshing}
          >
            {isRefreshing ? (
              <ActivityIndicator size="small" color="#fff" />
            ) : (
              <Ionicons name="refresh" size={20} color="#fff" />
            )}
          </TouchableOpacity>
        </View>
      </View>

      {/* Compare Mode Banner */}
      {compareMode && (
        <View style={styles.compareBanner}>
          <Text style={styles.compareBannerText}>
            Select 2 decks to compare ({selectedDecks.length}/2)
          </Text>
          {selectedDecks.length === 2 && (
            <TouchableOpacity style={styles.compareNowButton} onPress={handleCompare}>
              <Text style={styles.compareNowText}>Compare</Text>
            </TouchableOpacity>
          )}
        </View>
      )}
      
      {/* Stats Bar */}
      <View style={styles.statsBar}>
        <Text style={styles.statsText}>
          {decks?.length || 0} decks found
        </Text>
        <Text style={styles.statsSubtext}>Best of One • Standard</Text>
      </View>
      
      {/* Deck List */}
      {isLoading ? (
        <View style={[styles.container, styles.centerContent]}>
          <ActivityIndicator size="large" color="#6366F1" />
          <Text style={styles.loadingText}>Loading decks...</Text>
        </View>
      ) : (
        <FlashList
          data={decks}
          renderItem={renderDeckItem}
          estimatedItemSize={150}
          keyExtractor={(item) => item.id}
          contentContainerStyle={styles.listContent}
          refreshControl={
            <RefreshControl
              refreshing={isRefreshing}
              onRefresh={handleRefresh}
              tintColor="#6366F1"
              colors={['#6366F1']}
            />
          }
          ListEmptyComponent={
            <View style={styles.emptyContainer}>
              <Ionicons name="search" size={48} color="#666" />
              <Text style={styles.emptyText}>No decks found</Text>
              <Text style={styles.emptySubtext}>Try adjusting your filters</Text>
            </View>
          }
        />
      )}
      
      {/* Filter Modal */}
      <FilterModal
        visible={filterModalVisible}
        onClose={() => setFilterModalVisible(false)}
        options={filterOptions}
        filters={filters}
        onApply={setFilters}
      />

      {/* Comparison Modal */}
      <ComparisonModal
        visible={comparisonModalVisible}
        onClose={() => {
          setComparisonModalVisible(false);
          setCompareMode(false);
          setSelectedDecks([]);
        }}
        deck1={selectedDecks[0] || null}
        deck2={selectedDecks[1] || null}
      />
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
  headerActions: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#2a2a40',
  },
  headerRight: {
    flexDirection: 'row',
  },
  filterButton: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#2a2a40',
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 8,
  },
  filterButtonText: {
    color: '#fff',
    marginLeft: 8,
    fontSize: 14,
    fontWeight: '600',
  },
  filterBadge: {
    backgroundColor: '#6366F1',
    borderRadius: 10,
    minWidth: 20,
    height: 20,
    justifyContent: 'center',
    alignItems: 'center',
    marginLeft: 8,
  },
  filterBadgeText: {
    color: '#fff',
    fontSize: 12,
    fontWeight: 'bold',
  },
  compareButton: {
    backgroundColor: '#2a2a40',
    padding: 10,
    borderRadius: 8,
    marginRight: 8,
  },
  compareButtonActive: {
    backgroundColor: '#3a3a50',
    borderWidth: 1,
    borderColor: '#6366F1',
  },
  notificationButton: {
    backgroundColor: '#2a2a40',
    padding: 10,
    borderRadius: 8,
    marginRight: 8,
  },
  refreshButton: {
    backgroundColor: '#2a2a40',
    padding: 10,
    borderRadius: 8,
  },
  compareBanner: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: '#6366F1',
    paddingHorizontal: 16,
    paddingVertical: 10,
  },
  compareBannerText: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '500',
  },
  compareNowButton: {
    backgroundColor: '#fff',
    paddingHorizontal: 16,
    paddingVertical: 6,
    borderRadius: 16,
  },
  compareNowText: {
    color: '#6366F1',
    fontWeight: 'bold',
  },
  statsBar: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: '#2a2a40',
  },
  statsText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
  },
  statsSubtext: {
    color: '#888',
    fontSize: 12,
    marginTop: 2,
  },
  listContent: {
    paddingHorizontal: 16,
    paddingVertical: 8,
  },
  deckCard: {
    backgroundColor: '#1a1a2e',
    borderRadius: 12,
    marginVertical: 6,
    padding: 16,
    borderWidth: 1,
    borderColor: '#2a2a40',
  },
  deckCardSelected: {
    borderColor: '#6366F1',
    borderWidth: 2,
  },
  selectIndicator: {
    position: 'absolute',
    top: 8,
    right: 8,
    width: 24,
    height: 24,
    borderRadius: 12,
    borderWidth: 2,
    borderColor: '#666',
    justifyContent: 'center',
    alignItems: 'center',
  },
  selectIndicatorActive: {
    backgroundColor: '#6366F1',
    borderColor: '#6366F1',
  },
  deckCardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
  deckCardTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
  },
  deckName: {
    color: '#fff',
    fontSize: 16,
    fontWeight: 'bold',
    flex: 1,
  },
  deckCardBody: {
    marginBottom: 12,
  },
  manaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 8,
  },
  manaRowSmall: {
    flexDirection: 'row',
  },
  manaSymbol: {
    width: 24,
    height: 24,
    borderRadius: 12,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 4,
    borderWidth: 1,
  },
  manaText: {
    fontSize: 12,
    fontWeight: 'bold',
  },
  colorName: {
    color: '#888',
    fontSize: 14,
    marginLeft: 8,
  },
  deckMeta: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  archetypeBadge: {
    backgroundColor: '#3a3a50',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 4,
  },
  archetypeText: {
    color: '#fff',
    fontSize: 12,
    textTransform: 'capitalize',
  },
  sourceText: {
    color: '#666',
    fontSize: 12,
    marginLeft: 8,
    textTransform: 'capitalize',
  },
  deckCardFooter: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    borderTopWidth: 1,
    borderTopColor: '#2a2a40',
    paddingTop: 12,
  },
  wildcardContainer: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  wildcardItem: {
    flexDirection: 'row',
    alignItems: 'center',
    marginRight: 12,
  },
  wildcardDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    marginRight: 4,
  },
  wildcardText: {
    color: '#888',
    fontSize: 12,
  },
  tierBadge: {
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 4,
    marginRight: 8,
  },
  tierText: {
    color: '#000',
    fontSize: 12,
    fontWeight: 'bold',
  },
  winRateBadge: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 12,
  },
  winRateText: {
    color: '#fff',
    fontSize: 12,
    fontWeight: 'bold',
  },
  loadingText: {
    color: '#888',
    marginTop: 12,
    fontSize: 14,
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
  emptyContainer: {
    alignItems: 'center',
    paddingVertical: 48,
  },
  emptyText: {
    color: '#888',
    fontSize: 16,
    marginTop: 12,
  },
  emptySubtext: {
    color: '#666',
    fontSize: 14,
    marginTop: 4,
  },
  // Modal styles
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.7)',
    justifyContent: 'flex-end',
  },
  modalContent: {
    backgroundColor: '#1a1a2e',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    maxHeight: '80%',
  },
  comparisonModalContent: {
    backgroundColor: '#1a1a2e',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    maxHeight: '90%',
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 20,
    borderBottomWidth: 1,
    borderBottomColor: '#2a2a40',
  },
  modalTitle: {
    color: '#fff',
    fontSize: 20,
    fontWeight: 'bold',
  },
  modalBody: {
    padding: 20,
  },
  filterLabel: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
    marginBottom: 12,
    marginTop: 8,
  },
  filterChipContainer: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    marginBottom: 16,
  },
  filterChip: {
    backgroundColor: '#2a2a40',
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 20,
    marginRight: 8,
    marginBottom: 8,
  },
  filterChipSelected: {
    backgroundColor: '#6366F1',
  },
  filterChipText: {
    color: '#fff',
    fontSize: 14,
  },
  filterChipTextSelected: {
    fontWeight: 'bold',
  },
  modalFooter: {
    flexDirection: 'row',
    padding: 20,
    borderTopWidth: 1,
    borderTopColor: '#2a2a40',
  },
  resetButton: {
    flex: 1,
    backgroundColor: '#2a2a40',
    paddingVertical: 14,
    borderRadius: 8,
    marginRight: 8,
    alignItems: 'center',
  },
  resetButtonText: {
    color: '#fff',
    fontWeight: '600',
  },
  applyButton: {
    flex: 2,
    backgroundColor: '#6366F1',
    paddingVertical: 14,
    borderRadius: 8,
    alignItems: 'center',
  },
  applyButtonText: {
    color: '#fff',
    fontWeight: 'bold',
  },
  // Comparison Modal styles
  comparisonLoading: {
    padding: 40,
    alignItems: 'center',
  },
  comparisonBody: {
    padding: 20,
  },
  comparisonDeck: {
    backgroundColor: '#0f0f1a',
    borderRadius: 12,
    padding: 16,
    marginBottom: 8,
  },
  comparisonDeckHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 8,
  },
  comparisonDeckName: {
    color: '#fff',
    fontSize: 18,
    fontWeight: 'bold',
    marginLeft: 8,
    flex: 1,
  },
  comparisonWinRate: {
    color: '#888',
    fontSize: 14,
  },
  vsBadge: {
    alignSelf: 'center',
    backgroundColor: '#2a2a40',
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 20,
    marginVertical: 8,
  },
  vsText: {
    color: '#888',
    fontWeight: 'bold',
    fontSize: 16,
  },
  headToHead: {
    marginTop: 20,
    marginBottom: 20,
  },
  headToHeadLabel: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
    marginBottom: 12,
    textAlign: 'center',
  },
  headToHeadBar: {
    height: 24,
    backgroundColor: '#F44336',
    borderRadius: 12,
    overflow: 'hidden',
  },
  headToHeadFill: {
    height: '100%',
    backgroundColor: '#6366F1',
    borderRadius: 12,
  },
  headToHeadLabels: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 8,
  },
  headToHeadPercent: {
    color: '#fff',
    fontSize: 18,
    fontWeight: 'bold',
  },
  headToHeadNames: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 4,
  },
  headToHeadDeckName: {
    color: '#888',
    fontSize: 12,
    maxWidth: '45%',
  },
  verdict: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 16,
    borderRadius: 12,
    marginBottom: 16,
  },
  verdictText: {
    color: '#fff',
    fontSize: 18,
    fontWeight: 'bold',
    marginLeft: 8,
  },
  analysisBox: {
    backgroundColor: '#0f0f1a',
    borderRadius: 12,
    padding: 16,
  },
  analysisLabel: {
    color: '#6366F1',
    fontSize: 14,
    fontWeight: '600',
    marginBottom: 8,
  },
  analysisText: {
    color: '#ccc',
    fontSize: 14,
    lineHeight: 20,
  },
  closeCompareButton: {
    backgroundColor: '#2a2a40',
    margin: 20,
    padding: 16,
    borderRadius: 12,
    alignItems: 'center',
  },
  closeCompareText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
  },
});

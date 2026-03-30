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

// Color mapping for mana symbols
const MANA_COLORS: Record<string, string> = {
  W: '#F9FAF4', // White
  U: '#0E68AB', // Blue
  B: '#150B00', // Black
  R: '#D3202A', // Red
  G: '#00733E', // Green
  C: '#CBC2BF', // Colorless
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
  1: '#FFD700', // Gold
  2: '#C0C0C0', // Silver
  3: '#CD7F32', // Bronze
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
const DeckCard = ({ deck, onPress }: { deck: DeckSummary; onPress: () => void }) => (
  <TouchableOpacity style={styles.deckCard} onPress={onPress} activeOpacity={0.7}>
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
            {/* Color Filter */}
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
            
            {/* Archetype Filter */}
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
            
            {/* Tier Filter */}
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
  
  // Queries
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
      await new Promise((resolve) => setTimeout(resolve, 2000)); // Wait for scraping
      await refetch();
    } catch (error) {
      console.error('Error refreshing decks:', error);
    } finally {
      setIsRefreshing(false);
    }
  }, [refetch]);
  
  const handleDeckPress = useCallback(
    (deckId: string) => {
      router.push(`/deck/${deckId}`);
    },
    [router]
  );
  
  const activeFiltersCount = [filters.color, filters.archetype, filters.tier].filter(
    Boolean
  ).length;
  
  const renderDeckItem = useCallback(
    ({ item }: { item: DeckSummary }) => (
      <DeckCard deck={item} onPress={() => handleDeckPress(item.id)} />
    ),
    [handleDeckPress]
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
  refreshButton: {
    backgroundColor: '#2a2a40',
    padding: 10,
    borderRadius: 8,
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
});

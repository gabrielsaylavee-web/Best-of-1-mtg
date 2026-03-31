import React, { useState, useCallback, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  RefreshControl,
  ActivityIndicator,
  ScrollView,
  Modal,
  Animated,
  Dimensions,
  TextInput,
  Platform,
} from 'react-native';
import { FlashList } from '@shopify/flash-list';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import * as Haptics from 'expo-haptics';
import axios from 'axios';

const API_URL = process.env.EXPO_PUBLIC_BACKEND_URL || '';
const { width: SCREEN_WIDTH } = Dimensions.get('window');

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

// Color configurations
const MANA_GRADIENTS: Record<string, string[]> = {
  W: ['#FFFEF5', '#F8F4E8', '#EDE5D5'],
  U: ['#0A82C4', '#0E68AB', '#084C7A'],
  B: ['#3D3539', '#1A1517', '#0D0A0B'],
  R: ['#E84C30', '#D3202A', '#A11A22'],
  G: ['#2E9E5E', '#00733E', '#005C32'],
  C: ['#E0DDD8', '#CBC2BF', '#9E9E9E'],
};

const MANA_COLORS: Record<string, string> = {
  W: '#F9FAF4',
  U: '#0E68AB',
  B: '#1A1517',
  R: '#D3202A',
  G: '#00733E',
  C: '#CBC2BF',
};

const ARCHETYPE_ICONS: Record<string, string> = {
  aggro: 'flash',
  control: 'shield-checkmark',
  midrange: 'swap-horizontal',
  combo: 'git-merge',
  tempo: 'speedometer',
};

const ARCHETYPE_COLORS: Record<string, string[]> = {
  aggro: ['#FF6B6B', '#EE5A5A'],
  control: ['#4ECDC4', '#45B7AA'],
  midrange: ['#FFE66D', '#F4D35E'],
  combo: ['#A855F7', '#9333EA'],
  tempo: ['#3B82F6', '#2563EB'],
};

// API functions
const fetchDecks = async (filters: Filters, search: string): Promise<DeckSummary[]> => {
  const params = new URLSearchParams();
  if (filters.color) params.append('color', filters.color);
  if (filters.archetype) params.append('archetype', filters.archetype);
  if (filters.tier) params.append('tier', filters.tier.toString());
  params.append('sort_by', 'win_rate');
  params.append('sort_order', 'desc');
  
  const response = await axios.get(`${API_URL}/api/decks?${params.toString()}`);
  let decks = response.data;
  
  // Client-side search filter
  if (search.trim()) {
    const searchLower = search.toLowerCase();
    decks = decks.filter((d: DeckSummary) => 
      d.name.toLowerCase().includes(searchLower) ||
      d.color_name.toLowerCase().includes(searchLower) ||
      d.archetype.toLowerCase().includes(searchLower)
    );
  }
  
  return decks;
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

// Enhanced Mana Symbol Component
const ManaSymbol = ({ color, size = 28 }: { color: string; size?: number }) => {
  const gradients = MANA_GRADIENTS[color] || MANA_GRADIENTS.C;
  const textColor = color === 'W' || color === 'C' ? '#333' : '#FFF';
  
  return (
    <LinearGradient
      colors={gradients}
      style={[
        styles.manaSymbol,
        {
          width: size,
          height: size,
          borderRadius: size / 2,
        },
      ]}
      start={{ x: 0, y: 0 }}
      end={{ x: 1, y: 1 }}
    >
      <Text style={[styles.manaText, { fontSize: size * 0.45, color: textColor }]}>
        {color}
      </Text>
    </LinearGradient>
  );
};

// Tier Badge with gradient
const TierBadge = ({ tier }: { tier: number | null }) => {
  if (!tier) return null;
  
  const colors = tier === 1 
    ? ['#FFD700', '#FFA500'] 
    : tier === 2 
    ? ['#C0C0C0', '#A8A8A8']
    : ['#CD7F32', '#B87333'];
  
  return (
    <LinearGradient
      colors={colors}
      style={styles.tierBadge}
      start={{ x: 0, y: 0 }}
      end={{ x: 1, y: 1 }}
    >
      <Ionicons name="trophy" size={10} color="#000" />
      <Text style={styles.tierText}>T{tier}</Text>
    </LinearGradient>
  );
};

// Win Rate Ring Component
const WinRateRing = ({ winRate, size = 48 }: { winRate: number | null; size?: number }) => {
  if (winRate === null) return null;
  
  const color = winRate >= 55 ? '#4CAF50' : winRate >= 50 ? '#FFC107' : '#F44336';
  const strokeWidth = size * 0.12;
  const radius = (size - strokeWidth) / 2;
  const circumference = radius * 2 * Math.PI;
  const progress = (winRate / 100) * circumference;
  
  return (
    <View style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }}>
      <View style={[styles.winRateRingBg, { width: size, height: size, borderRadius: size / 2 }]}>
        <View style={[styles.winRateRingFill, { 
          width: size - 4, 
          height: size - 4, 
          borderRadius: (size - 4) / 2,
          borderWidth: strokeWidth,
          borderColor: color,
          borderTopColor: 'transparent',
          transform: [{ rotate: `${(winRate / 100) * 360}deg` }]
        }]} />
      </View>
      <View style={styles.winRateTextContainer}>
        <Text style={[styles.winRateValue, { fontSize: size * 0.28, color }]}>
          {winRate.toFixed(0)}
        </Text>
        <Text style={[styles.winRatePercent, { fontSize: size * 0.18 }]}>%</Text>
      </View>
    </View>
  );
};

// Wildcard Cost Pill
const WildcardPill = ({ cost }: { cost: WildcardCost }) => {
  const total = cost.mythic + cost.rare + cost.uncommon + cost.common;
  
  return (
    <View style={styles.wildcardPill}>
      {cost.mythic > 0 && (
        <View style={styles.wildcardItem}>
          <View style={[styles.wildcardDot, { backgroundColor: '#FF6B00' }]} />
          <Text style={styles.wildcardCount}>{cost.mythic}</Text>
        </View>
      )}
      {cost.rare > 0 && (
        <View style={styles.wildcardItem}>
          <View style={[styles.wildcardDot, { backgroundColor: '#FFD700' }]} />
          <Text style={styles.wildcardCount}>{cost.rare}</Text>
        </View>
      )}
      <View style={styles.wildcardTotal}>
        <Text style={styles.wildcardTotalText}>{total}</Text>
      </View>
    </View>
  );
};

// Enhanced Deck Card Component
const DeckCard = ({ 
  deck, 
  onPress, 
  isSelected,
  compareMode,
  isTopDeck = false,
}: { 
  deck: DeckSummary; 
  onPress: () => void;
  isSelected?: boolean;
  compareMode?: boolean;
  isTopDeck?: boolean;
}) => {
  const archetypeColors = ARCHETYPE_COLORS[deck.archetype] || ['#6366F1', '#4F46E5'];
  const scaleAnim = useRef(new Animated.Value(1)).current;
  
  const handlePressIn = () => {
    Animated.spring(scaleAnim, {
      toValue: 0.98,
      useNativeDriver: true,
    }).start();
  };
  
  const handlePressOut = () => {
    Animated.spring(scaleAnim, {
      toValue: 1,
      useNativeDriver: true,
    }).start();
  };
  
  const handlePress = () => {
    if (Platform.OS !== 'web') {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    }
    onPress();
  };
  
  return (
    <Animated.View style={[
      isTopDeck ? styles.topDeckCardContainer : styles.deckCardContainer,
      { transform: [{ scale: scaleAnim }] }
    ]}>
      <TouchableOpacity
        style={[
          styles.deckCard,
          isSelected && styles.deckCardSelected,
          isTopDeck && styles.topDeckCard,
        ]}
        onPress={handlePress}
        onPressIn={handlePressIn}
        onPressOut={handlePressOut}
        activeOpacity={1}
      >
        {/* Card gradient overlay */}
        <LinearGradient
          colors={['rgba(26, 26, 46, 0)', 'rgba(26, 26, 46, 0.9)']}
          style={styles.deckCardGradient}
        />
        
        {/* Compare mode indicator */}
        {compareMode && (
          <View style={[styles.selectIndicator, isSelected && styles.selectIndicatorActive]}>
            {isSelected ? (
              <Ionicons name="checkmark" size={16} color="#fff" />
            ) : (
              <View style={styles.selectIndicatorEmpty} />
            )}
          </View>
        )}
        
        {/* Top section */}
        <View style={styles.deckCardTop}>
          <View style={styles.manaRow}>
            {deck.colors.map((color, index) => (
              <ManaSymbol key={`${color}-${index}`} color={color} size={isTopDeck ? 36 : 28} />
            ))}
          </View>
          <WinRateRing winRate={deck.win_rate} size={isTopDeck ? 56 : 48} />
        </View>
        
        {/* Content */}
        <View style={styles.deckCardContent}>
          <View style={styles.deckCardHeader}>
            <TierBadge tier={deck.tier} />
            <Text style={[styles.deckName, isTopDeck && styles.topDeckName]} numberOfLines={1}>
              {deck.name}
            </Text>
          </View>
          
          <Text style={styles.colorName}>{deck.color_name}</Text>
          
          {/* Archetype badge */}
          <LinearGradient
            colors={archetypeColors}
            style={styles.archetypeBadge}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 0 }}
          >
            <Ionicons 
              name={ARCHETYPE_ICONS[deck.archetype] as any || 'help-circle'} 
              size={12} 
              color="#fff" 
            />
            <Text style={styles.archetypeText}>{deck.archetype}</Text>
          </LinearGradient>
        </View>
        
        {/* Footer */}
        <View style={styles.deckCardFooter}>
          <WildcardPill cost={deck.wildcard_cost} />
          <View style={styles.sourceTag}>
            <Ionicons name="globe-outline" size={12} color="#888" />
            <Text style={styles.sourceText}>{deck.source}</Text>
          </View>
        </View>
      </TouchableOpacity>
    </Animated.View>
  );
};

// Filter Chip Component
const FilterChip = ({
  label,
  selected,
  onPress,
  icon,
  color,
}: {
  label: string;
  selected: boolean;
  onPress: () => void;
  icon?: string;
  color?: string;
}) => (
  <TouchableOpacity
    style={[
      styles.filterChip,
      selected && styles.filterChipSelected,
      selected && color && { backgroundColor: color }
    ]}
    onPress={onPress}
  >
    {icon && (
      <Ionicons 
        name={icon as any} 
        size={14} 
        color={selected ? '#fff' : '#888'} 
        style={{ marginRight: 4 }}
      />
    )}
    <Text style={[styles.filterChipText, selected && styles.filterChipTextSelected]}>
      {label}
    </Text>
  </TouchableOpacity>
);

// Search Bar Component
const SearchBar = ({ value, onChangeText }: { value: string; onChangeText: (text: string) => void }) => (
  <View style={styles.searchContainer}>
    <Ionicons name="search" size={18} color="#888" />
    <TextInput
      style={styles.searchInput}
      placeholder="Search decks..."
      placeholderTextColor="#666"
      value={value}
      onChangeText={onChangeText}
    />
    {value.length > 0 && (
      <TouchableOpacity onPress={() => onChangeText('')}>
        <Ionicons name="close-circle" size={18} color="#666" />
      </TouchableOpacity>
    )}
  </View>
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
  const insets = useSafeAreaInsets();
  
  const handleReset = () => {
    setLocalFilters({ color: null, archetype: null, tier: null });
  };
  
  const handleApply = () => {
    if (Platform.OS !== 'web') {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    }
    onApply(localFilters);
    onClose();
  };
  
  return (
    <Modal visible={visible} animationType="slide" transparent>
      <View style={styles.modalOverlay}>
        <View style={[styles.modalContent, { paddingBottom: insets.bottom + 20 }]}>
          <View style={styles.modalHandle} />
          
          <View style={styles.modalHeader}>
            <Text style={styles.modalTitle}>Filters</Text>
            <TouchableOpacity onPress={onClose} style={styles.modalCloseBtn}>
              <Ionicons name="close" size={24} color="#fff" />
            </TouchableOpacity>
          </View>
          
          <ScrollView style={styles.modalBody} showsVerticalScrollIndicator={false}>
            {/* Color Filter */}
            <Text style={styles.filterLabel}>Mana Color</Text>
            <View style={styles.filterChipContainer}>
              <FilterChip
                label="All"
                selected={!localFilters.color}
                onPress={() => setLocalFilters({ ...localFilters, color: null })}
                icon="infinite"
              />
              {options?.colors.map((color) => (
                <FilterChip
                  key={color}
                  label={color}
                  selected={localFilters.color === color}
                  onPress={() => setLocalFilters({ ...localFilters, color })}
                  color={localFilters.color === color ? MANA_COLORS[color] : undefined}
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
                icon="infinite"
              />
              {options?.archetypes.map((archetype) => (
                <FilterChip
                  key={archetype}
                  label={archetype.charAt(0).toUpperCase() + archetype.slice(1)}
                  selected={localFilters.archetype === archetype}
                  onPress={() => setLocalFilters({ ...localFilters, archetype })}
                  icon={ARCHETYPE_ICONS[archetype]}
                  color={localFilters.archetype === archetype ? ARCHETYPE_COLORS[archetype]?.[0] : undefined}
                />
              ))}
            </View>
            
            {/* Tier Filter */}
            <Text style={styles.filterLabel}>Tier</Text>
            <View style={styles.filterChipContainer}>
              <FilterChip
                label="All Tiers"
                selected={!localFilters.tier}
                onPress={() => setLocalFilters({ ...localFilters, tier: null })}
                icon="infinite"
              />
              {options?.tiers.map((tier) => (
                <FilterChip
                  key={tier}
                  label={`Tier ${tier}`}
                  selected={localFilters.tier === tier}
                  onPress={() => setLocalFilters({ ...localFilters, tier })}
                  icon="trophy"
                />
              ))}
            </View>
          </ScrollView>
          
          <View style={styles.modalFooter}>
            <TouchableOpacity style={styles.resetButton} onPress={handleReset}>
              <Ionicons name="refresh" size={18} color="#fff" />
              <Text style={styles.resetButtonText}>Reset</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.applyButton} onPress={handleApply}>
              <LinearGradient
                colors={['#6366F1', '#4F46E5']}
                style={styles.applyButtonGradient}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 0 }}
              >
                <Text style={styles.applyButtonText}>Apply Filters</Text>
              </LinearGradient>
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
  const insets = useSafeAreaInsets();

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
    if (verdict === 'deck1_favored') return `${deck1.name} Wins`;
    if (verdict === 'deck2_favored') return `${deck2.name} Wins`;
    return 'Even Match';
  };

  return (
    <Modal visible={visible} animationType="slide" transparent>
      <View style={styles.modalOverlay}>
        <View style={[styles.comparisonModalContent, { paddingBottom: insets.bottom + 20 }]}>
          <View style={styles.modalHandle} />
          
          <View style={styles.modalHeader}>
            <Text style={styles.modalTitle}>Battle Analysis</Text>
            <TouchableOpacity onPress={onClose} style={styles.modalCloseBtn}>
              <Ionicons name="close" size={24} color="#fff" />
            </TouchableOpacity>
          </View>

          {loading ? (
            <View style={styles.comparisonLoading}>
              <ActivityIndicator size="large" color="#6366F1" />
              <Text style={styles.loadingText}>Analyzing matchup...</Text>
            </View>
          ) : comparison ? (
            <ScrollView style={styles.comparisonBody} showsVerticalScrollIndicator={false}>
              {/* VS Display */}
              <View style={styles.vsContainer}>
                <View style={styles.vsDeck}>
                  <View style={styles.vsManaRow}>
                    {deck1.colors.map((c, i) => (
                      <ManaSymbol key={`d1-${c}-${i}`} color={c} size={32} />
                    ))}
                  </View>
                  <Text style={styles.vsDeckName} numberOfLines={2}>{deck1.name}</Text>
                  <Text style={styles.vsWinRate}>{comparison.deck1_win_rate.toFixed(1)}%</Text>
                </View>
                
                <View style={styles.vsBadgeContainer}>
                  <LinearGradient
                    colors={['#6366F1', '#A855F7']}
                    style={styles.vsBadge}
                  >
                    <Text style={styles.vsText}>VS</Text>
                  </LinearGradient>
                </View>
                
                <View style={styles.vsDeck}>
                  <View style={styles.vsManaRow}>
                    {deck2.colors.map((c, i) => (
                      <ManaSymbol key={`d2-${c}-${i}`} color={c} size={32} />
                    ))}
                  </View>
                  <Text style={styles.vsDeckName} numberOfLines={2}>{deck2.name}</Text>
                  <Text style={styles.vsWinRate}>{comparison.deck2_win_rate.toFixed(1)}%</Text>
                </View>
              </View>

              {/* Head to Head Bar */}
              <View style={styles.h2hContainer}>
                <Text style={styles.h2hLabel}>Head-to-Head Prediction</Text>
                <View style={styles.h2hBarContainer}>
                  <LinearGradient
                    colors={['#6366F1', '#4F46E5']}
                    style={[styles.h2hBar, { width: `${comparison.head_to_head}%` }]}
                    start={{ x: 0, y: 0 }}
                    end={{ x: 1, y: 0 }}
                  />
                  <View style={[styles.h2hBarBg, { width: `${100 - comparison.head_to_head}%` }]} />
                </View>
                <View style={styles.h2hLabels}>
                  <Text style={styles.h2hPercent}>{comparison.head_to_head.toFixed(0)}%</Text>
                  <Text style={styles.h2hPercent}>{(100 - comparison.head_to_head).toFixed(0)}%</Text>
                </View>
              </View>

              {/* Verdict */}
              <LinearGradient
                colors={comparison.verdict === 'even' ? ['#FFC107', '#F59E0B'] : ['#6366F1', '#A855F7']}
                style={styles.verdictCard}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 0 }}
              >
                <Ionicons 
                  name={comparison.verdict === 'even' ? 'swap-horizontal' : 'trophy'} 
                  size={28} 
                  color="#fff" 
                />
                <Text style={styles.verdictText}>{getVerdictText(comparison.verdict)}</Text>
              </LinearGradient>

              {/* Analysis */}
              <View style={styles.analysisCard}>
                <Ionicons name="analytics" size={20} color="#6366F1" />
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
  const [searchQuery, setSearchQuery] = useState('');
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
    queryKey: ['decks', filters, searchQuery],
    queryFn: () => fetchDecks(filters, searchQuery),
  });
  
  const { data: filterOptions } = useQuery({
    queryKey: ['filterOptions'],
    queryFn: fetchFilterOptions,
  });
  
  const handleRefresh = useCallback(async () => {
    setIsRefreshing(true);
    if (Platform.OS !== 'web') {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    }
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
          if (selectedDecks.length === 1) {
            // Auto-show comparison when 2 decks selected
            setTimeout(() => setComparisonModalVisible(true), 300);
          }
        }
      } else {
        router.push(`/deck/${deck.id}`);
      }
    },
    [router, compareMode, selectedDecks]
  );

  const toggleCompareMode = useCallback(() => {
    if (Platform.OS !== 'web') {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    }
    setCompareMode(!compareMode);
    setSelectedDecks([]);
  }, [compareMode]);
  
  const activeFiltersCount = [filters.color, filters.archetype, filters.tier].filter(
    Boolean
  ).length;
  
  const topDeck = decks?.[0];
  const restDecks = decks?.slice(1) || [];
  
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
        <Ionicons name="cloud-offline" size={64} color="#F44336" />
        <Text style={styles.errorTitle}>Connection Error</Text>
        <Text style={styles.errorText}>Unable to load decks</Text>
        <TouchableOpacity style={styles.retryButton} onPress={() => refetch()}>
          <LinearGradient
            colors={['#6366F1', '#4F46E5']}
            style={styles.retryButtonGradient}
          >
            <Ionicons name="refresh" size={18} color="#fff" />
            <Text style={styles.retryButtonText}>Try Again</Text>
          </LinearGradient>
        </TouchableOpacity>
      </View>
    );
  }
  
  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      {/* Header */}
      <View style={styles.header}>
        <View style={styles.headerLeft}>
          <Text style={styles.headerTitle}>MTG Arena</Text>
          <Text style={styles.headerSubtitle}>Best of One • Standard</Text>
        </View>
        <View style={styles.headerRight}>
          <TouchableOpacity
            style={styles.headerButton}
            onPress={() => router.push('/notifications')}
          >
            <Ionicons name="notifications-outline" size={22} color="#fff" />
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.headerButton, compareMode && styles.headerButtonActive]}
            onPress={toggleCompareMode}
          >
            <Ionicons name="git-compare-outline" size={22} color={compareMode ? '#6366F1' : '#fff'} />
          </TouchableOpacity>
        </View>
      </View>
      
      {/* Search & Filter Bar */}
      <View style={styles.searchFilterBar}>
        <SearchBar value={searchQuery} onChangeText={setSearchQuery} />
        <TouchableOpacity
          style={[styles.filterBtn, activeFiltersCount > 0 && styles.filterBtnActive]}
          onPress={() => setFilterModalVisible(true)}
        >
          <Ionicons name="options" size={20} color={activeFiltersCount > 0 ? '#6366F1' : '#fff'} />
          {activeFiltersCount > 0 && (
            <View style={styles.filterBadge}>
              <Text style={styles.filterBadgeText}>{activeFiltersCount}</Text>
            </View>
          )}
        </TouchableOpacity>
      </View>
      
      {/* Compare Mode Banner */}
      {compareMode && (
        <LinearGradient
          colors={['#6366F1', '#A855F7']}
          style={styles.compareBanner}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 0 }}
        >
          <View style={styles.compareBannerContent}>
            <Ionicons name="git-compare" size={18} color="#fff" />
            <Text style={styles.compareBannerText}>
              Select {2 - selectedDecks.length} deck{selectedDecks.length === 1 ? '' : 's'} to compare
            </Text>
          </View>
          <TouchableOpacity onPress={toggleCompareMode}>
            <Text style={styles.compareBannerCancel}>Cancel</Text>
          </TouchableOpacity>
        </LinearGradient>
      )}

      {/* Content */}
      {isLoading ? (
        <View style={[styles.container, styles.centerContent]}>
          <ActivityIndicator size="large" color="#6366F1" />
          <Text style={styles.loadingText}>Loading decks...</Text>
        </View>
      ) : (
        <ScrollView
          style={styles.scrollView}
          showsVerticalScrollIndicator={false}
          refreshControl={
            <RefreshControl
              refreshing={isRefreshing}
              onRefresh={handleRefresh}
              tintColor="#6366F1"
              colors={['#6366F1']}
            />
          }
        >
          {/* Stats Bar */}
          <View style={styles.statsBar}>
            <View style={styles.statItem}>
              <Text style={styles.statValue}>{decks?.length || 0}</Text>
              <Text style={styles.statLabel}>Decks</Text>
            </View>
            <View style={styles.statDivider} />
            <View style={styles.statItem}>
              <Text style={styles.statValue}>{decks?.filter(d => d.tier === 1).length || 0}</Text>
              <Text style={styles.statLabel}>Tier 1</Text>
            </View>
            <View style={styles.statDivider} />
            <View style={styles.statItem}>
              <Text style={styles.statValue}>{topDeck?.win_rate?.toFixed(0) || '-'}%</Text>
              <Text style={styles.statLabel}>Top WR</Text>
            </View>
          </View>
          
          {/* Top Deck Spotlight */}
          {topDeck && !compareMode && (
            <View style={styles.spotlightSection}>
              <View style={styles.sectionHeader}>
                <Ionicons name="star" size={18} color="#FFD700" />
                <Text style={styles.sectionTitle}>Top Performing Deck</Text>
              </View>
              <DeckCard 
                deck={topDeck} 
                onPress={() => handleDeckPress(topDeck)}
                isTopDeck
              />
            </View>
          )}
          
          {/* Deck List */}
          <View style={styles.deckListSection}>
            <View style={styles.sectionHeader}>
              <Ionicons name="layers" size={18} color="#6366F1" />
              <Text style={styles.sectionTitle}>
                {compareMode ? 'Select Decks' : 'All Decks'}
              </Text>
            </View>
            
            {(compareMode ? decks : restDecks)?.map((deck) => (
              <DeckCard
                key={deck.id}
                deck={deck}
                onPress={() => handleDeckPress(deck)}
                compareMode={compareMode}
                isSelected={selectedDecks.some(d => d.id === deck.id)}
              />
            ))}
            
            {(!decks || decks.length === 0) && (
              <View style={styles.emptyContainer}>
                <Ionicons name="search" size={48} color="#666" />
                <Text style={styles.emptyText}>No decks found</Text>
                <Text style={styles.emptySubtext}>Try adjusting your filters</Text>
              </View>
            )}
          </View>
          
          <View style={{ height: 40 }} />
        </ScrollView>
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
    backgroundColor: '#0a0a14',
  },
  centerContent: {
    justifyContent: 'center',
    alignItems: 'center',
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingVertical: 16,
  },
  headerLeft: {},
  headerTitle: {
    color: '#fff',
    fontSize: 24,
    fontWeight: 'bold',
  },
  headerSubtitle: {
    color: '#888',
    fontSize: 13,
    marginTop: 2,
  },
  headerRight: {
    flexDirection: 'row',
  },
  headerButton: {
    width: 44,
    height: 44,
    borderRadius: 12,
    backgroundColor: 'rgba(255,255,255,0.1)',
    justifyContent: 'center',
    alignItems: 'center',
    marginLeft: 8,
  },
  headerButtonActive: {
    backgroundColor: 'rgba(99, 102, 241, 0.2)',
    borderWidth: 1,
    borderColor: '#6366F1',
  },
  searchFilterBar: {
    flexDirection: 'row',
    paddingHorizontal: 16,
    paddingBottom: 12,
  },
  searchContainer: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(255,255,255,0.08)',
    borderRadius: 12,
    paddingHorizontal: 14,
    height: 46,
  },
  searchInput: {
    flex: 1,
    color: '#fff',
    fontSize: 15,
    marginLeft: 10,
  },
  filterBtn: {
    width: 46,
    height: 46,
    borderRadius: 12,
    backgroundColor: 'rgba(255,255,255,0.08)',
    justifyContent: 'center',
    alignItems: 'center',
    marginLeft: 10,
  },
  filterBtnActive: {
    backgroundColor: 'rgba(99, 102, 241, 0.2)',
    borderWidth: 1,
    borderColor: '#6366F1',
  },
  filterBadge: {
    position: 'absolute',
    top: -4,
    right: -4,
    backgroundColor: '#6366F1',
    borderRadius: 10,
    minWidth: 18,
    height: 18,
    justifyContent: 'center',
    alignItems: 'center',
  },
  filterBadgeText: {
    color: '#fff',
    fontSize: 11,
    fontWeight: 'bold',
  },
  compareBanner: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  compareBannerContent: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  compareBannerText: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '600',
    marginLeft: 8,
  },
  compareBannerCancel: {
    color: 'rgba(255,255,255,0.8)',
    fontSize: 14,
    fontWeight: '500',
  },
  scrollView: {
    flex: 1,
  },
  statsBar: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: 'rgba(255,255,255,0.05)',
    marginHorizontal: 16,
    marginTop: 8,
    marginBottom: 16,
    borderRadius: 16,
    paddingVertical: 16,
  },
  statItem: {
    alignItems: 'center',
    paddingHorizontal: 24,
  },
  statValue: {
    color: '#fff',
    fontSize: 22,
    fontWeight: 'bold',
  },
  statLabel: {
    color: '#888',
    fontSize: 12,
    marginTop: 4,
  },
  statDivider: {
    width: 1,
    height: 30,
    backgroundColor: 'rgba(255,255,255,0.1)',
  },
  spotlightSection: {
    paddingHorizontal: 16,
    marginBottom: 16,
  },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 12,
  },
  sectionTitle: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
    marginLeft: 8,
  },
  deckListSection: {
    paddingHorizontal: 16,
  },
  deckCardContainer: {
    marginBottom: 12,
  },
  topDeckCardContainer: {
    marginBottom: 0,
  },
  deckCard: {
    backgroundColor: '#14141f',
    borderRadius: 20,
    padding: 18,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
    overflow: 'hidden',
  },
  topDeckCard: {
    padding: 22,
    borderColor: 'rgba(255, 215, 0, 0.3)',
    backgroundColor: 'rgba(255, 215, 0, 0.05)',
  },
  deckCardSelected: {
    borderColor: '#6366F1',
    borderWidth: 2,
    backgroundColor: 'rgba(99, 102, 241, 0.1)',
  },
  deckCardGradient: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    height: 60,
  },
  selectIndicator: {
    position: 'absolute',
    top: 12,
    right: 12,
    width: 26,
    height: 26,
    borderRadius: 13,
    borderWidth: 2,
    borderColor: 'rgba(255,255,255,0.3)',
    justifyContent: 'center',
    alignItems: 'center',
    zIndex: 10,
  },
  selectIndicatorActive: {
    backgroundColor: '#6366F1',
    borderColor: '#6366F1',
  },
  selectIndicatorEmpty: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: 'rgba(255,255,255,0.2)',
  },
  deckCardTop: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: 14,
  },
  manaRow: {
    flexDirection: 'row',
  },
  manaSymbol: {
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 6,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.3,
    shadowRadius: 4,
    elevation: 4,
  },
  manaText: {
    fontWeight: 'bold',
  },
  winRateRingBg: {
    backgroundColor: 'rgba(255,255,255,0.1)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  winRateRingFill: {
    position: 'absolute',
  },
  winRateTextContainer: {
    position: 'absolute',
    flexDirection: 'row',
    alignItems: 'baseline',
  },
  winRateValue: {
    fontWeight: 'bold',
  },
  winRatePercent: {
    color: '#888',
    fontWeight: '500',
  },
  deckCardContent: {
    marginBottom: 14,
  },
  deckCardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 4,
  },
  tierBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 8,
    marginRight: 8,
  },
  tierText: {
    color: '#000',
    fontSize: 11,
    fontWeight: 'bold',
    marginLeft: 3,
  },
  deckName: {
    color: '#fff',
    fontSize: 17,
    fontWeight: 'bold',
    flex: 1,
  },
  topDeckName: {
    fontSize: 20,
  },
  colorName: {
    color: '#888',
    fontSize: 14,
    marginBottom: 10,
  },
  archetypeBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 12,
  },
  archetypeText: {
    color: '#fff',
    fontSize: 12,
    fontWeight: '600',
    marginLeft: 5,
    textTransform: 'capitalize',
  },
  deckCardFooter: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  wildcardPill: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(255,255,255,0.05)',
    borderRadius: 12,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  wildcardItem: {
    flexDirection: 'row',
    alignItems: 'center',
    marginRight: 8,
  },
  wildcardDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    marginRight: 3,
  },
  wildcardCount: {
    color: '#aaa',
    fontSize: 12,
    fontWeight: '600',
  },
  wildcardTotal: {
    backgroundColor: 'rgba(255,255,255,0.1)',
    borderRadius: 8,
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  wildcardTotalText: {
    color: '#fff',
    fontSize: 11,
    fontWeight: 'bold',
  },
  sourceTag: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  sourceText: {
    color: '#666',
    fontSize: 12,
    marginLeft: 4,
    textTransform: 'capitalize',
  },
  loadingText: {
    color: '#888',
    marginTop: 12,
    fontSize: 14,
  },
  errorTitle: {
    color: '#fff',
    fontSize: 20,
    fontWeight: 'bold',
    marginTop: 16,
  },
  errorText: {
    color: '#888',
    marginTop: 8,
    fontSize: 14,
  },
  retryButton: {
    marginTop: 20,
    borderRadius: 12,
    overflow: 'hidden',
  },
  retryButtonGradient: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 24,
    paddingVertical: 14,
  },
  retryButtonText: {
    color: '#fff',
    fontWeight: 'bold',
    marginLeft: 8,
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
    backgroundColor: 'rgba(0, 0, 0, 0.8)',
    justifyContent: 'flex-end',
  },
  modalContent: {
    backgroundColor: '#14141f',
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    maxHeight: '85%',
  },
  comparisonModalContent: {
    backgroundColor: '#14141f',
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    maxHeight: '90%',
  },
  modalHandle: {
    width: 40,
    height: 4,
    backgroundColor: 'rgba(255,255,255,0.2)',
    borderRadius: 2,
    alignSelf: 'center',
    marginTop: 12,
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 20,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255,255,255,0.08)',
  },
  modalTitle: {
    color: '#fff',
    fontSize: 22,
    fontWeight: 'bold',
  },
  modalCloseBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: 'rgba(255,255,255,0.1)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  modalBody: {
    padding: 20,
  },
  filterLabel: {
    color: '#fff',
    fontSize: 15,
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
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(255,255,255,0.08)',
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 20,
    marginRight: 8,
    marginBottom: 8,
  },
  filterChipSelected: {
    backgroundColor: '#6366F1',
  },
  filterChipText: {
    color: '#888',
    fontSize: 13,
    fontWeight: '500',
  },
  filterChipTextSelected: {
    color: '#fff',
    fontWeight: '600',
  },
  modalFooter: {
    flexDirection: 'row',
    padding: 20,
    borderTopWidth: 1,
    borderTopColor: 'rgba(255,255,255,0.08)',
  },
  resetButton: {
    flex: 1,
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: 'rgba(255,255,255,0.08)',
    paddingVertical: 14,
    borderRadius: 12,
    marginRight: 10,
  },
  resetButtonText: {
    color: '#fff',
    fontWeight: '600',
    marginLeft: 6,
  },
  applyButton: {
    flex: 2,
    borderRadius: 12,
    overflow: 'hidden',
  },
  applyButtonGradient: {
    paddingVertical: 14,
    alignItems: 'center',
  },
  applyButtonText: {
    color: '#fff',
    fontWeight: 'bold',
    fontSize: 15,
  },
  // Comparison Modal
  comparisonLoading: {
    padding: 40,
    alignItems: 'center',
  },
  comparisonBody: {
    padding: 20,
  },
  vsContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 24,
  },
  vsDeck: {
    flex: 1,
    alignItems: 'center',
  },
  vsManaRow: {
    flexDirection: 'row',
    marginBottom: 8,
  },
  vsDeckName: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '600',
    textAlign: 'center',
    marginBottom: 4,
  },
  vsWinRate: {
    color: '#888',
    fontSize: 13,
  },
  vsBadgeContainer: {
    marginHorizontal: 12,
  },
  vsBadge: {
    width: 44,
    height: 44,
    borderRadius: 22,
    justifyContent: 'center',
    alignItems: 'center',
  },
  vsText: {
    color: '#fff',
    fontWeight: 'bold',
    fontSize: 14,
  },
  h2hContainer: {
    marginBottom: 24,
  },
  h2hLabel: {
    color: '#fff',
    fontSize: 15,
    fontWeight: '600',
    marginBottom: 12,
    textAlign: 'center',
  },
  h2hBarContainer: {
    flexDirection: 'row',
    height: 28,
    borderRadius: 14,
    overflow: 'hidden',
    backgroundColor: '#1a1a2e',
  },
  h2hBar: {
    height: '100%',
    borderRadius: 14,
  },
  h2hBarBg: {
    height: '100%',
    backgroundColor: 'rgba(244, 67, 54, 0.5)',
  },
  h2hLabels: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 8,
  },
  h2hPercent: {
    color: '#fff',
    fontSize: 16,
    fontWeight: 'bold',
  },
  verdictCard: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 18,
    borderRadius: 16,
    marginBottom: 16,
  },
  verdictText: {
    color: '#fff',
    fontSize: 18,
    fontWeight: 'bold',
    marginLeft: 10,
  },
  analysisCard: {
    flexDirection: 'row',
    backgroundColor: 'rgba(99, 102, 241, 0.1)',
    borderRadius: 12,
    padding: 16,
    borderWidth: 1,
    borderColor: 'rgba(99, 102, 241, 0.2)',
  },
  analysisText: {
    color: '#ccc',
    fontSize: 14,
    lineHeight: 20,
    marginLeft: 12,
    flex: 1,
  },
  closeCompareButton: {
    backgroundColor: 'rgba(255,255,255,0.08)',
    margin: 20,
    padding: 16,
    borderRadius: 12,
    alignItems: 'center',
  },
  closeCompareText: {
    color: '#fff',
    fontSize: 15,
    fontWeight: '600',
  },
});

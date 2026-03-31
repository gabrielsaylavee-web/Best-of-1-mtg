import React, { useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  Switch,
  TouchableOpacity,
  ActivityIndicator,
  Alert,
  Platform,
} from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import * as Notifications from 'expo-notifications';
import * as Device from 'expo-device';
import axios from 'axios';

const API_URL = process.env.EXPO_PUBLIC_BACKEND_URL || '';

// Types
interface NotificationPreferences {
  user_id: string;
  push_token: string | null;
  enabled: boolean;
  meta_changes: boolean;
  new_decks: boolean;
  favorite_archetypes: string[];
  min_win_rate: number;
}

interface MetaAlert {
  id: string;
  alert_type: string;
  deck_id: string;
  deck_name: string;
  message: string;
  details: Record<string, any>;
  created_at: string;
  read: boolean;
}

// Generate or get user ID (in production, use proper auth)
const getUserId = (): string => {
  // For demo, use device-based ID or random
  return 'user_' + (Device.modelName || 'web').replace(/\s/g, '_').toLowerCase();
};

// Register for push notifications
async function registerForPushNotifications(): Promise<string | null> {
  if (!Device.isDevice) {
    console.log('Push notifications require a physical device');
    return null;
  }

  try {
    const { status: existingStatus } = await Notifications.getPermissionsAsync();
    let finalStatus = existingStatus;

    if (existingStatus !== 'granted') {
      const { status } = await Notifications.requestPermissionsAsync();
      finalStatus = status;
    }

    if (finalStatus !== 'granted') {
      Alert.alert('Permission Required', 'Push notifications are disabled. Enable them in settings.');
      return null;
    }

    const token = await Notifications.getExpoPushTokenAsync();
    return token.data;
  } catch (error) {
    console.error('Error getting push token:', error);
    return null;
  }
}

// API functions
const fetchPreferences = async (userId: string): Promise<NotificationPreferences> => {
  const response = await axios.get(`${API_URL}/api/notifications/preferences/${userId}`);
  return response.data;
};

const updatePreferences = async (userId: string, prefs: Partial<NotificationPreferences>): Promise<void> => {
  await axios.put(`${API_URL}/api/notifications/preferences/${userId}`, prefs);
};

const registerNotifications = async (prefs: NotificationPreferences): Promise<void> => {
  await axios.post(`${API_URL}/api/notifications/register`, prefs);
};

const fetchAlerts = async (userId: string): Promise<MetaAlert[]> => {
  const response = await axios.get(`${API_URL}/api/notifications/alerts/${userId}`);
  return response.data;
};

const markAlertRead = async (alertId: string): Promise<void> => {
  await axios.post(`${API_URL}/api/notifications/alerts/${alertId}/read`);
};

const ARCHETYPES = ['aggro', 'control', 'midrange', 'combo', 'tempo'];

export default function NotificationsScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [userId] = useState(getUserId);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [preferences, setPreferences] = useState<NotificationPreferences>({
    user_id: userId,
    push_token: null,
    enabled: true,
    meta_changes: true,
    new_decks: true,
    favorite_archetypes: [],
    min_win_rate: 55,
  });
  const [alerts, setAlerts] = useState<MetaAlert[]>([]);
  const [alertsLoading, setAlertsLoading] = useState(false);

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    setLoading(true);
    try {
      const prefs = await fetchPreferences(userId);
      setPreferences(prefs);
      
      setAlertsLoading(true);
      const alertsData = await fetchAlerts(userId);
      setAlerts(alertsData);
    } catch (error) {
      console.error('Error loading preferences:', error);
    } finally {
      setLoading(false);
      setAlertsLoading(false);
    }
  };

  const handleToggleEnabled = async (value: boolean) => {
    setPreferences({ ...preferences, enabled: value });
    
    if (value) {
      // Register for push notifications when enabling
      const token = await registerForPushNotifications();
      const newPrefs = { ...preferences, enabled: value, push_token: token };
      setPreferences(newPrefs);
      await savePreferences(newPrefs);
    } else {
      await savePreferences({ ...preferences, enabled: value });
    }
  };

  const handleToggleMetaChanges = async (value: boolean) => {
    const newPrefs = { ...preferences, meta_changes: value };
    setPreferences(newPrefs);
    await savePreferences(newPrefs);
  };

  const handleToggleNewDecks = async (value: boolean) => {
    const newPrefs = { ...preferences, new_decks: value };
    setPreferences(newPrefs);
    await savePreferences(newPrefs);
  };

  const handleToggleArchetype = async (archetype: string) => {
    const current = preferences.favorite_archetypes;
    let updated: string[];
    
    if (current.includes(archetype)) {
      updated = current.filter(a => a !== archetype);
    } else {
      updated = [...current, archetype];
    }
    
    const newPrefs = { ...preferences, favorite_archetypes: updated };
    setPreferences(newPrefs);
    await savePreferences(newPrefs);
  };

  const handleMinWinRateChange = async (change: number) => {
    const newRate = Math.min(Math.max(preferences.min_win_rate + change, 40), 70);
    const newPrefs = { ...preferences, min_win_rate: newRate };
    setPreferences(newPrefs);
    await savePreferences(newPrefs);
  };

  const savePreferences = async (prefs: NotificationPreferences) => {
    setSaving(true);
    try {
      await updatePreferences(userId, prefs);
    } catch (error) {
      console.error('Error saving preferences:', error);
      Alert.alert('Error', 'Failed to save preferences');
    } finally {
      setSaving(false);
    }
  };

  const handleMarkRead = async (alertId: string) => {
    try {
      await markAlertRead(alertId);
      setAlerts(alerts.map(a => a.id === alertId ? { ...a, read: true } : a));
    } catch (error) {
      console.error('Error marking alert read:', error);
    }
  };

  const getAlertIcon = (type: string) => {
    switch (type) {
      case 'new_deck': return 'add-circle';
      case 'win_rate_change': return 'trending-up';
      case 'tier_change': return 'arrow-up-circle';
      default: return 'notifications';
    }
  };

  const getAlertColor = (type: string) => {
    switch (type) {
      case 'new_deck': return '#4CAF50';
      case 'win_rate_change': return '#FFC107';
      case 'tier_change': return '#6366F1';
      default: return '#888';
    }
  };

  if (loading) {
    return (
      <View style={[styles.container, styles.centerContent]}>
        <ActivityIndicator size="large" color="#6366F1" />
        <Text style={styles.loadingText}>Loading settings...</Text>
      </View>
    );
  }

  const unreadCount = alerts.filter(a => !a.read).length;

  return (
    <View style={[styles.container, { paddingBottom: insets.bottom }]}>
      <ScrollView style={styles.scrollView} showsVerticalScrollIndicator={false}>
        {/* Header */}
        <View style={styles.header}>
          <TouchableOpacity onPress={() => router.back()} style={styles.backButton}>
            <Ionicons name="arrow-back" size={24} color="#fff" />
          </TouchableOpacity>
          <Text style={styles.headerTitle}>Notifications</Text>
          {saving && <ActivityIndicator size="small" color="#6366F1" />}
        </View>

        {/* Main Toggle */}
        <View style={styles.section}>
          <View style={styles.settingRow}>
            <View style={styles.settingInfo}>
              <Ionicons name="notifications" size={24} color="#6366F1" />
              <View style={styles.settingText}>
                <Text style={styles.settingLabel}>Push Notifications</Text>
                <Text style={styles.settingDescription}>
                  Get notified about meta changes
                </Text>
              </View>
            </View>
            <Switch
              value={preferences.enabled}
              onValueChange={handleToggleEnabled}
              trackColor={{ false: '#2a2a40', true: '#6366F1' }}
              thumbColor="#fff"
            />
          </View>
        </View>

        {/* Notification Types */}
        {preferences.enabled && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Notification Types</Text>
            
            <View style={styles.settingRow}>
              <View style={styles.settingInfo}>
                <Ionicons name="trending-up" size={22} color="#FFC107" />
                <View style={styles.settingText}>
                  <Text style={styles.settingLabel}>Win Rate Changes</Text>
                  <Text style={styles.settingDescription}>
                    Alert when decks gain or lose &gt;3% WR
                  </Text>
                </View>
              </View>
              <Switch
                value={preferences.meta_changes}
                onValueChange={handleToggleMetaChanges}
                trackColor={{ false: '#2a2a40', true: '#6366F1' }}
                thumbColor="#fff"
              />
            </View>

            <View style={styles.settingRow}>
              <View style={styles.settingInfo}>
                <Ionicons name="add-circle" size={22} color="#4CAF50" />
                <View style={styles.settingText}>
                  <Text style={styles.settingLabel}>New Top Decks</Text>
                  <Text style={styles.settingDescription}>
                    Alert when new Tier 1 decks emerge
                  </Text>
                </View>
              </View>
              <Switch
                value={preferences.new_decks}
                onValueChange={handleToggleNewDecks}
                trackColor={{ false: '#2a2a40', true: '#6366F1' }}
                thumbColor="#fff"
              />
            </View>
          </View>
        )}

        {/* Archetype Filter */}
        {preferences.enabled && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Favorite Archetypes</Text>
            <Text style={styles.sectionSubtitle}>
              Only get alerts for selected archetypes (leave empty for all)
            </Text>
            <View style={styles.archetypeGrid}>
              {ARCHETYPES.map(archetype => (
                <TouchableOpacity
                  key={archetype}
                  style={[
                    styles.archetypeChip,
                    preferences.favorite_archetypes.includes(archetype) && styles.archetypeChipSelected
                  ]}
                  onPress={() => handleToggleArchetype(archetype)}
                >
                  <Text style={[
                    styles.archetypeText,
                    preferences.favorite_archetypes.includes(archetype) && styles.archetypeTextSelected
                  ]}>
                    {archetype.charAt(0).toUpperCase() + archetype.slice(1)}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
          </View>
        )}

        {/* Min Win Rate */}
        {preferences.enabled && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Minimum Win Rate</Text>
            <Text style={styles.sectionSubtitle}>
              Only alert for decks with at least this win rate
            </Text>
            <View style={styles.winRateControl}>
              <TouchableOpacity
                style={styles.winRateButton}
                onPress={() => handleMinWinRateChange(-5)}
              >
                <Ionicons name="remove" size={24} color="#fff" />
              </TouchableOpacity>
              <View style={styles.winRateDisplay}>
                <Text style={styles.winRateValue}>{preferences.min_win_rate}%</Text>
              </View>
              <TouchableOpacity
                style={styles.winRateButton}
                onPress={() => handleMinWinRateChange(5)}
              >
                <Ionicons name="add" size={24} color="#fff" />
              </TouchableOpacity>
            </View>
          </View>
        )}

        {/* Recent Alerts */}
        <View style={styles.section}>
          <View style={styles.alertsHeader}>
            <Text style={styles.sectionTitle}>Recent Alerts</Text>
            {unreadCount > 0 && (
              <View style={styles.unreadBadge}>
                <Text style={styles.unreadText}>{unreadCount} new</Text>
              </View>
            )}
          </View>

          {alertsLoading ? (
            <ActivityIndicator size="small" color="#6366F1" />
          ) : alerts.length > 0 ? (
            alerts.slice(0, 10).map((alert, index) => (
              <TouchableOpacity
                key={alert.id}
                style={[styles.alertCard, !alert.read && styles.alertCardUnread]}
                onPress={() => {
                  handleMarkRead(alert.id);
                  router.push(`/deck/${alert.deck_id}`);
                }}
              >
                <View style={[styles.alertIcon, { backgroundColor: getAlertColor(alert.alert_type) }]}>
                  <Ionicons name={getAlertIcon(alert.alert_type) as any} size={18} color="#fff" />
                </View>
                <View style={styles.alertContent}>
                  <Text style={styles.alertMessage}>{alert.message}</Text>
                  <Text style={styles.alertTime}>
                    {new Date(alert.created_at).toLocaleDateString()}
                  </Text>
                </View>
                {!alert.read && <View style={styles.unreadDot} />}
              </TouchableOpacity>
            ))
          ) : (
            <View style={styles.emptyAlerts}>
              <Ionicons name="notifications-off-outline" size={40} color="#666" />
              <Text style={styles.emptyText}>No alerts yet</Text>
              <Text style={styles.emptySubtext}>
                You'll see meta changes here when they happen
              </Text>
            </View>
          )}
        </View>

        <View style={{ height: 40 }} />
      </ScrollView>
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
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#2a2a40',
  },
  backButton: {
    marginRight: 16,
  },
  headerTitle: {
    color: '#fff',
    fontSize: 20,
    fontWeight: 'bold',
    flex: 1,
  },
  section: {
    backgroundColor: '#1a1a2e',
    marginHorizontal: 16,
    marginTop: 16,
    borderRadius: 12,
    padding: 16,
    borderWidth: 1,
    borderColor: '#2a2a40',
  },
  sectionTitle: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
    marginBottom: 8,
  },
  sectionSubtitle: {
    color: '#888',
    fontSize: 13,
    marginBottom: 12,
  },
  settingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#2a2a40',
  },
  settingInfo: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
  },
  settingText: {
    marginLeft: 12,
    flex: 1,
  },
  settingLabel: {
    color: '#fff',
    fontSize: 15,
    fontWeight: '500',
  },
  settingDescription: {
    color: '#888',
    fontSize: 12,
    marginTop: 2,
  },
  archetypeGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
  },
  archetypeChip: {
    backgroundColor: '#2a2a40',
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 20,
    marginRight: 8,
    marginBottom: 8,
  },
  archetypeChipSelected: {
    backgroundColor: '#6366F1',
  },
  archetypeText: {
    color: '#888',
    fontSize: 14,
  },
  archetypeTextSelected: {
    color: '#fff',
    fontWeight: '600',
  },
  winRateControl: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 8,
  },
  winRateButton: {
    backgroundColor: '#2a2a40',
    width: 44,
    height: 44,
    borderRadius: 22,
    justifyContent: 'center',
    alignItems: 'center',
  },
  winRateDisplay: {
    backgroundColor: '#0f0f1a',
    paddingHorizontal: 32,
    paddingVertical: 12,
    borderRadius: 8,
    marginHorizontal: 16,
  },
  winRateValue: {
    color: '#6366F1',
    fontSize: 24,
    fontWeight: 'bold',
  },
  alertsHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 12,
  },
  unreadBadge: {
    backgroundColor: '#6366F1',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 12,
  },
  unreadText: {
    color: '#fff',
    fontSize: 12,
    fontWeight: '600',
  },
  alertCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#0f0f1a',
    borderRadius: 8,
    padding: 12,
    marginBottom: 8,
  },
  alertCardUnread: {
    borderLeftWidth: 3,
    borderLeftColor: '#6366F1',
  },
  alertIcon: {
    width: 36,
    height: 36,
    borderRadius: 18,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 12,
  },
  alertContent: {
    flex: 1,
  },
  alertMessage: {
    color: '#fff',
    fontSize: 14,
  },
  alertTime: {
    color: '#666',
    fontSize: 12,
    marginTop: 4,
  },
  unreadDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: '#6366F1',
    marginLeft: 8,
  },
  emptyAlerts: {
    alignItems: 'center',
    paddingVertical: 24,
  },
  emptyText: {
    color: '#888',
    fontSize: 14,
    marginTop: 8,
  },
  emptySubtext: {
    color: '#666',
    fontSize: 12,
    marginTop: 4,
    textAlign: 'center',
  },
  loadingText: {
    color: '#888',
    marginTop: 12,
  },
});

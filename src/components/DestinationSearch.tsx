import { ActivityIndicator, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import type { Place } from '../routing/routeTypes';
import { MIN_QUERY_LENGTH } from '../search/photonClient';
import type { PlaceSearchState } from '../search/usePlaceSearch';
import { MIN_TOUCH_TARGET, useTheme } from '../theme/theme';

interface Props {
  search: PlaceSearchState;
  onPick: (place: Place) => void;
}

/** Destination search with large rows (>= 56dp) so it can be used at a red light. */
export function DestinationSearch({ search, onPick }: Props) {
  const theme = useTheme();
  const { query, setQuery, places, loading, error, mock, settled, reset } = search;
  const hasQuery = query.trim().length >= MIN_QUERY_LENGTH;
  const showPanel = hasQuery && (loading || settled);

  return (
    <View style={styles.wrap}>
      <View style={[styles.inputRow, { backgroundColor: theme.surface, borderColor: theme.border }]}>
        <TextInput
          value={query}
          onChangeText={setQuery}
          placeholder="Where to?"
          placeholderTextColor={theme.textMuted}
          style={[styles.input, { color: theme.text }]}
          autoCorrect={false}
          autoCapitalize="none"
          returnKeyType="search"
          accessibilityLabel="Search destination"
          maxLength={120}
        />
        {loading ? <ActivityIndicator color={theme.accent} style={styles.spinner} /> : null}
        {query.length > 0 ? (
          <Pressable accessibilityRole="button" accessibilityLabel="Clear search" onPress={reset} style={styles.clear}>
            <Text style={[styles.clearText, { color: theme.text }]}>✕</Text>
          </Pressable>
        ) : null}
      </View>

      {showPanel ? (
        <View style={[styles.panel, { backgroundColor: theme.surface, borderColor: theme.border }]}>
          {mock && places.length > 0 ? (
            <Text style={[styles.note, { color: theme.textMuted }]}>Sample places (search server not set up)</Text>
          ) : null}
          {error ? <Text style={[styles.message, { color: theme.danger }]}>{error}</Text> : null}
          {!error && settled && places.length === 0 ? (
            <Text style={[styles.message, { color: theme.textMuted }]}>No matches. Try another name.</Text>
          ) : null}
          {places.map((place) => (
            <Pressable
              key={place.id}
              accessibilityRole="button"
              accessibilityLabel={`${place.name}. ${place.subtitle}`}
              accessibilityHint="Plans routes to this place"
              onPress={() => onPick(place)}
              style={({ pressed }) => [styles.row, { borderTopColor: theme.border, opacity: pressed ? 0.7 : 1 }]}
            >
              <Text style={[styles.name, { color: theme.text }]} numberOfLines={1}>
                {place.name}
              </Text>
              {place.subtitle ? (
                <Text style={[styles.subtitle, { color: theme.textMuted }]} numberOfLines={1}>
                  {place.subtitle}
                </Text>
              ) : null}
            </Pressable>
          ))}
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { alignSelf: 'stretch', gap: 6 },
  inputRow: { flexDirection: 'row', alignItems: 'center', borderWidth: 2, borderRadius: 14, minHeight: 56, paddingLeft: 14 },
  input: { flex: 1, fontSize: 18, fontWeight: '600', minHeight: 52 },
  spinner: { marginRight: 4 },
  clear: { minWidth: MIN_TOUCH_TARGET, minHeight: MIN_TOUCH_TARGET, alignItems: 'center', justifyContent: 'center' },
  clearText: { fontSize: 20, fontWeight: '700' },
  panel: { borderWidth: 2, borderRadius: 14, overflow: 'hidden' },
  note: { fontSize: 13, fontWeight: '600', paddingHorizontal: 14, paddingTop: 8 },
  message: { fontSize: 16, fontWeight: '600', padding: 14 },
  row: { minHeight: 56, justifyContent: 'center', paddingHorizontal: 14, paddingVertical: 8, borderTopWidth: 1 },
  name: { fontSize: 17, fontWeight: '700' },
  subtitle: { fontSize: 14, marginTop: 2 },
});

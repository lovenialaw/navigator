import { StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import type { HudModel } from '../navigation/guidance';
import { LANE_ROTATION } from '../navigation/maneuverIcon';
import { ROAD_SIGN_COLORS } from '../navigation/roadSign';
import type { Lane } from '../routing/routeTypes';
import { MIN_TOUCH_TARGET, useTheme } from '../theme/theme';
import { BigButton } from './BigButton';

/** Active lane colour and the dimmed colour for lanes the driver should avoid. */
export const LANE_ACTIVE_COLOR = '#00E5FF';
const LANE_INACTIVE_COLOR = '#7C8A99';

interface Props {
  hud: HudModel;
  /** "Re-routing…" or an offline notice. */
  notice: string | null;
  /** True while position is being estimated because GPS has dropped out. */
  gpsLost: boolean;
  onEndRoute: () => void;
}

/**
 * Turn-by-turn overlay built for a 2-second glance: a big Malaysian road-sign banner
 * (green for expressways, blue for federal and municipal roads), a lane row when the
 * data has lanes, and a compact bottom bar with an oversized End Route button.
 */
export function NavigationHUD({ hud, notice, gpsLost, onEndRoute }: Props) {
  const insets = useSafeAreaInsets();
  const theme = useTheme();
  const { banner, lanes, bottom } = hud;
  const signColor = ROAD_SIGN_COLORS[banner.kind];

  const bannerLabel = hud.arrived
    ? banner.primary
    : `${banner.distanceText}. ${banner.exitLabel ? `${banner.exitLabel}. ` : ''}${banner.primary}`;

  return (
    <>
      <View pointerEvents="box-none" style={[styles.top, { paddingTop: insets.top + 8 }]}>
        <View
          accessible
          accessibilityRole="header"
          accessibilityLiveRegion="polite"
          accessibilityLabel={bannerLabel}
          style={[styles.banner, { backgroundColor: signColor }]}
        >
          <View style={styles.iconBox}>
            <Text style={[styles.glyph, { transform: [{ rotate: `${banner.rotationDeg}deg` }] }]}>{banner.glyph}</Text>
          </View>

          <View style={styles.bannerText}>
            {banner.distanceText ? <Text style={styles.distance}>{banner.distanceText}</Text> : null}
            <View style={styles.streetRow}>
              {banner.badges.map((badge) => (
                <View key={badge} style={styles.refBadge}>
                  <Text style={styles.refBadgeText}>{badge}</Text>
                </View>
              ))}
              <Text style={styles.street} numberOfLines={2}>
                {banner.primary}
              </Text>
            </View>
            {banner.toward ? (
              <Text style={styles.toward} numberOfLines={1}>
                {banner.toward}
              </Text>
            ) : null}
          </View>

          {banner.exitLabel ? (
            <View style={styles.exitBadge}>
              <Text style={styles.exitBadgeText}>{banner.exitLabel}</Text>
            </View>
          ) : null}
        </View>

        {lanes.length > 0 ? <LaneRow lanes={lanes} /> : null}

        {notice || gpsLost ? (
          <View style={[styles.notice, { backgroundColor: theme.surface, borderColor: theme.warning }]}>
            <Text style={[styles.noticeText, { color: theme.warning }]}>
              {notice ?? 'GPS signal lost. Estimating your position on the saved route.'}
            </Text>
          </View>
        ) : null}
      </View>

      <View
        style={[
          styles.bottom,
          { backgroundColor: theme.surface, borderColor: theme.border, paddingBottom: insets.bottom + 10 },
        ]}
      >
        <View style={styles.stats}>
          <Stat label="ETA" value={bottom.arrivalText} sub={bottom.remainingDurationText} />
          <Stat label="Left" value={bottom.remainingDistanceText} />
          <Stat
            label="Tolls"
            value={bottom.hasTollAhead ? bottom.tollText.replace(' tolls ahead', '') : 'None'}
            tint={bottom.hasTollAhead ? theme.warning : theme.success}
          />
        </View>
        <BigButton
          label="End Route"
          variant="danger"
          onPress={onEndRoute}
          accessibilityHint="Stops navigation and clears the route"
          style={styles.endButton}
        />
      </View>
    </>
  );
}

function Stat({ label, value, sub, tint }: { label: string; value: string; sub?: string; tint?: string }) {
  const theme = useTheme();
  return (
    <View style={styles.stat} accessible accessibilityLabel={`${label} ${value}${sub ? `, ${sub}` : ''}`}>
      <Text style={[styles.statLabel, { color: theme.textMuted }]}>{label}</Text>
      <Text style={[styles.statValue, { color: tint ?? theme.text }]} numberOfLines={1} adjustsFontSizeToFit>
        {value}
      </Text>
      {sub ? <Text style={[styles.statSub, { color: theme.textMuted }]}>{sub}</Text> : null}
    </View>
  );
}

function describeLane(lane: Lane): string {
  return `${lane.directions.map((d) => d.replace('_', ' ')).join(' and ')}${lane.active ? ', use this lane' : ''}`;
}

/** One cell per lane, arrows for every direction it allows. Active lanes glow cyan, others dim. */
function LaneRow({ lanes }: { lanes: readonly Lane[] }) {
  return (
    <View
      accessible
      accessibilityLabel={`Lane guidance. ${lanes.map((lane, i) => `Lane ${i + 1}, ${describeLane(lane)}`).join('. ')}`}
      style={styles.laneRow}
    >
      {lanes.map((lane, index) => {
        const color = lane.active ? LANE_ACTIVE_COLOR : LANE_INACTIVE_COLOR;
        return (
          <View
            // Lanes have no ids; position is their identity.
            // eslint-disable-next-line react/no-array-index-key
            key={index}
            style={[
              styles.lane,
              {
                borderColor: color,
                backgroundColor: lane.active ? 'rgba(0, 229, 255, 0.16)' : 'rgba(255, 255, 255, 0.04)',
                opacity: lane.active ? 1 : 0.5,
              },
            ]}
          >
            <View style={styles.laneArrows}>
              {lane.directions.map((direction) => (
                <Text
                  key={direction}
                  style={[styles.laneArrow, { color, transform: [{ rotate: `${LANE_ROTATION[direction]}deg` }] }]}
                >
                  ↑
                </Text>
              ))}
            </View>
          </View>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  top: { position: 'absolute', top: 0, left: 0, right: 0, paddingHorizontal: 10, gap: 8 },
  banner: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 16,
    borderWidth: 3,
    borderColor: '#FFFFFF',
    paddingVertical: 10,
    paddingHorizontal: 12,
    gap: 12,
    minHeight: 96,
  },
  iconBox: { width: 64, height: 64, alignItems: 'center', justifyContent: 'center' },
  glyph: { color: '#FFFFFF', fontSize: 56, fontWeight: '900', lineHeight: 64 },
  bannerText: { flex: 1, gap: 2 },
  distance: { color: '#FFFFFF', fontSize: 38, fontWeight: '900', lineHeight: 42 },
  streetRow: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 8 },
  street: { color: '#FFFFFF', fontSize: 22, fontWeight: '800', flexShrink: 1 },
  toward: { color: '#E6F2EA', fontSize: 15, fontWeight: '600' },
  refBadge: { borderWidth: 2, borderColor: '#FFFFFF', borderRadius: 6, paddingHorizontal: 6, paddingVertical: 1 },
  refBadgeText: { color: '#FFFFFF', fontSize: 16, fontWeight: '900' },
  exitBadge: {
    alignSelf: 'flex-start',
    backgroundColor: '#FFFFFF',
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  exitBadgeText: { color: '#000000', fontSize: 18, fontWeight: '900' },
  laneRow: {
    flexDirection: 'row',
    alignSelf: 'center',
    gap: 6,
    backgroundColor: 'rgba(11, 15, 20, 0.92)',
    borderRadius: 14,
    padding: 8,
  },
  lane: {
    minWidth: MIN_TOUCH_TARGET,
    height: 56,
    paddingHorizontal: 6,
    borderWidth: 2,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  laneArrows: { flexDirection: 'row', alignItems: 'center', gap: 2 },
  laneArrow: { fontSize: 30, fontWeight: '900', lineHeight: 34 },
  notice: { borderWidth: 2, borderRadius: 12, paddingVertical: 8, paddingHorizontal: 12, alignSelf: 'stretch' },
  noticeText: { fontSize: 15, fontWeight: '700' },
  bottom: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingTop: 10,
    paddingHorizontal: 12,
    borderTopWidth: 2,
    borderTopLeftRadius: 18,
    borderTopRightRadius: 18,
  },
  stats: { flex: 1, flexDirection: 'row', gap: 8 },
  stat: { flex: 1, minWidth: 0 },
  statLabel: { fontSize: 12, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.5 },
  statValue: { fontSize: 22, fontWeight: '900' },
  statSub: { fontSize: 13, fontWeight: '600' },
  endButton: { minWidth: 112, minHeight: 64 },
});

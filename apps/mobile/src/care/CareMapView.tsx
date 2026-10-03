import { Camera, Map, Marker } from '@maplibre/maplibre-react-native';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ActivityIndicator, StyleSheet, useWindowDimensions, View } from 'react-native';

import { AppText } from '@/components/AppText';
import { Button } from '@/components/Button';
import { useTheme } from '@/theme';

import type { Coordinates, NearbyClinic } from './clinics';
import type { NearbyDoctor } from './nearbyDoctors';

// OpenFreeMap needs no key; commercial use is allowed and the attribution stays on (ADR 0054 §2).
// Liberty in both themes: the dark style's labels and roads were too faint to read (ADR 0054, 2026-10-02).
// https://openfreemap.org/quick_start/
const MAP_STYLE = 'https://tiles.openfreemap.org/styles/liberty';
const START_ZOOM = 11;
const PIN_SIZE = 30;
const MAP_MAX_HEIGHT = 280;
// On a 360x640 dp phone this leaves the list, the ZIP field and the doctor button within reach.
const MAP_WINDOW_SHARE = 0.3;

type PinProps = { shape: 'clinic' | 'doctor' | 'you' };

// Clinic: filled teal disc with a cross. Doctor: blue ring with a dot. You: small ringed dot.
function Pin({ shape }: PinProps) {
  const { colors } = useTheme();
  if (shape === 'you') {
    return (
      <View
        style={{
          width: 18,
          height: 18,
          borderRadius: 9,
          backgroundColor: colors.text,
          borderWidth: 4,
          borderColor: colors.accentFill,
        }}
      />
    );
  }
  if (shape === 'doctor') {
    return (
      <View
        style={[
          styles.pin,
          { backgroundColor: colors.surface, borderColor: colors.badgePublicFg, borderWidth: 3 },
        ]}
      >
        <View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: colors.badgePublicFg }} />
      </View>
    );
  }
  return (
    <View
      style={[
        styles.pin,
        { backgroundColor: colors.accentFill, borderColor: colors.surface, borderWidth: 2 },
      ]}
    >
      <View style={{ width: 14, height: 4, borderRadius: 2, backgroundColor: colors.onAccentFill }} />
      <View
        style={{
          position: 'absolute',
          width: 4,
          height: 14,
          borderRadius: 2,
          backgroundColor: colors.onAccentFill,
        }}
      />
    </View>
  );
}

type LegendEntry = { shape: 'clinic' | 'doctor' | 'you'; label: string };

// Sits top-left so it never covers the attribution control at the bottom right.
function MapLegend({ entries }: { entries: readonly LegendEntry[] }) {
  const { colors, radius, spacing } = useTheme();
  return (
    <View
      testID="care-map-legend"
      style={{
        position: 'absolute',
        top: spacing.sm,
        left: spacing.sm,
        maxWidth: '70%',
        gap: spacing.xs,
        padding: spacing.sm,
        borderRadius: radius.card,
        borderWidth: 1,
        borderColor: colors.line2,
        backgroundColor: colors.surface,
      }}
    >
      {entries.map(({ shape, label }) => (
        <View key={shape} style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm }}>
          <Pin shape={shape} />
          <AppText variant="caption" style={{ flexShrink: 1 }}>
            {label}
          </AppText>
        </View>
      ))}
    </View>
  );
}

type CareMapViewProps = {
  centre: Coordinates;
  // Where the person is, when the location was allowed; a ZIP search shows no "you" dot.
  you: Coordinates | null;
  clinics: readonly NearbyClinic[];
  doctors: readonly NearbyDoctor[];
  selectedId: string | null;
  // Folds the map away (it stays mounted) so the ZIP field stays above the keyboard on small phones.
  collapsed: boolean;
  onSelectClinic: (id: string) => void;
  onClearSelection: () => void;
};

// The style is the same in both themes, so it is never swapped on a live map (a crash on some Android
// devices, maplibre-react-native #1647). Retry remounts the map instead.
export function CareMapView({
  centre,
  you,
  clinics,
  doctors,
  selectedId,
  collapsed,
  onSelectClinic,
  onClearSelection,
}: CareMapViewProps) {
  const { t } = useTranslation();
  const { radius, colors, spacing } = useTheme();
  const [attempt, setAttempt] = useState(0);
  const [loadState, setLoadState] = useState<'loading' | 'ready' | 'failed'>('loading');
  const { height: windowHeight } = useWindowDimensions();
  const mapHeight = Math.min(MAP_MAX_HEIGHT, Math.round(windowHeight * MAP_WINDOW_SHARE));
  const legend: LegendEntry[] = [
    { shape: 'clinic', label: t('careMap.legendClinic') },
    ...(doctors.length > 0 ? [{ shape: 'doctor' as const, label: t('careMap.legendDoctor') }] : []),
    ...(you ? [{ shape: 'you' as const, label: t('careMap.legendYou') }] : []),
  ];
  const retry = () => {
    setLoadState('loading');
    setAttempt((count) => count + 1);
  };
  return (
    <View
      testID="care-map-frame"
      style={{
        height: collapsed ? 0 : mapHeight,
        borderRadius: radius.card,
        overflow: 'hidden',
        backgroundColor: colors.surface2,
      }}
    >
      <Map
        key={attempt}
        style={StyleSheet.absoluteFill}
        mapStyle={MAP_STYLE}
        attribution
        logo={false}
        accessibilityLabel={t('careMap.mapLabel')}
        onPress={onClearSelection}
        // Rendering finished means tiles are on screen; style-only loading still shows a blank base.
        // Prop names: @maplibre/maplibre-react-native 11.4.1, lib/typescript/commonjs/components/map/Map.d.ts.
        onDidFinishRenderingMap={() => setLoadState((state) => (state === 'failed' ? state : 'ready'))}
        onDidFailLoadingMap={() => setLoadState('failed')}
      >
        <Camera initialViewState={{ center: [centre.lon, centre.lat], zoom: START_ZOOM }} />
        {you ? (
          <Marker id="you" lngLat={[you.lon, you.lat]}>
            <Pin shape="you" />
          </Marker>
        ) : null}
        {clinics.map((clinic) => (
          <Marker
            key={clinic.id}
            id={`clinic-${clinic.id}`}
            lngLat={[clinic.lon, clinic.lat]}
            // On Android a pin tap also reaches the map's own onPress (maplibre-react-native #1618).
            onPress={(event) => {
              event.stopPropagation();
              onSelectClinic(clinic.id);
            }}
          >
            <View style={{ opacity: selectedId === null || selectedId === clinic.id ? 1 : 0.6 }}>
              <Pin shape="clinic" />
            </View>
          </Marker>
        ))}
        {doctors.map((doctor, index) => (
          <Marker
            key={`${doctor.name}-${index}`}
            id={`doctor-${index}`}
            lngLat={[doctor.lon, doctor.lat]}
            // Doctor details wait for the native search (Track B); the tap must not clear the clinic pick.
            onPress={(event) => event.stopPropagation()}
          >
            <Pin shape="doctor" />
          </Marker>
        ))}
      </Map>
      {loadState === 'loading' ? (
        <View
          testID="care-map-loading"
          pointerEvents="none"
          style={[
            StyleSheet.absoluteFill,
            { alignItems: 'center', justifyContent: 'center', gap: spacing.sm },
          ]}
        >
          <View style={[StyleSheet.absoluteFill, { backgroundColor: colors.surface2, opacity: 0.85 }]} />
          <ActivityIndicator color={colors.accent} />
          <AppText tone="textDim">{t('careMap.loadingMap')}</AppText>
        </View>
      ) : null}
      {loadState === 'failed' ? (
        <View
          testID="care-map-failed"
          style={[
            StyleSheet.absoluteFill,
            {
              alignItems: 'center',
              justifyContent: 'center',
              gap: spacing.sm,
              padding: spacing.lg,
              backgroundColor: colors.surface2,
            },
          ]}
        >
          <AppText accessibilityRole="alert" tone="textDim" style={{ textAlign: 'center' }}>
            {t('careMap.mapFailed')}
          </AppText>
          <Button label={t('careMap.retry')} variant="secondary" onPress={retry} />
        </View>
      ) : null}
      <MapLegend entries={legend} />
    </View>
  );
}

const styles = StyleSheet.create({
  pin: {
    width: PIN_SIZE,
    height: PIN_SIZE,
    borderRadius: PIN_SIZE / 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
});

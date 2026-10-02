import { Camera, Map, Marker } from '@maplibre/maplibre-react-native';
import { useTranslation } from 'react-i18next';
import { StyleSheet, View } from 'react-native';

import { useTheme } from '@/theme';

import type { Coordinates, NearbyClinic } from './clinics';
import type { NearbyDoctor } from './nearbyDoctors';

// OpenFreeMap needs no key; commercial use is allowed and the attribution stays on (ADR 0054 §2).
// https://openfreemap.org/quick_start/
const LIGHT_STYLE = 'https://tiles.openfreemap.org/styles/liberty';
const DARK_STYLE = 'https://tiles.openfreemap.org/styles/dark';
const START_ZOOM = 11;
const PIN_SIZE = 30;

type PinProps = { shape: 'clinic' | 'doctor' | 'you' };

// Clinic: filled teal disc with a cross. Doctor: blue ring with a dot. You: small ringed dot.
export function Pin({ shape }: PinProps) {
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

type CareMapViewProps = {
  centre: Coordinates;
  // Where the person is, when the location was allowed; a ZIP search shows no "you" dot.
  you: Coordinates | null;
  clinics: readonly NearbyClinic[];
  doctors: readonly NearbyDoctor[];
  selectedId: string | null;
  onSelectClinic: (id: string) => void;
  onClearSelection: () => void;
};

// The map is remounted (the key) when the theme changes instead of swapping its style live, which crashes
// on some Android devices (maplibre-react-native #1647). Style and camera are chosen when it mounts.
export function CareMapView({
  centre,
  you,
  clinics,
  doctors,
  selectedId,
  onSelectClinic,
  onClearSelection,
}: CareMapViewProps) {
  const { t } = useTranslation();
  const { isDark, radius, colors } = useTheme();
  return (
    <View
      style={{ height: 280, borderRadius: radius.card, overflow: 'hidden', backgroundColor: colors.surface2 }}
    >
      <Map
        key={isDark ? 'dark' : 'light'}
        style={StyleSheet.absoluteFill}
        mapStyle={isDark ? DARK_STYLE : LIGHT_STYLE}
        attribution
        logo={false}
        accessibilityLabel={t('careMap.mapLabel')}
        onPress={onClearSelection}
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
          <Marker key={`${doctor.name}-${index}`} id={`doctor-${index}`} lngLat={[doctor.lon, doctor.lat]}>
            <Pin shape="doctor" />
          </Marker>
        ))}
      </Map>
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

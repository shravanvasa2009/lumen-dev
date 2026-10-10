import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Keyboard, KeyboardAvoidingView, Platform, ScrollView, TextInput, View } from 'react-native';

import { AppText } from '@/components/AppText';
import { Card } from '@/components/Card';
import { ListRow } from '@/components/ListRow';
import { PressableScale } from '@/components/PressableScale';
import { Screen } from '@/components/Screen';
import { callNumber, opensOk } from '@/profile/dial';
import { useDoctorPhone } from '@/profile/doctorPhone';
import { useTheme } from '@/theme';

import { CareMapView } from './CareMapView';
import { ClinicRow } from './ClinicRow';
import { type Coordinates, findPlace, type NearbyClinic, nearestClinics } from './clinics';
import { ContactIcon } from './ContactIcons';
import { directionsUrl, doctorSearchUrl } from './contact';
import {
  canSearchNearbyDoctors,
  type NearbyDoctor,
  SEARCH_THROTTLED_CODE,
  searchNearbyDoctors,
} from './nearbyDoctors';
import { useCareLocation } from './useCareLocation';

type DoctorNotice = 'searchBusy' | 'searchFailed' | 'mapsFailed';
type SearchedPlace = { coordinates: Coordinates; label: string };

// ODbL 4.3 asks for this notice wherever the regular clinics are shown (ADR 0078).
const OSM_COPYRIGHT_URL = 'https://www.openstreetmap.org/copyright';

// Five digits is a whole ZIP code, so the map moves without waiting for Search.
const COMPLETE_ZIP = /^\d{5}$/;

export function CareMapScreen() {
  const { t } = useTranslation();
  const { colors, control, radius, shadow, spacing, type } = useTheme();
  const location = useCareLocation();
  const { phone: doctorPhone } = useDoctorPhone();
  const [query, setQuery] = useState('');
  // Stays until the next search that finds a place, whatever is typed in between.
  const [searchedPlace, setSearchedPlace] = useState<SearchedPlace | null>(null);
  const [placeNotFound, setPlaceNotFound] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [doctors, setDoctors] = useState<readonly NearbyDoctor[]>([]);
  const [doctorNotice, setDoctorNotice] = useState<DoctorNotice | null>(null);
  const [failedCallPhone, setFailedCallPhone] = useState<string | null>(null);
  const [directionsFailedId, setDirectionsFailedId] = useState<string | null>(null);
  const [keyboardUp, setKeyboardUp] = useState(false);
  // Keyboard events, not focus: Android hides the keyboard (back key, chevron) without blurring the field.
  useEffect(() => {
    const shown = Keyboard.addListener('keyboardDidShow', () => setKeyboardUp(true));
    const hidden = Keyboard.addListener('keyboardDidHide', () => setKeyboardUp(false));
    return () => {
      shown.remove();
      hidden.remove();
    };
  }, []);

  const you = location.status === 'ready' ? location.origin : null;
  const centre = searchedPlace?.coordinates ?? you;
  const clinics = useMemo(() => (centre ? nearestClinics(centre) : []), [centre]);
  const listed: NearbyClinic[] = [
    ...clinics.filter((clinic) => clinic.id === selectedId),
    ...clinics.filter((clinic) => clinic.id !== selectedId),
  ];
  const searchEmpty = query.trim() === '';

  const searchPlace = (text: string) => {
    Keyboard.dismiss();
    setKeyboardUp(false);
    const found = findPlace(text);
    setPlaceNotFound(found === null);
    if (found) {
      setSearchedPlace({ coordinates: found, label: text.trim() });
      setSelectedId(null);
      setDoctors([]);
    }
  };

  const changeQuery = (text: string) => {
    setQuery(text);
    if (COMPLETE_ZIP.test(text.trim())) searchPlace(text);
  };

  const showMyLocation = () => {
    setSearchedPlace(null);
    setPlaceNotFound(false);
    setQuery('');
    setSelectedId(null);
    setDoctors([]);
  };

  const call = async (phone: string) => {
    setFailedCallPhone((await callNumber(phone)) ? null : phone);
  };

  const openDirections = async (clinic: NearbyClinic) => {
    setDirectionsFailedId((await opensOk(directionsUrl(clinic, clinic.name))) ? null : clinic.id);
  };

  const findDoctors = async () => {
    if (!centre) return;
    setDoctorNotice(null);
    if (!canSearchNearbyDoctors()) {
      if (!(await opensOk(doctorSearchUrl(centre)))) setDoctorNotice('mapsFailed');
      return;
    }
    try {
      setDoctors(await searchNearbyDoctors(centre));
    } catch (error) {
      const throttled = (error as { code?: string }).code === SEARCH_THROTTLED_CODE;
      setDoctorNotice(throttled ? 'searchBusy' : 'searchFailed');
    }
  };

  const locationNotice = {
    asking: t('careMap.locating'),
    denied: t('careMap.denied'),
    failed: t('careMap.locationFailed'),
    ready: null,
  }[location.status];
  const doctorNoticeText = {
    searchBusy: t('careMap.searchBusy'),
    searchFailed: t('careMap.searchFailed'),
    mapsFailed: t('careMap.mapsFailed'),
  };

  return (
    <Screen headerless aboveTabBar>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={{ gap: spacing.md, flex: 1 }}
      >
        <AppText variant="display" accessibilityRole="header">
          {t('careMap.title')}
        </AppText>
        <View
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            gap: spacing.sm,
            paddingLeft: spacing.md,
            borderRadius: radius.pill,
            backgroundColor: colors.surface2,
          }}
        >
          <ContactIcon name="search" size={18} color={colors.textDim} />
          <TextInput
            accessibilityLabel={t('careMap.zipLabel')}
            placeholder={t('careMap.zipLabel')}
            placeholderTextColor={colors.textFaint}
            value={query}
            onChangeText={changeQuery}
            onSubmitEditing={() => searchPlace(query)}
            returnKeyType="search"
            autoCorrect={false}
            style={{
              flex: 1,
              minHeight: control.minTarget,
              color: colors.text,
              fontSize: type.body.size,
            }}
          />
          <PressableScale
            accessibilityRole="button"
            accessibilityLabel={t('careMap.search')}
            accessibilityState={{ disabled: searchEmpty }}
            disabled={searchEmpty}
            onPress={() => searchPlace(query)}
            style={{
              minHeight: control.minTarget,
              paddingHorizontal: spacing.lg,
              justifyContent: 'center',
              backgroundColor: 'transparent',
              opacity: searchEmpty ? 0.4 : 1,
            }}
          >
            <AppText variant="headline" tone="accent">
              {t('careMap.search')}
            </AppText>
          </PressableScale>
        </View>

        {centre ? (
          <CareMapView
            // A new area is a new map: remounting avoids restyling a live map (ADR 0054).
            key={`${centre.lat}-${centre.lon}`}
            centre={centre}
            you={searchedPlace ? null : you}
            clinics={clinics}
            doctors={doctors}
            selectedId={selectedId}
            compact={keyboardUp}
            onSelectClinic={setSelectedId}
            onClearSelection={() => setSelectedId(null)}
            onShowMyLocation={searchedPlace && you ? showMyLocation : undefined}
          />
        ) : null}

        <ScrollView
          contentContainerStyle={{ gap: spacing.md, paddingBottom: spacing.xxxl }}
          keyboardShouldPersistTaps="handled"
        >
          {placeNotFound ? (
            <AppText accessibilityRole="alert" tone="textDim">
              {t('careMap.notFound')}
            </AppText>
          ) : null}
          {searchedPlace ? (
            <AppText testID="care-map-place" tone="textDim">
              {t('careMap.showingNear', { place: searchedPlace.label })}
            </AppText>
          ) : null}
          {locationNotice && !searchedPlace ? <AppText tone="textDim">{locationNotice}</AppText> : null}
          {doctorPhone ? (
            <View style={{ gap: spacing.xs }}>
              <PressableScale
                accessibilityRole="button"
                accessibilityLabel={t('careMap.callMyDoctor')}
                accessibilityHint={doctorPhone}
                onPress={() => void call(doctorPhone)}
                style={{
                  flexDirection: 'row',
                  alignItems: 'center',
                  gap: spacing.md,
                  minHeight: control.minTarget,
                  paddingHorizontal: spacing.lg,
                  borderRadius: radius.sheet,
                  backgroundColor: colors.surface,
                  ...shadow.raised,
                }}
              >
                <ContactIcon name="call" size={20} color={colors.accent} />
                <AppText tone="accent" style={{ flex: 1 }}>
                  {t('careMap.callMyDoctor')}
                </AppText>
                <AppText tone="textDim">{doctorPhone}</AppText>
              </PressableScale>
              {failedCallPhone === doctorPhone ? (
                <AppText accessibilityRole="alert" tone="textDim">
                  {t('careMap.callFailed')} <AppText selectable>{doctorPhone}</AppText>
                </AppText>
              ) : null}
            </View>
          ) : null}

          {centre ? (
            <>
              <Card flush>
                <ListRow
                  last
                  chevron
                  title={canSearchNearbyDoctors() ? t('careMap.showDoctors') : t('careMap.searchDoctors')}
                  onPress={() => void findDoctors()}
                />
              </Card>
              {doctorNotice ? (
                <AppText accessibilityRole="alert" tone="textDim">
                  {doctorNoticeText[doctorNotice]}
                </AppText>
              ) : null}
              <AppText
                variant="caption"
                tone="textDim"
                accessibilityRole="header"
                style={{ paddingHorizontal: spacing.lg, marginBottom: -spacing.xs }}
              >
                {t('careMap.nearby')}
              </AppText>
              <Card flush>
                {listed.map((clinic, index) => (
                  <ClinicRow
                    key={clinic.id}
                    clinic={clinic}
                    selected={clinic.id === selectedId}
                    callFailed={clinic.phone !== '' && failedCallPhone === clinic.phone}
                    directionsFailed={directionsFailedId === clinic.id}
                    last={index === listed.length - 1}
                    onCall={() => void call(clinic.phone)}
                    onDirections={() => void openDirections(clinic)}
                  />
                ))}
              </Card>
              <View style={{ gap: spacing.sm, paddingHorizontal: spacing.lg }}>
                <AppText variant="caption" tone="textDim">
                  {t('careMap.source')}
                </AppText>
                <AppText
                  variant="caption"
                  tone="textDim"
                  accessibilityRole="link"
                  onPress={() => void opensOk(OSM_COPYRIGHT_URL)}
                >
                  {t('careMap.sourceOsm')}
                </AppText>
                <AppText variant="caption" tone="textDim">
                  {t('careMap.privacy')}
                </AppText>
              </View>
            </>
          ) : (
            <AppText variant="caption" tone="textDim" style={{ paddingHorizontal: spacing.lg }}>
              {t('careMap.privacy')}
            </AppText>
          )}
        </ScrollView>
      </KeyboardAvoidingView>
    </Screen>
  );
}

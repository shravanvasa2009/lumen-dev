import { Stack } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Keyboard, KeyboardAvoidingView, Platform, ScrollView, TextInput, View } from 'react-native';

import { AppText } from '@/components/AppText';
import { Button } from '@/components/Button';
import { Screen } from '@/components/Screen';
import { useDoctorPhone } from '@/profile/doctorPhone';
import { useTheme } from '@/theme';

import { CareMapView } from './CareMapView';
import { ClinicCard } from './ClinicCard';
import { type Coordinates, findPlace, type NearbyClinic, nearestClinics } from './clinics';
import { callNumber, directionsUrl, doctorSearchUrl, opensOk } from './contact';
import {
  canSearchNearbyDoctors,
  type NearbyDoctor,
  SEARCH_THROTTLED_CODE,
  searchNearbyDoctors,
} from './nearbyDoctors';
import { useCareLocation } from './useCareLocation';

type DoctorNotice = 'searchBusy' | 'searchFailed' | 'mapsFailed';

export function CareMapScreen() {
  const { t } = useTranslation();
  const { colors, radius, spacing, type } = useTheme();
  const location = useCareLocation();
  const { phone: doctorPhone } = useDoctorPhone();
  const [query, setQuery] = useState('');
  const [searchedPlace, setSearchedPlace] = useState<Coordinates | null>(null);
  const [placeNotFound, setPlaceNotFound] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [doctors, setDoctors] = useState<readonly NearbyDoctor[]>([]);
  const [doctorNotice, setDoctorNotice] = useState<DoctorNotice | null>(null);
  const [failedCallPhone, setFailedCallPhone] = useState<string | null>(null);
  const [directionsFailedId, setDirectionsFailedId] = useState<string | null>(null);
  const [typing, setTyping] = useState(false);
  // Android hides the keyboard (back key, chevron) without blurring the field, so the folded map would stay
  // hidden after a search; the map comes back whenever the keyboard goes away.
  useEffect(() => {
    const hidden = Keyboard.addListener('keyboardDidHide', () => setTyping(false));
    return () => hidden.remove();
  }, []);

  const you = location.status === 'ready' ? location.origin : null;
  const centre = searchedPlace ?? you;
  const clinics = useMemo(() => (centre ? nearestClinics(centre) : []), [centre]);
  const listed: NearbyClinic[] = [
    ...clinics.filter((clinic) => clinic.id === selectedId),
    ...clinics.filter((clinic) => clinic.id !== selectedId),
  ];

  const searchPlace = () => {
    Keyboard.dismiss();
    setTyping(false);
    const found = findPlace(query);
    setPlaceNotFound(found === null);
    if (found) {
      setSearchedPlace(found);
      setSelectedId(null);
      setDoctors([]);
    }
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
    <Screen>
      <Stack.Screen options={{ title: t('careMap.title') }} />
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={{ gap: spacing.md, flex: 1 }}
      >
        {doctorPhone ? (
          <View style={{ gap: spacing.xs }}>
            <Button label={t('careMap.callMyDoctor')} onPress={() => void call(doctorPhone)} />
            {failedCallPhone === doctorPhone ? (
              <AppText accessibilityRole="alert" tone="textDim">
                {t('careMap.callFailed')} <AppText selectable>{doctorPhone}</AppText>
              </AppText>
            ) : null}
          </View>
        ) : null}

        {centre ? (
          <CareMapView
            // A new area is a new map: remounting avoids restyling a live map (ADR 0054).
            key={`${centre.lat}-${centre.lon}`}
            centre={centre}
            you={searchedPlace ? null : you}
            clinics={clinics}
            doctors={doctors}
            selectedId={selectedId}
            collapsed={typing}
            onSelectClinic={setSelectedId}
            onClearSelection={() => setSelectedId(null)}
          />
        ) : null}

        <ScrollView
          contentContainerStyle={{ gap: spacing.md, paddingBottom: spacing.xxxl }}
          keyboardShouldPersistTaps="handled"
        >
          <AppText variant="caption" tone="textDim">
            {t('careMap.privacy')}
          </AppText>
          {locationNotice ? <AppText tone="textDim">{locationNotice}</AppText> : null}

          <View style={{ flexDirection: 'row', gap: spacing.sm, alignItems: 'center' }}>
            <TextInput
              accessibilityLabel={t('careMap.zipLabel')}
              placeholder={t('careMap.zipLabel')}
              placeholderTextColor={colors.textFaint}
              value={query}
              onChangeText={setQuery}
              onFocus={() => setTyping(true)}
              onBlur={() => setTyping(false)}
              onSubmitEditing={searchPlace}
              returnKeyType="search"
              autoCorrect={false}
              style={{
                flex: 1,
                minHeight: 48,
                borderRadius: radius.pill,
                borderWidth: 1,
                borderColor: colors.line2,
                backgroundColor: colors.surface,
                color: colors.text,
                paddingHorizontal: spacing.lg,
                fontSize: type.body.size,
              }}
            />
            <Button label={t('careMap.search')} onPress={searchPlace} disabled={query.trim() === ''} />
          </View>
          {placeNotFound ? (
            <AppText accessibilityRole="alert" tone="textDim">
              {t('careMap.notFound')}
            </AppText>
          ) : null}

          {centre ? (
            <>
              <Button
                label={canSearchNearbyDoctors() ? t('careMap.showDoctors') : t('careMap.searchDoctors')}
                variant="secondary"
                onPress={() => void findDoctors()}
              />
              {doctorNotice ? (
                <AppText accessibilityRole="alert" tone="textDim">
                  {doctorNoticeText[doctorNotice]}
                </AppText>
              ) : null}
              <AppText variant="headline" accessibilityRole="header">
                {t('careMap.nearby')}
              </AppText>
              {listed.map((clinic) => (
                <ClinicCard
                  key={clinic.id}
                  clinic={clinic}
                  selected={clinic.id === selectedId}
                  callFailed={clinic.phone !== '' && failedCallPhone === clinic.phone}
                  directionsFailed={directionsFailedId === clinic.id}
                  onCall={() => void call(clinic.phone)}
                  onDirections={() => void openDirections(clinic)}
                />
              ))}
              <AppText variant="caption" tone="textDim">
                {t('careMap.source')}
              </AppText>
            </>
          ) : null}
        </ScrollView>
      </KeyboardAvoidingView>
    </Screen>
  );
}

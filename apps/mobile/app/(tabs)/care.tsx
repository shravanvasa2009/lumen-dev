import { useIsFocused } from 'expo-router';

import { CareMapScreen } from '@/care/CareMapScreen';

// Tab screens stay mounted after the first visit; the map view and the location request must only exist while
// this tab is showing.
export default function CareTab() {
  return useIsFocused() ? <CareMapScreen /> : null;
}

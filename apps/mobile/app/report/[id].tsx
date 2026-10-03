import { useLocalSearchParams } from 'expo-router';

import { ReportView } from '@/report/ReportView';

export default function ReportScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  return <ReportView id={id} />;
}

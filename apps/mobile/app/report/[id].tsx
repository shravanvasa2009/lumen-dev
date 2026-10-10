import { useLocalSearchParams } from 'expo-router';

import { ReportView } from '@/report/ReportView';

export default function ReportScreen() {
  const { id, context } = useLocalSearchParams<{ id: string; context?: string }>();
  return <ReportView id={id} context={context} />;
}

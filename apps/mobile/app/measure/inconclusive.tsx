import { useLocalSearchParams } from 'expo-router';

import { handedInconclusive } from '@/measure/inconclusiveHandoff';
import { parseMode } from '@/measure/mode';
import { readingById } from '@/results/fixtures';
import { InconclusiveView } from '@/results/InconclusiveView';

export default function InconclusiveScreen() {
  const { mode, id } = useLocalSearchParams<{ mode?: string; id?: string }>();
  return <InconclusiveView reading={readingById(id)} outcome={handedInconclusive()} mode={parseMode(mode)} />;
}

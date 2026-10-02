import { StandingTestScreen } from '@/standing/StandingTestScreen';

// No reading source exists in this build yet, so the screen shows the plan and cannot start.
const NO_READING_SOURCE = { now: Date.now, readHeartRate: null };

export default function StandingTestRoute() {
  return <StandingTestScreen source={NO_READING_SOURCE} />;
}

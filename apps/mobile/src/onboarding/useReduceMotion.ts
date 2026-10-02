import { useEffect, useState } from 'react';
import { AccessibilityInfo } from 'react-native';

// True while the system "Reduce Motion" setting is on, so screens can swap a spinner for a still mark.
export function useReduceMotion(): boolean {
  const [reduceMotion, setReduceMotion] = useState(false);
  useEffect(() => {
    let current = true;
    void AccessibilityInfo.isReduceMotionEnabled().then((enabled) => {
      if (current) setReduceMotion(enabled);
    });
    const subscription = AccessibilityInfo.addEventListener('reduceMotionChanged', setReduceMotion);
    return () => {
      current = false;
      subscription.remove();
    };
  }, []);
  return reduceMotion;
}

import { useEffect, useState } from 'react';

import { LumenCapture, type Capabilities } from '../../modules/lumen-capture/src';

export type PhoneProbe =
  | { kind: 'checking' }
  | { kind: 'ready'; capabilities: Capabilities }
  // The capture module is not linked (Jest, Expo Go) or the probe threw.
  | { kind: 'unavailable' };

// Reads what the rear camera can do from the capture module's capability probe (Appendix A).
export function usePhoneProbe(): PhoneProbe {
  const [probe, setProbe] = useState<PhoneProbe>(
    LumenCapture ? { kind: 'checking' } : { kind: 'unavailable' },
  );
  useEffect(() => {
    if (!LumenCapture) return;
    let current = true;
    LumenCapture.getCapabilities()
      .then((capabilities) => current && setProbe({ kind: 'ready', capabilities }))
      .catch((error: unknown) => {
        console.warn(`Phone probe failed: ${error instanceof Error ? error.message : String(error)}`);
        if (current) setProbe({ kind: 'unavailable' });
      });
    return () => {
      current = false;
    };
  }, []);
  return probe;
}

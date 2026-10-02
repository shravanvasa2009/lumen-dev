import { useEffect, useState } from 'react';

import { LumenCapture, type Capabilities } from '../../modules/lumen-capture/src';

export type PhoneProbe =
  | { kind: 'checking' }
  | { kind: 'ready'; capabilities: Capabilities }
  // The capture module is not linked (Jest, Expo Go) or the probe threw.
  | { kind: 'unavailable' };

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

// Reads what the rear camera can do from the capture module's capability probe (Appendix A).
export function usePhoneProbe(): PhoneProbe {
  const [probe, setProbe] = useState<PhoneProbe>(
    LumenCapture ? { kind: 'checking' } : { kind: 'unavailable' },
  );
  useEffect(() => {
    if (!LumenCapture) return;
    let current = true;
    // Spec §9.5: the first camera request is here. Capture asks again as a fallback; the
    // capability read itself needs no permission, so neither a refusal nor a failed request
    // stops the probe. A failed request is reported and the probe still runs.
    const linked = LumenCapture;
    linked
      .requestPermission()
      .catch((error: unknown) => {
        console.warn(`Camera permission request failed: ${describe(error)}`);
      })
      .then(() => linked.getCapabilities())
      .then((capabilities) => current && setProbe({ kind: 'ready', capabilities }))
      .catch((error: unknown) => {
        console.warn(`Phone probe failed: ${describe(error)}`);
        if (current) setProbe({ kind: 'unavailable' });
      });
    return () => {
      current = false;
    };
  }, []);
  return probe;
}

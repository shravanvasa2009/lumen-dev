import type { TFunction } from 'i18next';

import type { LiveCapture } from './useLiveCapture';

// The line that explains why the camera is not running yet; undefined once it is.
export function phaseCaption(t: TFunction, live: LiveCapture): string | undefined {
  switch (live.phase) {
    case 'unavailable':
      return t('capture.unavailable');
    case 'starting':
      return t('capture.starting');
    case 'denied':
      return t('capture.denied');
    case 'failed':
      return t('capture.failed', { reason: live.failure });
    case 'running':
      return undefined;
  }
}

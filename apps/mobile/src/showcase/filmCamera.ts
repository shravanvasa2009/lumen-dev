import { useEffect, useState } from 'react';

import { LumenCapture } from '../../modules/lumen-capture/src';

// The scanning film replays a recorded take, which has no picture. The real rear camera runs alongside with
// the torch on, so the dial's live view shows the person's finger going onto the lens as the take plays; its
// frames are ignored and the numbers come from the recording. True once the camera is running.
export function useFilmCamera(active: boolean): boolean {
  const [running, setRunning] = useState(false);
  useEffect(() => {
    const capture = LumenCapture;
    if (!active || capture === null) return;
    let started = false;
    let closed = false;
    capture
      .start({ torchLevel: 1 })
      .then(() => {
        started = true;
        if (closed) return capture.stop();
        setRunning(true);
      })
      .catch((error: unknown) => console.warn('[showcase] film camera did not start', error));
    return () => {
      closed = true;
      setRunning(false);
      if (started)
        capture.stop().catch((error: unknown) => console.warn('[showcase] film camera did not stop', error));
    };
  }, [active]);
  return running;
}

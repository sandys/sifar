'use client';

import { useEffect, useState } from 'react';
import {
  readCapabilities,
  UNKNOWN_CAPABILITIES,
  type Capabilities
} from '@/lib/capabilities';

/**
 * Capabilities, resolved after mount.
 *
 * Deliberately not computed during render: the server has no `navigator`, so
 * a render-phase read produces a hydration mismatch and briefly paints an
 * "unsupported" message on a perfectly good browser. Callers should render
 * neutrally while `hydrated` is false.
 */
export function useCapabilities(): Capabilities {
  const [capabilities, setCapabilities] = useState<Capabilities>(
    UNKNOWN_CAPABILITIES
  );

  useEffect(() => {
    if (typeof window === 'undefined' || typeof navigator === 'undefined') return;
    setCapabilities(readCapabilities());
  }, []);

  return capabilities;
}

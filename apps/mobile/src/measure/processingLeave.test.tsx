import { renderRouter, screen } from 'expo-router/testing-library';
import type { ReactTestRendererJSON, ReactTestRendererNode } from 'react-test-renderer';

import { preloadAppRoutes } from '@/testing/preloadAppRoutes';

preloadAppRoutes();

function hostsOfType(type: string, from: ReactTestRendererNode | ReactTestRendererNode[] | null) {
  const found: ReactTestRendererJSON[] = [];
  const visit = (node: ReactTestRendererNode | null) => {
    if (typeof node === 'string' || node === null) return;
    if (node.type === type) found.push(node);
    node.children?.forEach(visit);
  };
  [from ?? []].flat().forEach(visit);
  return found;
}

describe('leaving the processing screen', () => {
  it('hides the header back and turns off swipe-back, so the urgent check cannot be skipped (SAFE-1)', () => {
    renderRouter('./app', { initialUrl: '/measure/processing?mode=quick' });
    const topScreen = hostsOfType('RNSScreen', screen.toJSON()).at(-1);
    const headerConfig = hostsOfType('RNSScreenStackHeaderConfig', topScreen ?? null).at(0);
    expect(topScreen?.props.gestureEnabled).toBe(false);
    expect(headerConfig?.props.hideBackButton).toBe(true);
  });
});

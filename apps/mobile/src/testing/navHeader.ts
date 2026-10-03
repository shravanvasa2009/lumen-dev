import { screen } from 'expo-router/testing-library';
import type { ReactTestRendererJSON, ReactTestRendererNode } from 'react-test-renderer';

type HostProps = Record<string, unknown>;

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

// The native-stack header never mounts as text under jest; react-native-screens hands its title and colours
// to this host element instead, so the focused (last) screen's header config is what the user would see.
export function focusedNavHeader(): HostProps | null {
  const tree = screen.toJSON();
  const topScreen = hostsOfType('RNSScreen', tree).at(-1);
  const config = topScreen && hostsOfType('RNSScreenStackHeaderConfig', topScreen).at(0);
  return config && config.props.hidden !== true ? (config.props as HostProps) : null;
}

export function expectNavTitle(title: string) {
  expect(focusedNavHeader()).toMatchObject({ title });
  expect(screen.queryByRole('header', { name: title })).toBeNull();
}

// Form sheets mount as RNSModalScreen, not RNSScreen, so the sheet's own presentation props are read here.
export function sheetScreenProps(): HostProps | null {
  return hostsOfType('RNSModalScreen', screen.toJSON()).at(-1)?.props ?? null;
}

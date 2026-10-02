import { fireEvent, render, screen } from '@testing-library/react-native';
import { useState } from 'react';

import { Toggle } from './Toggle';

function Harness({ disabled = false }: { disabled?: boolean }) {
  const [on, setOn] = useState(false);
  return <Toggle label="Daily check" value={on} onValueChange={setOn} disabled={disabled} />;
}

describe('Toggle', () => {
  it('flips its checked state when pressed', () => {
    render(<Harness />);
    expect(screen.getByRole('switch', { name: 'Daily check' })).not.toBeChecked();
    fireEvent.press(screen.getByRole('switch', { name: 'Daily check' }));
    expect(screen.getByRole('switch', { name: 'Daily check' })).toBeChecked();
    fireEvent.press(screen.getByRole('switch', { name: 'Daily check' }));
    expect(screen.getByRole('switch', { name: 'Daily check' })).not.toBeChecked();
  });

  it('ignores presses while disabled', () => {
    render(<Harness disabled />);
    fireEvent.press(screen.getByRole('switch', { name: 'Daily check' }));
    expect(screen.getByRole('switch', { name: 'Daily check' })).not.toBeChecked();
  });
});

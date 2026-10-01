import { type Href, useRouter } from 'expo-router';
import type { ComponentProps } from 'react';

import { Button } from './Button';

type NavButtonProps = Omit<ComponentProps<typeof Button>, 'onPress'> & {
  href: Href;
  // Replace drops the current screen from the back stack, for steps the user should not return to.
  replace?: boolean;
};

export function NavButton({ href, replace = false, ...buttonProps }: NavButtonProps) {
  const router = useRouter();
  return <Button {...buttonProps} onPress={() => (replace ? router.replace(href) : router.push(href))} />;
}

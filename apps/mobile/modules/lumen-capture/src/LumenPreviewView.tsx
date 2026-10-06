import { requireNativeView } from 'expo';
import type { ComponentType } from 'react';
import { Platform, type ViewProps } from 'react-native';

// The rear camera of the running capture session, drawn natively with the torch on (CAP-3: no frame reaches JS).
// Only Android has the view so far; asking an iOS build for it would throw, so there it is null and screens
// draw their glow instead. Resolved once at import because requireNativeView registers the view by name.
export const LumenPreviewView: ComponentType<ViewProps> | null =
  Platform.OS === 'android' ? requireNativeView<ViewProps>('LumenCapture', 'LumenPreviewView') : null;

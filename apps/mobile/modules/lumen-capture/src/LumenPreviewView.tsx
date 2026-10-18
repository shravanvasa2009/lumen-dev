import { requireNativeView } from 'expo';
import type { ComponentType } from 'react';
import { Platform, type ViewProps } from 'react-native';

// The rear camera of the running capture session, drawn natively with the torch on (CAP-3: no frame reaches JS).
// The iOS and Android modules both define it; any other platform has no capture module, so there it is null and
// screens draw their glow instead. Resolved once at import because requireNativeView registers the view by name.
export const LumenPreviewView: ComponentType<ViewProps> | null =
  Platform.OS === 'ios' || Platform.OS === 'android'
    ? requireNativeView<ViewProps>('LumenCapture', 'LumenPreviewView')
    : null;

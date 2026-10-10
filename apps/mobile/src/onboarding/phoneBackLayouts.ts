import type { TFunction } from 'i18next';
import { Platform } from 'react-native';

export type Lens = { cx: number; cy: number; r: number };
type Label = { x: number; anchor: 'start' | 'middle' | 'end' };

export type PhoneBackLayout = {
  model: 'galaxyA17' | 'iphone17Pro';
  cameraIsland: { x: number; y: number; width: number; height: number; rx: number };
  // The first lens is the one the fingertip must cover; the rest are drawn for recognition.
  lenses: readonly Lens[];
  flash: Lens;
  extras: readonly Lens[];
  fingerPad: { x: number; y: number; width: number; height: number };
  lensLabel: Label;
  flashLabel: Label;
};

// Positions are read from the manufacturers' product photos, not measured on a phone: the device database holds
// only a placeholder iPhone 16, so the owner should check both against the real phones. Units are viewBox px.
const galaxyA17: PhoneBackLayout = {
  model: 'galaxyA17',
  cameraIsland: { x: 82, y: 52, width: 46, height: 112, rx: 23 },
  lenses: [
    { cx: 105, cy: 77, r: 15 },
    { cx: 105, cy: 111, r: 11 },
    { cx: 105, cy: 141, r: 8 },
  ],
  flash: { cx: 146, cy: 77, r: 6 },
  extras: [],
  fingerPad: { x: 84, y: 58, width: 84, height: 38 },
  lensLabel: { x: 112, anchor: 'end' },
  flashLabel: { x: 140, anchor: 'start' },
};

const iphone17Pro: PhoneBackLayout = {
  model: 'iphone17Pro',
  cameraIsland: { x: 74, y: 46, width: 190, height: 96, rx: 24 },
  lenses: [
    { cx: 108, cy: 74, r: 17 },
    { cx: 108, cy: 116, r: 17 },
    { cx: 148, cy: 95, r: 17 },
  ],
  flash: { cx: 206, cy: 70, r: 7 },
  extras: [
    { cx: 206, cy: 112, r: 7 },
    { cx: 236, cy: 70, r: 2.5 },
  ],
  fingerPad: { x: 86, y: 52, width: 142, height: 40 },
  lensLabel: { x: 108, anchor: 'middle' },
  flashLabel: { x: 206, anchor: 'middle' },
};

export function phoneBackLayout(): PhoneBackLayout {
  return Platform.OS === 'ios' ? iphone17Pro : galaxyA17;
}

export function placementCopy(t: TFunction): { instruction: string; figureLabel: string } {
  return phoneBackLayout().model === 'iphone17Pro'
    ? { instruction: t('placement.instructionIos'), figureLabel: t('placement.figureLabelIos') }
    : { instruction: t('placement.instructionAndroid'), figureLabel: t('placement.figureLabelAndroid') };
}

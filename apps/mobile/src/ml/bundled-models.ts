// The app copy of the shipped models that `npm run sync-models` writes to assets/models/ (ADR 0036, 0064). Metro
// bundles only static import paths, so the manifest and each shipped .onnx file need an import here; after a
// `ships` change, re-run the sync and update the imports below to match (`sync-models -- --check` guards the files).
import diabetesNet from '../../assets/models/diabetes-net@1.0.0.onnx';
import appManifest from '../../assets/models/manifest.json';
import rhythmLgbm from '../../assets/models/rhythm-lgbm@1.0.0.onnx';
import sqiFinger from '../../assets/models/sqi-finger@1.0.0.onnx';

export const bundledManifest: unknown = appManifest;

// Manifest `file` name -> the Metro asset module that expo-asset resolves to a local file.
export const bundledModelFiles: Readonly<Record<string, number>> = {
  'rhythm-lgbm@1.0.0.onnx': rhythmLgbm,
  'sqi-finger@1.0.0.onnx': sqiFinger,
  'diabetes-net@1.0.0.onnx': diabetesNet,
};

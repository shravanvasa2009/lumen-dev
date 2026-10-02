// The app copy of the shipped models that `npm run sync-models` writes to assets/models/ (ADR 0036). Metro
// bundles only static import paths, so the manifest and each shipped .onnx file need an import here. Both stay
// empty until Track D's shipped models are synced; with nothing here every family uses basic analysis (§11.10).
export const bundledManifest: unknown = null;

// Manifest `file` name -> the Metro asset module that expo-asset resolves to a local file.
export const bundledModelFiles: Readonly<Record<string, number>> = {};

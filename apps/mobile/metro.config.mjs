// Metro bundles .onnx models as assets so expo-asset can hand ONNX Runtime a file path (ADR 0050).
// https://docs.expo.dev/guides/customizing-metro/#adding-more-file-extensions-to-assetexts
import expoMetro from 'expo/metro-config.js';

const config = expoMetro.getDefaultConfig(import.meta.dirname);
config.resolver.assetExts.push('onnx');

export default config;

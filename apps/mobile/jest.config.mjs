// jest-expo's Babel setup leaves `import()` alone, and Node only runs it under --experimental-vm-modules.
// src/ml/runtime.ts loads onnxruntime-react-native with `import()` (ADR 0050), so tests turn it into require.
// https://babeljs.io/docs/babel-plugin-transform-dynamic-import
import { createRequire } from 'node:module';
import expoPreset from 'jest-expo/jest-preset.js';

// Bundled ONNX models are Metro assets (metro.config.mjs); the preset's asset transformer has no .onnx rule.
const require = createRequire(import.meta.url);
const SCRIPTS = '\\.[jt]sx?$';
const [transformer, babelOptions] = expoPreset.transform[SCRIPTS];

export default {
  preset: 'jest-expo',
  setupFiles: [...expoPreset.setupFiles, '<rootDir>/jest.devBuild.ts', '<rootDir>/jest.setup.ts'],
  transform: {
    '\\.onnx$': require.resolve('jest-expo/src/preset/assetFileTransformer.js'),
    [SCRIPTS]: [transformer, { ...babelOptions, plugins: ['@babel/plugin-transform-dynamic-import'] }],
  },
};

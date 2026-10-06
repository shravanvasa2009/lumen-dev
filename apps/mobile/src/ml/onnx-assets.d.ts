// Metro turns an imported .onnx into the numeric asset id expo-asset resolves (metro.config.mjs, ADR 0050).
declare module '*.onnx' {
  const assetModule: number;
  export default assetModule;
}

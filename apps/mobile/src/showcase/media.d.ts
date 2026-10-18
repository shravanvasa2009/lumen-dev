// Metro bundles an .mp4 as an asset and an import gives its asset number (expo-video's VideoSource accepts it).
declare module '*.mp4' {
  const asset: number;
  export default asset;
}

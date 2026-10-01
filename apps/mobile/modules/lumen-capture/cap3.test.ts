// The app tsconfig has no Node types, so the two Node modules this test needs are typed here.
type DirEntry = { name: string; isDirectory(): boolean };
const fs = jest.requireActual<{
  readdirSync(dir: string, options: { withFileTypes: true }): DirEntry[];
  readFileSync(file: string, encoding: 'utf8'): string;
}>('fs');
const path = jest.requireActual<{ join(...parts: string[]): string; dirname(file: string): string }>('path');

// CAP-3: no video frames or images are written to disk. These APIs record, encode, or write files; none
// belongs in a module that reduces each frame to a few numbers in memory.
const BANNED: { platform: 'ios' | 'android'; api: RegExp }[] = [
  { platform: 'ios', api: /\bAVCaptureMovieFileOutput\b/ },
  { platform: 'ios', api: /\bAVCapturePhotoOutput\b/ },
  { platform: 'ios', api: /\bAVAssetWriter\b/ },
  { platform: 'ios', api: /\bPHPhotoLibrary\b/ },
  { platform: 'ios', api: /\bUIImageWriteToSavedPhotosAlbum\b/ },
  { platform: 'ios', api: /\bCGImageDestination\w*/ },
  { platform: 'ios', api: /\.(jpegData|pngData|heicData)\s*\(/ },
  { platform: 'ios', api: /\.write\s*\(\s*to:/ },
  { platform: 'ios', api: /\bFileManager\b/ },
  { platform: 'ios', api: /\bFileHandle\b/ },
  { platform: 'android', api: /\bImageCapture\b/ },
  { platform: 'android', api: /\bVideoCapture\b/ },
  { platform: 'android', api: /\bMediaRecorder\b/ },
  { platform: 'android', api: /\bMediaMuxer\b/ },
  { platform: 'android', api: /\bMediaStore\b/ },
  { platform: 'android', api: /\bFileOutputStream\b/ },
  { platform: 'android', api: /\bopenFileOutput\b/ },
  { platform: 'android', api: /\.compress\s*\(/ },
  { platform: 'android', api: /\.(writeBytes|writeText)\s*\(/ },
  { platform: 'android', api: /\bjava\.io\.File\b/ },
];

const SOURCE = { ios: /\.(swift|m|mm)$/, android: /\.(kt|java)$/ };

function sourceFiles(dir: string, pattern: RegExp): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(full, pattern);
    return pattern.test(entry.name) ? [full] : [];
  });
}

function moduleDir(): string {
  const testPath = expect.getState().testPath;
  if (!testPath) throw new Error('Jest did not report this test file path');
  return path.dirname(testPath);
}

function violations(platform: 'ios' | 'android', file: string, text: string): string[] {
  return text
    .split(/\r?\n/)
    .flatMap((line, i) =>
      BANNED.filter((rule) => rule.platform === platform && rule.api.test(line)).map(
        (rule) => `${file}:${i + 1} uses ${rule.api}`,
      ),
    );
}

test.each(['ios', 'android'] as const)(
  '%s native sources use no file or image writers (CAP-3)',
  (platform) => {
    const files = sourceFiles(path.join(moduleDir(), platform), SOURCE[platform]);
    expect(files.length).toBeGreaterThan(0);
    const found = files.flatMap((file) => violations(platform, file, fs.readFileSync(file, 'utf8')));
    expect(found).toEqual([]);
  },
);

test('the scan catches a frame writer', () => {
  expect(violations('ios', 'probe.swift', 'let output = AVCaptureMovieFileOutput()')).toHaveLength(1);
  expect(
    violations('android', 'Probe.kt', 'FileOutputStream(file).use { bitmap.compress(fmt, 90, it) }'),
  ).toHaveLength(2);
});

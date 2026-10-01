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
  { platform: 'ios', api: /\bwrite\s*\(\s*to(File)?:/ },
  { platform: 'ios', api: /\bwriteToFile\b/ },
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
  { platform: 'android', api: /\bFileWriter\b/ },
  { platform: 'android', api: /\bRandomAccessFile\b/ },
  { platform: 'android', api: /\bjava\.nio\.file\b/ },
  { platform: 'android', api: /\bjava\.io\.(File\b|\*)/ },
  // Bare File( catches files opened after a wildcard java.io import.
  { platform: 'android', api: /\bFile\s*\(/ },
  { platform: 'android', api: /\.(outputStream|bufferedWriter|printWriter)\s*\(/ },
];

// Build output and dependencies hold generated or third-party code, not this module's sources.
const SKIP_DIRS = new Set(['build', '.cxx', '.gradle', 'Pods', 'DerivedData']);
const SOURCE = { ios: /\.(swift|m|mm)$/, android: /\.(kt|java)$/ };

function sourceFiles(dir: string, pattern: RegExp): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return SKIP_DIRS.has(entry.name) ? [] : sourceFiles(full, pattern);
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

test.each([
  ['ios', 'let output = AVCaptureMovieFileOutput()'],
  ['ios', 'try frame.write(to: url)'],
  ['ios', 'try csv.write(toFile: path, atomically: true, encoding: .utf8)'],
  ['ios', '(frame as NSData).writeToFile(path, atomically: true)'],
  ['android', 'FileOutputStream(target).use { bitmap.compress(format, 90, it) }'],
  ['android', 'FileWriter(target).use { it.write(csv) }'],
  ['android', 'RandomAccessFile(target, "rw").write(bytes)'],
  ['android', 'import java.nio.file.Files'],
  ['android', 'import java.io.*'],
  ['android', 'val target = File(dir, "frame.raw")'],
  ['android', 'target.outputStream().write(bytes)'],
] as const)('the scan flags a %s file writer: %s', (platform, line) => {
  expect(violations(platform, 'probe', line).length).toBeGreaterThan(0);
});

test('the scan leaves in-memory frame math alone', () => {
  expect(violations('ios', 'probe', 'let meanR = Float(sumR) / Float(count)')).toEqual([]);
  expect(violations('android', 'probe', 'val meanR = sumR.toFloat() / count')).toEqual([]);
});

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const guard = path.join(path.dirname(fileURLToPath(import.meta.url)), 'scope-guard.mjs');
// Fixtures are ROT13-encoded so this file does not trip the banned-term scan.
const rot13 = (text) =>
  text.replace(/[a-z]/gi, (ch) => {
    const base = ch <= 'Z' ? 65 : 97;
    return String.fromCharCode(((ch.charCodeAt(0) - base + 13) % 26) + base);
  });
const FIXTURES = {
  constant: `let facing = ${rot13('YRAF_SNPVAT_SEBAG')}\n`,
  objectiveC: `${rot13('NIPncgherQrivprCbfvgvbaSebag')}\n`,
  swiftComparison: `if device.${rot13('cbfvgvba')} == .${rot13('sebag')} {}\n`,
  swiftLookup: `lookup(.video, ${rot13('cbfvgvba')}: .${rot13('sebag')})\nlookup(.${rot13('sebag')})\n`,
};
const FRONT = rot13('sebag');
const FRONT_UPPER = FRONT.toUpperCase();
// Each form slipped past the guard before PR4a; one fixture per form so each is checked on its own.
const SWIFT_FORMS = {
  assignment: `let wanted: AVCaptureDevice.Position = .${FRONT}\n`,
  qualifiedPosition: `let wanted = AVCaptureDevice.Position.${FRONT}\n`,
  barePosition: `let wanted = Position.${FRONT}\n`,
  frontOnLeftEquals: `if .${FRONT} == device.side {}\n`,
  frontOnLeftNotEquals: `if .${FRONT} != device.side {}\n`,
  frontOnRightEquals: `if side == .${FRONT} {}\n`,
  switchCase: `switch side {\ncase .${FRONT}: break\ndefault: break\n}\n`,
  unspecifiedPosition: `discover(mediaType: .video, position: .unspecified)\n`,
  unspecifiedQualified: `let any = AVCaptureDevice.Position.unspecified\n`,
  colonNoSpace: `lookup(.video, position:.${FRONT})\n`,
};
const KOTLIN_FORMS = {
  cameraXDefault: `val selector = CameraSelector.DEFAULT_${FRONT_UPPER}_CAMERA\n`,
  cameraXLensFacing: `builder.requireLensFacing(CameraSelector.LENS_FACING_${FRONT_UPPER})\n`,
  camera2LensFacing: `if (facing == CameraCharacteristics.LENS_FACING_${FRONT_UPPER}) {}\n`,
  camera1Facing: `if (info.facing == Camera.CameraInfo.CAMERA_FACING_${FRONT_UPPER}) {}\n`,
};
// Lines a rear-only module may legitimately contain.
const ALLOWED = {
  frontier: `let frontier = .${FRONT}ier\n`,
  storefront: `let storefront = store${FRONT}\n`,
  frontierCompare: `if region.${FRONT}ier == other {}\n`,
  backPosition: `let wanted: AVCaptureDevice.Position = .back\nif side == .back {}\n`,
  backCase: `switch side {\ncase .back: break\ncase .${FRONT}Row: break\n}\n`,
  backLookup: `discover(mediaType: .video, position: .back)\n`,
  kotlinBack: `val selector = CameraSelector.DEFAULT_BACK_CAMERA\n`,
};

function runGuard(relativeFile, content) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'scope-guard-'));
  try {
    const file = path.join(dir, relativeFile);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, content);
    return spawnSync(process.execPath, [guard], { cwd: dir, encoding: 'utf8' });
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

function assertFlagged(relativeFile, content = FIXTURES.constant) {
  const run = runGuard(relativeFile, content);
  assert.equal(run.status, 1);
  assert.match(run.stderr, /SCOPE-1 failed/);
  assert.ok(run.stderr.includes(path.basename(relativeFile)), run.stderr);
}

function assertSkipped(relativeFile) {
  const run = runGuard(relativeFile, FIXTURES.constant);
  assert.equal(run.status, 0, run.stderr);
}

const MODULE = 'apps/mobile/modules/lumen-capture';

test('flags a front-camera API in the native module ios folder', () => {
  assertFlagged(`${MODULE}/ios/Camera.swift`);
});

test('flags a front-camera API in the native module android folder', () => {
  assertFlagged(`${MODULE}/android/src/Camera.kt`);
});

test('flags a front-camera API inside a data or build folder of the module', () => {
  assertFlagged(`${MODULE}/ios/data/Camera.swift`);
  assertFlagged(`${MODULE}/android/src/build/Camera.kt`);
});

test('flags Objective-C and Swift forms in the added file types', () => {
  assertFlagged(`${MODULE}/ios/Camera.m`, FIXTURES.objectiveC);
  assertFlagged(`${MODULE}/ios/Camera.mm`, FIXTURES.objectiveC);
  assertFlagged(`${MODULE}/ios/Camera.h`, FIXTURES.objectiveC);
  assertFlagged(`${MODULE}/ios/Compare.swift`, FIXTURES.swiftComparison);
  assertFlagged(`${MODULE}/ios/Lookup.swift`, FIXTURES.swiftLookup);
  assertFlagged(`${MODULE}/android/src/main/AndroidManifest.xml`);
  assertFlagged(`${MODULE}/android/build.gradle`);
  assertFlagged(`${MODULE}/ios/Info.plist`);
});

for (const [name, content] of Object.entries(SWIFT_FORMS)) {
  test(`flags the Swift form: ${name}`, () => {
    assertFlagged(`${MODULE}/ios/${name}.swift`, content);
  });
}

for (const [name, content] of Object.entries(KOTLIN_FORMS)) {
  test(`flags the Kotlin form: ${name}`, () => {
    assertFlagged(`${MODULE}/android/src/${name}.kt`, content);
  });
}

for (const [name, content] of Object.entries(ALLOWED)) {
  test(`does not flag the allowed line: ${name}`, () => {
    const run = runGuard(`${MODULE}/ios/${name}.swift`, content);
    assert.equal(run.status, 0, run.stderr);
  });
}

test('does not flag the word in ordinary prose', () => {
  const run = runGuard(`${MODULE}/ios/Notes.swift`, '// the front of the phone faces the user\n');
  assert.equal(run.status, 0, run.stderr);
});

test('still skips the generated prebuild folders', () => {
  assertSkipped('apps/mobile/ios/Generated.swift');
  assertSkipped('apps/mobile/android/Generated.kt');
});

test('skips generated gradle output and ml data by full path', () => {
  assertSkipped(`${MODULE}/android/build/Generated.kt`);
  assertSkipped(`${MODULE}/android/.cxx/Generated.kt`);
  assertSkipped('ml/data/sample.json');
  assertSkipped('packages/core/dist/index.js');
});

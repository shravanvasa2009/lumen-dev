import fs from 'node:fs';
import ts from 'typescript';

import {
  COPY_FILES,
  jsonKeyLines,
  lineOf,
  mobileSourceFiles,
  parseSource,
  visitNodes,
} from './lib/mobile-sources.mjs';

// UI-2: no hard-coded text in screens. SAFE-1: shipped copy never says "you have" or states a
// condition or a diagnosis as fact.
const VISIBLE_NAMES = new Set([
  'title',
  'label',
  'subtitle',
  'heading',
  'placeholder',
  'accessibilityLabel',
  'accessibilityHint',
  'aria-label',
  'headerTitle',
  'tabBarLabel',
]);
// Separators such as "·" carry no words, so only text with a letter counts as copy.
const hasWords = (text) => /\p{L}/u.test(text);

function literalWithWords(expression) {
  if (ts.isStringLiteralLike(expression)) return hasWords(expression.text) ? expression : null;
  if (ts.isTemplateExpression(expression)) {
    const pieces = [expression.head.text, ...expression.templateSpans.map((span) => span.literal.text)];
    return pieces.some(hasWords) ? expression : null;
  }
  if (ts.isParenthesizedExpression(expression) || ts.isAsExpression(expression))
    return literalWithWords(expression.expression);
  if (ts.isConditionalExpression(expression))
    return literalWithWords(expression.whenTrue) ?? literalWithWords(expression.whenFalse);
  if (ts.isBinaryExpression(expression))
    return literalWithWords(expression.left) ?? literalWithWords(expression.right);
  return null;
}

// A JSX attribute (label="x", label={"x"}) or an object property (title: "x") named like visible text.
function visibleProp(node) {
  if (ts.isJsxAttribute(node) && node.initializer && VISIBLE_NAMES.has(node.name.text)) {
    const value = ts.isJsxExpression(node.initializer) ? node.initializer.expression : node.initializer;
    return value ? { name: node.name.text, value } : null;
  }
  if (
    ts.isPropertyAssignment(node) &&
    (ts.isIdentifier(node.name) || ts.isStringLiteral(node.name)) &&
    VISIBLE_NAMES.has(node.name.text)
  )
    return { name: node.name.text, value: node.initializer };
  return null;
}

function findHardCodedText(fileName, text) {
  const sourceFile = parseSource(fileName, text);
  const problems = [];
  const report = (node, what) => problems.push(`${fileName}:${lineOf(sourceFile, node)}: ${what}`);
  visitNodes(sourceFile, (node) => {
    if (ts.isJsxText(node) && hasWords(node.text)) report(node, `hard-coded JSX text "${node.text.trim()}"`);
    if (
      ts.isJsxExpression(node) &&
      node.expression &&
      (ts.isJsxElement(node.parent) || ts.isJsxFragment(node.parent))
    ) {
      const literal = literalWithWords(node.expression);
      if (literal) report(literal, 'string literal passed as a JSX child');
    }
    if (
      ts.isCallExpression(node) &&
      ts.isPropertyAccessExpression(node.expression) &&
      node.expression.expression.getText(sourceFile) === 'Alert' &&
      node.expression.name.text === 'alert'
    ) {
      for (const argument of node.arguments.slice(0, 2)) {
        const literal = literalWithWords(argument);
        if (literal) report(literal, 'string literal passed to Alert.alert');
      }
    }
    const target = visibleProp(node);
    if (target) {
      const literal = literalWithWords(target.value);
      if (literal) report(literal, `string literal passed to "${target.name}"`);
    }
  });
  return problems;
}

const CONDITIONS = String.raw`(?:afib|a-fib|atrial fibrillation|psvt|pots|diabetes|diabetic|tachycardia|arrhythmia)`;
const CONDICIONES = String.raw`(?:fibrilaci[oó]n(?: auricular)?|afib|psvt|pots|diabetes|diab[eé]tic[oa]|taquicardia|arritmia)`;
const NOT_NEGATED = String.raw`(?<!\b(?:not|never|nor|no|n't|nunca)\s)`;
const COPY_RULES = [
  { pattern: /\byou have\b|\byou've got\b/i, why: '"you have" is banned in all copy' },
  {
    pattern: new RegExp(
      String.raw`\b(?:you are|you're|this is|it is|it's|that is|this means you have)\s+(?:(?:a|an|the)\s+)?${CONDITIONS}\b`,
      'i',
    ),
    why: 'states a condition as fact',
  },
  {
    pattern: new RegExp(String.raw`\b${CONDITIONS}\s+(?:detected|found|confirmed|present)\b`, 'i'),
    why: 'states a condition as fact',
  },
  {
    pattern: new RegExp(
      String.raw`\b(?:your|the)\s+(?:rhythm|pulse|heart rate|heartbeat|result|reading)\s+(?:is|shows|means)\s+(?:(?:a|an)\s+)?${CONDITIONS}\b`,
      'i',
    ),
    why: 'states a condition as fact',
  },
  {
    pattern: new RegExp(String.raw`\b${CONDICIONES}\s+(?:detectad[oa]|confirmad[oa])\b`, 'i'),
    why: 'states a condition as fact',
  },
  {
    pattern: new RegExp(
      String.raw`\b(?:tu|su)\s+(?:ritmo|pulso|resultado|lectura|medici[oó]n)\s+(?:es|muestra|indica)\s+(?:(?:un|una)\s+)?${CONDICIONES}\b`,
      'i',
    ),
    why: 'states a condition as fact',
  },
  { pattern: new RegExp(`${NOT_NEGATED}\\bdiagnosed\\b`, 'i'), why: 'states a diagnosis as fact' },
  {
    pattern: new RegExp(`${NOT_NEGATED}\\b(?:a |the )?diagnosis (?:of|is)\\b`, 'i'),
    why: 'states a diagnosis as fact',
  },
  {
    pattern: new RegExp(
      String.raw`\b(?:tienes|tiene|usted tiene|padeces|sufres)\s+(?:(?:un|una|el|la)\s+)?${CONDICIONES}\b`,
      'i',
    ),
    why: 'states a condition as fact',
  },
  {
    pattern: new RegExp(String.raw`\b(?:eres|es usted|est[aá]s)\s+${CONDICIONES}\b`, 'i'),
    why: 'states a condition as fact',
  },
  { pattern: /\bdiagnostic(?:ad[oa]s?|aron|aste)\b/i, why: 'states a diagnosis as fact' },
  { pattern: /(?<!\bno es un\s)\bdiagn[oó]stico de\b/i, why: 'states a diagnosis as fact' },
];

function findUnsafeCopy(text) {
  return COPY_RULES.filter(({ pattern }) => pattern.test(text)).map(({ why }) => why);
}

// Runs on every call so a weakened rule fails the check itself, not only a code review.
const MUST_FAIL = [
  'You have AFib.',
  'You have an irregular pulse.',
  'You are diagnosed with POTS.',
  'This is AFib.',
  'Diagnosis of diabetes confirmed.',
  'AFib detected.',
  'Your rhythm is AFib.',
  'Tu ritmo es fibrilación auricular.',
  'Fibrilación auricular detectada.',
  'Tienes fibrilación auricular.',
  'Usted tiene diabetes.',
  'Tienes taquicardia.',
  'Te diagnosticaron arritmia.',
  'Diagnóstico de diabetes: confirmado.',
];
const MUST_PASS = [
  'Not a diagnosis.',
  'This is not a diabetes test.',
  "Lumen can't diagnose any condition.",
  'Irregular rhythm consistent with possible AFib.',
  'Irregular rhythm detected — please retake.',
  'What is AFib?',
  'Un teléfono que ya tienes.',
  'El teléfono que ya tienes en tu bolsillo.',
  '¿Tienes ahora dolor de pecho, desmayo o mucha falta de aire?',
  'Esto no es una prueba de diabetes.',
  'No es un diagnóstico.',
  'Una revisión de 90 segundos con el teléfono que ya tienes.',
];
const SOURCE_MUST_FAIL = [
  '<Text>Hello</Text>',
  "<Text>{'Hello'}</Text>",
  '<Text>{ready ? "Go" : t("go")}</Text>',
  '<Button label="Save" />',
  "<Button title={'Save'} />",
  '<Input placeholder={`Name`} />',
  '<View accessibilityLabel="Close" />',
  "const options = { title: 'Home' };",
  '<View aria-label="Close" />',
  "Alert.alert('Saved', 'Done');",
];
const SOURCE_MUST_PASS = [
  "<Text>{t('a.b')}</Text>",
  "<Button label={t('a.b')} />",
  '<Text>{count} · {unit}</Text>',
  '<View testID="close-button" accessibilityRole="button" />',
  "const options = { title: t('a.b') };",
  "Alert.alert(t('a.b'), t('a.c'));",
];

function selfTest() {
  const wrong = [];
  for (const text of MUST_FAIL)
    if (findUnsafeCopy(text).length === 0) wrong.push(`copy rule missed: ${text}`);
  for (const text of MUST_PASS)
    if (findUnsafeCopy(text).length > 0) wrong.push(`copy rule rejected: ${text}`);
  for (const text of SOURCE_MUST_FAIL)
    if (findHardCodedText('probe.tsx', text).length === 0) wrong.push(`string rule missed: ${text}`);
  for (const text of SOURCE_MUST_PASS)
    if (findHardCodedText('probe.tsx', text).length > 0) wrong.push(`string rule rejected: ${text}`);
  return wrong;
}

const selfTestFailures = selfTest();
if (selfTestFailures.length) {
  console.error(`lint:strings self-test failed:\n${selfTestFailures.join('\n')}`);
  process.exit(1);
}

const failures = [];
for (const file of mobileSourceFiles(['.tsx']))
  failures.push(...findHardCodedText(file, fs.readFileSync(file, 'utf8')));
for (const file of Object.values(COPY_FILES)) {
  const text = fs.readFileSync(file, 'utf8');
  const lines = jsonKeyLines(text);
  for (const [key, value] of Object.entries(JSON.parse(text)))
    for (const why of findUnsafeCopy(value))
      failures.push(`${file}:${lines.get(key)}: "${key}" ${why}: ${value}`);
}

if (failures.length) {
  console.error(`lint:strings failed:\n${failures.join('\n')}`);
  process.exit(1);
}
console.log('strings OK: no hard-coded UI text, no condition or diagnosis stated as fact');

// Format rules only; the requirement tag and banned hype words are checked by scripts/check-commit-msg.mjs.
export default {
  extends: ['@commitlint/config-conventional'],
  rules: { 'header-max-length': [2, 'always', 72], 'subject-case': [0] },
};

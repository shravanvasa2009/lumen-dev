# 0010 — Jest with ts-jest for @lumen/core

- Status: accepted
- Date: 2026-09-30
- Requirement IDs: DSP-C

## Context

`packages/core` must run in Node unchanged (no React Native or Expo), and §10.2 asks for Jest tests
that compare it with the Python golden vectors (DSP-C). The app already uses Jest 29.7.0 through
jest-expo 57 (ADR 0004), which is React Native-specific. ts-jest runs TypeScript test files in plain
Node with type checking.

Checked with `npm view` on 2026-09-30: ts-jest 29.4.14 is the newest 29.x and declares peers
`jest ^29.0.0 || ^30.0.0` and `typescript >=4.3 <7`, so it supports Jest 29.7.0 and TypeScript 6.0.3.

## Decision

- `@lumen/core` devDependencies, exact: jest 29.7.0 (same as `apps/mobile`), ts-jest 29.4.14,
  @types/jest 29.5.14 (same as `apps/mobile`).
- Jest config lives in `packages/core/package.json` (`preset: "ts-jest"`, `testEnvironment: "node"`).
- `npm test -w @lumen/core` runs `tsc --noEmit -p .` first, so type-only contract tests fail on drift.
- Docs: https://jestjs.io/docs/getting-started and https://kulshekhar.github.io/ts-jest/

## Consequences

- One Jest major across the monorepo; both move together when jest-expo moves to Jest 30.
- ts-jest type-checks each test file, which is slower than a Babel transform; acceptable at core's size.
- `apps/mobile` and `@lumen/core` each keep their own Jest config.

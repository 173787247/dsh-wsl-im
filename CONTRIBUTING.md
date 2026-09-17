# Contributing

1. Keep secrets out of tool returns and README examples (use env files).
2. Re-implement behavior from vendor protocol docs. Never copy or translate code from OryxOS (Apache-2.0) or any other project. See [`docs/PROVENANCE.md`](./docs/PROVENANCE.md).
3. Do not add a runtime dependency on OryxOS, and do not vendor its sources.
4. Run `npm test` before opening a PR.

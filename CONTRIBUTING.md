# Contributing

1. Keep secrets out of tool returns and README examples (use `${ENV}` / env files).
2. Prefer extending the OryxOS HTTP client in `lib/oryx.js` over adding platform SDKs.
3. Run `npm test` before opening a PR.

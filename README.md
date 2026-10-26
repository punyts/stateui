# @punyts/stateui

A state driven, browser based user interface system.

## Commands

```
npm run build         # typecheck and emit dist/
npm run test          # unit tests in happy-dom
npm run test:browser  # browser tests in headless Chromium
```

`@punyts/state` and `@punyts/expression` are consumed through their `dist/`
output, so on a fresh checkout run `npm run build` at the ai-minion repo root
first.

`npm run test:browser` needs Playwright's Chromium. Install it with
`npx playwright install chromium` (this downloads browser binaries).

A full README is planned for Epic 7.

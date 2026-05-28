# poincake

Infinite canvas notes in the Poincare disk.

The active app uses a generated `{3,7}` hyperbolic tiling as an anchored working grid.

## Development

```sh
npm install
npm run dev
```

## Checks

```sh
npm run build
npm run test
npm run e2e
```

Playwright e2e tests require browser binaries and their system libraries. On a fresh machine run `npx playwright install --with-deps chromium` or the equivalent for your OS.

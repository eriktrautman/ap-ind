# Tests

A small suite that says whether the site still works, run with Node's own test runner (no dependencies).

    npm test                                   build, then unit tests and a smoke test against a local server it starts itself
    npm run test:unit                          the library checks only (no build, no server)
    SMOKE_URL=https://electionproducer.com npm run test:smoke      the same smoke test against a deployment
    SMOKE_URL=... SMOKE_PASSWORD=... npm run test:smoke             also signs in and checks the Studio is served to that cookie

The smoke test never writes to a deployment: the publish round trip runs only against the local server it started.

**Budget: 100 tests, ever.** `budget.test.mjs` counts the `test(` calls in this directory and fails above 100. The suite is
meant to stay small enough to read in one sitting: when a new check matters more than an old one, replace the old one.
Each test covers one high-level thing a producer would notice broken (sign-in gate, ticker, chart router, data files,
publish), not internals.

GitHub Actions (`.github/workflows/test.yml`) runs `npm test` on every push and the smoke test against production
after each successful production deployment reported by Vercel.

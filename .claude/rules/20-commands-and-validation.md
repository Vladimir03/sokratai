# Commands And Validation

Run checks in sequence on Windows:

```bash
npm run dev
npm run lint
npm run build
npm run test
npm run smoke-test
npm run smoke-check
```

Notes:

- `test` runs `smoke-check` (Node-based smoke checks).
- `smoke-test` keeps the original bash-based smoke script.
- If lint fails, still run `build` + `smoke-check` and report failures precisely.
- Do not run `build` and `smoke-check` in parallel (can conflict in `dist/`).

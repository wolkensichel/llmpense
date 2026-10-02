# Contributing to LLMpense

Thanks for helping. Two things to know before you open a pull request.

## Licensing

LLMpense is **FSL-1.1-ALv2**: free to use, modify and self-host, including for
client work, but not to offer as a competing product. Each release becomes
Apache-2.0 after two years.

## Contributor License Agreement

Before we can merge your first pull request you must agree to the
[CLA](CLA.md). It lets the project license contributions under other terms in
the future while you keep the copyright to your work. You'll be asked to sign
it on your first pull request.

## Dependencies

The server must not depend on copyleft code (GPL, AGPL, LGPL, SSPL, EUPL). CI
runs `pnpm licenses:check` and fails on anything outside the allowlist in
`scripts/check-licenses.mjs`.

## Development

```bash
cp .env.example .env
docker compose up -d --wait
pnpm install
pnpm db:migrate && pnpm db:seed
pnpm dev
```

Run `pnpm typecheck && pnpm test` before pushing.

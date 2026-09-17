# SEOlytic – AI SEO Auditor

SEOlytic crawls public websites, explains SEO issues with page evidence, and helps teams prioritize fixes.

## Run & Operate

- `pnpm --filter @workspace/api-server run dev` — run the API server (port 5000)
- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all packages
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks and Zod schemas from the OpenAPI spec
- `pnpm --filter @workspace/db run push` — push DB schema changes (dev only)
- Required env: `DATABASE_URL` — Postgres connection string

## Stack

- pnpm workspaces, Node.js 24, TypeScript 5.9
- API: Express 5
- DB: PostgreSQL + Drizzle ORM
- Validation: Zod (`zod/v4`), `drizzle-zod`
- API codegen: Orval (from OpenAPI spec)
- Build: esbuild (CJS bundle)

## Where things live

- Web app: `artifacts/seolytic`
- API and crawler: `artifacts/api-server`
- API contract: `lib/api-spec/openapi.yaml`
- Database schema: `lib/db/src/schema/seolytic.ts`
- Generated hooks and validation: `lib/api-client-react` and `lib/api-zod`

## Architecture decisions

- Clerk owns browser sessions; API routes use Clerk middleware and reject unauthenticated project access.
- Crawls are asynchronous and persisted in PostgreSQL so progress survives navigation and refresh.
- Crawl targets are checked against local/private address ranges before requests are made to reduce SSRF risk.
- AI answers are grounded in stored crawl issues; without a configured provider key the app returns an explicit deterministic fallback.

## Product

Users can create SEO projects, run bounded crawls, inspect page evidence, review and filter issues, track score history, and ask project-specific assistant questions.

## User preferences

_Populate as you build — explicit user instructions worth remembering across sessions._

## Gotchas

_Populate as you build — sharp edges, "always run X before Y" rules._

## Pointers

- See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details

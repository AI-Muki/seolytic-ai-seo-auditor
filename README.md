# SEOlytic – AI SEO Auditor

SEOlytic crawls a public website, turns page evidence into transparent SEO checks, and gives teams a prioritized workspace for fixing the issues that matter.

## Local development

1. Copy `.env.example` into your environment and provide the managed Clerk values for authentication.
2. Make sure `DATABASE_URL` points to the project PostgreSQL database.
3. Install dependencies with `pnpm install`.
4. Push the current Drizzle schema with `pnpm --filter @workspace/db run push`.
5. Start the API with `pnpm --filter @workspace/api-server run dev`.
6. Start the frontend with `pnpm --filter @workspace/seolytic run dev`.

The normal Replit workflows already provide the required `PORT` and `BASE_PATH` values.

## Architecture

- `artifacts/seolytic` contains the React/Vite product UI, Clerk auth routes, dashboard, project flows, crawl progress, issue management, and assistant surface.
- `artifacts/api-server` contains the Express API, Clerk middleware, crawl orchestration, SSRF protections, and SEO rules.
- `lib/api-spec/openapi.yaml` is the API source of truth. Run `pnpm --filter @workspace/api-spec run codegen` after contract changes.
- `lib/db/src/schema/seolytic.ts` defines the PostgreSQL models for projects, crawls, pages, issues, and recommendations.

## Crawl behavior

The crawler only accepts public HTTP(S) URLs, rejects local/private network targets, respects a bounded page limit and basic robots exclusions, normalizes discovered URLs, follows a limited number of redirects, and records page-level evidence before calculating a score.

AI recommendations are grounded in stored crawl issues. If `OPENAI_API_KEY` is not configured, SEOlytic uses a deterministic evidence-backed response instead of fabricating an answer.

## Checks

```bash
pnpm run typecheck
PORT=24727 BASE_PATH=/ pnpm --filter @workspace/seolytic run build
```

## Docker

`docker compose up --build` starts PostgreSQL, Redis, and the static web container. The Replit development workflow remains the recommended way to run the API and frontend together during development.
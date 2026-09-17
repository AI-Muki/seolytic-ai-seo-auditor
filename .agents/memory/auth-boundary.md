---
name: SEOlytic auth boundary
description: Authentication and authorization boundary for the SEOlytic web app and API.
---

SEOlytic uses Clerk as the single authentication boundary. Browser workspace routes redirect signed-out visitors to Clerk sign-in, and the API rejects unauthenticated project requests with HTTP 401. The health endpoint is intentionally public for workflow and deployment probes.

**Why:** Project and crawl data must not be exposed through direct API calls just because the UI has a route guard.

**How to apply:** Keep new project-scoped API endpoints behind the existing auth middleware. Add ownership checks before treating a Clerk user as authorized to access another user's project.
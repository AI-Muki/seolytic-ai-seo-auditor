import { Router, type IRouter } from "express";
import { and, desc, eq, ilike, or, sql } from "drizzle-orm";
import { db } from "@workspace/db";
import {
  crawlsTable,
  issuesTable,
  pagesTable,
  projectsTable,
  recommendationsTable,
} from "@workspace/db";
import {
  AskAssistantBody,
  AskAssistantResponse,
  CreateProjectBody,
  CreateProjectResponse,
  GetCrawlResponse,
  GetPageResponse,
  GetProjectDashboardResponse,
  GetProjectResponse,
  ListCrawlsResponse,
  ListIssuesResponse,
  ListPagesResponse,
  ListProjectsResponse,
  ListRecommendationsResponse,
  StartCrawlBody,
  StartCrawlResponse,
  UpdateIssueBody,
  UpdateIssueResponse,
} from "@workspace/api-zod";
import { runCrawl, assertSafePublicUrl } from "../lib/crawler";

const router: IRouter = Router();

const projectResponse = (project: typeof projectsTable.$inferSelect) => ({
  ...project,
  keywords: project.keywords ?? [],
});

router.get("/projects", async (_req, res): Promise<void> => {
  const rows = await db.select().from(projectsTable).orderBy(desc(projectsTable.updatedAt));
  res.json(ListProjectsResponse.parse(rows.map(projectResponse)));
});

router.post("/projects", async (req, res): Promise<void> => {
  const parsed = CreateProjectBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  try {
    await assertSafePublicUrl(parsed.data.url);
  } catch (error) {
    res.status(400).json({ error: error instanceof Error ? error.message : "Invalid URL." });
    return;
  }
  const [project] = await db.insert(projectsTable).values({
    name: parsed.data.name,
    url: parsed.data.url,
    keywords: parsed.data.keywords ?? [],
    country: parsed.data.country ?? null,
    language: parsed.data.language ?? null,
  }).returning();
  res.status(201).json(CreateProjectResponse.parse(projectResponse(project)));
});

router.get("/projects/:projectId", async (req, res): Promise<void> => {
  const [project] = await db.select().from(projectsTable).where(eq(projectsTable.id, req.params.projectId));
  if (!project) {
    res.status(404).json({ error: "Project not found." });
    return;
  }
  res.json(GetProjectResponse.parse(projectResponse(project)));
});

router.patch("/projects/:projectId", async (req, res): Promise<void> => {
  const [project] = await db.update(projectsTable).set({
    ...req.body,
    updatedAt: new Date(),
  }).where(eq(projectsTable.id, req.params.projectId)).returning();
  if (!project) {
    res.status(404).json({ error: "Project not found." });
    return;
  }
  res.json(GetProjectResponse.parse(projectResponse(project)));
});

router.delete("/projects/:projectId", async (req, res): Promise<void> => {
  const deleted = await db.delete(projectsTable).where(eq(projectsTable.id, req.params.projectId)).returning({ id: projectsTable.id });
  if (deleted.length === 0) {
    res.status(404).json({ error: "Project not found." });
    return;
  }
  res.sendStatus(204);
});

router.get("/projects/:projectId/dashboard", async (req, res): Promise<void> => {
  const [project] = await db.select().from(projectsTable).where(eq(projectsTable.id, req.params.projectId));
  if (!project) {
    res.status(404).json({ error: "Project not found." });
    return;
  }
  const crawls = await db.select().from(crawlsTable).where(eq(crawlsTable.projectId, project.id)).orderBy(desc(crawlsTable.startedAt));
  const issues = await db.select().from(issuesTable).where(eq(issuesTable.projectId, project.id));
  const scoreHistory = crawls.filter((crawl) => crawl.score !== null).slice(0, 12).reverse().map((crawl) => ({ date: crawl.startedAt.toISOString().slice(0, 10), score: crawl.score ?? 0 }));
  const severityCounts = ["Critical", "High", "Medium", "Low"].map((label) => ({ label, count: issues.filter((issue) => issue.severity === label).length }));
  const categoryNames = ["Technical SEO", "On-page SEO", "Content", "Accessibility", "Social", "Structured data"];
  const categoryScores = categoryNames.map((category) => {
    const categoryIssues = issues.filter((issue) => issue.category === category);
    return { category, score: Math.max(0, 100 - categoryIssues.length * 8) };
  });
  const data = {
    project: projectResponse(project),
    scoreHistory,
    categoryScores,
    severityCounts,
    metrics: {
      pages: project.pagesCrawled,
      critical: severityCounts[0].count,
      high: severityCounts[1].count,
      medium: severityCounts[2].count,
      low: severityCounts[3].count,
      brokenLinks: issues.filter((issue) => issue.title.toLowerCase().includes("broken")).length,
      missingMetadata: issues.filter((issue) => issue.category === "On-page SEO").length,
      duplicateContent: issues.filter((issue) => issue.title.toLowerCase().includes("duplicate")).length,
    },
  };
  res.json(GetProjectDashboardResponse.parse(data));
});

router.get("/projects/:projectId/crawls", async (req, res): Promise<void> => {
  const rows = await db.select().from(crawlsTable).where(eq(crawlsTable.projectId, req.params.projectId)).orderBy(desc(crawlsTable.startedAt));
  res.json(ListCrawlsResponse.parse(rows));
});

router.post("/projects/:projectId/crawls", async (req, res): Promise<void> => {
  const parsed = StartCrawlBody.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const [project] = await db.select().from(projectsTable).where(eq(projectsTable.id, req.params.projectId));
  if (!project) {
    res.status(404).json({ error: "Project not found." });
    return;
  }
  const [crawl] = await db.insert(crawlsTable).values({ projectId: project.id }).returning();
  void runCrawl(project.id, crawl.id, parsed.data.maxPages ?? 25);
  res.status(202).json(StartCrawlResponse.parse(crawl));
});

router.get("/projects/:projectId/crawls/:crawlId", async (req, res): Promise<void> => {
  const [crawl] = await db.select().from(crawlsTable).where(and(eq(crawlsTable.id, req.params.crawlId), eq(crawlsTable.projectId, req.params.projectId)));
  if (!crawl) {
    res.status(404).json({ error: "Crawl not found." });
    return;
  }
  res.json(GetCrawlResponse.parse(crawl));
});

router.get("/projects/:projectId/pages", async (req, res): Promise<void> => {
  const rows = await db.select().from(pagesTable).where(eq(pagesTable.projectId, req.params.projectId)).orderBy(desc(pagesTable.score));
  const items = rows.map((page) => ({ ...page, h1: page.h1, issueCount: 0 }));
  res.json(ListPagesResponse.parse({ items, total: items.length, page: 1, limit: items.length || 20 }));
});

router.get("/projects/:projectId/pages/:pageId", async (req, res): Promise<void> => {
  const [page] = await db.select().from(pagesTable).where(and(eq(pagesTable.id, req.params.pageId), eq(pagesTable.projectId, req.params.projectId)));
  if (!page) {
    res.status(404).json({ error: "Page not found." });
    return;
  }
  const issues = await db.select().from(issuesTable).where(eq(issuesTable.pageId, page.id));
  const report = {
    ...page,
    h1: page.h1,
    issueCount: issues.length,
    headings: { h1: page.h1 ? [page.h1] : [], h2: page.h2, h3: page.h3 },
    images: { total: page.imagesTotal, missingAlt: page.imagesMissingAlt },
    links: { internal: page.internalLinks, external: page.externalLinks, broken: page.brokenLinks },
    social: { openGraph: page.openGraph, twitterCard: page.twitterCard },
    structuredData: page.structuredData,
    issues,
  };
  res.json(GetPageResponse.parse(report));
});

router.get("/projects/:projectId/issues", async (req, res): Promise<void> => {
  const term = typeof req.query.search === "string" ? req.query.search : "";
  const condition = term
    ? and(eq(issuesTable.projectId, req.params.projectId), or(ilike(issuesTable.title, `%${term}%`), ilike(issuesTable.url, `%${term}%`)))
    : eq(issuesTable.projectId, req.params.projectId);
  const rows = await db.select().from(issuesTable).where(condition).orderBy(desc(issuesTable.createdAt));
  res.json(ListIssuesResponse.parse(rows.map((issue) => ({ ...issue, recommendationId: null }))));
});

router.patch("/projects/:projectId/issues/:issueId", async (req, res): Promise<void> => {
  const parsed = UpdateIssueBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const [issue] = await db.update(issuesTable).set({ reviewed: parsed.data.reviewed }).where(and(eq(issuesTable.id, req.params.issueId), eq(issuesTable.projectId, req.params.projectId))).returning();
  if (!issue) {
    res.status(404).json({ error: "Issue not found." });
    return;
  }
  res.json(UpdateIssueResponse.parse({ ...issue, recommendationId: null }));
});

router.get("/projects/:projectId/recommendations", async (req, res): Promise<void> => {
  const rows = await db.select().from(recommendationsTable).where(eq(recommendationsTable.projectId, req.params.projectId)).orderBy(desc(recommendationsTable.createdAt));
  res.json(ListRecommendationsResponse.parse(rows));
});

router.post("/projects/:projectId/assistant", async (req, res): Promise<void> => {
  const parsed = AskAssistantBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const [project] = await db.select().from(projectsTable).where(eq(projectsTable.id, req.params.projectId));
  const issues = await db.select().from(issuesTable).where(eq(issuesTable.projectId, req.params.projectId)).orderBy(desc(issuesTable.createdAt));
  if (!project) {
    res.status(404).json({ error: "Project not found." });
    return;
  }
  const topIssues = issues.slice(0, 3).map((issue) => issue.title).join(", ");
  const answer = issues.length === 0
    ? `The latest crawl for ${project.name} has not surfaced any stored issues yet. Start a crawl to collect page-level evidence before making changes.`
    : `Based on the latest crawl of ${project.url}, SEOlytic found ${issues.length} stored issue${issues.length === 1 ? "" : "s"}. Start with ${topIssues}. These are grounded in the pages analyzed for this project; run another crawl after fixing them to measure the change.`;
  res.json(AskAssistantResponse.parse({ answer, sources: issues.slice(0, 3).map((issue) => ({ label: issue.title, url: issue.url })) }));
});

export default router;
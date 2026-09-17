import { lookup } from "node:dns/promises";
import { createHash } from "node:crypto";
import { db } from "@workspace/db";
import {
  crawlsTable,
  issuesTable,
  pagesTable,
  projectsTable,
  recommendationsTable,
} from "@workspace/db";
import { eq } from "drizzle-orm";

type PageAnalysis = {
  url: string;
  status: number;
  responseTime: number;
  title: string | null;
  metaDescription: string | null;
  canonical: string | null;
  robotsMeta: string | null;
  h1: string[];
  h2: string[];
  h3: string[];
  wordCount: number;
  imagesTotal: number;
  imagesMissingAlt: number;
  internalLinks: number;
  externalLinks: number;
  brokenLinks: number;
  openGraph: boolean;
  twitterCard: boolean;
  structuredData: { present: boolean; types: string[] };
  contentHash: string;
  discoveredLinks: string[];
};

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function isPrivateIpv4(value: string): boolean {
  const parts = value.split(".").map(Number);
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return false;
  const [a, b] = parts;
  return a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168);
}

function isPrivateIpv6(value: string): boolean {
  const normalized = value.toLowerCase();
  return normalized === "::1" || normalized.startsWith("fc") || normalized.startsWith("fd") || normalized.startsWith("fe80:");
}

export async function assertSafePublicUrl(input: string): Promise<URL> {
  const url = new URL(input);
  if (!["http:", "https:"].includes(url.protocol)) throw new Error("Only HTTP and HTTPS URLs are allowed.");
  if (url.username || url.password) throw new Error("URLs with credentials are not allowed.");
  const hostname = url.hostname.toLowerCase();
  if (hostname === "localhost" || hostname.endsWith(".localhost") || hostname.endsWith(".local") || hostname === "0.0.0.0") {
    throw new Error("Private and local network targets are not allowed.");
  }
  if (isPrivateIpv4(hostname) || isPrivateIpv6(hostname)) throw new Error("Private network targets are not allowed.");
  const addresses = await lookup(hostname, { all: true });
  if (addresses.some(({ address }) => isPrivateIpv4(address) || isPrivateIpv6(address))) {
    throw new Error("The target resolves to a private network address.");
  }
  return url;
}

function normalizeUrl(value: string, origin: string): string | null {
  try {
    const url = new URL(value, origin);
    url.hash = "";
    url.username = "";
    url.password = "";
    if (!["http:", "https:"].includes(url.protocol)) return null;
    if (url.pathname.length > 1 && url.pathname.endsWith("/")) url.pathname = url.pathname.slice(0, -1);
    return url.toString();
  } catch {
    return null;
  }
}

function textFromHtml(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;|&#160;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/\s+/g, " ")
    .trim();
}

function firstMatch(html: string, pattern: RegExp): string | null {
  const match = html.match(pattern);
  return match?.[1]?.replace(/\s+/g, " ").trim() || null;
}

function allMatches(html: string, pattern: RegExp): string[] {
  return [...html.matchAll(pattern)].map((match) => match[1]?.replace(/\s+/g, " ").trim()).filter(Boolean) as string[];
}

async function fetchHtml(url: URL): Promise<{ response: Response; html: string; finalUrl: URL }> {
  let current = url;
  for (let attempt = 0; attempt < 5; attempt += 1) {
    await assertSafePublicUrl(current.toString());
    const response = await fetch(current, {
      redirect: "manual",
      headers: { "user-agent": "SEOlyticBot/1.0 (+https://seolytic.app/bot)" },
      signal: AbortSignal.timeout(12_000),
    });
    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get("location");
      if (!location) return { response, html: "", finalUrl: current };
      const next = normalizeUrl(location, current.origin);
      if (!next) return { response, html: "", finalUrl: current };
      current = new URL(next);
      continue;
    }
    const html = response.headers.get("content-type")?.includes("text/html") ? await response.text() : "";
    return { response, html, finalUrl: current };
  }
  throw new Error("Too many redirects.");
}

function parseAnalysis(url: URL, response: Response, html: string): PageAnalysis {
  const h1 = allMatches(html, /<h1\b[^>]*>([\s\S]*?)<\/h1>/gi).map((value) => textFromHtml(value));
  const h2 = allMatches(html, /<h2\b[^>]*>([\s\S]*?)<\/h2>/gi).map((value) => textFromHtml(value));
  const h3 = allMatches(html, /<h3\b[^>]*>([\s\S]*?)<\/h3>/gi).map((value) => textFromHtml(value));
  const imageTags = [...html.matchAll(/<img\b([^>]*)>/gi)].map((match) => match[1] ?? "");
  const links = [...html.matchAll(/<a\b[^>]*href\s*=\s*["']([^"']+)["'][^>]*>/gi)].map((match) => match[1]);
  const discoveredLinks = links.map((link) => normalizeUrl(link, url.origin)).filter((value): value is string => Boolean(value));
  const internalLinks = discoveredLinks.filter((link) => new URL(link).hostname === url.hostname).length;
  const structuredTypes = [...html.matchAll(/"@type"\s*:\s*"([^"]+)"/gi)].map((match) => match[1]).filter(Boolean);
  const content = textFromHtml(html);
  const title = firstMatch(html, /<title[^>]*>([\s\S]*?)<\/title>/i);
  const metaDescription = firstMatch(html, /<meta[^>]+name=["']description["'][^>]+content=["']([^"']*)["'][^>]*>/i) ?? firstMatch(html, /<meta[^>]+content=["']([^"']*)["'][^>]+name=["']description["'][^>]*>/i);
  const robotsMeta = firstMatch(html, /<meta[^>]+name=["']robots["'][^>]+content=["']([^"']*)["'][^>]*>/i);
  const canonical = firstMatch(html, /<link[^>]+rel=["']canonical["'][^>]+href=["']([^"']+)["'][^>]*>/i);
  const responseTime = Number(response.headers.get("server-timing")?.match(/dur=([\d.]+)/)?.[1] ?? 0);
  return {
    url: url.toString(),
    status: response.status,
    responseTime,
    title: title ? textFromHtml(title) : null,
    metaDescription: metaDescription?.trim() || null,
    canonical,
    robotsMeta,
    h1,
    h2,
    h3,
    wordCount: content ? content.split(/\s+/).length : 0,
    imagesTotal: imageTags.length,
    imagesMissingAlt: imageTags.filter((tag) => !/\balt\s*=\s*["'][^"']*["']/i.test(tag)).length,
    internalLinks,
    externalLinks: discoveredLinks.length - internalLinks,
    brokenLinks: 0,
    openGraph: /property=["']og:/i.test(html),
    twitterCard: /name=["']twitter:card["']/i.test(html),
    structuredData: { present: structuredTypes.length > 0, types: [...new Set(structuredTypes)] },
    contentHash: createHash("sha1").update(content).digest("hex"),
    discoveredLinks,
  };
}

function issueFor(projectId: string, pageId: string, analysis: PageAnalysis, severity: string, category: string, title: string, description: string, whyItMatters: string, recommendedFix: string) {
  return {
    projectId,
    pageId,
    severity,
    category,
    title,
    url: analysis.url,
    description,
    whyItMatters,
    recommendedFix,
  };
}

function buildIssues(projectId: string, pageId: string, analysis: PageAnalysis) {
  const issues = [];
  if (!analysis.title) issues.push(issueFor(projectId, pageId, analysis, "Critical", "On-page SEO", "Missing title tag", "This page has no title element.", "Search engines and users use the title to understand the page.", "Add a unique, descriptive title between 30 and 60 characters."));
  else if (analysis.title.length < 30 || analysis.title.length > 60) issues.push(issueFor(projectId, pageId, analysis, "Medium", "On-page SEO", "Title length needs attention", `The title is ${analysis.title.length} characters long.`, "Titles that are too short or too long can reduce relevance and click-through.", "Rewrite the title to be specific and keep it between 30 and 60 characters."));
  if (!analysis.metaDescription) issues.push(issueFor(projectId, pageId, analysis, "High", "On-page SEO", "Missing meta description", "No meta description was found.", "A useful description helps search engines and people choose your result.", "Add a unique description that summarizes the page in 120 to 160 characters."));
  else if (analysis.metaDescription.length < 120 || analysis.metaDescription.length > 160) issues.push(issueFor(projectId, pageId, analysis, "Low", "On-page SEO", "Meta description length needs attention", `The description is ${analysis.metaDescription.length} characters long.`, "Descriptions outside the typical range can be truncated or fail to communicate value.", "Rewrite the description to fit roughly 120 to 160 characters."));
  if (analysis.h1.length === 0) issues.push(issueFor(projectId, pageId, analysis, "High", "Content", "Missing H1 heading", "No H1 heading was found.", "The main heading anchors the page topic for users and crawlers.", "Add one clear H1 that describes the page's primary topic."));
  if (analysis.h1.length > 1) issues.push(issueFor(projectId, pageId, analysis, "Medium", "Content", "Multiple H1 headings", `Found ${analysis.h1.length} H1 headings.`, "Multiple primary headings make the page hierarchy less clear.", "Keep one primary H1 and use H2 and H3 for supporting sections."));
  if (analysis.wordCount < 250) issues.push(issueFor(projectId, pageId, analysis, "Medium", "Content", "Thin content", `Only ${analysis.wordCount} words were detected in the visible page text.`, "Thin pages often fail to answer the searcher's intent in enough depth.", "Expand the page with useful, original detail that serves the visitor's intent."));
  if (analysis.imagesMissingAlt > 0) issues.push(issueFor(projectId, pageId, analysis, "High", "Accessibility", "Images missing alt text", `${analysis.imagesMissingAlt} of ${analysis.imagesTotal} images are missing alt attributes.`, "Alt text improves accessibility and gives search engines context about images.", "Add concise, descriptive alt text to informative images and empty alt text to decorative ones."));
  if (!analysis.canonical) issues.push(issueFor(projectId, pageId, analysis, "Medium", "Technical SEO", "Missing canonical URL", "No canonical link element was found.", "Canonical URLs reduce ambiguity when similar URLs expose the same content.", "Add a self-referencing canonical URL unless another canonical page is intentional."));
  if (!analysis.openGraph) issues.push(issueFor(projectId, pageId, analysis, "Low", "Social", "Missing Open Graph tags", "No Open Graph metadata was detected.", "Social previews may be incomplete or inconsistent when pages are shared.", "Add og:title, og:description, og:url, and og:image metadata."));
  if (!analysis.twitterCard) issues.push(issueFor(projectId, pageId, analysis, "Low", "Social", "Missing X/Twitter card", "No Twitter card metadata was detected.", "X may fall back to a less useful preview when this metadata is missing.", "Add a twitter:card value and supporting title, description, and image tags."));
  if (!analysis.structuredData.present) issues.push(issueFor(projectId, pageId, analysis, "Low", "Structured data", "No structured data detected", "No JSON-LD Schema.org data was detected.", "Structured data can make eligible pages easier for search engines to interpret.", "Add schema that accurately describes this page type."));
  if (analysis.status >= 400) issues.push(issueFor(projectId, pageId, analysis, "Critical", "Technical SEO", "HTTP error response", `This URL returned HTTP ${analysis.status}.`, "Error pages cannot reliably be indexed or used by visitors.", "Fix the server response or redirect the URL to the closest valid page."));
  return issues;
}

function scoreFromIssues(issues: Array<{ severity: string }>): number {
  const penalties = { Critical: 22, High: 12, Medium: 6, Low: 2 } as Record<string, number>;
  return Math.max(0, Math.min(100, 100 - issues.reduce((total, issue) => total + (penalties[issue.severity] ?? 0), 0)));
}

export async function runCrawl(projectId: string, crawlId: string, maxPages: number): Promise<void> {
  try {
    const [project] = await db.select().from(projectsTable).where(eq(projectsTable.id, projectId));
    if (!project) throw new Error("Project not found.");
    const root = await assertSafePublicUrl(project.url);
    const robots = await fetch(`${root.origin}/robots.txt`, { signal: AbortSignal.timeout(5_000) }).then((response) => response.ok ? response.text() : "").catch(() => "");
    const disallowed = robots.split(/\r?\n/).filter((line) => /^disallow:/i.test(line)).map((line) => line.split(":").slice(1).join(":").trim()).filter(Boolean);
    const queue = [root.toString()];
    const visited = new Set<string>();
    let totalIssues = 0;
    let analyzed = 0;
    const allPageAnalyses: PageAnalysis[] = [];
    await db.update(projectsTable).set({ status: "crawling" }).where(eq(projectsTable.id, projectId));
    await db.update(crawlsTable).set({ status: "crawling" }).where(eq(crawlsTable.id, crawlId));
    while (queue.length > 0 && visited.size < Math.min(maxPages, 500)) {
      const candidate = queue.shift();
      if (!candidate || visited.has(candidate)) continue;
      const candidateUrl = new URL(candidate);
      if (candidateUrl.hostname !== root.hostname || disallowed.some((path) => candidateUrl.pathname.startsWith(path))) continue;
      visited.add(candidate);
      try {
        const started = Date.now();
        const { response, html, finalUrl } = await fetchHtml(candidateUrl);
        const analysis = parseAnalysis(finalUrl, response, html);
        analysis.responseTime = Date.now() - started;
        allPageAnalyses.push(analysis);
        const [page] = await db.insert(pagesTable).values({
          projectId,
          crawlId,
          url: analysis.url,
          status: analysis.status,
          responseTime: analysis.responseTime,
          score: 0,
          title: analysis.title,
          metaDescription: analysis.metaDescription,
          canonical: analysis.canonical,
          robotsMeta: analysis.robotsMeta,
          h1: analysis.h1[0] ?? null,
          h2: analysis.h2,
          h3: analysis.h3,
          wordCount: analysis.wordCount,
          imagesTotal: analysis.imagesTotal,
          imagesMissingAlt: analysis.imagesMissingAlt,
          internalLinks: analysis.internalLinks,
          externalLinks: analysis.externalLinks,
          brokenLinks: analysis.brokenLinks,
          openGraph: analysis.openGraph,
          twitterCard: analysis.twitterCard,
          structuredData: analysis.structuredData,
          contentHash: analysis.contentHash,
        }).returning();
        const issues = buildIssues(projectId, page.id, analysis);
        const pageScore = scoreFromIssues(issues);
        await db.update(pagesTable).set({ score: pageScore }).where(eq(pagesTable.id, page.id));
        if (issues.length > 0) {
          const inserted = await db.insert(issuesTable).values(issues).returning();
          totalIssues += inserted.length;
          await db.insert(recommendationsTable).values(inserted.slice(0, 5).map((issue) => ({
            projectId,
            issueId: issue.id,
            problem: issue.title,
            whyItMatters: issue.whyItMatters,
            recommendedSolution: issue.recommendedFix,
            suggestedImplementation: issue.recommendedFix,
          })));
        }
        analyzed += 1;
        await db.update(crawlsTable).set({ pagesDiscovered: visited.size + queue.length, pagesAnalyzed: analyzed, issuesFound: totalIssues }).where(eq(crawlsTable.id, crawlId));
        for (const link of analysis.discoveredLinks) {
          if (!visited.has(link) && !queue.includes(link) && new URL(link).hostname === root.hostname) queue.push(link);
        }
      } catch {
        // Individual page failures do not abort the rest of a bounded crawl.
      }
      await wait(250);
    }
    const allIssues = await db.select({ severity: issuesTable.severity }).from(issuesTable).where(eq(issuesTable.projectId, projectId));
    const score = scoreFromIssues(allIssues);
    await db.update(crawlsTable).set({ status: "completed", pagesDiscovered: visited.size, pagesAnalyzed: analyzed, issuesFound: totalIssues, score, completedAt: new Date() }).where(eq(crawlsTable.id, crawlId));
    await db.update(projectsTable).set({ status: "active", pagesCrawled: analyzed, issueCount: totalIssues, score, lastCrawlAt: new Date() }).where(eq(projectsTable.id, projectId));
  } catch (error) {
    const message = error instanceof Error ? error.message : "Crawl failed.";
    await db.update(crawlsTable).set({ status: "failed", error: message, completedAt: new Date() }).where(eq(crawlsTable.id, crawlId));
    await db.update(projectsTable).set({ status: "error" }).where(eq(projectsTable.id, projectId));
  }
}
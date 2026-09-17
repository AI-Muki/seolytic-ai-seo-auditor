import {
  boolean,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const projectsTable = pgTable("seolytic_projects", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  url: text("url").notNull(),
  keywords: text("keywords").array().notNull().default([]),
  country: text("country"),
  language: text("language"),
  status: text("status").notNull().default("active"),
  score: integer("score").notNull().default(0),
  lastCrawlAt: timestamp("last_crawl_at", { withTimezone: true }),
  pagesCrawled: integer("pages_crawled").notNull().default(0),
  issueCount: integer("issue_count").notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const crawlsTable = pgTable("seolytic_crawls", {
  id: uuid("id").primaryKey().defaultRandom(),
  projectId: uuid("project_id").notNull().references(() => projectsTable.id, { onDelete: "cascade" }),
  status: text("status").notNull().default("queued"),
  pagesDiscovered: integer("pages_discovered").notNull().default(0),
  pagesAnalyzed: integer("pages_analyzed").notNull().default(0),
  issuesFound: integer("issues_found").notNull().default(0),
  score: integer("score"),
  startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
  completedAt: timestamp("completed_at", { withTimezone: true }),
  error: text("error"),
});

export const pagesTable = pgTable("seolytic_pages", {
  id: uuid("id").primaryKey().defaultRandom(),
  projectId: uuid("project_id").notNull().references(() => projectsTable.id, { onDelete: "cascade" }),
  crawlId: uuid("crawl_id").notNull().references(() => crawlsTable.id, { onDelete: "cascade" }),
  url: text("url").notNull(),
  status: integer("status").notNull().default(0),
  responseTime: integer("response_time").notNull().default(0),
  score: integer("score").notNull().default(0),
  title: text("title"),
  metaDescription: text("meta_description"),
  canonical: text("canonical"),
  robotsMeta: text("robots_meta"),
  h1: text("h1"),
  h2: text("h2").array().notNull().default([]),
  h3: text("h3").array().notNull().default([]),
  wordCount: integer("word_count").notNull().default(0),
  imagesTotal: integer("images_total").notNull().default(0),
  imagesMissingAlt: integer("images_missing_alt").notNull().default(0),
  internalLinks: integer("internal_links").notNull().default(0),
  externalLinks: integer("external_links").notNull().default(0),
  brokenLinks: integer("broken_links").notNull().default(0),
  openGraph: boolean("open_graph").notNull().default(false),
  twitterCard: boolean("twitter_card").notNull().default(false),
  structuredData: jsonb("structured_data").$type<{ present: boolean; types: string[] }>().notNull().default({ present: false, types: [] }),
  contentHash: text("content_hash"),
});

export const issuesTable = pgTable("seolytic_issues", {
  id: uuid("id").primaryKey().defaultRandom(),
  projectId: uuid("project_id").notNull().references(() => projectsTable.id, { onDelete: "cascade" }),
  pageId: uuid("page_id").references(() => pagesTable.id, { onDelete: "cascade" }),
  severity: text("severity").notNull(),
  category: text("category").notNull(),
  title: text("title").notNull(),
  url: text("url").notNull(),
  description: text("description").notNull(),
  whyItMatters: text("why_it_matters").notNull(),
  recommendedFix: text("recommended_fix").notNull(),
  reviewed: boolean("reviewed").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const recommendationsTable = pgTable("seolytic_recommendations", {
  id: uuid("id").primaryKey().defaultRandom(),
  projectId: uuid("project_id").notNull().references(() => projectsTable.id, { onDelete: "cascade" }),
  issueId: uuid("issue_id").notNull().references(() => issuesTable.id, { onDelete: "cascade" }),
  problem: text("problem").notNull(),
  whyItMatters: text("why_it_matters").notNull(),
  recommendedSolution: text("recommended_solution").notNull(),
  suggestedImplementation: text("suggested_implementation").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertProjectSchema = createInsertSchema(projectsTable).omit({
  id: true,
  score: true,
  lastCrawlAt: true,
  pagesCrawled: true,
  issueCount: true,
  createdAt: true,
  updatedAt: true,
});

export type InsertProject = z.infer<typeof insertProjectSchema>;
export type Project = typeof projectsTable.$inferSelect;
export type Crawl = typeof crawlsTable.$inferSelect;
export type Page = typeof pagesTable.$inferSelect;
export type Issue = typeof issuesTable.$inferSelect;
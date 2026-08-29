import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createClient } from "@supabase/supabase-js";
import { z } from "zod";

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!supabaseUrl || !supabaseServiceRoleKey) throw new Error("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required");

const supabase = createClient(supabaseUrl, supabaseServiceRoleKey);
const server = new McpServer({ name: "rolecamp-course-mcp", version: "0.2.0" });
const text = (value: unknown) => ({ content: [{ type: "text" as const, text: JSON.stringify(value, null, 2) }] });
const errorText = (message: string, details?: unknown) => ({ isError: true, content: [{ type: "text" as const, text: JSON.stringify({ error: message, details }, null, 2) }] });

server.registerTool("search_courses", {
  description: "Search RoleCamp courses by title, slug, or course type.",
  inputSchema: { query: z.string().min(1), source: z.string().optional() },
}, async ({ query, source }) => {
  let request = supabase.from("course").select("slug,title,source,status,difficulty,weeks,sessions").ilike("title", `%${query}%`).order("sort_order");
  if (source) request = request.eq("source", source);
  const { data, error } = await request;
  if (error) throw new Error(`Failed to search courses: ${error.message}`);
  return text(data ?? []);
});

server.registerTool("get_course_structure", {
  description: "Read a RoleCamp course as Course -> Module -> Chapter -> Content. The physical DB schema is hidden from the caller.",
  inputSchema: { course_slug: z.string().min(1).describe("Course slug") },
}, async ({ course_slug }) => {
  const { data: course, error: courseError } = await supabase.from("course").select("slug,title,source,subtitle,description,status,difficulty,weeks,sessions,achievements,cover_image_url,sort_order,updated_at").eq("slug", course_slug).maybeSingle();
  if (courseError) throw new Error(`Failed to load course: ${courseError.message}`);
  if (!course) return errorText("Course not found", { course_slug });

  const { data: modules, error: moduleError } = await supabase.from("chapter").select("id,title,week,outcome,sort_order").eq("course_slug", course_slug).order("sort_order");
  if (moduleError) throw new Error(`Failed to load modules: ${moduleError.message}`);
  const moduleIds = (modules ?? []).map(m => m.id);

  let lessons: Array<Record<string, unknown>> = [];
  if (moduleIds.length) {
    const { data, error } = await supabase.from("lesson").select("slug,chapter_id,title,brief,tools,sort_order,content_id").in("chapter_id", moduleIds).order("sort_order");
    if (error) throw new Error(`Failed to load chapters: ${error.message}`);
    lessons = data ?? [];
  }

  const contentIds = lessons.map(l => l.content_id).filter((id): id is string => typeof id === "string" && id.length > 0);
  let contents: Array<Record<string, unknown>> = [];
  if (contentIds.length) {
    const { data, error } = await supabase.from("content").select("id,title,section,markdown,svg,sources,updated_at").in("id", contentIds);
    if (error) throw new Error(`Failed to load content: ${error.message}`);
    contents = data ?? [];
  }
  const contentById = new Map(contents.map(c => [String(c.id), c]));
  const chaptersByModule = new Map<string, Array<Record<string, unknown>>>();
  for (const lesson of lessons) {
    const c = lesson.content_id ? contentById.get(String(lesson.content_id)) : undefined;
    const item = { id: lesson.slug, title: lesson.title, brief: lesson.brief, tools: lesson.tools, order: lesson.sort_order, content: c ? { id: c.id, title: c.title, section: c.section, markdown: c.markdown, svg: c.svg, sources: c.sources, updated_at: c.updated_at } : null };
    const list = chaptersByModule.get(String(lesson.chapter_id)) ?? [];
    list.push(item); chaptersByModule.set(String(lesson.chapter_id), list);
  }
  return text({ course, modules: (modules ?? []).map(m => ({ id: m.id, title: m.title, outcome: m.outcome, week: m.week, order: m.sort_order, chapters: chaptersByModule.get(String(m.id)) ?? [] })) });
});

server.registerTool("create_course", {
  description: "Create a new RoleCamp course record. Does not create modules or content.",
  inputSchema: {
    slug: z.string().min(1), title: z.string().min(1), source: z.string().min(1), subtitle: z.string().min(1), description: z.string().min(1),
    status: z.string().default("draft"), difficulty: z.string().default("beginner"), weeks: z.number().int().nonnegative().default(0), sessions: z.number().int().nonnegative().default(0), sort_order: z.number().int().default(0),
  },
}, async (input) => {
  const { data: existing, error: lookupError } = await supabase.from("course").select("slug").eq("slug", input.slug).maybeSingle();
  if (lookupError) throw new Error(`Failed to check course: ${lookupError.message}`);
  if (existing) return errorText("Course slug already exists", { slug: input.slug });
  const { data, error } = await supabase.from("course").insert({ ...input, achievements: [] }).select("slug,title,source,status").single();
  if (error) throw new Error(`Failed to create course: ${error.message}`);
  return text(data);
});

server.registerTool("create_module", {
  description: "Create a Module. In the current DB this is stored as a chapter record.",
  inputSchema: { course_slug: z.string().min(1), id: z.string().min(1), title: z.string().min(1), week: z.number().int().optional(), outcome: z.string().optional(), sort_order: z.number().int().default(0) },
}, async (input) => {
  const { data: course } = await supabase.from("course").select("slug").eq("slug", input.course_slug).maybeSingle();
  if (!course) return errorText("Course not found", { course_slug: input.course_slug });
  const { data: existing } = await supabase.from("chapter").select("id").eq("id", input.id).maybeSingle();
  if (existing) return errorText("Module id already exists", { id: input.id });
  const { data, error } = await supabase.from("chapter").insert(input).select("id,course_slug,title,week,outcome,sort_order").single();
  if (error) throw new Error(`Failed to create module: ${error.message}`);
  return text(data);
});

server.registerTool("create_chapter", {
  description: "Create a Chapter under a Module. In the current DB this is stored as a lesson record.",
  inputSchema: { slug: z.string().min(1), module_id: z.string().min(1), title: z.string().min(1), brief: z.string().optional(), tools: z.array(z.string()).default([]), sort_order: z.number().int().default(0), content_id: z.string().optional() },
}, async (input) => {
  const { data: module } = await supabase.from("chapter").select("id").eq("id", input.module_id).maybeSingle();
  if (!module) return errorText("Module not found", { module_id: input.module_id });
  const { data: existing } = await supabase.from("lesson").select("slug").eq("slug", input.slug).maybeSingle();
  if (existing) return errorText("Chapter slug already exists", { slug: input.slug });
  const { data, error } = await supabase.from("lesson").insert({ slug: input.slug, chapter_id: input.module_id, title: input.title, brief: input.brief ?? null, tools: input.tools, sort_order: input.sort_order, content_id: input.content_id ?? null }).select("slug,chapter_id,title,brief,tools,sort_order,content_id").single();
  if (error) throw new Error(`Failed to create chapter: ${error.message}`);
  return text(data);
});

server.registerTool("create_content", {
  description: "Create lesson content. SVG is optional but can be supplied for diagrams.",
  inputSchema: { id: z.string().min(1), title: z.string().min(1), section: z.string().min(1), markdown: z.string().min(1), svg: z.string().optional(), sources: z.array(z.unknown()).default([]) },
}, async (input) => {
  const { data: existing } = await supabase.from("content").select("id").eq("id", input.id).maybeSingle();
  if (existing) return errorText("Content id already exists", { id: input.id });
  const { data, error } = await supabase.from("content").insert({ ...input, svg: input.svg ?? null }).select("id,title,section,markdown,svg,sources,updated_at").single();
  if (error) throw new Error(`Failed to create content: ${error.message}`);
  return text(data);
});

server.registerTool("validate_course", {
  description: "Validate a course before publishing. Checks hierarchy, required content, and SVG presence per content item.",
  inputSchema: { course_slug: z.string().min(1) },
}, async ({ course_slug }) => {
  const { data: course } = await supabase.from("course").select("slug,status").eq("slug", course_slug).maybeSingle();
  if (!course) return errorText("Course not found", { course_slug });
  const { data: modules, error: me } = await supabase.from("chapter").select("id,title").eq("course_slug", course_slug).order("sort_order");
  if (me) throw new Error(me.message);
  const moduleIds = (modules ?? []).map(m => m.id);
  const { data: lessons, error: le } = moduleIds.length ? await supabase.from("lesson").select("slug,chapter_id,title,content_id").in("chapter_id", moduleIds).order("sort_order") : { data: [], error: null };
  if (le) throw new Error(le.message);
  const contentIds = (lessons ?? []).map(l => l.content_id).filter((x): x is string => typeof x === "string" && x.length > 0);
  const { data: contents, error: ce } = contentIds.length ? await supabase.from("content").select("id,markdown,svg").in("id", contentIds) : { data: [], error: null };
  if (ce) throw new Error(ce.message);
  const contentMap = new Map((contents ?? []).map(c => [c.id, c]));
  const issues: string[] = [];
  if (!modules?.length) issues.push("Course has no modules");
  for (const m of modules ?? []) {
    const ms = (lessons ?? []).filter(l => l.chapter_id === m.id);
    if (!ms.length) issues.push(`Module has no chapters: ${m.title}`);
    for (const l of ms) {
      if (!l.content_id) { issues.push(`Chapter has no content: ${l.title}`); continue; }
      const c = contentMap.get(l.content_id);
      if (!c) { issues.push(`Missing content record: ${l.title}`); continue; }
      if (!c.markdown?.trim()) issues.push(`Empty markdown: ${l.title}`);
      if (!c.svg?.trim()) issues.push(`Missing SVG: ${l.title}`);
    }
  }
  return text({ valid: issues.length === 0, course_slug, modules: modules?.length ?? 0, chapters: lessons?.length ?? 0, content: contents?.length ?? 0, issues });
});

server.registerTool("publish_course", {
  description: "Publish a validated course by changing its course status to published. Run validation first.",
  inputSchema: { course_slug: z.string().min(1) },
}, async ({ course_slug }) => {
  const validation = await validateForPublish(course_slug);
  if (!validation.valid) return errorText("Course failed validation; not published", validation);
  const { data, error } = await supabase.from("course").update({ status: "published" }).eq("slug", course_slug).select("slug,title,status,updated_at").single();
  if (error) throw new Error(`Failed to publish course: ${error.message}`);
  return text(data);
});

async function validateForPublish(course_slug: string): Promise<{ valid: boolean; issues: string[] }> {
  const { data: modules } = await supabase.from("chapter").select("id,title").eq("course_slug", course_slug);
  const ids = (modules ?? []).map(m => m.id);
  const { data: lessons } = ids.length ? await supabase.from("lesson").select("slug,chapter_id,title,content_id").in("chapter_id", ids) : { data: [] };
  const contentIds = (lessons ?? []).map(l => l.content_id).filter((x): x is string => typeof x === "string" && x.length > 0);
  const { data: contents } = contentIds.length ? await supabase.from("content").select("id,markdown,svg").in("id", contentIds) : { data: [] };
  const map = new Map((contents ?? []).map(c => [c.id, c]));
  const issues: string[] = [];
  if (!modules?.length) issues.push("Course has no modules");
  for (const m of modules ?? []) {
    const ms = (lessons ?? []).filter(l => l.chapter_id === m.id);
    if (!ms.length) issues.push(`Module has no chapters: ${m.title}`);
    for (const l of ms) {
      const c = l.content_id ? map.get(l.content_id) : undefined;
      if (!c) issues.push(`Missing content: ${l.title}`);
      else { if (!c.markdown?.trim()) issues.push(`Empty markdown: ${l.title}`); if (!c.svg?.trim()) issues.push(`Missing SVG: ${l.title}`); }
    }
  }
  return { valid: issues.length === 0, issues };
}

await server.connect(new StdioServerTransport());

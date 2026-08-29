import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createClient } from "@supabase/supabase-js";
import { z } from "zod";

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseServiceRoleKey) {
  throw new Error("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required");
}

const supabase = createClient(supabaseUrl, supabaseServiceRoleKey);
const server = new McpServer({ name: "rolecamp-course-mcp", version: "0.1.0" });

server.registerTool(
  "get_course_structure",
  {
    description: "Get a RoleCamp course as Course -> Module -> Chapter -> Content.",
    inputSchema: {
      course_slug: z.string().min(1).describe("Course slug"),
    },
  },
  async ({ course_slug }) => {
    const { data: course, error: courseError } = await supabase
      .from("course")
      .select("slug,title,subtitle,description,status,difficulty,weeks,sessions")
      .eq("slug", course_slug)
      .maybeSingle();

    if (courseError) throw new Error(`Failed to load course: ${courseError.message}`);
    if (!course) {
      return {
        isError: true,
        content: [{ type: "text", text: JSON.stringify({ error: "Course not found", course_slug }) }],
      };
    }

    // Conceptual Module = live `chapter` row.
    const { data: modules, error: moduleError } = await supabase
      .from("chapter")
      .select("id,title,week,outcome,sort_order")
      .eq("course_slug", course_slug)
      .order("sort_order", { ascending: true });

    if (moduleError) throw new Error(`Failed to load modules: ${moduleError.message}`);

    const moduleIds = (modules ?? []).map((m) => m.id);
    let lessons: Array<Record<string, unknown>> = [];
    if (moduleIds.length) {
      const { data, error } = await supabase
        .from("lesson")
        .select("slug,chapter_id,title,brief,sort_order,content_id")
        .in("chapter_id", moduleIds)
        .order("sort_order", { ascending: true });
      if (error) throw new Error(`Failed to load chapters: ${error.message}`);
      lessons = data ?? [];
    }

    const contentIds = lessons
      .map((lesson) => lesson.content_id)
      .filter((id): id is string => typeof id === "string" && id.length > 0);

    let contentRows: Array<Record<string, unknown>> = [];
    if (contentIds.length) {
      const { data, error } = await supabase
        .from("content")
        .select("id,title,section,markdown,svg,sources,updated_at")
        .in("id", contentIds);
      if (error) throw new Error(`Failed to load content: ${error.message}`);
      contentRows = data ?? [];
    }

    const contentById = new Map(contentRows.map((row) => [String(row.id), row]));
    const chaptersByModule = new Map<string, Array<Record<string, unknown>>>();

    for (const lesson of lessons) {
      const content = lesson.content_id ? contentById.get(String(lesson.content_id)) : undefined;
      const chapter = {
        id: lesson.slug,
        title: lesson.title,
        brief: lesson.brief,
        order: lesson.sort_order,
        content: content
          ? {
              id: content.id,
              title: content.title,
              section: content.section,
              markdown: content.markdown,
              svg: content.svg,
              sources: content.sources,
              updated_at: content.updated_at,
            }
          : null,
      };
      const moduleId = String(lesson.chapter_id);
      const list = chaptersByModule.get(moduleId) ?? [];
      list.push(chapter);
      chaptersByModule.set(moduleId, list);
    }

    const result = {
      course,
      modules: (modules ?? []).map((module) => ({
        id: module.id,
        title: module.title,
        outcome: module.outcome,
        week: module.week,
        order: module.sort_order,
        chapters: chaptersByModule.get(String(module.id)) ?? [],
      })),
    };

    return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
  },
);

await server.connect(new StdioServerTransport());

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
const server = new McpServer({
  name: "rolecamp-course-mcp",
  version: "0.1.0",
});

server.registerTool(
  "get_course_structure",
  {
    description:
      "Get a RoleCamp course and its Module -> Chapter -> Content hierarchy by course slug.",
    inputSchema: {
      course_slug: z.string().min(1).describe("Course slug, for example forward-deployed-product-manager"),
    },
  },
  async ({ course_slug }) => {
    const { data: course, error: courseError } = await supabase
      .from("course")
      .select("slug,title,status,source")
      .eq("slug", course_slug)
      .maybeSingle();

    if (courseError) {
      throw new Error(`Failed to load course: ${courseError.message}`);
    }
    if (!course) {
      return {
        content: [{ type: "text", text: JSON.stringify({ error: "Course not found", course_slug }) }],
        isError: true,
      };
    }

    const { data: modules, error: modulesError } = await supabase
      .from("course_section")
      .select("id,title,blurb,sort_order")
      .eq("course_slug", course_slug)
      .order("sort_order", { ascending: true });

    if (modulesError) {
      throw new Error(`Failed to load modules: ${modulesError.message}`);
    }

    const moduleIds = (modules ?? []).map((module) => module.id);
    let chapters: Array<Record<string, unknown>> = [];

    if (moduleIds.length > 0) {
      const { data, error } = await supabase
        .from("course_lesson")
        .select("id,section_id,title,sort_order,content_id,content_status")
        .in("section_id", moduleIds)
        .order("sort_order", { ascending: true });

      if (error) {
        throw new Error(`Failed to load chapters: ${error.message}`);
      }
      chapters = data ?? [];
    }

    const contentIds = chapters
      .map((chapter) => chapter.content_id)
      .filter((id): id is string => typeof id === "string" && id.length > 0);

    let contentRows: Array<Record<string, unknown>> = [];
    if (contentIds.length > 0) {
      const { data, error } = await supabase
        .from("lesson_content")
        .select("id,markdown,svg")
        .in("id", contentIds);

      if (error) {
        throw new Error(`Failed to load content: ${error.message}`);
      }
      contentRows = data ?? [];
    }

    const contentById = new Map(contentRows.map((row) => [String(row.id), row]));
    const chaptersByModule = new Map<string, Array<Record<string, unknown>>>();

    for (const chapter of chapters) {
      const moduleId = String(chapter.section_id);
      const content = chapter.content_id ? contentById.get(String(chapter.content_id)) : undefined;
      const normalizedChapter = {
        id: chapter.id,
        title: chapter.title,
        order: chapter.sort_order,
        content_status: chapter.content_status,
        content: content
          ? {
              id: content.id,
              has_markdown: typeof content.markdown === "string" && content.markdown.length > 0,
              has_svg: typeof content.svg === "string" && content.svg.length > 0,
            }
          : null,
      };

      const list = chaptersByModule.get(moduleId) ?? [];
      list.push(normalizedChapter);
      chaptersByModule.set(moduleId, list);
    }

    const result = {
      course: {
        slug: course.slug,
        title: course.title,
        status: course.status,
        source: course.source,
      },
      modules: (modules ?? []).map((module) => ({
        id: module.id,
        title: module.title,
        description: module.blurb,
        order: module.sort_order,
        chapters: chaptersByModule.get(String(module.id)) ?? [],
      })),
    };

    return {
      content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
    };
  },
);

const transport = new StdioServerTransport();
await server.connect(transport);

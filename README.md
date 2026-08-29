# RoleCamp Course MCP

MCP server for the RoleCamp course-creation workflow.

## Goal

Expose safe, business-level tools for an AI course-creation agent to read and write RoleCamp course data in Supabase.

Target learning hierarchy:

```text
Course
  └── Module
       └── Chapter
            └── Content
                 └── optional SVG
```

DeepTrack and Waypoint use the same hierarchy. The product difference is depth/amount of content, not database structure.

## Planned workflow

```text
Topic
  -> topic evaluation
  -> syllabus
  -> syllabus validation
  -> content generation
  -> content validation
  -> MCP
  -> Supabase
  -> final verification
  -> publish
```

## Safety

- No arbitrary SQL tool will be exposed to the agent.
- Database credentials stay server-side and are never committed to Git.
- Publishing is an explicit operation.
- Existing production data must be preserved during migration work.

## Status

Initial scaffold. Database-specific tool implementations will be added after the live Supabase schema is verified.

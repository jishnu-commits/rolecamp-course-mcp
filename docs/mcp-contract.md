# RoleCamp Course MCP Contract

## Purpose

The MCP is the database action layer for the RoleCamp course-creation agent. The agent decides what course content should exist; MCP persists and retrieves it from Supabase.

## Canonical learning model

```text
Course
  └── Module
       └── Chapter
            └── Content
                 └── optional SVG
```

DeepTrack and Waypoint share this model. Their difference is depth/amount of content.

## Current DB mapping

The current live schema uses the existing tables below while the conceptual MCP API uses the canonical names:

- `course` -> Course
- `course_section` -> Module
- `course_lesson` -> Chapter
- `lesson_content` -> Content

The MCP must hide these physical table names from the agent. The agent should work with Course/Module/Chapter/Content terminology.

## First tool

### `get_course_structure`

Input:

```json
{
  "course_slug": "forward-deployed-product-manager"
}
```

Behavior:

1. Find the course by slug.
2. Return course metadata.
3. Return modules in their stored order.
4. Return chapters in their stored order.
5. Return content metadata for each chapter.
6. Indicate whether content has Markdown and/or SVG.
7. Do not expose raw SQL or database credentials.

Conceptual output:

```json
{
  "course": {
    "slug": "...",
    "title": "...",
    "status": "..."
  },
  "modules": [
    {
      "id": "...",
      "title": "...",
      "order": 0,
      "chapters": [
        {
          "id": "...",
          "title": "...",
          "order": 0,
          "content": {
            "id": "...",
            "has_markdown": true,
            "has_svg": false
          }
        }
      ]
    }
  ]
}
```

## Planned tools

Read:

- `search_courses`
- `get_course`
- `get_course_structure`

Create:

- `create_course`
- `create_module`
- `create_chapter`
- `create_content`

Update:

- `update_course`
- `update_module`
- `update_chapter`
- `update_content`

Publishing:

- `validate_course`
- `publish_course`

Do not add an arbitrary `execute_sql` tool.

# RoleCamp database contract

## Verified live database

Project: `rolecamp` (Supabase, `ap-south-1`)

Relevant live tables:

- `course` — course-level metadata; primary key `slug`
- `course_stage` — legacy stage/program grouping; NOT part of the new Course → Module → Chapter → Content hierarchy
- `course_section` — current best match for **Module**; belongs to `course` through `course_slug`
- `course_lesson` — current best match for **Chapter**; belongs to `course_section` through `section_id`
- `lesson_content` — current best match for **Content**; linked from `course_lesson.content_id`
- `topic_pipeline` — topic intake/validation pipeline

## Target hierarchy

```text
Course
  └── Module
       └── Chapter
            └── Content
                 └── optional SVG
```

DeepTrack and Waypoint share this hierarchy. Their difference is depth/amount of material, not an extra hierarchy level.

## Current mapping

```text
course          -> Course
course_section  -> Module
course_lesson   -> Chapter
lesson_content  -> Content
course_stage    -> legacy / workflow metadata; do not expose as Module
```

The mapping above is based on the live relationships and real Forward Deployed Product Manager data. Do not rename tables/columns until a separate migration is approved.

## Verified example

Course: `forward-deployed-product-manager`

Current live structure contains 11 sections and 73 lessons overall in the database. The sections have meaningful thematic titles such as `The Role, Economics & Rhythm`, `Workflow Discovery & Domain Speed`, and `GenAI & Technical Fluency`. Lessons such as `The Field Product Function`, `Deployment Economics`, and `MCP fundamentals` sit underneath those sections.

The live `lesson_content` table has 73 rows and already contains both `markdown` and nullable `svg`. Existing Forward Deployed Product Manager content currently has Markdown; SVG is optional and can be added for content where a diagram materially improves understanding.

## Legacy stage finding

`course_stage` contains 5 stages for Forward Deployed Product Manager: DISCOVER, BUILD, DEPLOY, OPERATE, GENERALIZE. These are not represented in the desired frontend/course hierarchy and therefore should not become Module 1, Module 2, etc. The new course-generation system should not require a stage between Course and Module.

## Topic pipeline

`topic_pipeline` already provides a natural place to track topic intake. Current fields include:

- `topic_name`
- `status`
- `validation_evidence`
- `role_brief`
- `rejected_reason`
- `course_slug`
- `planned_modules`
- `lessons_planned`
- `lessons_published`

This supports the intended workflow:

```text
Topic
  -> evaluate/validate
  -> approve/reject
  -> generate course plan
  -> generate content
  -> publish
```

## MCP rule

The MCP must expose business-level operations, not arbitrary SQL. It should hide database implementation details from the Agent.

Initial tools:

### Read

- `search_courses`
- `get_course_structure`
- `get_topic`

### Create

- `create_course`
- `create_module`
- `create_chapter`
- `create_content`

### Update

- `update_course`
- `update_module`
- `update_chapter`
- `update_content`

### Publish

- `validate_course`
- `publish_course`

`publish_course` must be explicit; generation should default to draft state.

## Security

The live Supabase database currently has RLS disabled on the course/content and backup tables (and other tables). This is a security issue and must be addressed deliberately before exposing write access through a remotely reachable MCP. Do not automatically enable RLS without defining the required policies.

The MCP must never commit Supabase service-role credentials to Git.

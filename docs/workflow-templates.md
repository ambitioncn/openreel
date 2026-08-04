# Local workflow templates

OpenReel ships a reproducible, local-only `openreel-workflow/v1` import format. It has no public publishing endpoint.

```json
{"schema":"openreel-workflow/v1","template":"story-to-reel","version":1,"nodes":[{"id":"script","type":"script"},{"id":"frame","type":"image"},{"id":"clip","type":"video"}]}
```

Imports validate the schema, integer version, template name, unique node identifiers and supported node types. Identical JSON imports resolve to the same SHA-256 digest and stored workflow.

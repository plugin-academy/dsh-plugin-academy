# Provide a catalog

A catalog is a UTF-8 JSON document with `format: 1` and a `sources` array. Each
entry links to a native DeepSeek Harness index (`format: 1, plugins: [...]`),
not to another catalog. A static HTTPS host is enough. Serve the document
directly without a redirect.

Start with [the example catalog](../examples/catalog.json), replacing the
sample URLs and publisher details. Each source needs `url`, `title`,
`publisher.name`, and `pluginCount` (a non-negative safe integer).

- Optional fields include `id`, `description`, `publisher.id`, `publisher.url`,
  `curation` (`academy`, `community`, or `official`), `tags`, `updatedAt`, and
  `topPlugins`.
- `academy` identifies Plugin Academy-curated collections; `community`
  identifies independently curated collections. `official` is reserved for an
  index published by a company that owns every included plugin. These labels
  describe curation and ownership, not verification or executable safety.
- A catalog can contain up to 500 sources. Each source may have up to 20 tags
  and up to 10 highlighted plugins (or `pluginCount`, if smaller). A highlight
  needs a package `name`; `title`, `description`, `version`, and `homepage`
  are optional. Highlights are shown if the live preview cannot load.
- Use an ISO 8601 timestamp with a timezone for `updatedAt`. Index URLs, tags,
  and highlighted package names must be distinct after normalization.
- Academy metadata may include `pluginAcademy.resourceNames` with one distinct
  package name per listed plugin. The tab uses this optional list for display
  and search. The native index still defines what Harness can install.

Malformed known fields reject the catalog. Unknown fields are ignored.

**View Plugins** reads the native index directly in the browser when requested;
it never adds the index to the profile. For live previews, serve the index over
HTTPS with browser CORS access (for example, `Access-Control-Allow-Origin: *`).
Preview requests omit credentials, do not follow redirects, and are limited to
16 MiB decoded and 15 seconds. Loopback HTTP is allowed for development.

## Scripted profile settings

To configure a profile without the UI, set `catalogUrl` on the
`dsh-plugin-academy` entry in its `cordis.patch.yml`.
When the field is unset, the host uses `DSH_PLUGIN_ACADEMY_CATALOG_URL` if set,
then `https://plugin.academy/catalogs/dsh/catalog.json`. An explicit empty
string turns off catalog discovery.

The default fetch deadline is 15 seconds (`fetchTimeoutMs: 15000`) and the
default decoded size limit is 1 MiB (`maxBytes: 1048576`). If a refresh fails,
the tab labels the last good snapshot as stale. Switching URLs clears it.

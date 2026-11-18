# Plugin Academy DSH indexes

This guide covers native DeepSeek Harness format-1 indexes. The
[catalog guide](catalogs.md) explains how to list indexes for discovery.

## Validate and build

Node.js 22.18+:

```sh
npm ci
npm run validate
npm test
npm run validate:remote
npm run build
```

The default build emits both the installable plugin under `lib/` and native
index artifacts under `dist/`. `npm run build:indexes` builds only this guide's
static distribution. `npm run test:package` builds and verifies both outputs
while checking that native artifacts do not leak into the plugin's npm bundle.

Validation uses both the publishing JSON schema and the actual
`@deepseek-ai/dsh-plugin-market-index@0.2.2-rc.3` parser/install-target helper.
The publishing schema additionally requires source repository provenance;
it does not replace or redefine the native format. Remote checks verify
repository reachability, exact npm package versions, DSH manifest, repository
association, original author attribution, runtime requirements, integrity
metadata, and HTTPS install sources. An npm package must declare a DSH bundle;
the optional `dsh.manifestVersion` must be `1` when present. Remote checks fetch
metadata only; they never execute or install indexed plugins.

The Featured index references these published npm releases:

- `dsh-context@0.85.1` from
  [bowenliang123](https://github.com/bowenliang123/dsh-context).
- `@plugin-academy/dsh-plugin-academy@0.2.0` from
  [Plugin Academy](https://github.com/plugin-academy/dsh-plugin-academy).

Both preserve their original attribution, repository, runtime requirements and
npm source. Structural validity does not establish that a plugin is safe.
Review code and permissions before installing.

## Stable publication

`indexes.json` maps authoring paths to stable public routes. Moving source files
must not change consumer URLs. The initial artifact is:

`https://plugin.academy/dsh/featured/index.json`

The publishing schema is distributed at
`https://plugin.academy/dsh/schema/dsh-index.schema.json`.

Publish `dist/dsh/` under `/dsh/` at the public origin. This works independently
of the website and metadata repository. Do not serve the discovery catalog at
an index URL. Apply `dist/_headers` or equivalent CDN rules: HTTPS, JSON content
type, CORS `*`, five-minute cache lifetime, and no redirects. GitHub Actions
packages the native artifacts but does not deploy them; remote deployment
requires an operator's explicit hosting setup. Archive by commit SHA for
reproducibility. [npm releases](../CONTRIBUTING.md#npm-releases) are separate.

`dist/catalog-updates.json` contains counts and resource-name membership for
review in `agent-resources`. Publish the index first, then run that repository's
`sync:dsh` command. It avoids catalog commits for version-only plugin changes.
No automatic cross-repository commits or credentials are required.

PR CI performs local validation; the publication workflow also runs remote
checks and creates a SHA-versioned artifact. Network/provenance failures block
publication. Native format upgrades require an explicit parser version bump
and compatibility tests.

See the [plugin and repository README](../README.md),
[contributing](../CONTRIBUTING.md), and [governance](../GOVERNANCE.md).

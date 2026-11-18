# Contributing

## DeepSeek Harness plugin

Host and client source belongs under `src/`; tests, locales, and packaging
share the root package with index publication. Run
`npm ci && npm test && npm run test:package` for plugin changes.
`npm run build:plugin` is the focused plugin build.

Preserve the package identity, profile-backed registry, internal
`dsh-plugin-academy` ID, and existing API routes. Test catalog errors, custom
providers, Add/Added states, canonical duplicates, removal, localization, and
the released DSH client factory contract. Do not add a separate source database.

Keep `icon.svg` in sync with the Plugin Academy website's
`src/favicon.svg`. The plugin package and tab both use the local copy, so the
logo is available even when the website is offline.

## npm releases

Publish `@plugin-academy/dsh-plugin-academy` only after deploying the website.
The [public catalog](https://plugin.academy/catalogs/dsh/catalog.json) and its
Featured index must both pass `node scripts/check-live-catalog.mjs`.

### First release

npm requires the package to exist before you can configure a trusted publisher.
From a clean checkout of the reviewed `main` commit, an npm maintainer with
publish access to the `plugin-academy` organization and 2FA enabled publishes
`0.1.0` once locally (Node.js 22.18+):

```sh
(
  set -e
  npm ci
  npm run validate
  npm test
  node scripts/check-live-catalog.mjs
  release_dir=$(mktemp -d)
  tarball="$release_dir/plugin-academy-dsh-plugin-academy-0.1.0.tgz"
  trap 'rm -f -- "$tarball"; rmdir -- "$release_dir"' EXIT
  NPM_PACK_DESTINATION="$release_dir" npm run test:package
  npm login --registry=https://registry.npmjs.org
  npm publish "$tarball" --registry=https://registry.npmjs.org --access=public --ignore-scripts
)
```

### Later releases

1. Bump the stable version in `package.json` and the lockfile together
   (for example, `npm version patch --no-git-tag-version`) and merge to `main`.
2. Before the first Actions release, create the `npm` environment in GitHub
   under **Settings > Environments** and restrict it to the `main` branch. In
   the npm package's **Settings > Trusted publishing**, add GitHub Actions
   with organization `plugin-academy`,
   repository `dsh-plugin-academy`, workflow `publish-npm.yml`, and environment
   `npm`. Enable **npm publish** in the allowed actions. Set this up when the
   next version is ready: npm requires the first trusted publish within two days.
3. In GitHub Actions, manually run **Publish npm package** from `main` with the
   exact new version (no `v` prefix). It checks the public catalog, builds and
   tests the tarball, and publishes it as `latest` via npm Trusted Publishing.
   No npm token is needed in GitHub.

Confirm either release with `npm view @plugin-academy/dsh-plugin-academy@latest version`.
Routine pushes and pull requests do not publish to npm. See the
[npm Trusted Publishing guide](https://docs.npmjs.com/trusted-publishers/) for
setup details.

## Native indexes

Propose additions through pull requests. Official collections live under
`official/`; accepted community-hosted definitions belong under `community/`.
Register the stable route and reviewed publication timestamp in `indexes.json`.
Do not add fabricated versions or mutable Git branches as install targets.

Include original package name, author, HTTPS source repository, exact version,
native install source, publish timestamp and runtime requirements. Run
`npm ci && npm run validate && npm test && npm run validate:remote && npm run test:package`.
`npm run build:indexes` is the focused static distribution build.
Git sources must pin a full commit; current remote commit checks support
GitHub, and other hosts require a reviewed verification adapter.

Maintainers review source provenance, executable downloads, installation
instructions, suspicious sources, licensing and attribution before merging.
Schema validation alone is not a security review.

Independent publishers do not have to move their repositories here. Register
their external HTTPS index in `plugin-academy/agent-resources` instead, with
community curation, external hosting, and their original publisher identity.
Do not copy entire plugin packages into this repository.

Report malicious entries through private GitHub vulnerability reporting when
enabled, or contact the organization maintainers without disclosing secrets.
Corrections and non-sensitive removal requests can use public issues.

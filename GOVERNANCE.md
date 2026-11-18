# Governance

Anyone may submit indexes, plugin additions or metadata corrections.
Plugin Academy maintainers approve Academy-curated and hosted community indexes.
They also review and release the DeepSeek Harness plugin from this same root
package, preserving its native DSH integration and configuration contracts.
Only maintainers assign reviewed/featured status in the canonical metadata
repository. Independent publishers retain editorial responsibility and
ownership of their collections.

Academy curation (`academy`), community maintenance (`community`), publisher
ownership (`official`), hosting, automated validation, identity verification and
security review are separate claims. `official` is reserved for an index
published by a company that owns every included plugin. None of these labels
is a guarantee of executable safety.
Maintainers may remove malicious entries promptly, record the reason, and
accept appeals through issues.

Release ownership: maintainers approve native format upgrades, stable route
changes, publication timestamps, SHA snapshots, and deployment. Website
implementation changes are not a dependency of this pipeline.

The npm plugin and static index artifacts are distinct outputs of the shared
repository. Building or packing the plugin does not deploy indexes or
install the resources listed in them. Canonical publisher and catalog
metadata remains governed by agent-resources.

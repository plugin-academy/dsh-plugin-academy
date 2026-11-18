# Plugin Academy for DeepSeek Harness

Find plugin indexes from [Plugin Academy](https://plugin.academy) or another
catalog, then add the ones you want to browse in Harness's **Discover** tab.

## Install

You need DeepSeek Harness **0.2.2-rc.3 or newer, below 0.3.0**, and a Desktop or
Web profile.

```sh
dsh plugin --profile <profile> add @plugin-academy/dsh-plugin-academy
```

Replace `<profile>` with your profile name. Restart Harness and open
**Plugins → Plugin Academy**. Enable **Custom plugin indexes** under
**Experimental plugins** to add or remove sources.

## Find and add an index

Each index card shows how many plugins the publisher lists.

- Search the catalog by index, publisher, package, or tag. Select **View
  Plugins** to see names, descriptions, listed versions, authors, and source
  links before deciding whether to add an index. Then choose **Add Index** to
  make that source available in **Discover**.
- If an index can't be previewed, open the original index or use any highlights
  shared in the catalog.
- Have a direct index URL? Choose **Add by URL** and paste it. For example, the
  [Featured index](https://plugin.academy/dsh/featured/index.json) can be added
  without loading a catalog.

Adding an index does not install plugins. Removing an index leaves installed
plugins in place. Review the publisher, plugin source, and permissions before
installing anything.

## Change the catalog

In the **Plugin Academy** tab, open **Catalog Settings**. Paste a compatible
catalog URL or choose **Use Plugin Academy**, then select **Save Catalog URL**.
To browse only the indexes you've added, choose **Turn Off Catalog** and save.
Changing or disabling the catalog does not change your added indexes.

The [default catalog](https://plugin.academy/catalogs/dsh/catalog.json) lists
indexes; it is not itself an index for **Add by URL**. Catalog URLs use HTTPS
(loopback HTTP is allowed for development).

## Publish or contribute

- [Provide your own catalog](docs/catalogs.md) on any HTTPS host.
- [Propose an index or correct catalog metadata](https://github.com/plugin-academy/agent-resources).
  Community publishers can keep indexes on their own hosts.
- See the [contribution guide](CONTRIBUTING.md) to work on the plugin or
  [native index definitions](docs/indexes.md).

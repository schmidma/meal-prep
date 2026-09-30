# Rootless Podman with Quadlet

These examples run Meal Prep as a user systemd service with a persistent named volume. They are independent of any hypervisor, domain, or reverse-proxy product. Use a Linux host with systemd, cgroup v2, and Podman with Quadlet support; the published image supports Linux amd64.

## Install

Run these commands from the repository root, as the user who will own the service:

```sh
install -d -m 700 ~/.config/containers/systemd ~/.config/meal-prep
install -m 644 deploy/podman/meal-prep.container deploy/podman/meal-prep-data.volume ~/.config/containers/systemd/
install -m 600 deploy/podman/production.env.example ~/.config/meal-prep/production.env
```

This copies a fresh environment template; do not repeat the last command over an existing configuration.

Edit the installed files before starting:

- In `meal-prep.container`, replace `<version>` with a number from [Releases](https://github.com/schmidma/meal-prep/releases), without the leading `v`. A digest can be used instead of a version tag.
- In `production.env`, set your HTTPS origin, authentication secret, and SMTP settings. Keep this file private and outside the repository. Values use Podman's environment-file format: literal `KEY=value`, without shell expansion.
- Adapt the port binding and trusted client-address configuration as described below.

The volume is named `meal-prep-data` and mounted at `/data`. Quadlet creates it if absent; an existing volume with that name is reused. The image runs as a non-root user, and a fresh named volume receives the image directory's ownership. Do not add `UserNS=keep-id` without also arranging the volume permissions.

Start the service:

```sh
systemctl --user daemon-reload
systemctl --user start meal-prep.service
systemctl --user status meal-prep.service
journalctl --user -u meal-prep.service -f
```

The Quadlet's `[Install]` section handles automatic startup when the user manager starts; do not run `systemctl enable` on the generated service. To run at boot and after logout, an administrator can enable lingering for the service user:

```sh
sudo loginctl enable-linger "$USER"
```

## Reverse proxy

Terminate HTTPS at your reverse proxy and forward requests to the app's HTTP port 3000. Set `BETTER_AUTH_URL` and `ORIGIN` to the same external HTTPS origin users open, regardless of how the proxy reaches the app.

Choose a connection method appropriate to your deployment:

| Proxy location        | Container configuration                                                                                                                                                                              |
| --------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| On the same host      | Keep `PublishPort=127.0.0.1:3000:3000`; forward to `http://127.0.0.1:3000`.                                                                                                                          |
| On another host or VM | Replace the loopback address with the app host's private address; restrict that port to the proxy with a firewall.                                                                                   |
| In a container        | Use a shared Podman network and forward to `http://meal-prep:3000`; remove `PublishPort` if no host access is required. Rootless containers must belong to a compatible network under the same user. |

For sign-in rate limiting, configure the proxy to overwrite a client-address header with the real client IP, then set `ADDRESS_HEADER` to that header in `production.env`. Do not trust a header supplied directly by a browser. Without forwarding configuration, requests may share the proxy's rate limit. If using `X-Forwarded-For`, set `XFF_DEPTH` to the number of trusted proxy hops; see the [server's proxy guidance](https://svelte.dev/docs/kit/adapter-node#Environment-variables-ADDRESS_HEADER-and-XFF_DEPTH).

## Updates and backups

There is no automatic image update configured. Before an upgrade, stop the service and back up the entire `meal-prep-data` volume along with your private environment file. Follow the [backup guidance](../../README.md#saving-and-backups); do not copy live SQLite files independently.

```sh
systemctl --user stop meal-prep.service
podman volume inspect meal-prep-data
```

After the backup, change `Image=` in the installed Quadlet to the chosen release image. Pull that image, reload the units, and start the service:

```sh
podman pull ghcr.io/schmidma/meal-prep:<version>
systemctl --user daemon-reload
systemctl --user start meal-prep.service
```

Replace `<version>` before running the command. Confirm sign-in, your household plan, and photo access through the HTTPS URL. Restarting or replacing the container preserves the named volume. A rollback after a data migration may require restoring the matching backup, not just selecting an older image.

For changes only to `production.env`, restart the service. For changes to the Quadlet files, reload the units and restart. The [Podman Quadlet documentation](https://docs.podman.io/en/latest/markdown/podman-systemd.unit.5.html) covers additional networking and service options.

# Native deployment with systemd

Run Meal Prep directly on a Linux host with systemd, including a Debian VM or unprivileged LXC. No container engine is required. This guide uses a dedicated service account, versioned application directories, and a separate data directory. It does not depend on a particular hypervisor or reverse-proxy product.

## Prerequisites

Install Node.js 24, OpenSSL, and the usual archive tools (`tar`, `sha256sum`) using a trusted distribution or the [Node.js installation instructions](https://nodejs.org/en/download). Check `node --version` and `command -v node`; the example unit expects `/usr/bin/node`. Adjust `ExecStart` if your system-wide installation uses another path. A Node installation inside an administrator's home directory is not suitable for this service.

You also need an SMTP provider and a browser-facing HTTPS origin served by your reverse proxy. See [Hosting and email](../../README.md#hosting-and-email).

## Download a release

Choose a release with a **Linux x64** archive from [Releases](https://github.com/schmidma/meal-prep/releases). Download both `meal-prep-<version>-linux-x64.tar.gz` and its matching `.tar.gz.sha256` file into an empty working directory. Replace `<version>` below with that release's number, without the leading `v`:

```sh
sha256sum --check meal-prep-<version>-linux-x64.tar.gz.sha256
tar -xzf meal-prep-<version>-linux-x64.tar.gz
cd meal-prep-<version>-linux-x64
```

Continue only if the checksum passes. The archive includes the built app, production dependencies, and deployment examples; Node.js is installed separately. No npm install or frontend build is needed on the server. The supplied builds are tested on Ubuntu 24.04 with Node.js 24; ARM64 and other platforms are not currently tested release targets.

For releases without an archive, or to build from source, use Git and npm as a regular administrative user:

```sh
git clone --depth 1 --branch <release-tag> https://github.com/schmidma/meal-prep.git meal-prep-source
cd meal-prep-source
npm ci
npm run build
npm prune --omit=dev --ignore-scripts
```

Replace `<release-tag>` with a tag including its leading `v`. Older source releases may not contain the deployment examples; obtain them separately from the repository if needed.

## Install the release

The installed application needs `build`, production `node_modules`, `package.json`, and `LICENSE`. Keep the build on a compatible operating system and CPU architecture; do not copy dependencies built on a different platform.

From the extracted archive (or source checkout), install the built release into its own directory:

```sh
release_version=$(node -p 'JSON.parse(require("fs").readFileSync("package.json", "utf8")).version')
release_dir="/opt/meal-prep/releases/$release_version"
sudo install -d -m 755 /opt/meal-prep/releases
sudo mkdir "$release_dir"
sudo cp -a build node_modules package.json LICENSE "$release_dir/"
sudo chown -R root:root "$release_dir"
sudo chmod -R go+rX "$release_dir"
```

`mkdir` intentionally fails if that release directory already exists. Do not overwrite a running release. The runtime service account should not own or modify application files.

## Configure and start

Create the service account once, then install the bundled example files from the extracted archive:

```sh
sudo useradd --system --user-group --home-dir /var/lib/meal-prep --no-create-home --shell /usr/sbin/nologin meal-prep
sudo install -d -m 700 /etc/meal-prep
sudo install -m 600 deploy/native/production.env.example /etc/meal-prep/production.env
sudo install -m 644 deploy/native/meal-prep.service /etc/systemd/system/meal-prep.service
sudoedit /etc/meal-prep/production.env
```

Do not copy the template over an existing configuration. Replace the example origin, SMTP settings, and `CHANGE_ME` values. Generate a persistent authentication secret with `openssl rand -hex 48`. The environment file is read by systemd before it starts the service; it can remain owned by root. Use systemd environment-file quoting for values containing whitespace; shell commands and variable expansion are not evaluated.

The unit creates `/var/lib/meal-prep` with private permissions and ownership for the service account. All databases and uploaded photos are stored there, outside the release directory. The application runs with a read-only system view except for its state directory and private temporary directory.

Point `current` at the installed release and start the service, using the variables from the installation step:

```sh
sudo ln -s "$release_dir" /opt/meal-prep/current
sudo systemctl daemon-reload
sudo systemctl enable --now meal-prep.service
sudo systemctl status meal-prep.service
sudo journalctl -u meal-prep.service -f
```

Configure the proxy before testing sign-in through the HTTPS URL. Confirm email delivery, creation or access of a household, saving a plan, and photo uploads. A local request to `http://127.0.0.1:3000/sign-in` can check basic startup but does not verify the HTTPS authentication flow.

## Reverse proxy

The default listener is `127.0.0.1:3000`, suitable for a proxy on the same host. If the proxy runs elsewhere, set `HOST` to this host's private address in `production.env` and restrict port 3000 to trusted proxies. The proxy forwards HTTP to the app and handles HTTPS for browsers. `ORIGIN` must use the external HTTPS origin, not the internal forwarding address.

Configure trusted client-IP forwarding for sign-in rate limits. Set `ADDRESS_HEADER` only when the proxy supplies the real address and overwrites any client-supplied value. If using `X-Forwarded-For`, set `XFF_DEPTH` for the actual trusted proxy chain. See the [server's proxy guidance](https://svelte.dev/docs/kit/adapter-node#Environment-variables-ADDRESS_HEADER-and-XFF_DEPTH). Without this configuration, users may share the proxy's rate limit.

## Updates and backups

Download and install the new release into a fresh versioned directory using the steps above while the old release continues running. Read its release notes, then:

1. Stop the service: `sudo systemctl stop meal-prep.service`.
2. Back up the whole `/var/lib/meal-prep` directory and the private `/etc/meal-prep/production.env` file. Follow the [backup guidance](../../README.md#saving-and-backups); include SQLite journal files and uploaded photos.
3. Switch the `current` symlink to the new `release_dir` and start the service:

   ```sh
   sudo ln -sfnT "$release_dir" /opt/meal-prep/current
   sudo systemctl start meal-prep.service
   ```

4. Check the logs and verify sign-in, saved household data, and photos through the public HTTPS URL.

Keep the previous application directory and backup until the update is verified. If startup migrated data, rolling back can require restoring that backup as well as the previous symlink. Never replace databases while the service is running. Database migrations are performed by the app; no separate database server or migration command is needed.

Restart after editing `production.env`. If you change the service unit, run `systemctl daemon-reload` before restarting. Compare deployment examples when upgrading, but preserve your environment-specific settings.

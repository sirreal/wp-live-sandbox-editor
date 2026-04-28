# Live sandbox editor

## Run locally

### Prerequisites

Local development requires:

- Node.js and npm
- [Composer](https://getcomposer.org/)
- Docker
- [wp-env](https://www.npmjs.com/package/@wordpress/env), run through `npx wp-env`

### Install dependencies

Install PHP dependencies from the repository root before starting WordPress:

```sh
composer install
```

This installs the root development dependencies, including WordPress Coding Standards, and then automatically installs the plugin runtime dependencies into `live-sandbox-editor/vendor/`.

The automatic plugin install is handled by the root Composer script:

```sh
composer install --working-dir=live-sandbox-editor --no-scripts --no-dev
```

The plugin runtime dependencies are required for the WordPress plugin to work. In particular, `live-sandbox-editor/composer.json` installs `wp-php-toolkit/reprint-exporter`, and the plugin loads it through:

```text
live-sandbox-editor/vendor/autoload.php
```

If this autoloader is missing, the plugin will show an admin notice that Reprint classes are unavailable.

If you only need to refresh the plugin runtime dependencies, you can run:

```sh
composer install --working-dir=live-sandbox-editor --no-scripts --no-dev
```

Then install and build the JavaScript assets:

```sh
npm ci
npm run build
```

### Start WordPress

Start the local WordPress environment:

```sh
npx wp-env start
```

wp-env picks a free localhost port and prints the URL on start, for example:

```text
WordPress development site started at http://127.0.0.1:9400
WordPress test site started at http://127.0.0.1:9401
```

Open the development site URL in your browser. The admin is available at `/wp-admin` with:

```text
Username: admin
Password: password
```

Rebuild JavaScript on change with:

```sh
npm run dev
```

Stop the environment with:

```sh
npx wp-env stop
```

### Verify the setup

From the repository root, confirm the Composer-generated plugin autoloader exists:

```sh
test -f live-sandbox-editor/vendor/autoload.php && echo "Plugin Composer autoload is installed"
```

Expected output:

```text
Plugin Composer autoload is installed
```

Confirm the JavaScript build completed:

```sh
test -d live-sandbox-editor/build && echo "Plugin assets are built"
```

Expected output:

```text
Plugin assets are built
```

After `npx wp-env start`, open the WordPress admin and verify there is no plugin notice about missing Reprint classes or a missing Composer autoloader.

### Adding the `pdo_mysql` extension

The `reprint-exporter` package used by the plugin requires the PHP `pdo_mysql` extension.

The extension is not installed by default in wp-env and can be installed as follows from the repository root after `npx wp-env start`:

```bash
cd $(wp-env status 2>&1 | sed -n 's/.*install path: //p') && \
docker compose exec -it -u root wordpress docker-php-ext-install pdo_mysql && \
docker compose exec -it -u root wordpress service apache2 reload && \
cd -
```

If your Docker Compose command is only available as `docker-compose`, use this variant:

```bash
cd $(wp-env status 2>&1 | sed -n 's/.*install path: //p') && \
docker-compose exec -it -u root wordpress docker-php-ext-install pdo_mysql && \
docker-compose exec -it -u root wordpress service apache2 reload && \
cd -
```

After installing the extension, reload the WordPress admin page and verify there are no runtime dependency notices from the plugin.

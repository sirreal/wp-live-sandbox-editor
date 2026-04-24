# Live sandbox editor

## Run locally

Requires [wp-env](https://www.npmjs.com/package/@wordpress/env) (Docker).

```sh
npm install
npm run build
npx wp-env start
```

wp-env picks a free localhost port and prints the URL on start (e.g. `http://127.0.0.1:9400`). Admin is at `/wp-admin` (user `admin`, password `password`).

Rebuild JS on change with `npm run dev`. Stop with `npx wp-env stop`.

### Adding the `pdo_mysql` extension
The `reprint-exporter` package used by the plugin requires the `pdo_mysql` extension.
The extension is **not** installed by default in wp-env and can be installed as follows, from the repository root directory:
```bash
cd $(wp-env status 2>&1 | sed -n 's/.*install path: //p' \
  && docker compose exec -it -u root wordpress docker-php-ext-install pdo_mysql
```

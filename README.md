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

#!/bin/sh
# Install PHP extensions required by the plugin that are not bundled with wp-env.
# This script is run automatically by the wp-env afterStart lifecycle hook.

npx @wordpress/env run wordpress bash -c \
	"php -m | grep -q pdo_mysql || (sudo docker-php-ext-install pdo_mysql && sudo service apache2 reload)"

# Stands in for `npm ci`: writes the dependency tree and the lockfile.
set -e
mkdir -p node_modules/next node_modules/react
printf '{ "name": "next", "version": "15.0.3" }\n' > node_modules/next/package.json
printf '{ "name": "react", "version": "19.0.0" }\n' > node_modules/react/package.json
printf '{ "lockfileVersion": 3 }\n' > package-lock.json
echo "added 2 packages"

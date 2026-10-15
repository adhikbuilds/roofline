# Fallback when postgis/postgis has no manifest for this architecture.
# Use: ROOFLINE_PG_BUILD=local ROOFLINE_PG_IMAGE=roofline-postgres:local docker compose up -d --build --wait
FROM postgres:16-bookworm
RUN apt-get update \
 && apt-get install -y --no-install-recommends postgresql-16-postgis-3 postgresql-16-postgis-3-scripts \
 && rm -rf /var/lib/apt/lists/*

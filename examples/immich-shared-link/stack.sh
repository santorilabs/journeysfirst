#!/bin/bash
# Start or stop a local Immich from Immich's own CI image for one commit.
# Usage: ./stack.sh up <commit sha> | ./stack.sh down
# Each "up" starts from an empty database and an empty photo library.
# Machine learning is off and no mail server is set, so the app sends nothing out.
# Ports bind to 127.0.0.1 only.
set -euo pipefail
NET=immich-journey
down() { docker rm -f immich-journey-server immich-journey-redis immich-journey-db >/dev/null 2>&1 || true; docker network rm $NET >/dev/null 2>&1 || true; }
running() { [ "$(docker inspect -f '{{.State.Running}}' immich-journey-server)" = true ] || { echo "The Immich server stopped (OOMKilled=$(docker inspect -f '{{.State.OOMKilled}}' immich-journey-server)). Give Docker more memory and run up again." >&2; exit 1; }; }
case "${1:-}" in
  down) down ;;
  up)
    [ -n "${2:-}" ] || { echo "Usage: ./stack.sh up <commit sha>" >&2; exit 1; }
    down
    docker network create $NET >/dev/null
    docker run -d --name immich-journey-redis --network $NET --network-alias redis docker.io/valkey/valkey:9@sha256:4963247afc4cd33c7d3b2d2816b9f7f8eeebab148d29056c2ca4d7cbc966f2d9 >/dev/null
    docker run -d --name immich-journey-db --network $NET --network-alias database --shm-size 128m \
      -e POSTGRES_PASSWORD=postgres -e POSTGRES_USER=postgres -e POSTGRES_DB=immich \
      ghcr.io/immich-app/postgres:14-vectorchord0.4.3-pgvectors0.2.0@sha256:bcf63357191b76a916ae5eb93464d65c07511da41e3bf7a8416db519b40b1c23 \
      -c fsync=off -c shared_preload_libraries=vchord.so -c config_file=/var/lib/postgresql/data/postgresql.conf >/dev/null
    until docker exec immich-journey-db pg_isready -U postgres -d immich >/dev/null 2>&1; do sleep 1; done
    docker run -d --name immich-journey-server --network $NET -p 127.0.0.1:2285:2285 \
      -e DB_HOSTNAME=database -e DB_USERNAME=postgres -e DB_PASSWORD=postgres -e DB_DATABASE_NAME=immich \
      -e REDIS_HOSTNAME=redis -e IMMICH_MACHINE_LEARNING_ENABLED=false -e IMMICH_PORT=2285 \
      -e IMMICH_IGNORE_MOUNT_CHECK_ERRORS=true \
      "ghcr.io/immich-app/immich-server:commit-$2" >/dev/null
    until curl -sf http://127.0.0.1:2285/api/server/ping >/dev/null; do running; sleep 2; done
    # A new server imports its place-name data first. It reads photo details only after that.
    until docker logs immich-journey-server 2>&1 | grep -q "Initialized local reverse geocoder"; do running; sleep 2; done
    echo "Immich $(curl -s http://127.0.0.1:2285/api/server/version) at commit $2 on http://127.0.0.1:2285"
    ;;
  *) echo "Usage: ./stack.sh up <commit sha> | ./stack.sh down" >&2; exit 1 ;;
esac

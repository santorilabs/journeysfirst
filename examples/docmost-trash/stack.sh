#!/bin/bash
# Start or stop a local Docmost for one commit, from a fresh database.
# Usage: ./stack.sh up break|fix | ./stack.sh down
# The first "up" for a commit clones Docmost at that commit and builds an image
# with Dockerfile.proof (see README.md). Later runs reuse the image.
# Mail goes to a local Mailpit. Telemetry is off. Ports bind to 127.0.0.1 only.
set -euo pipefail
cd "$(dirname "$0")"
BREAK=ec12e80423b5048dc67f144ddc6960daf3e604a4   # merge of docmost#325
FIX=95b7be61df95ce4a2199d055cbec74dca3f080be     # merge of docmost#1445, after docmost#1439
N=docmost-journey
down() { docker rm -f $N-app $N-db $N-redis $N-mail >/dev/null 2>&1 || true; docker network rm $N >/dev/null 2>&1 || true; }
build() {
  docker image inspect "$N:$1" >/dev/null 2>&1 && return
  local src; src=$(mktemp -d)
  git clone -q https://github.com/docmost/docmost "$src"
  git -C "$src" checkout -q "$2"
  docker build -f Dockerfile.proof -t "$N:$1" "$src"
  rm -rf "$src"
}
case "${1:-}" in
  down) down ;;
  up)
    case "${2:-}" in break) SHA=$BREAK ;; fix) SHA=$FIX ;; *) echo "Usage: ./stack.sh up break|fix" >&2; exit 1 ;; esac
    build "$2" "$SHA"
    down
    docker network create $N >/dev/null
    docker run -d --name $N-db --network $N -e POSTGRES_DB=docmost -e POSTGRES_USER=docmost -e POSTGRES_PASSWORD=localpw postgres:16-alpine >/dev/null
    docker run -d --name $N-redis --network $N redis:7.2-alpine >/dev/null
    docker run -d --name $N-mail --network $N -p 127.0.0.1:8325:8025 axllent/mailpit:v1.27 >/dev/null
    until docker exec $N-db pg_isready -U docmost >/dev/null 2>&1; do sleep 1; done
    sleep 2
    docker run -d --name $N-app --network $N -p 127.0.0.1:3300:3000 \
      -e APP_URL=http://localhost:3300 -e APP_SECRET=local-journey-secret-0123456789abcdef0123456789 \
      -e DATABASE_URL="postgresql://docmost:localpw@$N-db:5432/docmost?schema=public" -e REDIS_URL=redis://$N-redis:6379 \
      -e MAIL_DRIVER=smtp -e SMTP_HOST=$N-mail -e SMTP_PORT=1025 -e SMTP_SECURE=false -e SMTP_IGNORETLS=true \
      -e MAIL_FROM_ADDRESS=docmost@example.test -e DISABLE_TELEMETRY=true "$N:$2" >/dev/null
    for _ in $(seq 1 90); do
      [ "$(curl -s -o /dev/null -w '%{http_code}' http://localhost:3300/)" = 200 ] && echo "Docmost at commit $SHA on http://localhost:3300" && exit 0
      sleep 2
    done
    docker logs --tail 30 $N-app
    echo "Docmost did not answer on http://localhost:3300 in 3 minutes. Its last log lines are above." >&2
    exit 1
    ;;
  *) echo "Usage: ./stack.sh up break|fix | ./stack.sh down" >&2; exit 1 ;;
esac

#!/usr/bin/env bash
# Wrapper para rodar o stack do Eagle em produção.
# Script vive em eagle-back/. Assume eagle-front como repo irmão (../eagle-front).

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
COMPOSE_FILE="$SCRIPT_DIR/docker-compose.prod.yml"
ENV_FILE="$SCRIPT_DIR/.env.production"
FRONT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)/eagle-front"

if [[ ! -f "$COMPOSE_FILE" ]]; then
  echo "compose file não encontrado: $COMPOSE_FILE" >&2
  exit 1
fi

if [[ ! -d "$FRONT_DIR" ]]; then
  echo "eagle-front não encontrado em: $FRONT_DIR" >&2
  echo "clone o eagle-front como diretório irmão do eagle-back." >&2
  exit 1
fi

compose() {
  if [[ -f "$ENV_FILE" ]]; then
    docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" "$@"
  else
    docker compose -f "$COMPOSE_FILE" "$@"
  fi
}

cmd="${1:-help}"
shift || true

case "$cmd" in
  up)
    if [[ ! -f "$ENV_FILE" ]]; then
      echo ".env.production faltando em $ENV_FILE" >&2
      echo "copie de .env.production.example e ajuste antes." >&2
      exit 1
    fi
    compose up -d --build "$@"
    ;;
  down)        compose down "$@" ;;
  logs)        compose logs -f "$@" ;;
  ps)          compose ps "$@" ;;
  restart)     compose restart "$@" ;;
  rebuild)     compose up -d --build --force-recreate "$@" ;;
  pull-code)
    git -C "$SCRIPT_DIR" pull --ff-only
    git -C "$FRONT_DIR" pull --ff-only
    git -C "$FRONT_DIR" submodule update --remote shared/eagle-back
    ;;
  psql)
    docker exec -it eagle-postgres-prod psql -U "${POSTGRES_USER:-eagle}" -d "${POSTGRES_DB:-eagle}"
    ;;
  help|--help|-h|"")
    cat <<EOF
uso: $0 <cmd> [args...]

  up          build + start (postgres + back + front)
  down        stop containers (volumes preservados)
  logs [svc]  segue logs (sem arg: todos os services)
  ps          lista containers
  restart svc reinicia um service
  rebuild     up -d --build --force-recreate
  pull-code   git pull nos dois repos + atualiza submodule do front
  psql        abre psql no container do postgres
  help        mostra isto

paths:
  script:   $SCRIPT_DIR
  compose:  $COMPOSE_FILE
  env:      $ENV_FILE
  front:    $FRONT_DIR
EOF
    ;;
  *)
    echo "comando desconhecido: $cmd" >&2
    "$0" help
    exit 1
    ;;
esac

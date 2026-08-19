SHELL := /bin/bash

COMPOSE ?= docker compose
PM      ?= pnpm
DB_CONTAINER := eagle-postgres
DB_USER      := eagle
DB_NAME      := eagle

.PHONY: help setup install env up down restart logs ps wait-db \
        db-generate db-push db-migrate db-seed db-reset db-studio psql \
        db-fix-encoding db-fix-encoding-apply \
        dev build start clean nuke

help:
	@echo "Eagle Back — Make targets"
	@echo ""
	@echo "  make setup        Full bootstrap: env + install + up + wait + push + seed"
	@echo "  make install      Install deps ($(PM))"
	@echo "  make env          Copy .env.example -> .env (if missing)"
	@echo ""
	@echo "  make up           Start Postgres (docker compose up -d)"
	@echo "  make down         Stop Postgres"
	@echo "  make restart      Restart Postgres"
	@echo "  make logs         Tail Postgres logs"
	@echo "  make ps           Show container status"
	@echo "  make wait-db      Block until Postgres healthy"
	@echo ""
	@echo "  make db-generate  prisma generate"
	@echo "  make db-push      prisma db push (sync schema)"
	@echo "  make db-migrate   prisma migrate dev"
	@echo "  make db-seed      Run prisma/seed.ts"
	@echo "  make db-reset     Drop volume, recreate, push, seed"
	@echo "  make db-studio    Open Prisma Studio"
	@echo "  make db-fix-encoding        Report mojibake (acentos quebrados) no banco"
	@echo "  make db-fix-encoding-apply  Corrige mojibake no banco (grava)"
	@echo "  make psql         psql shell into container"
	@echo ""
	@echo "  make dev          Start API in watch mode"
	@echo "  make build        tsc build"
	@echo "  make start        Run built API"
	@echo ""
	@echo "  make clean        Stop containers (keep volume)"
	@echo "  make nuke         Stop + delete volume (DESTROYS DATA)"

setup: env install up wait-db db-generate db-push db-seed
	@echo ""
	@echo "✓ Setup complete. Run: make dev"

env:
	@if [ ! -f .env ]; then cp .env.example .env && echo "Created .env from .env.example"; else echo ".env already exists"; fi

install:
	$(PM) install

up:
	$(COMPOSE) up -d postgres

down:
	$(COMPOSE) stop postgres

restart:
	$(COMPOSE) restart postgres

logs:
	$(COMPOSE) logs -f postgres

ps:
	$(COMPOSE) ps

wait-db:
	@echo "Waiting for Postgres..."
	@for i in {1..30}; do \
		if docker exec $(DB_CONTAINER) pg_isready -U $(DB_USER) -d $(DB_NAME) >/dev/null 2>&1; then \
			echo "Postgres ready."; exit 0; \
		fi; \
		sleep 1; \
	done; \
	echo "Postgres did not become ready in time" >&2; exit 1

db-generate:
	$(PM) run db:generate

db-push:
	$(PM) run db:push

db-migrate:
	$(PM) exec prisma migrate dev

db-seed:
	$(PM) run db:seed

db-reset: down
	$(COMPOSE) rm -fv postgres
	docker volume rm eagle-back_eagle_pgdata 2>/dev/null || true
	$(MAKE) up wait-db db-generate db-push db-seed

db-studio:
	$(PM) run db:studio

db-fix-encoding:
	$(PM) run db:fix-encoding

db-fix-encoding-apply:
	$(PM) run db:fix-encoding -- --apply

psql:
	docker exec -it $(DB_CONTAINER) psql -U $(DB_USER) -d $(DB_NAME)

dev:
	$(PM) run dev

build:
	$(PM) run build

start:
	$(PM) run start

clean: down

nuke: down
	$(COMPOSE) rm -fv postgres
	docker volume rm eagle-back_eagle_pgdata 2>/dev/null || true
	@echo "Postgres data destroyed."

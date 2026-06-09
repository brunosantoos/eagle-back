# Eagle Center — Deploy guiado por Claude Code na VPS

Este documento é o **passo a passo executável** para subir o stack do Eagle em uma VPS limpa. Foi escrito assumindo que quem vai executar é o Claude Code rodando na própria VPS (via SSH). Cada bloco de comando é direto: copia, cola, executa.

Cada passo termina com um **check** — uma saída esperada. Se o check falhar, **pare** e investigue antes de seguir.

---

## Layout final esperado

```
/opt/eagle/
├── eagle-back/                     ← repo do backend (este arquivo vive aqui)
│   ├── deploy.sh                   ← wrapper script
│   ├── DEPLOY.md                   ← este arquivo
│   ├── docker-compose.prod.yml
│   ├── .env.production             ← criado no Passo 2
│   ├── deploy/apache-eagle.conf
│   └── ...
└── eagle-front/                    ← repo do frontend
    ├── shared/eagle-back/          ← submodule (NÃO esquecer --recurse-submodules no clone)
    └── ...
```

A pasta wrapper `/opt/eagle/` é só organizacional (sem git). Os comandos do `deploy.sh` ficam em `eagle-back/deploy.sh` — invoque de qualquer cwd:

```bash
/opt/eagle/eagle-back/deploy.sh up
# ou, se estiver em /opt/eagle/:
./eagle-back/deploy.sh up
```

Domínios:
- `https://eagleacademia.com.br` → frontend
- `https://api.eagleacademia.com.br` → backend

Portas no host (loopback, Apache faz proxy):
- `127.0.0.1:6666` — nginx do front
- `127.0.0.1:3033` — backend Express
- Postgres sem porta no host (rede interna do compose, sem colisão com outro Postgres já existente na VPS)

---

## Passo 0 — Pré-requisitos na VPS

```bash
# Docker + plugin compose
docker --version && docker compose version

# Apache + módulos
apache2 -v && apache2ctl -M 2>/dev/null | grep -E 'proxy_module|proxy_http_module|rewrite_module|headers_module|ssl_module'

# Certbot
certbot --version

# git
git --version
```

**Check:** todos retornam versão sem erro. Se faltar algo:

```bash
sudo apt-get update
sudo apt-get install -y docker.io docker-compose-plugin apache2 certbot python3-certbot-apache git
sudo a2enmod proxy proxy_http rewrite headers ssl
sudo systemctl reload apache2
```

DNS apontando pro IP da VPS (sem isso o certbot falha):
- `eagleacademia.com.br` A → IP_DA_VPS
- `www.eagleacademia.com.br` A → IP_DA_VPS
- `api.eagleacademia.com.br` A → IP_DA_VPS

**Check:** `dig +short eagleacademia.com.br api.eagleacademia.com.br www.eagleacademia.com.br` retorna o IP da VPS.

---

## Passo 1 — Clonar os repos

```bash
sudo mkdir -p /opt/eagle
sudo chown "$USER:$USER" /opt/eagle
cd /opt/eagle

git clone https://github.com/brunosantoos/eagle-back.git eagle-back
git clone --recurse-submodules https://github.com/brunosantoos/eagle-front.git eagle-front

chmod +x /opt/eagle/eagle-back/deploy.sh
```

**Check:**

```bash
ls /opt/eagle/
# esperado: eagle-back  eagle-front

ls /opt/eagle/eagle-back/deploy.sh /opt/eagle/eagle-back/docker-compose.prod.yml /opt/eagle/eagle-back/DEPLOY.md
# esperado: 3 arquivos listados sem erro

ls /opt/eagle/eagle-front/shared/eagle-back/src/router.ts
# esperado: arquivo existe. Se "No such file", o submodule não foi clonado:
#   cd /opt/eagle/eagle-front && git submodule update --init --recursive
```

---

## Passo 2 — Configurar `.env.production`

```bash
cd /opt/eagle/eagle-back
cp .env.production.example .env.production
```

Editar `.env.production` (use `nano .env.production` ou Edit) e garantir:

| Var | Valor |
|-----|-------|
| `POSTGRES_USER` | `eagle` (ou outro) |
| `POSTGRES_PASSWORD` | **senha forte aleatória** (`openssl rand -base64 24`) |
| `POSTGRES_DB` | `eagle` |
| `BETTER_AUTH_SECRET` | **string aleatória 32+ chars** (`openssl rand -hex 32`) |
| `BETTER_AUTH_URL` | `https://api.eagleacademia.com.br` |
| `CORS_ORIGIN` | `https://eagleacademia.com.br` |
| `SEED_ON_START` | `true` (apenas no primeiro boot — vamos desligar depois) |
| `VITE_API_URL` | `https://api.eagleacademia.com.br/trpc` |
| `VITE_BACKEND_URL` | `https://api.eagleacademia.com.br` |

**Check:**

```bash
grep -E '^(POSTGRES_PASSWORD|BETTER_AUTH_SECRET|BETTER_AUTH_URL|CORS_ORIGIN)=' /opt/eagle/eagle-back/.env.production
# Cada linha existe e não termina em "change-me..." ou está vazia.
```

---

## Passo 3 — Subir o stack

```bash
cd /opt/eagle
./eagle-back/deploy.sh up
```

Isto faz:
1. Build da imagem do backend (Node 20 + Prisma + tsx + Express)
2. Build da imagem do frontend (Node 20 build + nginx serve)
3. Sobe Postgres, espera healthcheck
4. Sobe backend (roda `prisma db push` no entrypoint + seed se `SEED_ON_START=true`)
5. Sobe frontend

**Check:**

```bash
./eagle-back/deploy.sh ps
# esperado: 3 containers Up:
#   eagle-postgres-prod  (healthy)
#   eagle-backend
#   eagle-frontend

./eagle-back/deploy.sh logs backend | head -30
# esperado: "Eagle backend running on http://localhost:3033"
# e antes disso: "[entrypoint] running prisma db push..." sem erro

curl -sf http://127.0.0.1:3033/health
# esperado: {"ok":true}

curl -sI http://127.0.0.1:6666/
# esperado: HTTP/1.1 200 OK  (nginx do front)
```

Se algo falhar, `./eagle-back/deploy.sh logs <service>` (backend/frontend/postgres) e investigue.

---

## Passo 4 — Configurar Apache (dois vhosts)

```bash
sudo cp /opt/eagle/eagle-back/deploy/apache-eagle.conf /etc/apache2/sites-available/eagle.conf
sudo a2ensite eagle
sudo apachectl configtest
```

**Check:** `configtest` retorna `Syntax OK`. Se reclamar de SSL faltando, é esperado neste momento — vamos rodar o certbot no próximo passo, que vai injetar os paths corretos.

Por enquanto, comente as linhas `SSLCertificateFile` e `SSLCertificateKeyFile` em `/etc/apache2/sites-available/eagle.conf` para o configtest passar, OU pule este passo e deixe o certbot configurar automaticamente:

```bash
sudo systemctl reload apache2 || true
```

---

## Passo 5 — Certificados HTTPS (certbot)

```bash
sudo certbot --apache \
  -d eagleacademia.com.br -d www.eagleacademia.com.br \
  --non-interactive --agree-tos --email seu@email.com --redirect

sudo certbot --apache \
  -d api.eagleacademia.com.br \
  --non-interactive --agree-tos --email seu@email.com --redirect
```

Substitua `seu@email.com` por um email real.

**Check:**

```bash
sudo certbot certificates
# esperado: 2 certs ativos para eagleacademia.com.br + api.eagleacademia.com.br

curl -sI https://eagleacademia.com.br/ | head -3
# esperado: HTTP/2 200 (ou 301 se Apache redireciona / → SPA)

curl -sf https://api.eagleacademia.com.br/health
# esperado: {"ok":true}
```

---

## Passo 6 — Smoke test da aplicação

1. Abra `https://eagleacademia.com.br/` no browser. Site público carrega.
2. Vá para `https://eagleacademia.com.br/admin/login`.
3. Login com `admin@admin.com` / `admin@123`.
4. Dashboard abre.

Se login falhar:
- DevTools → Network → request de login. Resposta deve ser 200 e setar cookie `__Secure-better-auth.session_token` no domínio `api.eagleacademia.com.br`.
- Se cookie não persiste: verificar `BETTER_AUTH_URL` no `.env.production` (deve bater com domínio da API exato, com https).
- Se CORS bloqueado: verificar `CORS_ORIGIN` (domínio do front exato, com https, sem trailing slash).

---

## Passo 7 — Desligar seed e trocar senha de admin

1. **Trocar senha do admin** no painel imediatamente (Admin → Usuários → editar `admin@admin.com`).
2. Desligar seed:

```bash
sed -i 's/^SEED_ON_START=true/SEED_ON_START=false/' /opt/eagle/eagle-back/.env.production
cd /opt/eagle && ./eagle-back/deploy.sh restart backend
```

**Check:**

```bash
grep '^SEED_ON_START=' /opt/eagle/eagle-back/.env.production
# esperado: SEED_ON_START=false

./eagle-back/deploy.sh logs backend | tail -5 | grep -v 'seeding'
# esperado: linha de seed NÃO aparece após restart
```

---

## Operação contínua

### Atualizar código

```bash
cd /opt/eagle
./eagle-back/deploy.sh pull-code
./eagle-back/deploy.sh up        # rebuild + restart serviços com diff
```

`pull-code` faz `git pull` nos dois repos e `git submodule update --remote` no front (pra trazer tipos novos do back).

### Logs

```bash
./eagle-back/deploy.sh logs                # todos
./eagle-back/deploy.sh logs backend        # só backend
./eagle-back/deploy.sh logs frontend       # só nginx do front
```

### Acessar Postgres

```bash
docker exec -it eagle-postgres-prod psql -U eagle -d eagle
```

### Backup

```bash
docker run --rm -v eagle-prod_eagle_pgdata:/data -v "$(pwd):/backup" alpine \
  tar -czf "/backup/pgdata-$(date +%F).tgz" -C /data .
docker run --rm -v eagle-prod_eagle_uploads:/data -v "$(pwd):/backup" alpine \
  tar -czf "/backup/uploads-$(date +%F).tgz" -C /data .
```

---

## Troubleshooting

| Sintoma | Causa provável | Fix |
|---------|----------------|-----|
| `Repository not found` ao clonar | URL errada ou repo privado sem auth | Confira URL; configure SSH key ou troque pra HTTPS com token |
| `Cannot find module '@prisma/client'` no build do front | Submodule não foi clonado, ou postinstall não rodou | `cd eagle-front && git submodule update --init && pnpm install` |
| `502 Bad Gateway` no Apache | Container caído ou porta diferente | `./eagle-back/deploy.sh ps` + `./eagle-back/deploy.sh logs <svc>` |
| Login não persiste | `BETTER_AUTH_URL` ≠ domínio da API real | Ajuste `.env.production` + `./eagle-back/deploy.sh restart backend` |
| CORS bloqueado | `CORS_ORIGIN` ≠ domínio do front real | Ajuste `.env.production` + `./eagle-back/deploy.sh restart backend` |
| Upload retorna URL com `localhost` | `VITE_BACKEND_URL` errado durante build | Ajuste env + `./eagle-back/deploy.sh up` (rebuild) |
| Postgres não conecta | Senha mudou depois do volume já criado | `docker volume rm eagle-prod_eagle_pgdata` (PERDE DADOS) ou troque senha via SQL |
| Certbot falha | DNS ainda não propagou | `dig +short <domínio>` deve mostrar IP da VPS. Espere propagação. |

---

## Para Claude executando este guia

- Execute um passo por vez, na ordem.
- Após cada passo, rode o **Check** e cole a saída antes de seguir.
- Se um Check falhar, **não tente o próximo passo**. Investigue, ajuste, re-rode o Check.
- Comandos que precisam de input (editor de texto, certbot interativo) — use as flags `--non-interactive` quando possível, ou peça ao usuário pra preencher e voltar.
- Nunca commite `.env.production` em git (já está no `.gitignore` do back).
- Operações destrutivas (`docker volume rm`, `down -v`, `db-reset`) — sempre confirme com usuário antes.

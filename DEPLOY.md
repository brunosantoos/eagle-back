# Deploy Eagle Center — VPS + Apache + Docker

Front e API em **domínios separados**:

- Front: `https://eagleacademia.com.br`
- API:   `https://api.eagleacademia.com.br`

Portas no host (somente loopback, Apache faz o proxy reverso):

- `127.0.0.1:6666` → container nginx do frontend
- `127.0.0.1:3033` → backend Express/tRPC
- Postgres: **sem porta no host** (apenas rede interna do compose, sem colisão com outro Postgres já existente na VPS)

## Pré-requisitos no VPS

- Docker + Docker Compose plugin
- Apache 2.4+ com `proxy`, `proxy_http`, `headers`, `rewrite`, `ssl` habilitados
- Certbot (Let's Encrypt) para certificado HTTPS
- DNS A/AAAA apontando para o IP da VPS:
  - `eagleacademia.com.br`
  - `www.eagleacademia.com.br`
  - `api.eagleacademia.com.br`

## Passos

```bash
# 1. Clone o repositório
git clone <repo> eagle && cd eagle

# 2. Configure env de produção
cp .env.production.example .env.production
nano .env.production    # ajuste senhas + segredo (domínios já vêm corretos)

# 3. Build + sobe stack docker (postgres + backend + frontend)
docker compose --env-file .env.production -f docker-compose.prod.yml up -d --build

# 4. Verifica
docker compose -f docker-compose.prod.yml ps
docker compose -f docker-compose.prod.yml logs -f backend

# 5. Configura Apache (dois vhosts: front + api)
sudo cp deploy/apache-eagle.conf /etc/apache2/sites-available/eagle.conf
sudo a2enmod proxy proxy_http rewrite headers ssl
sudo a2ensite eagle
sudo apachectl configtest
sudo systemctl reload apache2

# 6. Certificados HTTPS (um por domínio)
sudo certbot --apache -d eagleacademia.com.br -d www.eagleacademia.com.br
sudo certbot --apache -d api.eagleacademia.com.br
```

## Após primeiro boot

Setar `SEED_ON_START=false` no `.env.production` e reiniciar backend pra não tentar seedar novamente:

```bash
docker compose --env-file .env.production -f docker-compose.prod.yml up -d backend
```

Login inicial: `admin@admin.com` / `admin@123` — **troque imediatamente** dentro do painel.

## Volumes persistentes

- `eagle_pgdata` — dados do Postgres
- `eagle_uploads` — arquivos enviados via `/api/upload`

Backup:

```bash
docker run --rm -v eagle-prod_eagle_pgdata:/data -v $(pwd):/backup alpine \
  tar -czf /backup/pgdata-$(date +%F).tgz -C /data .
docker run --rm -v eagle-prod_eagle_uploads:/data -v $(pwd):/backup alpine \
  tar -czf /backup/uploads-$(date +%F).tgz -C /data .
```

Acessar Postgres do host (sem porta exposta):

```bash
docker exec -it eagle-postgres-prod psql -U eagle -d eagle
```

## Atualizações de código

```bash
git pull
docker compose --env-file .env.production -f docker-compose.prod.yml up -d --build
```

Backend roda `prisma db push` no entrypoint — schema do Postgres é sincronizado automaticamente.

> **Atenção:** `VITE_API_URL` e `VITE_BACKEND_URL` são **build args**. Se mudar o domínio da API, é obrigatório rebuildar o front com `--build`, senão o bundle continua com a URL antiga.

## Troubleshooting

| Problema | Fix |
|---------|-----|
| `502 Bad Gateway` no front | Container `eagle-frontend` caído ou porta 6666 errada. `docker compose -f docker-compose.prod.yml ps` |
| `502 Bad Gateway` na API | Container `eagle-backend` caído ou porta 3033 errada. `docker compose -f docker-compose.prod.yml logs backend` |
| Login não persiste session | `BETTER_AUTH_URL` deve ser `https://api.eagleacademia.com.br`. `CORS_ORIGIN` deve ser `https://eagleacademia.com.br`. Cookies precisam de HTTPS válido. |
| CORS bloqueado no browser | Confira `CORS_ORIGIN` no `.env.production` (origem do front, exata, com https). |
| Upload retorna URL com `localhost` | Front buildado sem `VITE_BACKEND_URL`. Rebuild com `--build` após ajustar env. |
| Front aponta pra API errada | Rebuild do front depois de mudar `VITE_API_URL`. Limpa cache do navegador. |

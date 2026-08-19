# Eagle Center Fitness — Backend (CLAUDE.md)

API (Express + tRPC v11 + Prisma + better-auth + multer).

Este é o repo do backend. O frontend vive num repo separado (`eagle-front`).
Para desenvolvimento e build de produção, o front consome os tipos do tRPC do back via **git submodule** em `eagle-front/shared/eagle-back/` (apontando para este repo).

Layout esperado em dev e na VPS:

```
<workspace>/
├── eagle-back/    ← este repo
└── eagle-front/   ← repo separado, com submodule shared/eagle-back apontando aqui
```

O `docker-compose.prod.yml` deste repo orquestra o stack inteiro (postgres + back + front) e referencia `../eagle-front` como contexto de build do front.

---

## Comandos principais

### Backend (`eagle-back/`)

Usar **Makefile** (não rode `pnpm` diretamente pra setup de DB):

```bash
make setup      # env + install + up postgres + push + seed (full bootstrap)
make up         # sobe postgres (docker compose)
make down       # para postgres (mantém volume)
make wait-db    # bloqueia até pg_isready
make db-push    # prisma db push
make db-seed    # cria admin@admin.com / admin@123 + siteContent.main
make db-reset   # drop volume + recreate + push + seed
make db-studio  # Prisma Studio
make psql       # psql shell no container
make dev        # pnpm run dev (tsx watch)
make nuke       # destrói volume (DATA LOSS)
```

Postgres roda em `localhost:5432`, user/pass/db = `eagle`. Container: `eagle-postgres`.

Se mudar `schema.prisma`, sempre `make db-generate db-push` antes do seed — senão Prisma Client fica stale e dá erro de validation com schema antigo.

### Frontend (`eagle-front/`)

```bash
pnpm install
pnpm dev          # Vite dev server (porta 3000)
pnpm build        # tsc + vite build
pnpm exec tsc --noEmit   # typecheck
```

Backend deve estar rodando em `http://localhost:3001` (configurável via `VITE_BACKEND_URL` + `VITE_API_URL`).

**CORS está aberto**: o backend responde a qualquer origem, com credenciais
(`cors({ origin: true, credentials: true })` em `src/index.ts`). `origin: true` reflete o Origin do
request — `*` não pode ser usado junto de `Allow-Credentials`. O better-auth acompanha com
`trustedOrigins: ['*']` e `advanced.disableCSRFCheck: true`; sem isso o login recusaria origem
não listada mesmo com o CORS liberado.

`CORS_ORIGIN` deixou de ser lido. Sem restrição de origem, a única barreira contra requisição
partindo de outro site é o `SameSite=Lax` do cookie de sessão.

### Portas

| Ambiente | Frontend | Backend | Postgres |
|----------|----------|---------|----------|
| Dev local | 3000 (`vite --port=3000`) | 3001 | 5432 |
| Produção (VPS, loopback) | 6666 | 3033 | sem porta no host |

Pra matar processo em porta: `lsof -ti :<port> | xargs kill`.

---

## Arquitetura

### tRPC

- Tipos compartilhados via git submodule: `eagle-front/src/lib/trpc.ts` faz `import type { AppRouter } from '../../shared/eagle-back/src/router'`. `shared/eagle-back` é submodule deste repo dentro do front.
- **Não há build step de tipos** — front tsc lê fonte do back direto pelo submodule. Após mudança no router do back: commit + push no back, depois `git submodule update --remote shared/eagle-back` no front (ou `git pull` dentro de `shared/eagle-back`).
- Cliente: `createTRPCReact<AppRouter>()` + `httpBatchLink` apontando pra `/trpc`, sempre com `credentials: 'include'`.

### Procedures (em `eagle-back/src/trpc.ts`)

- `publicProcedure` — sem auth (forms públicos, GET de conteúdo)
- `protectedProcedure` — qualquer user logado e ativo
- `adminProcedure` — apenas `role === 'admin'`
- `leadsProcedure` — `admin` ou `user` (gerenciam leads/contatos)
- `contentProcedure` — `admin` ou `editor` (editam textos do site)

### Roles

3 papéis, criados via tela "Usuários" (apenas admin):

- **admin** — tudo (textos + leads/contatos + usuários)
- **editor** — só textos do site
- **user** — só leads/contatos (kanban)

Default seed: `admin@admin.com / admin@123`.

Frontend gating: `AdminAuthProvider` expõe `role`; `AdminDashboard` filtra `allowedSections`; `AdminUsersProvider.list.useQuery` tem `enabled: role === 'admin'` pra evitar 403 em editor/user.

### Schema (`eagle-back/prisma/schema.prisma`)

Postgres. Models:

- `User` + `Session` + `Account` + `Verification` — better-auth padrão
- `SiteContent` — chave única `main` com JSON serializado de todo conteúdo do site
- `FranchiseLead` — formulário de franquia (kanban: novo/contatado/qualificado/encerrado)
- `ContactSubmission` — formulário contato (kanban: novo/lido/respondido)

### Auth

better-auth com session cookie + bcrypt em `Account.password`. CORS configurado com `credentials: true`. Frontend sempre manda `credentials: 'include'`.

### Uploads e armazenamento

Destino é escolhido em **Admin > Armazenamento** (`src/lib/storageSettings.ts`, chave
`storageSettings` na tabela `SiteContent`; variáveis `S3_*` são fallback):

- **`local` (padrão)** — disco da API, servido em `/uploads`. É o comportamento de sempre.
- **`s3`** — qualquer serviço compatível com S3; o caso aqui é DigitalOcean Spaces.
  Campos: endpoint, região, bucket, access key, secret, URL pública/CDN, pasta, path-style.

Regras que valem nos dois modos:

- Multer **sempre** grava em disco primeiro. No modo S3 o arquivo é temporário: sobe por stream
  (`fs.createReadStream`, sem segurar vídeo de 100 MB em memória) e é apagado depois do PUT.
- Se o bucket falhar, o arquivo local é mantido e a resposta volta com a URL `/uploads/...`:
  indisponibilidade do bucket não quebra o upload do painel.
- Objetos vão com `ACL: public-read` e `Cache-Control: 1 ano immutable` — sem o ACL o Spaces
  devolve 403 no `<img>`.
- `POST /api/upload` responde `{ url, provider }`. `url` é **relativa** no modo local e
  **absoluta** (CDN/bucket) no modo S3 — o front grava as duas formas como vierem
  (`toStoredMediaUrl` só encurta URL do próprio backend).
- `storageSettings.testConnection` grava e apaga um objeto de teste; devolve o erro cru do
  provedor, que é o caminho de diagnóstico no painel.
- Segredo nunca sai do backend: `get` devolve `hasSecret`, `secretPreview` e `secretSource`.

- Endpoint: `POST /api/upload` (multer disco) — devolve **caminho relativo** (`/uploads/<file>`) no modo local
- Limite: 100 MB
- Servidos em `/uploads/<file>` (static) com `Cache-Control: 1 ano immutable` + `Access-Control-Allow-Origin: *`
  (o `*` é necessário pro editor de recorte ler a imagem em `<canvas>` sem tainted canvas)
- **Nunca gravar URL absoluta no SiteContent.** O host entra no render, via `eagle-front/src/lib/mediaUrl.ts`
  (`resolveMediaUrl`). URL absoluta gravada quebra quando o site muda de domínio — foi a causa do bug
  "mídias não replicam no site".
- Reutilizar componente `eagle-front/src/components/admin/ImageUploader.tsx` — NÃO mostra URL pro usuário, só preview + botão trocar + "Recortar imagem". Upload automático ao escolher arquivo.

### E-mail transacional (`src/lib/email.ts` + `src/lib/emailSettings.ts`)

- API HTTP do Resend via `fetch` nativo — **sem dependência nova**, sem SMTP.
- **Configuração é cadastrada pelo admin no painel** (Admin > E-mail), não em env:
  chave da API, remetente, e-mail da equipe, reply-to, URL do site.
  Guardada na tabela `SiteContent` sob a chave `emailSettings` — chave separada da `main`,
  então o `siteContent.get` (público) nunca enxerga esses dados. Sem migration nova.
- Variáveis de ambiente (`RESEND_API_KEY`, `EMAIL_FROM`, `EMAIL_TEAM`, `EMAIL_REPLY_TO`, `SITE_URL`)
  continuam valendo como **fallback**; o que estiver salvo no painel tem prioridade.
- Router `emailSettings` é todo `adminProcedure`. A chave **nunca** sai em texto puro:
  `get` devolve `hasApiKey`, `apiKeyPreview` (4 últimos dígitos) e `apiKeySource` (panel/env/none).
  No `update`, `apiKey` ausente = mantém a atual; `clearApiKey: true` remove.
- `emailSettings.sendTest` manda e-mail de teste e devolve o erro cru do Resend (401 = chave inválida,
  403 = remetente não verificado) — é o caminho de diagnóstico no painel.
- Cache de 30s em `loadEmailSettings()`, invalidado no save.
- Dois e-mails por formulário: confirmação pro cliente + notificação pra equipe.
  `replyTo` da notificação = e-mail do cliente, então "Responder" já vai pro lead.
- Disparo em background (`dispatchFormEmails`) — falha de e-mail nunca derruba a mutation.
- `SendEmailResult` é achatado de propósito (`ok`/`skipped`/`id`/`error`): o front lê esses tipos pelo
  submodule e o tsconfig de lá não liga `strict`, então union discriminada não estreita.

### Rate limit (`src/lib/rateLimit.ts`)

- Em memória, dois limites por formulário público:
  - por IP: 5 envios / 10 min (`contact`, `franchise`)
  - por destinatário: 3 envios / 1 h (`contact-email`, `franchise-email`) — a confirmação vai para um
    endereço informado por quem envia, então IP rotativo não pode virar spam contra terceiro.
- `app.set('trust proxy', Number(process.env.TRUST_PROXY_HOPS) || 1)` — **um hop só**.
  Com `true`, `req.ip` passaria a ser o que o cliente escrever em `X-Forwarded-For` e o limite viraria
  decorativo. Se entrar CDN na frente do Apache, subir `TRUST_PROXY_HOPS`.
- Se um dia rodar em mais de um processo, trocar por Redis mantendo a assinatura de `enforceRateLimit`.

### Encoding (acentuação)

- Postgres sobe com `POSTGRES_INITDB_ARGS=--encoding=UTF8 --locale=C.UTF-8` (só afeta volume novo).
- Middleware em `/trpc` força `application/json; charset=utf-8`: o adapter do tRPC escreve
  `application/json` puro (é por ali que passa o conteúdo acentuado do site). `res.json` do Express já
  manda charset. **Não usar `res.charset`** — é API do Express 3, ignorada na v4.
- Dados antigos com mojibake (`musculaÃ§Ã£o`): `make db-fix-encoding` (dry-run) e
  `make db-fix-encoding-apply` (grava).
- Reparo em `src/lib/mojibake.ts`, **sequência por sequência** (Latin-1 e CP1252). Nunca fazer
  round-trip `Buffer.from(texto, 'latin1')` no texto inteiro: isso truncaria todo caractere acima de
  U+00FF — um em dash `—` viraria o byte de controle 0x14 e destruiria o JSON do `SiteContent`
  (o `get` engole erro de parse e devolve `null`, ou seja: site sem conteúdo).
  `repairJsonText` só grava se o resultado continuar sendo JSON válido; texto já correto é no-op.

---

## Painel admin — estrutura

Rotas:
- `/admin/login` — login (`AdminLogin.tsx`)
- `/admin` — dashboard (`AdminDashboard.tsx`) protegido por `ProtectedAdminRoute`

Layout: sidebar grouping + header com section icon + área de conteúdo. Mobile: pills horizontais no header.

Seções (filtradas por role):

| ID | Label | Roles |
|----|-------|-------|
| `nav-footer` | Menu e rodapé | admin, editor |
| `home` | Home | admin, editor |
| `about` | Sobre | admin, editor |
| `franchise` | Franquia | admin, editor |
| `media` | Mídias | admin, editor |
| `leads` | Leads e contatos | admin, user |
| `users` | Usuários | admin |
| `email` | E-mail | admin |
| `storage` | Armazenamento | admin |

### Kanban (Leads / Contatos)

Drag-and-drop HTML5 nativo (sem `@dnd-kit`). Optimistic updates via `trpc.useUtils().setData` com rollback em `onError`. Status mutation no `onDrop`.

### RichTextEditor

Tiptap com `StarterKit` + `TextAlign` + `TextStyle` + `FontFamily` + `Underline`. Font picker custom (não `<select>`) que renderiza opções na própria fonte — sem nome técnico exposto pro usuário. Adicionar fonte = editar `FONT_OPTIONS` em `components/admin/RichTextEditor.tsx`.

---

## Convenções de código

- **Idioma:** UI em PT-BR. Identifiers em inglês. Toast/labels/empty states em PT-BR.
- **Estilos:** Tailwind v4 (`@theme` em `index.css`). Cores brand: `eagle-black`, `eagle-red`, `eagle-gold`, `eagle-light`, `eagle-muted`. Sempre usar essas em vez de hardcode.
- **Fontes:** `font-sans` (Inter), `font-heading` (Montserrat), `font-vonique` (display, decorativa Eagle).
- **Forms admin:** classes compartilhadas `inCls` / `taCls` / `lbCls` no topo de `AdminDashboard.tsx`.
- **Section card:** componente `<Section title subtitle>` com linha gradient red no topo.
- **Save bar:** `<SectionSaveBar onSave label>` — botão vermelho com ring + dot amber pulsante explicando que precisa salvar.
- **Modais:** classes de animação `animate-[fadeIn_...]` e `animate-[modalIn_...]` definidas em `index.css`.
- **Role badges:** `bg-eagle-red/15 text-eagle-gold` (admin), `bg-blue-500/15 text-blue-200` (editor), `bg-emerald-500/15 text-emerald-200` (user).

---

## Padrões importantes

- **Não amend commits.** Sempre criar commit novo.
- **Não usar `git add -A`** — adicione arquivos por nome.
- **Não commitar `.env`.**
- **Optimistic updates:** sempre que mutation altera lista visível, use `useUtils().<router>.<query>.setData()` em `onMutate` + rollback em `onError` + `invalidate` em `onSettled`.
- **tRPC `onMutate` typing quirk (v11):** `variables` aparece como `void | Partial<Input>`. Workaround: cast com `as { ... }` dentro da callback.
- **Schema changes:** após editar `schema.prisma`, sempre rode `make db-generate db-push` antes de qualquer mutation/seed.

---

## Troubleshooting

| Sintoma | Causa | Fix |
|---------|-------|-----|
| `protocol file:` error em Prisma | Client gerado com schema antigo (sqlite) | `make db-generate db-push` |
| `make: *** No rule to make target 'db'` | Espaço em vez de hífen | Use `make db-seed`, não `make db seed` |
| Login OK mas 403 em queries | Role do user não tem permissão na procedure | Confira role no DB ou troque procedure |
| `Access-Control-Allow-Origin` ausente | Backend não subiu ou caiu antes do middleware | CORS é aberto; conferir se a API está de pé |
| Front mostra "Vonique 43" no font picker | Cache de build antigo | Reinicia vite dev |
| Upload de imagem volta URL relativa quebrada | `VITE_BACKEND_URL` não setado | Defina ou deixe fallback `http://localhost:3001` |
| Mídia enviada no admin não aparece no site | URL absoluta antiga (host de dev) no SiteContent | `resolveMediaUrl` já reaponta `/uploads/...` pro backend atual; confira `VITE_BACKEND_URL` |
| Acento quebrado no site (`Ã§`) | Dado gravado antes do fix de encoding | `make db-fix-encoding-apply` |
| Formulário responde 429 | Rate limit (5 envios / 10 min / IP) | Esperar ou ajustar `enforceRateLimit` |
| Nenhum e-mail de confirmação chega | Sem chave cadastrada, envio desligado ou remetente não verificado | Admin > E-mail: conferir status e usar "Enviar teste" |
| Upload volta `/uploads/...` mesmo com bucket configurado | PUT no bucket falhou (fallback automático) | Ver `[storage]` no log e usar "Testar conexão" |
| Imagem do bucket dá 403 no site | Objeto sem ACL pública ou bucket privado | Conferir permissão do Space; o PUT já manda `public-read` |

---

## Arquivos-chave

```
eagle-back/
├── Makefile                       # bootstrap + comandos DB
├── docker-compose.yml             # Postgres 16 alpine
├── prisma/schema.prisma           # Postgres + better-auth + 4 models
├── prisma/seed.ts                 # admin user + siteContent.main
├── src/trpc.ts                    # 5 procedures (public/protected/admin/leads/content)
├── src/router.ts                  # AppRouter raiz
├── src/routers/
│   ├── adminUsers.ts              # CRUD users (admin only)
│   ├── franchiseLeads.ts          # CRUD leads (leadsProcedure)
│   ├── contactSubmissions.ts      # CRUD contatos (leadsProcedure)
│   ├── emailSettings.ts           # config de e-mail + teste de envio (adminProcedure)
│   ├── storageSettings.ts         # config de armazenamento + teste de conexão (adminProcedure)
│   └── siteContent.ts             # get/update/reset (contentProcedure)
├── src/lib/
│   ├── email.ts                   # templates + envio via API HTTP do Resend
│   ├── emailSettings.ts           # config no banco (painel) + fallback por env
│   ├── mojibake.ts                # reparo de acentuação (sequência por sequência)
│   ├── storage.ts                 # grava upload no disco ou no bucket (S3/Spaces)
│   ├── storageSettings.ts         # config no banco (painel) + fallback por env
│   └── rateLimit.ts               # limite dos formulários públicos (memória)
├── src/scripts/fixEncoding.ts     # repara mojibake no banco (dry-run por default)
├── src/auth.ts                    # better-auth config
└── src/index.ts                   # express + multer upload + cors + trust proxy

eagle-front/
├── src/lib/trpc.ts                # createTRPCReact<AppRouter>
├── src/lib/auth-client.ts         # better-auth client
├── src/context/
│   ├── AdminAuthProvider.tsx      # role + userName + userEmail + login/logout
│   ├── AdminUsersProvider.tsx     # CRUD via tRPC, gated por role admin
│   └── SiteContentProvider.tsx    # site content state + mutation
├── src/pages/admin/
│   ├── AdminDashboard.tsx         # sidebar + header + todas as seções de edição
│   ├── AdminLogin.tsx             # login com show password
│   ├── AdminLeadsPanel.tsx        # kanban drag-and-drop (leads + contatos)
│   ├── AdminUsersPanel.tsx        # tabela usuários
│   ├── AdminUserModal.tsx         # criar/editar user (3 roles)
│   ├── AdminMediaPanel.tsx        # editar URLs/upload de mídias do site
│   └── ProtectedAdminRoute.tsx    # gate por isAuthenticated
├── src/lib/
│   ├── mediaUrl.ts                # resolveMediaUrl / toStoredMediaUrl (host só no render)
│   └── upload.ts                  # uploadFile() compartilhado
└── src/components/admin/
    ├── RichTextEditor.tsx         # tiptap + font picker custom
    ├── ImageUploader.tsx          # upload sem expor URL + botão recortar
    ├── ImageCropModal.tsx         # editor de recorte (canvas, sem lib externa)
    └── ConfirmModal.tsx           # modal genérico de confirmação
```

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
pnpm dev          # Vite dev server (porta 5173)
pnpm build        # tsc + vite build
pnpm exec tsc --noEmit   # typecheck
```

Backend deve estar rodando em `http://localhost:3001` (configurável via `VITE_BACKEND_URL` + `VITE_API_URL`).

### Portas

| Ambiente | Frontend | Backend | Postgres |
|----------|----------|---------|----------|
| Dev local | 5173 | 3001 | 5432 |
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

### Uploads

- Endpoint: `POST /api/upload` (multer disco)
- Limite: 100 MB
- Servidos em `/uploads/<file>` (static)
- Reutilizar componente `eagle-front/src/components/admin/ImageUploader.tsx` — NÃO mostra URL pro usuário, só preview + botão trocar. Upload automático ao escolher arquivo.

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
| Front mostra "Vonique 43" no font picker | Cache de build antigo | Reinicia vite dev |
| Upload de imagem volta URL relativa quebrada | `VITE_BACKEND_URL` não setado | Defina ou deixe fallback `http://localhost:3001` |

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
│   └── siteContent.ts             # get/update/reset (contentProcedure)
├── src/auth.ts                    # better-auth config
└── src/index.ts                   # express + multer upload + cors

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
└── src/components/admin/
    ├── RichTextEditor.tsx         # tiptap + font picker custom
    ├── ImageUploader.tsx          # upload sem expor URL
    └── ConfirmModal.tsx           # modal genérico de confirmação
```

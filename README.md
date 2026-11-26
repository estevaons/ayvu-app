# Ayvu

Transforma PDFs e ebooks (EPUB, MOBI/AZW/AZW3, TXT) em audiolivros com vozes neurais (Kokoro‑82M).
Web + Android/iOS a partir do mesmo código.

```
Next.js (static export) ──► Capacitor (Android / iOS)
   │  leitura + realtime + progresso          │
   ▼                                          ▼
Supabase: Auth · Postgres (RLS) · Storage · Realtime
   ▲
   │ service role
Modal: API (FastAPI) · prepare (CPU) · TTSWorker (GPU, Kokoro) · dispatch (cron)
```

## Como funciona

1. O app envia o arquivo direto para o Storage (`uploads/{user}/{book}/source.ext`) com progresso real.
2. `POST /books` (Modal) cria o livro e dispara `prepare`: extrai capítulos, título, autor e capa, detecta o idioma e enfileira os capítulos.
3. `TTSWorker` (GPU) consome a fila **round‑robin entre usuários** (`claim_next_chapter()` no Postgres), capítulos em ordem de leitura — o primeiro capítulo fica pronto rápido e já dá pra ouvir enquanto o resto gera.
4. Cada capítulo vira um MP3 64 kbps mono em `audio/{user}/{book}/NNNN.mp3`. Triggers no banco mantêm contadores e status do livro; o app atualiza ao vivo via Realtime.
5. `dispatch` roda a cada 3 min: recupera capítulos travados e acorda workers para retries.

Melhorias em relação ao Ayvu original: ouvir enquanto gera, capa/título/autor automáticos, escolha de voz, timer de sono, velocidade até 2.5×, player global com mini‑player, controles na tela de bloqueio, progresso que nunca é sobrescrito por um sync atrasado (o mais recente vence), downloads offline por livro, tema claro/escuro, MP3s ~3× menores e escala automática de GPU.

## Estrutura

```
app/            telas (login, library, add, book, settings)
components/     UI (player, capa gerada, sheets, shell)
lib/            supabase, api do Modal, player, offline, progresso, i18n (pt-BR/en)
backend/        Modal: app.py + pacote ayvu (extração, idioma, TTS, jobs) + testes
supabase/       migrations SQL (schema, RLS, fila, storage)
android/        projeto Capacitor
```

## Setup

### 1. Supabase
O schema em `supabase/migrations/` já está aplicado no projeto `ayvu`.
Em **Authentication → URL Configuration**, adicione `http://localhost:3000/**` (e o domínio web) às Redirect URLs.
Para testar sem confirmar e‑mail, desative **Confirm email** em Authentication → Providers → Email.

### 2. Modal
```bash
cd backend
uv sync
uv run modal setup                     # login
uv run modal secret create ayvu-supabase \
  SUPABASE_URL=https://gsttfhqvqtpowyxybgtw.supabase.co \
  SUPABASE_SERVICE_ROLE_KEY=<service_role key do painel do Supabase>
uv run modal deploy app.py
```
Copie a URL do endpoint `api` (`https://<workspace>--ayvu-api.modal.run`) para `NEXT_PUBLIC_API_URL` no `.env.local`.

Variáveis opcionais no deploy: `AYVU_GPU` (padrão `L4`), `AYVU_MAX_TTS_WORKERS` (padrão `4`), `AYVU_WEB_ORIGINS` (origens CORS extras, separadas por vírgula).

### 3. Web
```bash
npm install
npm run dev          # http://localhost:3000
npm run build        # gera out/ (estático)
```

### 4. Android
```bash
npm run android      # build + cap sync + abre no Android Studio
```
iOS: `npx cap add ios` em um Mac e adicione `audio` em *Background Modes*.

## Testes
```bash
npm run test:backend   # extração, idioma, vozes, metadados
npm run lint
```

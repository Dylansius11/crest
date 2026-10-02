# Crest API, monitor, Custos, and runtime RPC relay. One image, four processes selected by compose.
# Built on the VPS from a `git archive` of one commit, so the build context never contains `.env`,
# node_modules, Foundry output, or local provider state. Node runs the `.ts` sources directly.
FROM node:24.21.0-bookworm-slim
# NODE_EXTRA_CA_CERTS (the Supabase root CA) is set by compose at runtime only.
ENV CI=true
RUN corepack enable && corepack prepare pnpm@12.4.1 --activate
WORKDIR /app
COPY . .
# The web client ships on Vercel; only the three runtime apps and their workspace packages are installed,
# without dev dependencies. Files stay root-owned; the runtime user can read but not modify them.
RUN pnpm install --frozen-lockfile --prod \
      --filter "@crest/api..." --filter "@crest/monitor..." --filter "@crest/automation..."
USER node

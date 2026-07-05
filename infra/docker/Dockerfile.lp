FROM node:22-alpine AS base
RUN corepack enable
WORKDIR /app

FROM base AS deps
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml turbo.json ./
COPY packages ./packages
COPY apps/lp ./apps/lp
RUN pnpm install --frozen-lockfile || pnpm install
ARG VITE_APP_URL=https://app.softmusic.com.br
ENV VITE_APP_URL=$VITE_APP_URL
RUN pnpm --filter @softmusic/lp build

FROM deps AS runner
RUN apk add --no-cache nginx
COPY infra/nginx/conf.d/lp.conf /etc/nginx/conf.d/default.conf
RUN mkdir -p /usr/share/nginx/html \
  && cp -r /app/apps/lp/dist/. /usr/share/nginx/html/
EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]

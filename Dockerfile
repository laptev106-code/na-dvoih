FROM node:22-bookworm-slim

WORKDIR /app

RUN corepack enable && corepack prepare pnpm@9.12.0 --activate

COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile

COPY . .

# Build the desktop/Telegram web surface and the server bundle in the image.
RUN npx expo export --platform web --output-dir dist-web && pnpm build

ENV NODE_ENV=production
EXPOSE 3000

CMD ["node", "dist/index.js"]

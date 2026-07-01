FROM node:20-slim

# Required by Prisma for native binaries
RUN apt-get update -y && apt-get install -y openssl && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package*.json ./
RUN npm ci --only=production

COPY prisma ./prisma
RUN npx prisma generate

COPY . .

EXPOSE 5000

# Just start the server. Database migrations and seeding run ONCE per deploy
# via the Blueprint `preDeployCommand` (see render.yaml) instead of here — so
# that with multiple instances they don't run concurrently on every boot.
CMD ["node", "src/server.js"]

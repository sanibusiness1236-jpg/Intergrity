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

# Apply any pending schema changes (creates indexes, new tables, etc.)
# then start the server.
CMD ["sh", "-c", "npx prisma migrate deploy && node prisma/seed.js && node src/server.js"]

FROM node:20-alpine

WORKDIR /app

# Copy package manifests first for optimal layer caching
COPY package*.json ./

RUN npm ci --only=production

# Copy application source
COPY . .

# Environment defaults
ENV NODE_ENV=production

CMD ["node", "orchestrator.js"]

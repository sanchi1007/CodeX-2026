# Multi-stage lightweight Node.js container
FROM node:20-alpine AS production

# Set working directory
WORKDIR /app

# Set production environment
ENV NODE_ENV=production

# Install dependencies (only production)
COPY package*.json ./
RUN npm ci --only=production

# Copy application files
COPY . .

# Expose default port
EXPOSE 3000

# Healthcheck
HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://localhost:3000/api/system/status || exit 1

# Start server
CMD ["node", "index.js"]

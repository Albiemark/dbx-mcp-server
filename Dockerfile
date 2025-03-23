FROM node:18-alpine AS build

WORKDIR /app

# Copy package files
COPY package*.json ./

# Install all dependencies (including dev dependencies)
ENV NODE_ENV=production
RUN npm ci

# Copy source code
COPY . .

# Build the application directly with TypeScript compiler
RUN npm run build
RUN chmod +x ./build/src/index.js

# Production stage
FROM node:18-alpine AS production

WORKDIR /app

# Copy package files
COPY package*.json ./

# Install only production dependencies and ignore scripts to prevent prepare script from running
RUN npm ci --only=production --ignore-scripts

# Copy built files from build stage
COPY --from=build /app/build ./build
COPY --from=build /app/.env.example ./.env.example

# Make the entry point executable
RUN chmod +x ./build/src/index.js

# Set environment variables
ENV NODE_ENV=production
ENV HEALTH_CHECK_PORT=8080

# Expose the health check port
EXPOSE 8080

# Command to run the application
CMD ["node", "build/src/index.js"]

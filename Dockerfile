FROM node:18-alpine AS build

WORKDIR /app

# Copy package files
COPY package*.json ./

# Set NODE_ENV to production to skip the postinstall script
ENV NODE_ENV=production

# Install all dependencies (including dev dependencies)
RUN npm ci

# Copy source code
COPY . .

# Install TypeScript globally
RUN npm install -g typescript

# Create a custom tsconfig.json that excludes test files
RUN echo '{ "extends": "./tsconfig.json", "exclude": ["tests/**/*"] }' > tsconfig.build.json

# Build the application directly with TypeScript compiler
RUN tsc -p tsconfig.build.json && node --input-type=module -e "import * as fs from 'fs'; if(fs.existsSync('build/src/index.js')){fs.chmodSync('build/src/index.js', '755');}"
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

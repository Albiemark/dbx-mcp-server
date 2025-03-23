#!/usr/bin/env node
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import DbxServer from './dbx-server.js';
import { config, log } from './config.js';
import { startHealthCheckServer } from './health-check.js';

// Start the health check server if in production
if (process.env.NODE_ENV === 'production') {
  const port = process.env.HEALTH_CHECK_PORT ? parseInt(process.env.HEALTH_CHECK_PORT, 10) : 8080;
  startHealthCheckServer(port);
}

// Start the server
const server = new DbxServer();
server.run().catch(error => {
  log.error('Fatal server error:', {
    error: error instanceof Error ? error.message : 'Unknown error',
    stack: error instanceof Error ? error.stack : undefined
  });
  process.exit(1);
});

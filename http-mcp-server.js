#!/usr/bin/env node

const express = require('express');
const fs = require('fs');
const path = require('path');

// Create express app
const app = express();
const port = 8090;

// Enable JSON parsing
app.use(express.json());

// Log to a file for debugging
const logFile = path.join(__dirname, 'mcp-debug.log');
function log(message) {
  try {
    fs.appendFileSync(logFile, `${new Date().toISOString()}: ${message}\n`);
  } catch (error) {
    // Ignore logging errors
  }
}

// Clear log file on startup
try {
  fs.writeFileSync(logFile, `${new Date().toISOString()}: HTTP MCP Server starting\n`);
} catch (error) {
  // Ignore errors
}

// MCP JSON-RPC endpoint
app.post('/mcp', (req, res) => {
  const request = req.body;
  log(`Received: ${JSON.stringify(request)}`);
  
  try {
    handleRequest(request, (response) => {
      log(`Sending: ${JSON.stringify(response)}`);
      res.json(response);
    });
  } catch (error) {
    log(`Error: ${error.message}`);
    res.json({
      jsonrpc: '2.0',
      error: {
        code: -32603,
        message: `Internal error: ${error.message}`
      },
      id: request.id || null
    });
  }
});

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({ status: 'ok' });
});

// Handle a JSON-RPC request
function handleRequest(request, sendResponse) {
  const { method, params, id } = request;
  
  if (!method) {
    sendResponse({
      jsonrpc: '2.0',
      error: {
        code: -32600,
        message: 'Invalid Request: method is required'
      },
      id: id || null
    });
    return;
  }
  
  // Handle MCP protocol methods
  if (method === 'initialize') {
    // Respond to initialize request
    sendResponse({
      jsonrpc: '2.0',
      result: {
        capabilities: {
          tools: {
            definitions: [
              {
                name: 'list_files',
                description: 'List files in a Dropbox folder',
                parameters: {
                  type: 'object',
                  properties: {
                    path: {
                      type: 'string',
                      description: 'Path to list files from'
                    }
                  },
                  required: ['path']
                }
              }
            ]
          }
        },
        serverInfo: {
          name: 'dbx-mcp-server',
          version: '0.1.0'
        }
      },
      id
    });
    return;
  }
  
  if (method === 'call_tool') {
    const toolName = params?.name;
    const toolArgs = params?.arguments || {};
    
    if (toolName === 'list_files') {
      try {
        const path = toolArgs.path || '/';
        log(`Listing files at path: ${path}`);
        
        // Mock response for testing
        sendResponse({
          jsonrpc: '2.0',
          result: {
            entries: [
              { name: 'test-file.txt', path: '/test-file.txt', type: 'file' },
              { name: 'test-folder', path: '/test-folder', type: 'folder' }
            ]
          },
          id
        });
      } catch (error) {
        log(`Error in list_files: ${error.message}`);
        sendResponse({
          jsonrpc: '2.0',
          error: {
            code: -32603,
            message: `Server error: ${error.message}`
          },
          id: id || null
        });
      }
      return;
    }
    
    sendResponse({
      jsonrpc: '2.0',
      error: {
        code: -32601,
        message: `Tool ${toolName} not supported`
      },
      id: id || null
    });
    return;
  }
  
  if (method === 'shutdown') {
    sendResponse({
      jsonrpc: '2.0',
      result: null,
      id
    });
    // Exit after a short delay to allow the response to be sent
    setTimeout(() => process.exit(0), 100);
    return;
  }
  
  sendResponse({
    jsonrpc: '2.0',
    error: {
      code: -32601,
      message: `Method ${method} not supported`
    },
    id: id || null
  });
}

// Handle errors
process.on('uncaughtException', (error) => {
  log(`Uncaught exception: ${error.message}`);
  log(error.stack);
});

// Start the server
app.listen(port, () => {
  console.log(`HTTP MCP Server running at http://localhost:${port}`);
}); 
#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const readline = require('readline');

// Create a readable stream for stdin
const rl = readline.createInterface({
  input: process.stdin,
  terminal: false
});

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
  fs.writeFileSync(logFile, `${new Date().toISOString()}: MCP Server starting\n`);
} catch (error) {
  // Ignore errors
}

// Send a response to stdout
function sendResponse(response) {
  const responseStr = JSON.stringify(response);
  log(`Sending: ${responseStr}`);
  
  // Write to stdout using the proper format
  process.stdout.write(responseStr + '\n');
  process.stdout.write('\n'); // Add an empty line after each response
}

// Handle incoming JSON-RPC requests
rl.on('line', (line) => {
  if (!line.trim()) return; // Skip empty lines
  
  log(`Received: ${line}`);
  
  try {
    const request = JSON.parse(line);
    handleRequest(request);
  } catch (error) {
    log(`Error parsing request: ${error.message}`);
    sendResponse({
      jsonrpc: '2.0',
      error: {
        code: -32700,
        message: 'Parse error: Invalid JSON'
      },
      id: null
    });
  }
});

// Handle a JSON-RPC request
async function handleRequest(request) {
  const { method, params, id } = request;
  
  if (!method) {
    sendError(id, -32600, 'Invalid Request: method is required');
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
        sendError(id, -32603, `Server error: ${error.message}`);
      }
      return;
    }
    
    sendError(id, -32601, `Tool ${toolName} not supported`);
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
  
  sendError(id, -32601, `Method ${method} not supported`);
}

function sendError(id, code, message) {
  sendResponse({
    jsonrpc: '2.0',
    error: {
      code,
      message
    },
    id: id || null
  });
}

// Handle errors
process.on('uncaughtException', (error) => {
  log(`Uncaught exception: ${error.message}`);
  log(error.stack);
});

// Signal that we're ready
console.error('MCP_SERVER_READY');

// Log process info
log(`Process info: pid=${process.pid}, ppid=${process.ppid}`);
log(`Current directory: ${process.cwd()}`);

// Keep the process alive
process.stdin.resume(); 
import dotenv from 'dotenv';
import axios from 'axios';

// Load environment variables
dotenv.config();

// Get the Dropbox access token from .env
const DROPBOX_ACCESS_TOKEN = process.env.DROPBOX_ACCESS_TOKEN;

if (!DROPBOX_ACCESS_TOKEN) {
  console.error('Error: DROPBOX_ACCESS_TOKEN not found in environment variables');
  process.exit(1);
}

// Helper function to make Dropbox API calls
async function callDropboxApi(endpoint, data) {
  try {
    const response = await axios({
      method: 'post',
      url: `https://api.dropboxapi.com/2/${endpoint}`,
      headers: {
        'Authorization': `Bearer ${DROPBOX_ACCESS_TOKEN}`,
        'Content-Type': 'application/json'
      },
      data: data,
      timeout: 10000
    });
    return response.data;
  } catch (error) {
    console.error('Dropbox API error:', error.message);
    if (error.response) {
      console.error('Response:', JSON.stringify(error.response.data));
    }
    throw new Error(`Dropbox API error: ${error.message}`);
  }
}

// Handle input from stdin
process.stdin.setEncoding('utf8');

let inputBuffer = '';

process.stdin.on('data', async (chunk) => {
  inputBuffer += chunk;
  
  // Process complete JSON messages
  const messages = extractJsonMessages(inputBuffer);
  inputBuffer = messages.remaining;
  
  for (const message of messages.complete) {
    try {
      const response = await handleRequest(message);
      process.stdout.write(JSON.stringify(response) + '\n');
    } catch (error) {
      process.stdout.write(JSON.stringify({
        jsonrpc: '2.0',
        error: {
          code: -32603,
          message: error.message
        },
        id: message.id || null
      }) + '\n');
    }
  }
});

// Extract complete JSON messages from the buffer
function extractJsonMessages(buffer) {
  const complete = [];
  let remaining = buffer;
  
  while (true) {
    try {
      const message = JSON.parse(remaining);
      complete.push(message);
      remaining = '';
      break;
    } catch (error) {
      // Find a newline character that might separate messages
      const newlineIndex = remaining.indexOf('\n');
      if (newlineIndex === -1) {
        break;
      }
      
      try {
        const messagePart = remaining.substring(0, newlineIndex);
        const message = JSON.parse(messagePart);
        complete.push(message);
        remaining = remaining.substring(newlineIndex + 1);
      } catch (error) {
        // Not a valid JSON message, skip to the next newline
        remaining = remaining.substring(newlineIndex + 1);
      }
    }
  }
  
  return { complete, remaining };
}

// Handle a request
async function handleRequest(request) {
  try {
    const { method, params, id } = request;
    
    if (!method) {
      return {
        jsonrpc: '2.0',
        error: {
          code: -32600,
          message: 'Invalid Request: method is required'
        },
        id: id || null
      };
    }
    
    if (method === 'list_files') {
      const path = params?.path || '';
      
      const result = await callDropboxApi('files/list_folder', {
        path: path === '/' ? '' : path
      });
      
      return {
        jsonrpc: '2.0',
        result: {
          entries: result.entries.map(entry => ({
            name: entry.name,
            path: entry.path_display,
            type: entry['.tag']
          }))
        },
        id: id || null
      };
    }
    
    return {
      jsonrpc: '2.0',
      error: {
        code: -32601,
        message: `Method ${method} not supported`
      },
      id: id || null
    };
  } catch (error) {
    return {
      jsonrpc: '2.0',
      error: {
        code: -32603,
        message: `Server error: ${error.message}`
      },
      id: request.id || null
    };
  }
}

// Let Cursor know we're ready
console.log('Dbx MCP server running on stdio'); 
#!/usr/bin/env node

import { McpServer, StringStream, toolFn } from '@modelcontextprotocol/sdk';
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
      console.error('Response:', error.response.data);
    }
    throw new Error(`Dropbox API error: ${error.message}`);
  }
}

// Define list_files tool
const listFiles = toolFn({
  name: 'list_files',
  description: 'List files in a Dropbox folder',
  parameters: {
    properties: {
      path: {
        type: 'string',
        description: 'Path to the folder',
      }
    },
    required: ['path'],
  },
  async execute({ path }) {
    console.error(`Listing files at path: ${path}`);
    try {
      const result = await callDropboxApi('files/list_folder', {
        path: path === '/' ? '' : path
      });
      
      return {
        entries: result.entries.map(entry => ({
          name: entry.name,
          path: entry.path_display,
          type: entry['.tag']
        }))
      };
    } catch (error) {
      console.error('Error listing files:', error);
      throw error;
    }
  }
});

// Setup the MCP server
const server = new McpServer({
  tools: [listFiles]
});

// Connect stdin/stdout
const input = new StringStream(process.stdin);
const output = new StringStream(process.stdout);

// Start server
server.serve(input, output);

// Signal that the server is ready
process.stderr.write('dbx-mcp-server-ready\n'); 
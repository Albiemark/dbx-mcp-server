#!/usr/bin/env node

import fs from 'fs';
import path from 'path';
import { homedir } from 'os';
import fetch from 'node-fetch';

async function checkConfig() {
  try {
    // Find and read Cursor's MCP configuration
    const cursorConfigDir = path.join(homedir(), '.cursor');
    const mcpConfigPath = path.join(cursorConfigDir, 'mcp.json');
    
    console.log('Checking Cursor MCP configuration at:', mcpConfigPath);
    
    if (!fs.existsSync(mcpConfigPath)) {
      console.error('Error: MCP configuration file not found');
      return;
    }
    
    const configContent = fs.readFileSync(mcpConfigPath, 'utf8');
    console.log('\nMCP configuration content:');
    console.log(configContent);
    
    // Parse the configuration
    const config = JSON.parse(configContent);
    
    if (!config.mcpServers) {
      console.error('Error: mcpServers not found in configuration');
      return;
    }
    
    console.log('\nFound MCP servers:');
    for (const [serverName, serverConfig] of Object.entries(config.mcpServers)) {
      console.log(`- ${serverName}:`, serverConfig);
      
      // If this is an HTTP server, try to connect to it
      if (serverConfig.host && serverConfig.port) {
        const protocol = serverConfig.protocol || 'http';
        const host = serverConfig.host;
        const port = serverConfig.port;
        const path = serverConfig.path || '';
        
        const url = `${protocol}://${host}:${port}${path}`;
        console.log(`\nTesting connection to ${serverName} at ${url}`);
        
        try {
          // First try a health check if available
          const healthUrl = `${protocol}://${host}:${port}/health`;
          console.log(`Checking health at ${healthUrl}`);
          const healthResponse = await fetch(healthUrl);
          const healthData = await healthResponse.json();
          console.log('Health check response:', healthData);
          
          // Now try the initialize request
          console.log(`Sending initialize request to ${url}`);
          const initializeRequest = {
            jsonrpc: '2.0',
            method: 'initialize',
            params: {
              protocolVersion: '2024-11-05',
              capabilities: {
                tools: true,
                prompts: false,
                resources: true,
                logging: false,
                roots: { listChanged: false }
              },
              clientInfo: {
                name: 'test-client',
                version: '1.0.0'
              }
            },
            id: 1
          };
          
          const method = serverConfig.method || 'POST';
          const headers = serverConfig.headers || { 'Content-Type': 'application/json' };
          
          const initResponse = await fetch(url, {
            method,
            headers,
            body: JSON.stringify(initializeRequest)
          });
          
          const initData = await initResponse.json();
          console.log('Initialize response:', JSON.stringify(initData, null, 2));
          
          if (initData.result?.capabilities?.tools?.definitions) {
            console.log('\nAvailable tools:');
            for (const tool of initData.result.capabilities.tools.definitions) {
              console.log(`- ${tool.name}: ${tool.description}`);
            }
          }
        } catch (error) {
          console.error(`Error connecting to ${serverName}:`, error.message);
        }
      }
    }
    
    // Check for common issues
    console.log('\nChecking for common issues:');
    
    // 1. Check Cursor's config directory permissions
    try {
      fs.accessSync(cursorConfigDir, fs.constants.R_OK | fs.constants.W_OK);
      console.log('✅ Cursor config directory permissions are correct');
    } catch (error) {
      console.error('❌ Issue with Cursor config directory permissions:', error.message);
    }
    
    // 2. Check if mcp.json is valid JSON
    try {
      JSON.parse(configContent);
      console.log('✅ mcp.json is valid JSON');
    } catch (error) {
      console.error('❌ mcp.json is not valid JSON:', error.message);
    }
    
    // 3. Check if any server is actually running
    let anyServerRunning = false;
    for (const [serverName, serverConfig] of Object.entries(config.mcpServers)) {
      if (serverConfig.host && serverConfig.port) {
        const protocol = serverConfig.protocol || 'http';
        const host = serverConfig.host;
        const port = serverConfig.port;
        
        try {
          const healthUrl = `${protocol}://${host}:${port}/health`;
          await fetch(healthUrl);
          console.log(`✅ Server ${serverName} is running`);
          anyServerRunning = true;
        } catch (error) {
          console.error(`❌ Server ${serverName} is not running:`, error.message);
        }
      }
    }
    
    if (!anyServerRunning) {
      console.error('❌ No MCP servers are running');
    }
    
    console.log('\nDone checking configuration');
  } catch (error) {
    console.error('Error:', error);
  }
}

checkConfig(); 
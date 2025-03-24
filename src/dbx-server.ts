import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListResourcesRequestSchema,
  ListResourceTemplatesRequestSchema,
  ListToolsRequestSchema,
  ReadResourceRequestSchema,
  ListPromptsRequestSchema,
  GetPromptRequestSchema,
  McpError,
  ErrorCode,
  CallToolResult,
  CallToolRequest
} from '@modelcontextprotocol/sdk/types.js';
import { getValidAccessToken, initializeTokenData, refreshAccessToken } from './auth.js';
import { handleListPrompts, handleGetPrompt } from './prompt-handler.js';
import { handleListResources, handleReadResource } from './resource-handler.js';
import { toolDefinitions } from './tool-definitions.js';
import { config, log } from './config.js';
import * as dbxApi from './dbx-api.js';
import axios, { AxiosError } from 'axios';
import * as fs from 'fs';

// Define resource templates
const resourceTemplates = [
  {
    uriTemplate: 'dbx://{path}',
    name: 'Dbx Item',
    description: 'Access any file or folder in Dropbox by path',
    parameters: {
      path: {
        description: 'Path to the file or folder',
        required: true,
        type: 'string'
      }
    }
  },
  {
    uriTemplate: 'dbx:///shared/{share_id}',
    name: 'Shared Dbx Item',
    description: 'Access a shared Dropbox item by its share ID',
    parameters: {
      share_id: {
        description: 'Shared item identifier',
        required: true,
        type: 'string'
      }
    }
  }
];

interface SearchOptions {
  query: string;
  path?: string;
  maxResults?: number;
  fileExtensions?: string[];
  fileCategories?: string[];
  dateRange?: {
    start: string;
    end: string;
  };
  includeContentMatch?: boolean;
  sortBy?: 'relevance' | 'last_modified_time' | 'file_size';
  order?: 'asc' | 'desc';
}

export default class DbxServer {
  private server: Server;

  constructor() {
    this.server = new Server(
      {
        name: 'dbx-mcp-server',
        version: '0.1.0',
      },
      {
        capabilities: {
          resources: {
            types: ["dbx-file", "dbx-folder"],
          },
          tools: {
            tools: toolDefinitions
          },
          prompts: {
            listChanged: true
          }
        },
      }
    );
    this.setupHandlers();
    this.setupPromptHandlers();
  }

  private setupPromptHandlers() {
    this.server.setRequestHandler(ListPromptsRequestSchema, handleListPrompts);
    this.server.setRequestHandler(GetPromptRequestSchema, handleGetPrompt);
  }

  private setupHandlers() {
    // Resource handlers
    this.server.setRequestHandler(ListResourcesRequestSchema, handleListResources);
    this.server.setRequestHandler(ReadResourceRequestSchema, handleReadResource);
    this.server.setRequestHandler(ListResourceTemplatesRequestSchema, async () => ({
      resourceTemplates
    }));

    // Tool handlers
    this.server.setRequestHandler(ListToolsRequestSchema, async () => ({
      tools: toolDefinitions
    }));

    this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
      try {
        // Force token refresh before handling each request
        await this.ensureValidToken();

        // Verify authentication
        if (!config.dropbox.accessToken && !await getValidAccessToken()) {
          throw new McpError(
            ErrorCode.InvalidRequest,
            'No valid access token available. Please authenticate first.'
          );
        }

        // Log request (without sensitive data)
        log.info('Tool request:', { 
          tool: request.params.name,
          args: this.sanitizeArgs(request.params.arguments)
        });

        // Handle tool requests
        const result = await (async () => {
          switch (request.params.name) {
            case 'list_files':
              return await this.listFiles(request.params.arguments);
            case 'upload_file':
              return await this.uploadFile(request.params.arguments);
            case 'download_file':
              return await this.downloadFile(request.params.arguments);
            case 'safe_delete_item':
              return await this.safeDeleteItem(request.params.arguments);
            case 'delete_item':
              // Legacy delete operation - logs a warning and uses safe delete with default settings
              log.warn('Legacy delete operation used', { path: request.params.arguments?.path });
              return await this.safeDeleteItem({
                path: String(request.params.arguments?.path),
                userId: 'legacy_user',
                skipConfirmation: true,
                permanent: true
              });
            case 'create_folder':
              return await this.createFolder(request.params.arguments);
            case 'copy_item':
              return await this.copyItem(request.params.arguments);
            case 'move_item':
              return await this.moveItem(request.params.arguments);
            case 'get_file_metadata':
              return await this.getFileMetadata(request.params.arguments);
            case 'search_file_db': {
              const searchOptions: SearchOptions = {
                query: String(request.params.arguments?.query),
                path: String(request.params.arguments?.path || ''),
                maxResults: Number(request.params.arguments?.max_results || 20),
                fileExtensions: request.params.arguments?.file_extensions as string[] | undefined,
                fileCategories: request.params.arguments?.file_categories as string[] | undefined,
                dateRange: request.params.arguments?.date_range as { start: string; end: string } | undefined,
                includeContentMatch: Boolean(request.params.arguments?.include_content_match),
                sortBy: (request.params.arguments?.sort_by as SearchOptions['sortBy']) || 'relevance',
                order: (request.params.arguments?.order as SearchOptions['order']) || 'desc'
              };
              return await this.searchFiles(searchOptions);
            }
            case 'get_sharing_link':
              return await this.getSharingLink(request.params.arguments);
            case 'get_account_info':
              return await this.getAccountInfo();
            case 'get_file_content':
              return await this.getFileContent(request.params.arguments);
            default:
              throw new McpError(
                ErrorCode.MethodNotFound,
                `Unknown tool: ${request.params.name}`
              );
          }
        })();

        return {
          content: result.content,
          _meta: {}
        };
      } catch (error) {
        if (error instanceof McpError) {
          throw error;
        }
        
        // Map Dropbox API errors to MCP errors
        if (axios.isAxiosError(error)) {
          const axiosError = error as AxiosError;
          const status = axiosError.response?.status;
          const data = axiosError.response?.data as { error?: any };
          
          if (data?.error && typeof data.error === 'string') {
            throw new McpError(
              ErrorCode.InternalError,
              `Dropbox API error: ${data.error}`
            );
          }
          
          if (status === 401) {
            throw new McpError(
              ErrorCode.InvalidRequest,
              `Dropbox API authentication error: ${axiosError.message}`
            );
          }
          
          throw new McpError(
            ErrorCode.InternalError,
            `Dropbox API error: ${axiosError.message}`
          );
        }
        
        throw new McpError(
          ErrorCode.InternalError,
          error instanceof Error ? error.message : String(error)
        );
      }
    });
  }

  private sanitizeArgs(args: any): any {
    if (!args) return args;
    const sanitized = { ...args };
    // Remove sensitive data from logs
    if (sanitized.content) sanitized.content = '[CONTENT]';
    return sanitized;
  }

  private async initialize() {
    await initializeTokenData();
    log.info('Dropbox token data initialized successfully');
    
    try {
      // Verify access token
      await getValidAccessToken();
      log.info('Successfully verified access token');
    } catch (error) {
      log.warn('Failed to verify access token:', error);
      // Continue initialization
    }

    log.info('Connecting to transport...');
    const transport = new StdioServerTransport();
    await this.server.connect(transport);
    log.info(`Dbx MCP server running on stdio`);
  }

  // Add a simple method to force refresh the token before any API calls
  private async ensureValidToken(): Promise<void> {
    try {
      log.info('Forcibly refreshing access token before request');
      await refreshAccessToken();
    } catch (err) {
      log.error('Failed to refresh token:', err);
      // Continue with request even if refresh fails
    }
  }

  async listFiles(params: any): Promise<any> {
    try {
      await this.ensureValidToken();
      
      // Get the path from params
      const path = params.path || '';
      
      // For root directory, use empty string instead of "/"
      const normalizedPath = path === '/' ? '' : path;
      
      log.info(`Directly listing files at path: "${normalizedPath}" (original: "${path}")`);
      
      // Get access token - prioritize environment variable
      const accessToken = process.env.DROPBOX_ACCESS_TOKEN || await getValidAccessToken();
      
      // Make a direct API call
      const response = await axios.post(
        'https://api.dropboxapi.com/2/files/list_folder',
        { path: normalizedPath },
        {
          headers: {
            'Authorization': `Bearer ${accessToken}`,
            'Content-Type': 'application/json'
          },
          timeout: 15000
        }
      );
      
      // Format the response
      const entries = response.data.entries.map((entry: any) => ({
        name: entry.name,
        path: entry.path_display,
        type: entry['.tag'],
        size: entry.size,
        isFolder: entry['.tag'] === 'folder'
      }));
      
      return {
        content: [{
          type: 'text',
          text: JSON.stringify(entries, null, 2)
        }]
      };
    } catch (error) {
      log.error('Error listing files:', error);
      throw error;
    }
  }

  async uploadFile(params: any): Promise<any> {
    await this.ensureValidToken();
    return dbxApi.uploadFile(params.path, params.content);
  }

  async downloadFile(params: any): Promise<any> {
    await this.ensureValidToken();
    return dbxApi.downloadFile(params.path);
  }

  async deleteItem(params: any): Promise<any> {
    await this.ensureValidToken();
    return dbxApi.deleteItem(params.path);
  }

  async safeDeleteItem(params: any): Promise<any> {
    await this.ensureValidToken();
    return dbxApi.safeDeleteItem({
      path: params.path,
      userId: params.userId,
      reason: params.reason,
      permanent: params.permanent,
      retentionDays: params.retentionDays,
      skipConfirmation: params.skipConfirmation
    });
  }

  async createFolder(params: any): Promise<any> {
    await this.ensureValidToken();
    return dbxApi.createFolder(params.path);
  }

  async copyItem(params: any): Promise<any> {
    await this.ensureValidToken();
    return dbxApi.copyItem(params.from_path, params.to_path);
  }

  async moveItem(params: any): Promise<any> {
    await this.ensureValidToken();
    return dbxApi.moveItem(params.from_path, params.to_path);
  }

  async getFileMetadata(params: any): Promise<any> {
    await this.ensureValidToken();
    return dbxApi.getFileMetadata(params.path);
  }

  async searchFiles(params: any): Promise<any> {
    await this.ensureValidToken();
    return dbxApi.searchFiles(params);
  }

  async getSharingLink(params: any): Promise<any> {
    await this.ensureValidToken();
    return dbxApi.getSharingLink(params.path);
  }

  async getAccountInfo(): Promise<any> {
    await this.ensureValidToken();
    return dbxApi.getAccountInfo();
  }

  async getFileContent(params: any): Promise<any> {
    await this.ensureValidToken();
    return dbxApi.getFileContent(params.path);
  }
  
  // Public method to run the server
  async run(): Promise<void> {
    await this.initialize();
  }
}

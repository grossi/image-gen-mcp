#!/usr/bin/env node
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ErrorCode,
  ListToolsRequestSchema,
  McpError,
} from '@modelcontextprotocol/sdk/types.js';
import axios from 'axios';
import sharp from 'sharp';
import path from 'path';
import fs from 'fs';
import { mkdir } from 'fs/promises';
import { randomUUID } from 'crypto';

const SD_WEBUI_URL = process.env.SD_WEBUI_URL || 'http://127.0.0.1:7860';
const AUTH_USER = process.env.SD_AUTH_USER;
const AUTH_PASS = process.env.SD_AUTH_PASS;
const DEFAULT_OUTPUT_DIR = process.env.SD_OUTPUT_DIR || './output';
const REQUEST_TIMEOUT = parseInt(process.env.REQUEST_TIMEOUT || "300000", 10);

interface GenerateImageArgs {
  prompt: string;
  negative_prompt?: string;
  steps?: number;
  width?: number;
  height?: number;
  cfg_scale?: number;
  sampler_name?: string;
  scheduler_name?: string;
  seed?: number;
  batch_size?: number;
  restore_faces?: boolean;
  tiling?: boolean;
  output_path?: string;
  distilled_cfg_scale?: number;
}

interface SDAPIPayload {
  prompt: string;
  negative_prompt: string;
  steps: number;
  width: number;
  height: number;
  cfg_scale: number;
  sampler_name: string;
  scheduler_name: string;
  seed: number;
  n_iter: number;
  restore_faces?: boolean;
  tiling?: boolean;
  distilled_cfg_scale?: number;
}

class ImageGenServer {
  private server: Server;
  private axiosInstance;

  constructor() {
    this.server = new Server(
      { name: 'image-gen', version: '0.1.0' },
      { capabilities: { tools: {} } }
    );

    const axiosConfig: any = {
      baseURL: SD_WEBUI_URL,
      headers: { 'Content-Type': 'application/json' },
      timeout: REQUEST_TIMEOUT
    };

    if (AUTH_USER && AUTH_PASS) {
      axiosConfig.auth = { username: AUTH_USER, password: AUTH_PASS };
    }

    this.axiosInstance = axios.create(axiosConfig);
    this.setupToolHandlers();

    process.on('SIGINT', async () => {
      await this.server.close();
      process.exit(0);
    });
  }

  private setupToolHandlers() {
    this.server.setRequestHandler(ListToolsRequestSchema, async () => ({
      tools: [{
        name: 'generate_image',
        description: 'Generate an image using Stable Diffusion',
        inputSchema: {
          type: 'object',
          properties: {
            prompt: { type: 'string', description: 'The prompt describing the desired image' },
            negative_prompt: { type: 'string', description: 'Things to exclude from the image' },
            steps: { type: 'number', description: 'Number of sampling steps (default: 4)', minimum: 1, maximum: 150 },
            width: { type: 'number', description: 'Image width (default: 1024)', minimum: 512, maximum: 2048 },
            height: { type: 'number', description: 'Image height (default: 1024)', minimum: 512, maximum: 2048 },
            cfg_scale: { type: 'number', description: 'CFG scale (default: 1)', minimum: 1, maximum: 30 },
            sampler_name: { type: 'string', description: 'Sampling algorithm (default: Euler)', default: 'Euler' },
            scheduler_name: { type: 'string', description: 'Scheduler algorithm (default: Simple)', default: 'Simple' },
            seed: { type: 'number', description: 'Random seed (-1 for random)', minimum: -1 },
            batch_size: { type: 'number', description: 'Number of images to generate (default: 1)', minimum: 1, maximum: 4 },
            restore_faces: { type: 'boolean', description: 'Enable face restoration' },
            tiling: { type: 'boolean', description: 'Generate tileable images' },
            distilled_cfg_scale: { type: 'number', description: 'Distilled CFG scale (default: 3.5)', minimum: 1, maximum: 30 },
            output_path: { type: 'string', description: 'Custom output path for the generated image' }
          },
          required: ['prompt']
        }
      }]
    }));

    this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
      try {
        if (request.params.name !== 'generate_image') {
          throw new McpError(ErrorCode.MethodNotFound, `Unknown tool: ${request.params.name}`);
        }

        const args = request.params.arguments;
        if (!isGenerateImageArgs(args)) {
          throw new McpError(ErrorCode.InvalidParams, 'Invalid parameters');
        }

        const outputDir = args.output_path ? path.normalize(args.output_path.trim()) : DEFAULT_OUTPUT_DIR;
        await this.ensureDirectoryExists(outputDir);

        const payload: SDAPIPayload = {
          prompt: args.prompt,
          negative_prompt: args.negative_prompt || '',
          steps: args.steps || 4,
          width: args.width || 1024,
          height: args.height || 1024,
          cfg_scale: args.cfg_scale || 1,
          sampler_name: args.sampler_name || 'Euler',
          seed: args.seed ?? -1,
          n_iter: args.batch_size || 1,
          distilled_cfg_scale: args.distilled_cfg_scale || 3.5,
          scheduler_name: args.scheduler_name || 'Simple',
          tiling: !!args.tiling,
          restore_faces: !!args.restore_faces
        };

        const response = await this.axiosInstance.post('/sdapi/v1/txt2img', payload);
        if (!response.data.images?.length) throw new Error('No images generated');

        const results = [];
        for (const imageData of response.data.images) {
          const base64Data = imageData.includes(',') ? imageData.split(',')[1] : imageData;
          const pngInfoResponse = await this.axiosInstance.post('/sdapi/v1/png-info', { image: `data:image/png;base64,${imageData}` });
          
          const outputPath = path.join(outputDir, `sd_${randomUUID()}.png`);
          const imageBuffer = Buffer.from(base64Data, 'base64');
          
          await sharp(imageBuffer)
            .withMetadata({ exif: { IFD0: { ImageDescription: pngInfoResponse.data.info } } })
            .toFile(outputPath);

          results.push({ path: outputPath, parameters: pngInfoResponse.data.info });
        }

        return { content: [{ type: 'text', text: JSON.stringify(results) }] };
      } catch (error) {
        if (axios.isAxiosError(error)) {
          throw new McpError(
            ErrorCode.InternalError,
            error.response ? `API error: ${error.response.data?.error || error.message}` :
            error.request ? `No response: ${error.message}` : `Request error: ${error.message}`
          );
        }
        throw new McpError(
          ErrorCode.InternalError,
          error instanceof Error ? error.message : 'Unknown error occurred'
        );
      }
    });
  }

  private async ensureDirectoryExists(dirPath: string): Promise<void> {
    try {
      await fs.promises.access(dirPath, fs.constants.F_OK);
    } catch {
      await mkdir(dirPath, { recursive: true });
    }
  }

  async run() {
    const transport = new StdioServerTransport();
    await this.server.connect(transport);
  }
}

function isGenerateImageArgs(value: unknown): value is GenerateImageArgs {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  
  // Validate string fields
  if (typeof v.prompt !== 'string') return false;
  if (v.negative_prompt !== undefined && typeof v.negative_prompt !== 'string') return false;
  
  // Convert and validate numeric fields
  if (v.steps !== undefined) {
    const steps = Number(v.steps);
    if (isNaN(steps) || steps < 1 || steps > 150) return false;
    v.steps = steps;
  }
  
  if (v.batch_size !== undefined) {
    const batchSize = Number(v.batch_size);
    if (isNaN(batchSize) || batchSize < 1 || batchSize > 4) return false;
    v.batch_size = batchSize;
  }
  
  return true;
}

process.on('unhandledRejection', (reason) => {
  console.error('Unhandled rejection:', reason);
});

process.on('uncaughtException', (err) => {
  console.error('Uncaught exception:', err);
  setTimeout(() => process.exit(1), 500);
});

const server = new ImageGenServer();
server.run().catch(err => {
  console.error('Server failed:', err);
  process.exit(1);
});
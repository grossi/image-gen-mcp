# image-gen MCP Server

A MCP server that provides text-to-image generation capabilities using Stable Diffusion WebUI API (ForgeUI/AUTOMATIC-1111).

## Installation

### Prerequisites
- Node.js
- Access to a Stable Diffusion WebUI instance with API enabled
- The WebUI must have `--api` flag enabled when starting

### Setup

1. Clone the repository:
```bash
git clone https://github.com/Ichigo3766/image-gen-mcp.git
cd image-gen-mcp
```

2. Install dependencies:
```bash
npm install
```

3. Build the server:
```bash
npm run build
```

4. Add the server configuration to your environment:

```json
{
  "mcpServers": {
    "image-gen": {
      "command": "node",
      "args": [
        "/path/to/image-gen-mcp/build/index.js"
      ],
      "env": {
        "SD_WEBUI_URL": "http://your-sd-webui-url:7860",
        "SD_AUTH_USER": "your-username",  // Optional: if authentication is enabled
        "SD_AUTH_PASS": "your-password",  // Optional: if authentication is enabled
        "SD_OUTPUT_DIR": "/path/to/output/directory"
      }
    }
  }
}
```

Replace the environment variables with your values:
- `SD_WEBUI_URL`: URL of your Stable Diffusion WebUI instance
- `SD_AUTH_USER`: Username for basic auth (if enabled)
- `SD_AUTH_PASS`: Password for basic auth (if enabled)
- `SD_OUTPUT_DIR`: Directory where generated images will be saved

## Features

### Tools
- `generate_image` - Generate images using Stable Diffusion
  - Parameters:
    - `prompt` (required): Text description of the desired image
    - `negative_prompt`: Things to exclude from the image
    - `steps`: Number of sampling steps (default: 4, range: 1-150)
    - `width`: Image width (default: 1024, range: 512-2048)
    - `height`: Image height (default: 1024, range: 512-2048)
    - `cfg_scale`: CFG scale (default: 1, range: 1-30)
    - `sampler_name`: Sampling algorithm (default: "Euler")
    - `scheduler_name`: Scheduler algorithm (default: "Simple")
    - `seed`: Random seed (-1 for random)
    - `batch_size`: Number of images to generate (default: 1, max: 4)
    - `restore_faces`: Enable face restoration
    - `tiling`: Generate tileable images
    - `output_path`: Custom output path for the generated image

## Development

For development with auto-rebuild:
```bash
npm run watch
```

## Error Handling

Common issues and solutions:
1. Make sure your Stable Diffusion WebUI is running with the `--api` flag
2. Check if the WebUI URL is accessible from where you're running the MCP server
3. If using authentication, ensure credentials are correct
4. Verify the output directory exists and has write permissions
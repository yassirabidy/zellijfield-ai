# Zellijfield AI — Docker stack

One compose project, `zellijfield-ai`, shown as a single stack in Docker Desktop.

| Service | Image | Profiles | Port | GPU |
|---|---|---|---|---|
| `studio` | `zellijfield-ai/studio` (Next.js, node:22.23.4-slim, non-root) | mock, wan2gp, comfyui, full | `127.0.0.1:3000` (published) | no |
| `wan2gp` | `zellijfield-ai/wan2gp` (CUDA 12.8, Wan2GP @ `9d25c60`, MCP API v1) | wan2gp, full | 7866 (internal only) | yes |
| `comfyui` | `zellijfield-ai/comfyui` (Python 3.12, ComfyUI v0.42.1) | comfyui, full | 8188 (internal only) | yes |

The studio talks to Wan2GP through its MCP server (`http://wan2gp:7866/mcp`) and to ComfyUI over
HTTP/WebSocket (`http://comfyui:8188`). Containers never spawn each other's processes, and the
Docker socket is never mounted. Wan2GP's Gradio UI is not started.

## Commands

| | Windows | Linux / macOS |
|---|---|---|
| Check the machine | `preflight.bat full` | `./preflight.sh full` |
| Start (mock, no GPU) | `start.bat` | `./start.sh` |
| Start everything | `start.bat full` | `./start.sh full` |
| Stop | `stop.bat` | `./stop.sh` |

Plain compose works too, from this folder:

```bash
docker compose up -d                    # mock (COMPOSE_PROFILES=mock in .env)
docker compose --profile full up -d     # studio + wan2gp + comfyui
docker compose logs -f wan2gp
docker compose --profile full down
```

`.env` sets `COMPOSE_FILE=docker-compose.yml;docker-compose.gpu.yml`, so the GPU reservations in
`docker-compose.gpu.yml` are always merged. On a machine without an NVIDIA GPU only the mock
profile can start; the GPU services fail at container creation with a clear Docker error.

## Folders (bind mounts)

Set in `.env`; relative paths are relative to this folder. On Windows prefer forward slashes
(`D:/ai/models`). The preflight script creates the tree before the first start.

| Host (default) | Container | Purpose |
|---|---|---|
| `./data` | studio `/data` | SQLite database, settings (incl. API keys, server-side only) |
| `./data/outputs` | studio `/outputs`; `wan2gp/` and `comfyui/` subfolders in each engine | generated media, gallery |
| `./workflows` | studio `/workflows` (read-only) | ComfyUI API-format workflows |
| `./models` | studio `/models` (read-only, status checks) | all weights |
| `./models/wan2gp` | wan2gp `/opt/wan2gp/ckpts` | Wan2GP weights (auto-downloaded on first use) |
| `./models/comfyui` | comfyui `/opt/comfyui/models` | ComfyUI weights (`diffusion_models/`, `vae/`, `text_encoders/`, ...) |
| `./models/huggingface` | both engines' HF cache | Hugging Face downloads |
| `./data/wan2gp`, `./data/comfyui` | engine config / input / user dirs | engine state |

`npm run dev` outside Docker reads `.env.local` (gitignored); keep `DATA_DIR=./.dev-data` there so
a dev server never opens the same SQLite file as the running container.

## Runtime settings

| `.env` | Effect |
|---|---|
| `ZF_WAN2GP_PROFILE` | Wan2GP memory profile passed as `--profile` (4 default, 5 fail-safe for low RAM/VRAM). |
| `ZF_DEFAULT_BACKEND` | Backend preselected by the studio (`mock` by default). |
| `ZF_WAN2GP_MCP_URL`, `ZF_COMFYUI_URL` | Default backend URLs; the Settings page can override them per install and reset them. |

## Pinned versions

Bump these deliberately and re-test a real generation afterwards.

| Component | Pin | Where |
|---|---|---|
| Node.js | 22.23.4-slim | `docker/studio/Dockerfile` |
| Wan2GP | `9d25c601f3c7074ca03c50f41b307a7c517835f9` | `docker/wan2gp/Dockerfile` (`WAN2GP_REF`) |
| CUDA base (Wan2GP) | `nvidia/cuda:12.8.1-cudnn-devel-ubuntu22.04` | same (matches Wan2GP's Dockerfile) |
| PyTorch | 2.10.0 + cu128 (both engines) | both GPU Dockerfiles |
| SageAttention | `d1a57a546c3d395b1ffcbeecc66d81db76f3b4b5` | `docker/wan2gp/Dockerfile` |
| ComfyUI | v0.42.1 = `63be2f9b82ad0dac88a7ceaa28a9cf3154125a18` | `docker/comfyui/Dockerfile` |
| ComfyUI-WanVideoWrapper | `088128b2` | same (`CUSTOM_NODES`) |
| ComfyUI-KJNodes | `eaa8fee7` | same |
| ComfyUI-VideoHelperSuite | `4d907bee` | same |
| ComfyUI-Cosmos3 (experimental) | `09369639` | same (`INSTALL_COSMOS3`) |
| ComfyUI-MelBandRoFormer (opt-in) | `92c86854` | same (`INSTALL_MELBAND`, off by default) |

`ZF_CUDA_ARCHITECTURES` in `.env` must include the client GPU's compute capability
(RTX 30xx = 8.6, RTX 40xx = 8.9, RTX 50xx = 12.0) or SageAttention will not run on it.
`ZF_BUILD_JOBS` sets how many CUDA compile jobs run in parallel during that build; each needs
about 4 GB of RAM. Keep 2 on a 16 GB PC (8 jobs crashed Docker Desktop's WSL VM in testing);
use 4 or more on 32 GB+.

## Security

- Only the studio publishes a port, and only on `127.0.0.1`. Wan2GP's MCP server has no
  authentication in this setup and is reachable solely on the internal compose network.
- API keys (Muapi, fal, Replicate) are entered in the studio's Settings and stored under `./data`;
  they are never sent to the browser or written to logs. Keep `./data` private and out of backups
  you share.
- All containers run as non-root users (uid 1000).

## LAN access (other computers on the network)

By default the studio is reachable only from the PC it runs on. To open it to the local network:

1. In `.env`, set `ZF_BIND_ADDRESS=0.0.0.0` (or that PC's LAN IP) and restart with `start.bat`.
2. Allow the port in Windows Defender Firewall for **Private** networks only:
   `New-NetFirewallRule -DisplayName "Zellijfield AI" -Direction Inbound -Protocol TCP -LocalPort 3000 -Profile Private -Action Allow`
   (PowerShell as Administrator).
3. Browse to `http://<pc-ip>:3000` from the other machine.

Understand what this exposes: the studio has **no login**. Anyone on that network can generate
media on the GPU, see the gallery, and use the API keys saved in Settings (the keys themselves are
not displayed, but they will be spent). Only do this on a trusted network; never forward the port
on a router or expose it to the internet. For remote access, use a VPN (e.g. Tailscale) or put an
authenticating reverse proxy with HTTPS in front of the studio. Wan2GP and ComfyUI stay internal
either way.

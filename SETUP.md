# Zellijfield AI — setup on a Windows PC with an NVIDIA GPU

This guide installs Zellijfield AI on a Windows 10/11 PC and runs local video generation on its
NVIDIA GPU with Docker. Allow half a day for the first install: most of it is downloading.

Everything runs on this PC. The studio opens in a browser at **http://127.0.0.1:3000** and is not
reachable from other computers unless you choose to open it (see [LAN access](docs/DOCKER.md#lan-access-other-computers-on-the-network)).

---

## 1. What the PC needs

| | Minimum | Recommended |
|---|---|---|
| Windows | 10 22H2 or 11, 64-bit | 11 |
| NVIDIA GPU | 12 GB VRAM (RTX 3060 12 GB) | 16–24 GB VRAM (RTX 4080/4090/5090) |
| RAM | 32 GB | 64 GB |
| Free disk (SSD) | 200 GB | 500 GB+ |
| Internet | needed for installation and first model downloads | |

Rough sizes: Docker images ≈ 55 GB (Wan2GP 34 GB, ComfyUI 16 GB, studio 0.5 GB). Each large video
model is 20–60 GB. SkyReels-V3 needs ≈ 32 GB of files. Cosmos3-Super is far larger (its download
repository is ≈ 196 GB) and is **experimental**.

## 2. Install the NVIDIA driver (Windows side)

1. Install the latest **NVIDIA Game Ready or Studio driver** for the GPU from
   https://www.nvidia.com/Download/index.aspx (or with the NVIDIA App).
2. Reboot, then check in PowerShell: `nvidia-smi` must list the GPU.

Do **not** install a Linux NVIDIA driver inside WSL. The Windows driver provides the GPU to WSL and Docker.

## 3. Install WSL2

In **PowerShell as Administrator**:

```powershell
wsl --install
```

Reboot when asked. Then, in a normal PowerShell:

```powershell
wsl --update
wsl --status
```

`wsl --status` must report **Default Version: 2**.

Optional but recommended: give WSL enough memory for the models. Create `C:\Users\<you>\.wslconfig`:

```ini
[wsl2]
memory=24GB
swap=16GB
```

(About 75 % of the PC's RAM is a good value.) Run `wsl --shutdown` afterwards.

## 4. Install Docker Desktop

1. Download Docker Desktop for Windows: https://docs.docker.com/desktop/setup/install/windows-install/
2. During installation keep **Use WSL 2 instead of Hyper-V** selected.
3. Start Docker Desktop and wait for **Engine running**.
4. Optional: *Settings → Resources → Advanced → Disk image location* — move it to the drive with the
   most free space, since the images and caches live there.

## 5. Get Zellijfield AI

Put the project in a folder without spaces in the path if possible, e.g. `D:\ZellijfieldAI`:

```powershell
git clone https://github.com/yassirabidy/zellijfield-ai.git D:\ZellijfieldAI
cd D:\ZellijfieldAI
```

(Or copy the folder from a USB drive/zip.)

## 6. Configure

`start.bat` creates `.env` from `.env.example` on first run. Open `.env` in Notepad and check:

| Setting | What to set |
|---|---|
| `ZF_CUDA_ARCHITECTURES` | The GPU's compute capability: RTX 30xx = `8.6`, RTX 40xx = `8.9`, RTX 50xx = `12.0`. Several: `8.6;8.9`. |
| `ZF_BUILD_JOBS` | `2` on a 32 GB PC, `4` with 64 GB+. Higher values can crash Docker during the Wan2GP build. |
| `ZF_MODELS_DIR`, `ZF_DATA_DIR`, `ZF_OUTPUTS_DIR` | Leave as is, or point at a big drive with forward slashes: `D:/ai/models`. |
| `ZF_WAN2GP_PROFILE` | `4` (default). Use `5` if you run out of memory (section 11). |

API keys do **not** go in `.env`. Muapi, fal and Replicate keys are optional and entered in the
**API key** dashboard (its Settings page); they are stored in `data/` and never sent to the browser.

## 7. Check the PC

Double-click **`preflight.bat`**, or from PowerShell:

```powershell
.\preflight.bat full
```

Every line should be `[ OK ]`. It checks Docker, GPU access from containers, disk space, the port
and the model folders, and creates the folder tree under `models/` and `data/`.

## 8. Models

### Wan2GP models (MiniMax H3, LTX-2.5, Wan 2.2, HunyuanVideo 1.5)

Nothing to do. Wan2GP downloads the weights the first time each model is used, into
`models/wan2gp/` (so they survive rebuilds). The first generation with a model is therefore slow
and needs internet. If you already have a Wan2GP installation, you can copy its `ckpts` folder
contents into `models/wan2gp/` to skip the downloads.

### ComfyUI models

Download these files into `models/comfyui/` with exactly these names:

**SkyReels-V3 (talking avatar: portrait image + voice clip → video)**

| File | Put it in | Source |
|---|---|---|
| `Wan21-SkyReelsV3-A2V_fp8_scaled_mixed.safetensors` (19 GB) | `models/comfyui/diffusion_models/WanVideo/SkyreelsV3/` | https://huggingface.co/Kijai/WanVideo_comfy_fp8_scaled/tree/main/SkyReelsV3 |
| `Wan2_1_VAE_bf16.safetensors` (0.3 GB) | `models/comfyui/vae/wanvideo/` | https://huggingface.co/Kijai/WanVideo_comfy/tree/main |
| `umt5-xxl-enc-bf16.safetensors` (11 GB) | `models/comfyui/text_encoders/` | https://huggingface.co/Kijai/WanVideo_comfy/tree/main |
| `clip_vision_h.safetensors` (1.3 GB) | `models/comfyui/clip_vision/` | https://huggingface.co/Comfy-Org/Wan_2.1_ComfyUI_repackaged/tree/main/split_files/clip_vision |

The voice model (wav2vec2) is downloaded automatically on first use.

**Cosmos3-Super image-to-video (experimental)**

Download the repository https://huggingface.co/nvidia/Cosmos3-Super-Image2Video into
`models/comfyui/cosmos3/Cosmos3-Super-Image2Video/` (the folder must contain `transformer/`, `vae/`,
`text_tokenizer/`, …). It is very large; read the model card and its license (listed as
"openmdw-1.1") before commercial use.

**Local → Settings → Models** shows exactly which files are still missing.

## 9. Start

Double-click **`start.bat full`** — or in PowerShell:

```powershell
.\start.bat full
```

which runs the same as:

```powershell
docker compose --profile full up -d
```

The **first start builds the images: 30–60+ minutes** (SageAttention is compiled for your GPU).
Later starts take seconds. When it is ready the browser opens http://127.0.0.1:3000.

Docker Desktop shows one stack, **zellijfield-ai**, with `studio`, `wan2gp` and `comfyui`; it can
be started and stopped from there too. Wan2GP needs a few minutes after the container starts before
it reports *healthy*.

Other start modes: `start.bat` (mock only, no GPU), `start.bat wan2gp`, `start.bat comfyui`.
Stop everything with **`stop.bat`** (images, models and outputs are kept).

## 10. First real generation

1. Open http://127.0.0.1:3000. Every visit starts with a choice: **Local** (this PC's GPU, no keys)
   or **API key** (cloud studios with a Muapi key). Choose **Local**. *Switch mode* in the top bar
   returns to this choice.
2. In the Local dashboard open **Settings** (left menu) and press **Test connections**. Wan2GP models should show
   *Installed* or *Not found* (= downloads on first use); ComfyUI models show which files are missing.
   *Unreachable* means the service is not running yet (section 11).
3. Open **Video Studio**, pick **Wan 2.2 A14B Text-to-Video** (or LTX-2.5), write a prompt, press
   **Generate**.
4. The first run downloads the model; follow it with `docker compose logs -f wan2gp`. The progress
   bar then shows the denoising steps. Jobs run one at a time on the GPU; others wait in the queue.
5. The result plays in the page and is saved to `data/outputs/studio/`. **Gallery** lists them all.

The Local dashboard lists only what runs on this PC: an Image section appears only once local
image models are added to `models.json`. For a test without the GPU, set `ZF_SHOW_MOCK=1` in `.env`
and restart: a *Mock video (no GPU)* model appears. Keep it at `0` for everyday use.

## 11. Troubleshooting

**Run `preflight.bat full` first** — it names most problems directly. Logs:
`docker compose logs -f studio`, `... wan2gp`, `... comfyui`.

### GPU not visible ("Containers cannot see the NVIDIA GPU", "Found no NVIDIA driver")

- `nvidia-smi` in Windows PowerShell must work. If not: reinstall the NVIDIA driver, reboot.
- `wsl --update`, then `wsl --shutdown`, then restart Docker Desktop.
- Docker Desktop → Settings → General: **Use the WSL 2 based engine** must be on.
- Test: `docker run --rm --gpus all nvidia/cuda:12.8.1-base-ubuntu22.04 nvidia-smi`
- The `wan2gp` container restarting in a loop with *Found no NVIDIA driver* is this problem.

### Out of memory

- **GPU (CUDA out of memory)** in the job error: use a lighter model (HunyuanVideo 1.5 480p, LTX-2.5
  distilled), fewer frames, or 9:16 / 480p; set `ZF_WAN2GP_PROFILE=5` in `.env`, then
  `docker compose --profile full up -d`. Close other GPU programs (games, browsers with many video tabs).
- **System RAM / WSL** (container killed, Docker Desktop restarts): raise `memory=` in `.wslconfig`
  (section 3), `wsl --shutdown`, restart Docker Desktop.
- **During the first build** (Docker Desktop stops while "Building wheel for sageattention"): set
  `ZF_BUILD_JOBS=1` in `.env` and run `start.bat full` again; finished steps are cached.

### Port 3000 already in use

Preflight names the program using it. Stop it, or set another port in `.env`, e.g.
`ZF_STUDIO_PORT=3010`, then open http://127.0.0.1:3010.

### Models show "Unreachable"

- In the `mock` profile the GPU services are not started — use `start.bat full`.
- Wan2GP takes several minutes after start: wait for `docker compose ps` to show it *healthy*.
- If you changed the URLs in Local → Settings, press **Reset to defaults**.

### "no kernel image is available for execution on the device" (Wan2GP)

SageAttention was compiled for a different GPU generation. Rebuild Wan2GP for this GPU: set `ZF_CUDA_ARCHITECTURES` in `.env`, then
`docker compose build --no-cache wan2gp` and `start.bat full`.

### Disk full

`docker system df` shows image space. `docker builder prune` removes build caches (safe). Models
are in `models/`, outputs in `data/outputs/`.

## 12. Updating, backup, privacy

- **Update:** `git pull`, then `start.bat full` (rebuilds what changed).
- **Back up:** `data/` (settings, history, outputs). `models/` can be re-downloaded.
- `data/zellijfield.db` contains the API keys you entered. Keep `data/` private; do not share it.
- Wan2GP is licensed under the WanGP Community License (see `NOTICE.md`): installing and supporting
  it for a client is fine; selling access to Wan2GP itself is not.

More details on the stack, pinned versions and LAN access: [docs/DOCKER.md](docs/DOCKER.md).

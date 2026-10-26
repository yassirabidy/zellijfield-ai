# Zellijfield AI — setup on a Windows PC with an NVIDIA GPU

Installing with an AI assistant? Give it [CLIENT_INSTALL.md](CLIENT_INSTALL.md): the same install as
step-by-step instructions with checks.

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
model is 20–50 GB (the Models page shows the exact size of each). SkyReels-V3 needs ≈ 30 GB. Cosmos3-Super is far larger (≈ 122 GB)
and is **experimental**.

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

## 8. Engines and models

Everything is managed from the website: **Local → Models**. Nothing is downloaded in advance.

**Engines.** Local models run inside one of two engines: **Wan2GP** (≈ 34 GB, for MiniMax H3,
LTX-2.5, Wan 2.2 and HunyuanVideo 1.5) and **ComfyUI** (≈ 16 GB, for SkyReels-V3 and Cosmos3-Super).
The **Engines** section at the top of the page shows each engine's status and disk usage, with
**Install**, **Start**, **Stop** and **Delete** buttons. Installing an engine the first time takes
30–60 minutes (it is downloaded and built for this GPU). Stop an engine to free GPU memory when you
are not using it, and delete it to free its disk space; downloaded models stay on disk.

These buttons work through the **engine manager**, a small program that `start.bat` starts in the
background (section 9). If the page says the engine manager is not running, start Zellijfield AI
with `start.bat` again.

**Models.** Each model has a **Download** button, a progress bar, **Cancel download**, and
**Remove** to free disk space when the model is no longer needed. If the model's engine is not
installed yet, the button says **Install engine + download**: the engine is installed first, then
the model is downloaded, without anything else to do. After removing the last model of an engine,
the page suggests deleting that engine too.

- **Wan2GP models** are downloaded by Wan2GP itself, so Wan2GP must be installed and running (the
  button takes care of that). Wan2GP takes a minute or two to get ready before the first bytes
  arrive. Files go to `models/wan2gp/`. If a model was not downloaded here, Wan2GP still fetches it
  on the first generation.
- **ComfyUI models** are downloaded by the studio from Hugging Face into `models/comfyui/`, with
  the exact names ComfyUI expects. ComfyUI does not need to be running for this. A cancelled
  download continues where it stopped the next time.
- **Remove** deletes the model's weight files. Files that another downloaded model still uses
  (for example a text encoder shared by the Wan 2.2 models) are kept until that model is removed
  too. A model cannot be removed while it has jobs waiting or running.

Each model on the Models page shows how much disk space it needs (for example SkyReels-V3 ≈ 30 GB,
Wan 2.2 ≈ 37 GB, MiniMax H3 ≈ 48 GB; Cosmos3-Super ≈ 122 GB and **experimental**: read its license ("openmdw-1.1") before commercial use).

If you already have the files (another PC, a USB drive), you can copy them instead:

| Model | Files | Put them in |
|---|---|---|
| Wan2GP models | the contents of an existing Wan2GP `ckpts` folder | `models/wan2gp/` |
| SkyReels-V3 | [Wan21-SkyReelsV3-A2V_fp8_scaled_mixed.safetensors](https://huggingface.co/Kijai/WanVideo_comfy_fp8_scaled/tree/main/SkyReelsV3) | `models/comfyui/diffusion_models/WanVideo/SkyreelsV3/` |
| | [Wan2_1_VAE_bf16.safetensors](https://huggingface.co/Kijai/WanVideo_comfy/tree/main) | `models/comfyui/vae/wanvideo/` |
| | [umt5-xxl-enc-bf16.safetensors](https://huggingface.co/Kijai/WanVideo_comfy/tree/main) | `models/comfyui/text_encoders/` |
| | [clip_vision_h.safetensors](https://huggingface.co/Comfy-Org/Wan-2.1/tree/main/split_files/clip_vision) | `models/comfyui/clip_vision/` |
| Cosmos3-Super | the whole [nvidia/Cosmos3-Super-Image2Video](https://huggingface.co/nvidia/Cosmos3-Super-Image2Video) repository | `models/comfyui/cosmos3/Cosmos3-Super-Image2Video/` |

The voice model used by SkyReels-V3 (wav2vec2) is downloaded by ComfyUI on first use.

## 9. Start

**Simplest:** double-click **`start.bat`**. It starts the website (≈ 0.5 GB) and the engine
manager; install engines and models later from **Local → Models** (section 8).

To install and start both engines straight away instead, run **`start.bat full`** — or in PowerShell:

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

Other start modes: `start.bat` (website and engine manager only), `start.bat wan2gp`, `start.bat comfyui`.
Stop everything with **`stop.bat`** (images, models and outputs are kept).

## 10. First real generation

1. Open http://127.0.0.1:3000. Every visit starts with a choice: **Local** (this PC's GPU, no keys)
   or **API key** (cloud studios with a Muapi key). Choose **Local**. *Switch mode* in the top bar
   returns to this choice.
2. In the Local dashboard open **Models** (left menu) and press **Download** on
   **Wan 2.2 A14B Text-to-Video** (or LTX-2.5). Wait until it shows *Installed*. *Unreachable*
   means Wan2GP is not running yet (section 11).
3. Open **Video Studio**, pick that model, write a prompt, press **Generate**.
4. The progress bar shows the denoising steps. Jobs run one at a time on the GPU; others wait in
   the queue. (A model that was not downloaded first is fetched now, which takes much longer.)
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

### "The engine manager is not running"

The Engines buttons need the engine manager, which `start.bat` starts in the background. Run
`start.bat` again (it does nothing if the manager is already running). It is a PowerShell window
named *Zellijfield AI engine manager*, minimized; `stop.bat` closes it.

### A download fails or stops

- Check the internet connection and the free disk space, then press **Download** again: ComfyUI
  downloads continue where they stopped, and Wan2GP skips the files it already has.
- Wan2GP downloads need the `wan2gp` or `full` start mode; details are in `docker compose logs -f wan2gp`.
- ComfyUI download errors are in `docker compose logs -f studio`.

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

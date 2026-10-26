# Zellijfield AI Setup

This file is written for an AI assistant (Claude, ChatGPT, …) that installs and starts Zellijfield AI
on a Windows PC, working together with the person at that PC. Follow steps 1–7 **in order**. After each
step, run its **Check** and only continue when it passes. If a check fails, use the *Problems* section
or stop and report (see *What to report*).

**The setup ends at step 7, when the website runs.** It installs no engines and no models. Engines
(Wan2GP, ComfyUI) and models are optional and are installed later by the person, by clicking
**Install** in the website — see *After setup*.

Target PC: **Windows 11, NVIDIA RTX 5080 (16 GB VRAM), 64 GB RAM, Intel Core Ultra 9**.
Commands are for **PowerShell**. "As Administrator" means a PowerShell window opened with
*Run as administrator*.

## Rules for the assistant

- Do not change any project code, `docker-compose*.yml` or Dockerfiles. Only edit `.env` and
  `C:\Users\<name>\.wslconfig` as described below. If something seems to need a code change, stop and report.
- Never mount the Docker socket into a container, never publish ports beyond what the project does,
  and keep `ZF_BIND_ADDRESS=127.0.0.1` (the studio has no login).
- Never put API keys or passwords in `.env` or in chat. API keys (optional) are entered by the person
  in the website, under API key → Settings.
- Do not run destructive Docker commands (`docker system prune -a`, `docker volume rm …`, deleting
  `models/` or `data/`) unless the person explicitly asks.
- Ask the person before steps that need a reboot, an administrator window, or a sign-in.
- Do not install engines or download models during setup (no `start.bat full`, `start.bat wan2gp`,
  `start.bat comfyui` or `docker compose build wan2gp/comfyui`). Only `start.bat` without arguments.

## What gets installed

| Part | Size on disk | What it is |
|---|---|---|
| Docker Desktop + WSL2 | a few GB | Runs everything below |
| Studio (website) | ≈ 0.5 GB | The dashboard at http://127.0.0.1:3000 |
| Wan2GP engine (later, optional) | ≈ 35 GB | Runs MiniMax H3, LTX-2.5, Wan 2.2, HunyuanVideo 1.5 |
| ComfyUI engine (later, optional) | ≈ 16 GB | Runs SkyReels-V3 (talking avatar) and Cosmos3 |
| Each model (later, optional) | 24–48 GB | Downloaded from the website when needed |

The setup itself needs only a few GB (Docker Desktop, WSL2 and the 0.5 GB website). To generate
videos later, plan for **at least 100 GB free** for one engine and a couple of models.

---

## Step 1 — NVIDIA driver

1. Install the latest NVIDIA Game Ready or Studio driver for the RTX 5080
   (https://www.nvidia.com/Download/index.aspx or the NVIDIA App). Reboot if asked.
2. Do **not** install any NVIDIA driver inside WSL/Linux; the Windows driver is used.

**Check:**
```powershell
nvidia-smi
```
Must list `NVIDIA GeForce RTX 5080`.

## Step 2 — WSL2

As Administrator:
```powershell
wsl --install
```
Reboot when asked. Then in a normal PowerShell:
```powershell
wsl --update
```

Give WSL enough memory: create the file `C:\Users\<name>\.wslconfig` (replace `<name>` with the
Windows user folder) with exactly:
```ini
[wsl2]
memory=48GB
swap=16GB
```
Then:
```powershell
wsl --shutdown
```

**Check:**
```powershell
wsl --status
```
Must show `Default Version: 2`.

## Step 3 — Docker Desktop

1. Install Docker Desktop for Windows: https://docs.docker.com/desktop/setup/install/windows-install/
   Keep **Use WSL 2 instead of Hyper-V** selected.
2. Start Docker Desktop and wait until it shows **Engine running**.
3. Optional: Docker Desktop → Settings → Resources → Advanced → *Disk image location*: move it to
   the drive with the most free space.

**Check:**
```powershell
docker version
docker run --rm --gpus all nvidia/cuda:12.8.1-base-ubuntu22.04 nvidia-smi
```
The second command must print the RTX 5080 table (it downloads a small test image the first time).

## Step 4 — Get the project

Use a folder **without spaces** if possible, e.g. `D:\ZellijfieldAI`.

- If the person has access to the private GitHub repository (they sign in when asked):
  ```powershell
  git clone https://github.com/yassirabidy/zellijfield-ai.git D:\ZellijfieldAI
  ```
- Otherwise copy the project folder from the USB drive / zip to `D:\ZellijfieldAI`.

Then:
```powershell
cd D:\ZellijfieldAI
```
All later commands run in this folder.

**Check:** `dir` shows `start.bat`, `stop.bat`, `preflight.bat`, `docker-compose.yml`, `.env.example`.

## Step 5 — Configure `.env` for this PC

```powershell
Copy-Item .env.example .env
notepad .env
```
Change these three lines (leave everything else as it is) and save:
```ini
ZF_CUDA_ARCHITECTURES=12.0
ZF_BUILD_JOBS=6
ZF_WAN2GP_PROFILE=4
```
- `12.0` = RTX 50xx (Blackwell). Required, or Wan2GP's SageAttention will not run on this GPU.
- `6` parallel build jobs is safe with 64 GB RAM and the `.wslconfig` above.
- `4` is Wan2GP's recommended memory profile (models larger than 16 GB VRAM are streamed from RAM).

Optional: to keep models and outputs on another drive, set `ZF_MODELS_DIR`, `ZF_DATA_DIR`,
`ZF_OUTPUTS_DIR` with forward slashes, e.g. `ZF_MODELS_DIR=E:/zf/models`.

**Check:**
```powershell
Select-String -Path .env -Pattern '^ZF_CUDA_ARCHITECTURES|^ZF_BUILD_JOBS|^ZF_WAN2GP_PROFILE|^ZF_BIND_ADDRESS'
```
Must show `12.0`, `6`, `4` and `ZF_BIND_ADDRESS=127.0.0.1`.

## Step 6 — Preflight

```powershell
.\preflight.bat full
```
It only checks — Docker, GPU access from containers, disk space, the port — and creates the empty
folder tree under `models\` and `data\`. It installs no engine.

**Check:** every line is `[ OK ]`. A `[WARN]` about disk space is fine for the setup (it only needs a
few GB); tell the person that engines and models need about 100 GB later. Fix any `[FAIL]` before
continuing (see *Problems*).

## Step 7 — Start Zellijfield AI

```powershell
.\start.bat
```
This builds and starts **only the website** (≈ 0.5 GB) and starts the **engine manager** in the
background (a minimized PowerShell window called *Zellijfield AI engine manager*). The first run builds
the studio image (a few minutes). The browser then opens http://127.0.0.1:3000. No engine is installed.

Always start the project with `start.bat` (not only from Docker Desktop): the engine manager is what
lets the website install and control the engines.

**Check:**
```powershell
docker compose ps
```
shows `studio` as `healthy`, and http://127.0.0.1:3000 shows two cards: **Local** and **API key**.
In the website, **Local → Models** shows an **Engines** section with Wan2GP and ComfyUI as
*Not installed*, and no warning that the engine manager is not running.

**Setup is complete.** Stop here and tell the person the website is ready. Everything below is
optional and done by the person, in the website, whenever they want.

---

## After setup (optional): engines and models, from the website

Done by the person when they want to generate videos locally — not part of the setup.

### Install an engine and a model

1. Open http://127.0.0.1:3000 → **Local** → **Models** (left menu).
2. Either click **Install** on an engine in the **Engines** section, or click **Install engine +
   download** on a model: that installs the model's engine first, then downloads the model.
   Good first models: **LTX-2.5 Distilled 22B** (fast, 38.5 GB) or **HunyuanVideo 1.5** (smallest, 24.4 GB).
3. Wait. The first Wan2GP install takes 30–60 minutes (it downloads and compiles for the RTX 5080);
   then the model downloads (the card shows progress). Do not cancel because it is slow.

**Check:** the engine shows **Running**, and the model shows **Installed**.

Progress can also be followed with:
```powershell
docker compose --profile full logs -f --tail 50 wan2gp
```
(Ctrl+C stops following the log; it does not stop the engine.)

### First video

1. **Video Studio** (left menu). In the bottom prompt bar pick the installed model.
2. Keep **480p** and a short duration (≈ 5 s) for the first test.
3. Write a prompt, e.g. `A paper boat drifting down a rainy street at night, cinematic`, press **Generate**.
4. The job card shows progress; the result plays in the page and appears in **Gallery**.
   Files are saved in `data\outputs\studio\`.

**Check:** a video plays. Then try 720p and longer clips.

---

## Good to know on this PC (16 GB VRAM)

- 480p and 720p with 5–10 s clips run well for Wan 2.2, LTX-2.5, HunyuanVideo and MiniMax H3.
- 1080p or long clips (20 s+) may hit *CUDA out of memory*: pick a lower quality or shorter duration.
- Skip **Cosmos3-Super** (≈ 122 GB of files, larger than the 64 GB RAM).
- The ComfyUI engine is only needed for SkyReels-V3 (talking avatar from a portrait + voice clip).
- Stop everything with `.\stop.bat` (images, models and outputs are kept). Next time just run `.\start.bat`.
- Engines can be stopped (frees GPU memory) or deleted (frees disk space) in **Local → Models → Engines**;
  models are removed with **Remove** on each model.

## Problems

| Symptom | What to do |
|---|---|
| `nvidia-smi` fails, or the CUDA test in step 3 fails | Reinstall the NVIDIA driver, reboot, `wsl --update`, `wsl --shutdown`, restart Docker Desktop. Docker Desktop → Settings → General → *Use the WSL 2 based engine* must be on. |
| Website says "The engine manager is not running" | Run `.\start.bat` again (it does nothing if the manager already runs). |
| Engine install fails in the website | Run `docker compose --profile full logs --tail 100 wan2gp` and look at the error shown on the engine card. If Docker Desktop crashed during "Building wheel for sageattention", set `ZF_BUILD_JOBS=2` in `.env` and click **Install** again (finished steps are cached). |
| "no kernel image is available for execution on the device" | `ZF_CUDA_ARCHITECTURES` is wrong: set it to `12.0`, delete the Wan2GP engine in the website, install it again. |
| Model shows *Unreachable* | The engine is stopped or still starting: start it under **Engines** and wait until it shows **Running** (Wan2GP needs a few minutes after starting). |
| Job fails with *CUDA out of memory* | Lower the quality or duration; close games/other GPU programs; if it persists set `ZF_WAN2GP_PROFILE=5` in `.env`, then **Stop** and **Start** the Wan2GP engine under **Local → Models → Engines**. |
| Container killed / Docker Desktop restarts during a job | Check `.wslconfig` (step 2), then `wsl --shutdown` and restart Docker Desktop. |
| A download stops | Check internet and free disk space, press **Download** again (it resumes / skips finished files). |
| Port 3000 in use | Preflight names the program. Stop it or set `ZF_STUDIO_PORT=3010` in `.env` and open http://127.0.0.1:3010. |

More detail: `SETUP.md` (sections 8–11) and `docs/DOCKER.md`.

## What to report

When a step fails and the table above does not fix it, stop and send the developer:

1. Which step failed and the exact command or button.
2. A screenshot of the error in the website (if any).
3. The output of:
   ```powershell
   docker compose --profile full ps
   docker compose logs --tail 100 studio
   docker compose --profile full logs --tail 100 wan2gp
   Get-Content data\engines\status.json
   ```
   (use `comfyui` instead of `wan2gp` for SkyReels / Cosmos problems).

Do not include `.env` contents beyond the lines checked in step 5, and never include API keys.

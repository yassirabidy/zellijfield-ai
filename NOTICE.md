# Notice

**Zellijfield AI** is a standalone project derived from third-party open-source software.
It is not a fork in the GitHub sense: the upstream sources were imported once and their git
history and submodule links were removed so this repository is self-contained.

## Upstream project

| Project | Source | Imported commit | License |
|---|---|---|---|
| Open-Generative-AI by Anil-matcha | https://github.com/Anil-matcha/Open-Generative-AI | `1fe89914527fa517c2de08344c66cbcfbf41563d` (2026-10-23) | MIT — see [`LICENSE`](LICENSE) ("Copyright (c) 2026 Open Generative AI Contributors") |

## Flattened submodules

These were git submodules of the upstream project. Their files now live directly in this
repository under `packages/`; each keeps its original license file where one exists.

| Path | Source | Imported commit | License |
|---|---|---|---|
| `packages/Vibe-Workflow` | https://github.com/SamurAIGPT/Vibe-Workflow | `c65ce897e82bf73659c2725528c8492cd609d831` | MIT — [`packages/Vibe-Workflow/LICENSE`](packages/Vibe-Workflow/LICENSE) ("Copyright (c) 2024 Vibe Workflow Contributors") |
| `packages/Open-AI-Design-Agent` | https://github.com/Anil-matcha/Open-AI-Design-Agent | `ebc0ce7650baad0d13797ccd471c883e78be3161` | MIT — [`packages/Open-AI-Design-Agent/LICENSE`](packages/Open-AI-Design-Agent/LICENSE) ("Copyright (c) 2023 Anil Chandra Naidu Matcha") |
| `packages/Open-Poe-AI` | https://github.com/Anil-matcha/Open-Poe-AI | `3e21ebc92d93bd699ffc6000bbcf980eaa8830cb` | MIT, as stated in its [`README.md`](packages/Open-Poe-AI/README.md) ("## License — MIT"). **The upstream repository ships no LICENSE file** and GitHub reports no detected license. |

> **Open-Poe-AI license caveat:** a README statement is weaker than a LICENSE file. Before
> distributing builds commercially, ask the author (Anil-matcha) to add a LICENSE file upstream,
> or remove the `packages/Open-Poe-AI` workspace (it powers the "Agents" section only).

## Components fetched when building the Docker images (not included in this repository)

The GPU images download these projects at pinned commits during `docker compose build`. They are
not part of this repository's source and stay under their own licenses.

| Component | Source | License |
|---|---|---|
| Wan2GP / WanGP | https://github.com/deepbeepmeep/Wan2GP | **WanGP Community License 2.0** (not open source). Free use, including inside companies and for client work; charging for access to WanGP itself, white-labelling it, or reselling it requires a commercial license from its author. Charging for installation/support labour is permitted (§1.9 (iii)). |
| SageAttention | https://github.com/thu-ml/SageAttention | Apache-2.0 |
| ComfyUI | https://github.com/Comfy-Org/ComfyUI | GPL-3.0 |
| ComfyUI-WanVideoWrapper | https://github.com/kijai/ComfyUI-WanVideoWrapper | Apache-2.0 |
| ComfyUI-KJNodes | https://github.com/kijai/ComfyUI-KJNodes | GPL-3.0 |
| ComfyUI-VideoHelperSuite | https://github.com/Kosinkadink/ComfyUI-VideoHelperSuite | GPL-3.0 |
| ComfyUI-Cosmos3 (experimental) | https://github.com/RyukoMatoiFan/ComfyUI-Cosmos3 | MIT (LICENSE file; not detected by GitHub) |
| ComfyUI-MelBandRoFormer (opt-in, off by default) | https://github.com/kijai/ComfyUI-MelBandRoFormer | **No license file upstream** |
| PyTorch, NVIDIA CUDA base images | https://pytorch.org, https://hub.docker.com/r/nvidia/cuda | BSD-3-Clause; NVIDIA Deep Learning Container License |

Model weights (MiniMax H3, LTX-2.5, Wan 2.2, HunyuanVideo 1.5, SkyReels-V3, Cosmos3, ...) are
downloaded by the user and carry their own licenses; check each model card before commercial use.

## Changes made in this repository

- Display and package names renamed from "Open Generative AI" to "Zellijfield AI" where safe.
- Upstream copyright notices and license texts are kept unchanged.
- Further changes (Docker stack, local backends, job queue) are tracked in this repository's git history.

All third-party code remains under its original license. Zellijfield AI's own additions are
also released under the MIT License.

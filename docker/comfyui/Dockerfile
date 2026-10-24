# syntax=docker/dockerfile:1.7
# ComfyUI for Zellijfield AI — built from pinned upstream sources (ComfyUI has no official image).
#
# PyTorch cu128 wheels bundle the CUDA runtime; the host only needs an NVIDIA driver plus the
# NVIDIA container runtime (Docker Desktop + WSL2 provides it on Windows).
# ComfyUI is GPL-3.0; custom node packs keep their own licenses (see NOTICE.md). None of them are
# vendored in this repository — they are fetched at the commits pinned below.

ARG PYTHON_IMAGE=python:3.12.12-slim-bookworm
FROM ${PYTHON_IMAGE}

ARG COMFYUI_REPO=https://github.com/Comfy-Org/ComfyUI.git
# v0.42.1
ARG COMFYUI_REF=63be2f9b82ad0dac88a7ceaa28a9cf3154125a18
ARG TORCH_INDEX_URL=https://download.pytorch.org/whl/cu128
ARG TORCH_VERSION=2.10.0
ARG TORCHVISION_VERSION=0.25.0
ARG TORCHAUDIO_VERSION=2.10.0

# Custom node packs used by the bundled workflows. Format: <dir>|<git url>|<commit>
# - ComfyUI-WanVideoWrapper (Apache-2.0): SkyReels-V3 (WanVideoImageToVideoSkyreelsv3_audio)
# - ComfyUI-KJNodes (GPL-3.0): helper nodes used by WanVideoWrapper workflows
# - ComfyUI-VideoHelperSuite (GPL-3.0): VHS_VideoCombine video output
ARG CUSTOM_NODES="\
ComfyUI-WanVideoWrapper|https://github.com/kijai/ComfyUI-WanVideoWrapper.git|088128b224242e110d3906c6750e9a3a348a659b \
ComfyUI-KJNodes|https://github.com/kijai/ComfyUI-KJNodes.git|eaa8fee753faf37d1539804d89a46d3e0f40963d \
ComfyUI-VideoHelperSuite|https://github.com/Kosinkadink/ComfyUI-VideoHelperSuite.git|4d907bee61e92c2e65af3bd6383a4e4d356126d1"
# EXPERIMENTAL — NVIDIA Cosmos3 (third-party nodes, MIT). Needs dynamic VRAM (comfy-aimdo, in ComfyUI's requirements).
ARG INSTALL_COSMOS3=1
ARG COSMOS3_NODES="ComfyUI-Cosmos3|https://github.com/RyukoMatoiFan/ComfyUI-Cosmos3.git|093696394114dd90ac555e3ca08695aff0431a20"
# Opt-in: vocal separation used by the upstream SkyReels-V3 example. The repo has NO license file.
ARG INSTALL_MELBAND=0
ARG MELBAND_NODES="ComfyUI-MelBandRoFormer|https://github.com/kijai/ComfyUI-MelBandRoFormer.git|92c86854e6654f4aacc97484471af95c98ea16d4"

ENV DEBIAN_FRONTEND=noninteractive \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1

RUN apt-get update \
    && apt-get install -y --no-install-recommends git ca-certificates ffmpeg libgl1 libglib2.0-0 build-essential \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /opt/comfyui
RUN git init -q . \
    && git remote add origin "${COMFYUI_REPO}" \
    && git fetch -q --depth 1 origin "${COMFYUI_REF}" \
    && git checkout -q FETCH_HEAD \
    && rm -rf .git

RUN pip install "torch==${TORCH_VERSION}" "torchvision==${TORCHVISION_VERSION}" "torchaudio==${TORCHAUDIO_VERSION}" \
        --index-url "${TORCH_INDEX_URL}" \
    && pip install -r requirements.txt

# Fetch each pinned node pack and install its requirements without letting it replace torch.
RUN set -eu; \
    packs="${CUSTOM_NODES}"; \
    if [ "${INSTALL_COSMOS3}" = "1" ]; then packs="${packs} ${COSMOS3_NODES}"; fi; \
    if [ "${INSTALL_MELBAND}" = "1" ]; then packs="${packs} ${MELBAND_NODES}"; fi; \
    pip freeze | grep -i -E '^(torch|torchvision|torchaudio)==' > /tmp/torch-constraints.txt; \
    for spec in ${packs}; do \
        dir="${spec%%|*}"; rest="${spec#*|}"; url="${rest%%|*}"; ref="${rest#*|}"; \
        echo "custom node: ${dir} @ ${ref}"; \
        mkdir -p "custom_nodes/${dir}"; \
        git -C "custom_nodes/${dir}" init -q; \
        git -C "custom_nodes/${dir}" remote add origin "${url}"; \
        git -C "custom_nodes/${dir}" fetch -q --depth 1 origin "${ref}"; \
        git -C "custom_nodes/${dir}" checkout -q FETCH_HEAD; \
        rm -rf "custom_nodes/${dir}/.git"; \
        if [ -f "custom_nodes/${dir}/requirements.txt" ]; then \
            pip install -c /tmp/torch-constraints.txt -r "custom_nodes/${dir}/requirements.txt"; \
        fi; \
    done

RUN useradd -u 1000 -ms /bin/bash comfy \
    && mkdir -p /opt/comfyui/models /outputs /data/input /data/user /data/temp \
    && chown -R comfy:comfy /opt/comfyui /outputs /data /home/comfy

USER comfy
ENV HOME=/home/comfy \
    HF_HOME=/home/comfy/.cache/huggingface

# Internal only: compose publishes no port; the studio reaches it at http://comfyui:8188.
EXPOSE 8188
HEALTHCHECK --interval=30s --timeout=5s --start-period=180s --retries=5 \
    CMD ["python", "-c", "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8188/system_stats', timeout=4)"]

ENTRYPOINT ["python", "main.py", \
    "--listen", "0.0.0.0", "--port", "8188", \
    "--output-directory", "/outputs", \
    "--input-directory", "/data/input", \
    "--user-directory", "/data/user", \
    "--temp-directory", "/data/temp", \
    "--disable-auto-launch"]

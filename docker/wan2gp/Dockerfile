# syntax=docker/dockerfile:1.7
# Wan2GP (WanGP) headless MCP server for Zellijfield AI.
#
# Follows Wan2GP's own Dockerfile (deepbeepmeep/Wan2GP, Dockerfile + entrypoint.sh): same CUDA
# 12.8 cuDNN base, the same torch/torchvision/torchaudio pins, requirements.txt, then SageAttention.
# Differences: the Wan2GP source is fetched at a pinned commit instead of bind-mounting a checkout,
# and the container starts WanGP's MCP server (Streamable HTTP, API v1) instead of the Gradio UI.
#
# Wan2GP is NOT vendored in this repository. It is licensed under the "WanGP Community License 2.0"
# (LICENSE.txt inside the image at /opt/wan2gp). Installing it for a client and charging for
# installation/support labour is allowed; charging for access to WanGP itself is not.

ARG CUDA_IMAGE=nvidia/cuda:12.8.1-cudnn-devel-ubuntu22.04
FROM ${CUDA_IMAGE}

# Pinned upstream revisions — bump deliberately and re-test.
ARG WAN2GP_REF=9d25c601f3c7074ca03c50f41b307a7c517835f9
ARG SAGEATTENTION_REF=d1a57a546c3d395b1ffcbeecc66d81db76f3b4b5
# CUDA compute capabilities to compile SageAttention for (no GPU needed at build time):
#   8.6 RTX 30xx · 8.9 RTX 40xx · 12.0 RTX 50xx · 8.0 A100. Separate several with ';'.
ARG CUDA_ARCHITECTURES="8.0;8.6"
ARG INSTALL_SAGEATTENTION=1
# Parallel nvcc jobs for SageAttention. Each can use 3-4 GB RAM; 8 jobs exhausted a 16 GB machine.
ARG MAX_JOBS=2

ENV DEBIAN_FRONTEND=noninteractive \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1

RUN apt-get update \
    && apt-get install -y --no-install-recommends \
        python3 python3-pip python3-dev git wget curl ca-certificates cmake ninja-build \
        libgl1 libglib2.0-0 ffmpeg \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /opt/wan2gp
RUN git init -q . \
    && git remote add origin https://github.com/deepbeepmeep/Wan2GP.git \
    && git fetch -q --depth 1 origin "${WAN2GP_REF}" \
    && git checkout -q FETCH_HEAD \
    && rm -rf .git

RUN pip install --upgrade pip setuptools wheel
# Same pins as Wan2GP's Dockerfile; keep in step with the CUDA base image above.
RUN pip install torch==2.10.0+cu128 torchvision==0.25.0+cu128 torchaudio==2.10.0+cu128 \
        --index-url https://download.pytorch.org/whl/cu128
RUN pip install -r requirements.txt

RUN if [ "${INSTALL_SAGEATTENTION}" = "1" ]; then \
        git clone -q https://github.com/thu-ml/SageAttention.git /tmp/sageattention \
        && cd /tmp/sageattention \
        && git checkout -q "${SAGEATTENTION_REF}" \
        && TORCH_CUDA_ARCH_LIST="${CUDA_ARCHITECTURES}" FORCE_CUDA=1 MAX_JOBS="${MAX_JOBS}" \
           pip install --no-build-isolation . \
        && rm -rf /tmp/sageattention; \
    fi

# Non-root runtime user (uid 1000 matches typical host users and Docker Desktop bind mounts).
RUN useradd -u 1000 -ms /bin/bash wangp \
    && mkdir -p /opt/wan2gp/ckpts /opt/wan2gp/loras /config /outputs /home/wangp/.cache/huggingface \
    && chown -R wangp:wangp /opt/wan2gp /config /outputs /home/wangp/.cache

COPY --chmod=755 entrypoint.sh /usr/local/bin/wan2gp-entrypoint.sh
# Model download/remove service for the studio (internal port 7867, see zf_model_server.py).
COPY --chmod=644 zf_models.py zf_model_server.py /opt/zf/

USER wangp
ENV HOME=/home/wangp \
    HF_HOME=/home/wangp/.cache/huggingface \
    SDL_AUDIODRIVER=dummy \
    WAN2GP_MCP_PORT=7866 \
    ZF_MODEL_TOOLS_PORT=7867

# MCP and the model tools only. The Gradio UI is not started and not exposed.
EXPOSE 7866 7867
# Importing torch and building the session takes a while on first start.
HEALTHCHECK --interval=30s --timeout=5s --start-period=600s --retries=5 \
    CMD ["python3", "-c", "import os, socket; socket.create_connection(('127.0.0.1', int(os.environ.get('WAN2GP_MCP_PORT', '7866'))), 3).close()"]

ENTRYPOINT ["/usr/local/bin/wan2gp-entrypoint.sh"]

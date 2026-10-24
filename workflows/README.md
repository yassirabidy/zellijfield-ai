# ComfyUI workflows

ComfyUI workflows used by Zellijfield AI, in ComfyUI **API format** (export with
"Save (API)" in ComfyUI). One file per model: `<model-id>.json`.

The studio mounts this folder read-only at `/workflows` and maps its inputs (prompt, seed,
image, size) onto node IDs declared in `models.json`.

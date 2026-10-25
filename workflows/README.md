# ComfyUI workflows

ComfyUI workflows used by Zellijfield AI, in ComfyUI **API format** (the body of `POST /prompt`).
The studio mounts this folder read-only at `/workflows`; `models.json` maps the user's inputs
(prompt, seed, image, audio, size, …) onto node ids in these files.

| File | Model | Source | Changes from upstream |
|---|---|---|---|
| `skyreels-v3.json` | SkyReels-V3 audio-to-video (talking avatar) | `kijai/ComfyUI-WanVideoWrapper` @ `088128b2`, `example_workflows/wanvideo_2_1_14B_I2V_SkyReelsV3_TalkingAvatar_example_01.json` | MelBandRoFormer vocal separation removed (audio goes to the wav2vec embeds directly); unused preview/compile nodes removed; Windows paths → `/`; model file name matches the Hugging Face file (`Wan21-SkyReelsV3-…`); `attention_mode` `sageattn` → `sdpa` (SageAttention is not in the ComfyUI image); final video node 131 saves to the output folder. |
| `cosmos3-super.json` | NVIDIA Cosmos3-Super image-to-video (experimental) | `RyukoMatoiFan/ComfyUI-Cosmos3` @ `09369639`, `example_workflows/cosmos3_super_i2v.json` | None. |

Both were converted from UI format with `scripts/comfyui-ui-to-api.mjs`, which keeps the original
node ids and maps widget values to input names using the running ComfyUI's `/object_info`, then
validated against the ComfyUI image (only missing model files and example inputs were reported).

## Adding your own workflow

1. Build and test it in ComfyUI (open the UI temporarily, see SETUP.md).
2. Save it in UI format, then convert it:
   `node scripts/comfyui-ui-to-api.mjs my-workflow.json http://127.0.0.1:8188 workflows/my-model.json`
   (or export with **Save (API)** in ComfyUI).
3. Add an entry to `models.json` with `"backend": "comfyui"` and a `comfyui` block: `workflow`,
   `outputNode`, and the node ids/inputs for `prompt`, `seed`, `image`, … taken from the file.
4. Restart the studio; the registry is validated at startup and by `npm test`.

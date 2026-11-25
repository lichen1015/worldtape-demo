# WorldTape Demo

The home page presents the layered FreeTimeGS++ reconstruction of a jump-rope sequence. Drag the scene or move the camera slider to explore 32 rendered viewpoints. Use the timeline independently to pause on either jump or play the sequence at 24 fps from a fixed angle. Switch to **Background only** to inspect the static layer.

The interactive preview uses a synchronized 105-frame camera atlas rendered from separately fitted foreground and background Gaussians. The reconstruction was fitted to eight H3-generated views using nominal target cameras. The original frontal video supplied the motion and visible appearance. Some occluded background areas remain blurred.

The previous Wan2.2 and MiniMax-H3 WebGL comparison is available at `comparison.html`.

## Run locally

```sh
python3 scripts/serve_demo.py --port 8000
```

Open <http://localhost:8000/>. The local server supports MP4 byte ranges for seeking. GitHub Pages serves the static demo directly from the repository root.

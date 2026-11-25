# WorldTape Demo

The home page links to both WorldTape demos. The jump-rope demo presents a layered FreeTimeGS++ reconstruction of a human sequence. Drag the scene or move the camera slider to explore 32 rendered viewpoints. Use the timeline independently to pause on either jump or play the sequence at 24 fps from a fixed angle. Switch to **Background only** to inspect the static layer.

The interactive preview uses a synchronized 105-frame camera atlas rendered from separately fitted foreground and background Gaussians. The reconstruction was fitted to eight H3-generated views using nominal target cameras. The original frontal video supplied the motion and visible appearance. Some occluded background areas remain blurred.

The zebra demo at `zebra.html` offers 24 angles of the reconstruction at 3.5 seconds, a five-second dynamic orbit, and four fixed-view comparisons against the H3 inputs. The animal geometry was initialized from 3D-Fauna.

The previous Wan2.2 and MiniMax-H3 WebGL comparison is available at `comparison.html`.

## Run locally

```sh
python3 scripts/serve_demo.py --port 8000
```

Open <http://localhost:8000/>. The local server supports MP4 byte ranges for seeking. GitHub Pages serves the static demo directly from the repository root.

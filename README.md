# WorldTape Demo

A static WebGL 2 viewer for two eight-view dynamic reconstructions, from Wan2.2-Fun-5B-Control and MiniMax-H3 generated videos. Each model covers 105 frames at 24 fps. Use the viewer to scrub time and compare either model at the same nominal camera and frame.

Only the viewer, rendered previews, and browser-ready Gaussian data are included. The nominal cameras come from the generation conditions. The reconstructions include visible gaps and motion artifacts and are research previews.

## Run locally

```sh
python3 -m http.server 8000
```

Open <http://localhost:8000/> in a browser with WebGL 2. Each compressed reconstruction is about 50 MB and loads separately. GitHub Pages can serve the repository root directly.

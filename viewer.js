import {Renderer} from "./renderer.js";

const canvas = document.querySelector("#scene");
const play = document.querySelector("#play");
const slider = document.querySelector("#time");
const label = document.querySelector("#timeLabel");
const load = document.querySelector("#load");
const diagnostics = document.querySelector("#diagnostics");
const reset = document.querySelector("#reset");
const presets = [...document.querySelectorAll("[data-turn]")];

const add = (a,b) => a.map((v,i) => v+b[i]);
const sub = (a,b) => a.map((v,i) => v-b[i]);
const mul = (a,s) => a.map(v => v*s);
const dot = (a,b) => a.reduce((sum,v,i) => sum+v*b[i],0);
const norm = a => mul(a,1/Math.max(1e-9,Math.hypot(...a)));
const cross = (a,b) => [a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];
const lerp = (a,b,t) => a.map((v,i) => v+(b[i]-v)*t);
const clamp = (value,min,max) => Math.max(min,Math.min(max,value));
const column = (m,i) => [m[0][i],m[1][i],m[2][i]];

function referenceCamera(entry) {
  return {...entry, eye:column(entry.c2w,3), right:column(entry.c2w,0),
    down:column(entry.c2w,1), forward:column(entry.c2w,2)};
}

async function checkedFetch(url) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Could not load ${url} (HTTP ${response.status}).`);
  return response;
}

async function openScene() {
  const init = performance.now();
  const query = new URLSearchParams(location.search);
  const name = query.get("asset") || "wan-ring8";
  if (!["wan-ring8", "h3-ring8"].includes(name)) throw new Error("Unknown reconstruction.");
  const base = `./assets/${name}/`;
  const asset = await (await checkedFetch(base+"scene.json")).json();
  const [geometry, harmonics] = await Promise.all(
    [asset.geometry, asset.harmonics].map(async file => {
      const response = await checkedFetch(base + file);
      const stream = response.body.pipeThrough(new DecompressionStream("gzip"));
      return new Response(stream).arrayBuffer();
    }),
  );
  if (asset.version !== 1 || geometry.byteLength !== asset.count*64 ||
      harmonics.byteLength !== asset.count*6*(asset.shDegree+1)**2) {
    throw new Error("The reconstruction files do not match the scene metadata.");
  }
  const scale = query.get("resolution") === "full" ? 1 : .55;
  const navigation = asset.navigation;
  const up = norm(asset.up ?? [0,1,0]);
  const byId = new Map(asset.cameras.map(c => [c.id,referenceCamera(c)]));
  const path = navigation?.mode === "arc" ? navigation.path.map(id => byId.get(id)) : null;
  const first = byId.get(path ? navigation.reference : asset.cameras[0].id);
  const levelArc = Boolean(path && navigation.levelArc === true);
  const lookAt = levelArc
    ? add(first.eye,mul(first.forward,dot(sub(asset.center,first.eye),first.forward))) : null;
  const offsetFromTarget = levelArc ? sub(first.eye,lookAt) : null;
  const orbitHeight = levelArc ? dot(offsetFromTarget,up) : 0;
  const horizontal = eye => {
    const delta = sub(eye,lookAt);
    return sub(delta,mul(up,dot(delta,up)));
  };
  const orbitRadial = levelArc ? norm(horizontal(first.eye)) : null;
  const orbitTangent = levelArc ? cross(up,orbitRadial) : null;
  const orbitAngles = levelArc ? path.map(({eye}) => {
    const offset = horizontal(eye);
    return Math.atan2(dot(offset,orbitTangent),dot(offset,orbitRadial));
  }) : null;
  const orbitRadius = levelArc
    ? path.map(({eye}) => Math.hypot(...horizontal(eye))).sort((a,b) => a-b)[Math.floor(path.length/2)] : 0;
  const arcCoordinate = i => levelArc
    ? (orbitAngles[i]-orbitAngles[0])/(orbitAngles.at(-1)-orbitAngles[0])*(path.length-1) : i;
  if (path) {
    document.querySelector("h1").textContent = asset.title ?? "3D reconstruction";
    document.querySelector("#cameraHint").textContent = "Drag to change viewpoint · Shift-drag to pan · Scroll to zoom";
    document.querySelector("#coverageHint").textContent = levelArc
      ? "Drag or use the camera buttons to move along the path."
      : `Switch cameras while paused, then use the timeline to inspect any frame.`;
  }
  canvas.width = Math.round(first.width*scale);
  canvas.height = Math.round(first.height*scale);
  const renderer = new Renderer(canvas,asset,new Float32Array(geometry),new Uint16Array(harmonics));
  const gl = renderer.gl;
  const debug = gl.getExtension("WEBGL_debug_renderer_info");
  const gpu = debug ? gl.getParameter(debug.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER);
  const worker = new Worker("./depth-worker.js");
  worker.postMessage({geometry,nearPlane:asset.nearPlane},[geometry]);

  document.querySelector("#sceneLabel").textContent = asset.label;
  const previewFrames = asset.playbackSeconds
    ? Math.max(2, Math.round(asset.playbackSeconds * asset.fps)) : asset.frames;
  const sourceFramesPerTick = (asset.frames-1)/(previewFrames-1);
  slider.max = previewFrames-1;
  for (const element of [play,slider,reset,...presets]) element.disabled = false;

  let camera = first;
  let baseCamera = first, yaw=0, pitch=0, zoom=1, pan=[0,0,0];
  let arcIndex=path ? arcCoordinate(path.indexOf(first)) : 0;
  let frame=0, playing=false, last=0, debt=0;
  let requestVersion=0, sent=-1, pending=false, latest, displayed;
  let startDraw;
  const draws=[];
  const info = {gpu, width:canvas.width, height:canvas.height,
    count:asset.count, fps:asset.fps, loopSeconds:previewFrames/asset.fps,
    targetFrame:0, displayedFrame:null, draws:0,
    firstFrameMs:null, sortMs:null, displayFps:0};
  const displayTime = () => {
    slider.value = Math.round(frame);
    label.value = `${(frame/asset.fps).toFixed(2)} s`;
  };
  function setPreviewFrame(next) {
    frame = clamp(next,0,previewFrames-1);
    debt=0;
    displayTime();
    ++requestVersion;
  }
  function setPlaying(value) {
    playing = value;
    play.textContent = value ? "Pause" : "Play";
    play.setAttribute("aria-pressed",String(value));
    last = performance.now();
  }
  function selectCamera(id) {
    const entry = asset.cameras.find(camera => camera.id === id);
    if (!entry) throw new Error(`Camera ${id} is unavailable.`);
    camera = baseCamera = byId.get(id);
    if (path) arcIndex=arcCoordinate(path.includes(camera) ? path.indexOf(camera) : path.indexOf(first));
    yaw=0; pitch=0; zoom=1; pan=[0,0,0];
    ++requestVersion;
  }
  function moveCamera() {
    if (path) {
      arcIndex=clamp(arcIndex,0,path.length-1);
      const i = Math.min(path.length-2,Math.floor(arcIndex));
      const t = arcIndex-i;
      const a=path[i], b=path[i+1];
      let eye=lerp(a.eye,b.eye,t);
      let forward=norm(lerp(a.forward,b.forward,t));
      let right=norm(cross(lerp(a.down,b.down,t),forward));
      if (levelArc) {
        const angle = orbitAngles[0]+(orbitAngles.at(-1)-orbitAngles[0])*arcIndex/(path.length-1);
        const radial = add(mul(orbitRadial,Math.cos(angle)),mul(orbitTangent,Math.sin(angle)));
        eye=add(lookAt,add(mul(up,orbitHeight),mul(radial,orbitRadius)));
        forward=norm(sub(lookAt,eye));
        right=norm(cross(forward,up));
      }
      const down=norm(cross(forward,right));
      const calibrated=levelArc ? first.k.map(row=>row.slice()) : a.k.map((row,j)=>lerp(row,b.k[j],t));
      calibrated[0][0] *= zoom;
      calibrated[1][1] *= zoom;
      calibrated[0][2] += pan[0];
      calibrated[1][2] += pan[1];
      camera={...a,id:null,eye,forward,right,down,k:calibrated};
      ++requestVersion;
      return;
    }
    const offset = sub(baseCamera.eye,asset.center);
    const height = dot(offset,up);
    const horizontal = sub(offset,mul(up,height));
    const radial = norm(horizontal);
    const tangent = cross(up,radial);
    const radius = Math.hypot(...offset)*zoom;
    const latitude = Math.atan2(height,Math.hypot(...horizontal))+pitch;
    const target = add(asset.center,pan);
    const rotated = add(mul(radial,Math.cos(yaw)),mul(tangent,Math.sin(yaw)));
    const eye = add(target,mul(add(mul(rotated,Math.cos(latitude)),mul(up,Math.sin(latitude))),radius));
    const forward = norm(sub(target,eye));
    const right = norm(cross(forward,up));
    const down = cross(forward,right);
    camera = {...baseCamera,id:null,eye,right,down,forward};
    ++requestVersion;
  }

  worker.onerror = event => {
    load.textContent = `Rendering failed: ${event.message}`;
    load.hidden = false;
  };
  worker.onmessage = ({data}) => {
    pending = false;
    latest = data;
  };
  function tick(now) {
    if (playing) {
      debt += (now-last)*asset.fps/1000;
      last = now;
      const steps = Math.floor(debt);
      if (steps > 0) {
        frame = (frame+steps)%previewFrames;
        debt -= steps;
        displayTime();
        ++requestVersion;
      }
    }
    if (latest) {
      const data = latest;
      latest = undefined;
      renderer.setOrder(data.order);
      renderer.draw(data.camera,data.time);
      displayed = data;
      info.displayedFrame = Math.round(data.time*asset.fps);
      info.sortMs = data.sortMs;
      info.activeGaussians = data.order.length;
      info.draws++;
      draws.push(now);
      while (draws[0] < now-2000) draws.shift();
      info.displayFps = draws.length > 1 ? (draws.length-1)*1000/(now-draws[0]) : 0;
      if (info.firstFrameMs === null) {
        info.firstFrameMs = now-init;
        startDraw = now;
        load.hidden = true;
      }
    }
    if (!pending && sent !== requestVersion) {
      pending=true;
      sent=requestVersion;
      const sourceFrame = frame*sourceFramesPerTick;
      info.targetFrame=Math.round(sourceFrame);
      worker.postMessage({camera,time:sourceFrame/asset.fps,id:sent});
    }
    if (startDraw !== undefined && now-startDraw > 500) {
      const rate = playing ? ` · ${info.displayFps.toFixed(1)} rendered fps` : "";
      diagnostics.textContent = `${renderer.count.toLocaleString()} Gaussians${rate}`;
      startDraw = now;
    }
    requestAnimationFrame(tick);
  }

  play.onclick = () => setPlaying(!playing);
  slider.oninput = () => setPreviewFrame(+slider.value);
  const selectPreset = id => {
    selectCamera(id);
    if (levelArc) moveCamera();
  };
  reset.onclick = () => selectPreset(first.id);
  const cameraButtons = [...presets];
  if (path && navigation.labels) {
    for (let i = cameraButtons.length; i < path.length; i++) {
      const button = document.createElement("button");
      button.type = "button";
      reset.before(button);
      cameraButtons.push(button);
    }
  }
  cameraButtons.forEach((button,i) => {
    if (path) {
      if (i >= path.length) { button.hidden = true; return; }
      const shortcut=path[i];
      button.textContent=navigation.labels?.[i] ?? ["0°","7.5°","15°"][i] ?? `Camera ${i + 1}`;
      button.onclick=()=>selectPreset(shortcut.id);
      return;
    }
    button.onclick = () => selectCamera(asset.cameras[Math.round(+button.dataset.turn*asset.cameras.length)].id);
  });
  const alternatives = {
    "wan-ring8": ["h3-ring8", "Compare H3 here"],
    "h3-ring8": ["wan-ring8", "Compare Wan here"],
  };
  const alternative = alternatives[name];
  if (alternative) {
    const compare = document.createElement("button");
    compare.type = "button";
    compare.textContent = alternative[1];
    compare.onclick = () => {
      const next = new URL(location.href);
      next.searchParams.set("asset", alternative[0]);
      next.searchParams.set("frame", Math.round(frame * sourceFramesPerTick));
      next.searchParams.set("camera", camera.id ?? baseCamera.id);
      location.assign(next);
    };
    reset.after(compare);
  }
  let drag;
  canvas.addEventListener("contextmenu",event => event.preventDefault());
  canvas.addEventListener("pointerdown",event => {
    drag={x:event.clientX,y:event.clientY,pan:event.shiftKey || event.button===2};
    canvas.setPointerCapture(event.pointerId);
  });
  canvas.addEventListener("pointermove",event => {
    if (!drag) return;
    const dx=event.clientX-drag.x, dy=event.clientY-drag.y;
    drag.x=event.clientX; drag.y=event.clientY;
    if (path) {
      if (drag.pan) {
        pan=[clamp(pan[0]+dx,-.12*first.width,.12*first.width),
             clamp(pan[1]+dy,-.12*first.height,.12*first.height),0];
      } else {
        arcIndex -= dx*(path.length-1)/canvas.getBoundingClientRect().width;
      }
      moveCamera();
      return;
    }
    if (drag.pan) {
      pan=add(pan,add(mul(camera.right,-dx*asset.radius/500),mul(camera.down,-dy*asset.radius/500)));
      const max=asset.radius*.22, length=Math.hypot(...pan);
      if (length>max) pan=mul(pan,max/length);
    } else {
      yaw -= dx*.009;
      pitch=clamp(pitch+dy*.006,-.22,.22);
    }
    moveCamera();
  });
  canvas.addEventListener("lostpointercapture",() => { drag=undefined; });
  canvas.addEventListener("wheel",event => {
    event.preventDefault();
    zoom=path ? clamp(zoom*Math.exp(-event.deltaY*.0013),.9,1.5) : clamp(zoom*Math.exp(event.deltaY*.0013),.68,1.58);
    moveCamera();
  },{passive:false});
  document.addEventListener("keydown",event => {
    if (event.code==="Space" && !["INPUT","BUTTON"].includes(event.target.tagName)) {
      event.preventDefault(); setPlaying(!playing);
    }
  });

  window.worldtape = {
    // Reproduce a particular offline frame and pose without a video seek.
    setFrame: next => setPreviewFrame(Math.round(next)/sourceFramesPerTick),
    selectCamera, setPlaying,
    setOrbit: radians => { if (path) arcIndex=radians/(2*Math.PI)*(path.length-1); else yaw=radians; moveCamera(); },
    state: () => ({...info, frame:Math.round(frame*sourceFramesPerTick), previewFrame:frame, playing, camera:camera.id, requested:requestVersion,
      rendered:displayed?.id, displayedCamera:displayed?.camera.id,
      displayedEye:displayed?.camera.eye, displayedForward:displayed?.camera.forward}),
    snapshot: () => canvas.toDataURL("image/png"),
  };
  if (levelArc) moveCamera();
  displayTime();
  setPlaying(false);
  if (alternative && query.has("frame")) {
    const requested = Number(query.get("frame"));
    if (Number.isFinite(requested)) setPreviewFrame(Math.round(requested) / sourceFramesPerTick);
  }
  if (alternative && query.has("camera")) {
    const requested = Number(query.get("camera"));
    if (byId.has(requested)) selectPreset(requested);
  }
  requestAnimationFrame(tick);
}

openScene().catch(error => {
  load.textContent = error.message;
  console.error(error);
});

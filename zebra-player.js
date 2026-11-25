"use strict";
const $ = id => document.getElementById(id);
const canvas = $("view");
const ctx = canvas.getContext("2d");
const video = $("motion");
const angleInput = $("angle");
const timeInput = $("time");
const play = $("play");
const status = $("status");
const still = new Image();
const fps = 24, frames = 120, columns = 6, views = 24;
const staticTile = 320, motionTile = 192;
const readyMessage = "24 synchronized viewpoints · 24 fps";
let angle = 0, frame = 84, pendingFrame = 84;
let drag = null, paintRequest = 0, seekRequest = 0;
let playingRequested = false, playbackRequest = 0;

function updateAngle() {
  const degrees = angle * 15;
  angleInput.value = angle;
  $("angle-value").textContent = degrees + "°";
  angleInput.setAttribute("aria-valuetext", degrees + " degrees");
}

function updateTime() {
  const seconds = (frame / fps).toFixed(2);
  timeInput.value = frame;
  $("time-value").textContent = seconds + " s";
  timeInput.setAttribute("aria-valuetext", seconds + " seconds");
}

function draw() {
  paintRequest = 0;
  const usable = video.readyState >= 2 && !video.seeking && pendingFrame === null;
  if (!usable && video.readyState >= 2 && frame !== 84) return;
  const media = usable ? video : still;
  const tile = usable ? motionTile : staticTile;
  if (media === still && !still.naturalWidth) return;
  const x = (angle % columns) * tile;
  const y = Math.floor(angle / columns) * tile;
  ctx.drawImage(media, x, y, tile, tile, 0, 0, canvas.width, canvas.height);
}

function scheduleDraw() {
  if (!paintRequest) paintRequest = requestAnimationFrame(draw);
}

function setAngle(value) {
  const next = ((Number(value) % views) + views) % views;
  if (next === angle) return;
  angle = next;
  updateAngle();
  scheduleDraw();
}

function flushSeek() {
  if (pendingFrame === null || !Number.isFinite(video.duration) || video.seeking) return;
  const seconds = pendingFrame / fps + .002;
  pendingFrame = null;
  if (Math.abs(video.currentTime - seconds) > .001) video.currentTime = seconds;
  else scheduleDraw();
}

function seek(value) {
  frame = Number(value);
  pendingFrame = frame;
  updateTime();
  if (!seekRequest) seekRequest = requestAnimationFrame(() => {
    seekRequest = 0;
    flushSeek();
  });
}

function tick(_, metadata) {
  if (!video.paused && !video.seeking && pendingFrame === null) {
    const time = metadata ? metadata.mediaTime : video.currentTime;
    const next = Math.min(frames - 1, Math.floor(time * fps + .005));
    if (next !== frame) {
      frame = next;
      updateTime();
    }
  }
  scheduleDraw();
  if ("requestVideoFrameCallback" in video) video.requestVideoFrameCallback(tick);
}

function pause() {
  playbackRequest++;
  playingRequested = false;
  video.pause();
  play.textContent = "Play";
}

play.addEventListener("click", () => {
  if (playingRequested) {
    pause();
    return;
  }
  playingRequested = true;
  const request = ++playbackRequest;
  play.textContent = "Pause";
  if (video.readyState < 3) status.textContent = "Loading motion…";
  video.play().catch(() => {
    if (request !== playbackRequest) return;
    pause();
    status.textContent = "Playback could not start. Try pressing Play again.";
  });
});
$("restart").addEventListener("click", () => seek(0));
timeInput.addEventListener("input", event => {
  pause();
  seek(event.target.value);
});
angleInput.addEventListener("input", event => setAngle(event.target.value));
document.querySelectorAll("[data-angle]").forEach(button => {
  button.addEventListener("click", () => setAngle(button.dataset.angle));
});

video.addEventListener("loadedmetadata", flushSeek);
video.addEventListener("seeked", () => {
  flushSeek();
  scheduleDraw();
});
video.addEventListener("canplay", () => {
  status.textContent = readyMessage;
  scheduleDraw();
});
video.addEventListener("playing", () => { status.textContent = readyMessage; });
video.addEventListener("waiting", () => {
  if (playingRequested) status.textContent = "Buffering motion…";
});
video.addEventListener("error", () => {
  pause();
  status.textContent = "The motion video could not load. Try reloading this page.";
});
if ("requestVideoFrameCallback" in video) video.requestVideoFrameCallback(tick);
else video.addEventListener("timeupdate", () => tick());

still.onload = scheduleDraw;
still.src = "assets/layered-zebra/angles.jpg";

canvas.addEventListener("pointerdown", event => {
  if (event.button !== 0) return;
  drag = {x: event.clientX, angle};
  canvas.setPointerCapture(event.pointerId);
  canvas.classList.add("dragging");
});
canvas.addEventListener("pointermove", event => {
  if (drag) setAngle(drag.angle + Math.round((event.clientX - drag.x) / 12));
});
for (const name of ["pointerup", "pointercancel", "lostpointercapture"]) {
  canvas.addEventListener(name, () => {
    drag = null;
    canvas.classList.remove("dragging");
  });
}

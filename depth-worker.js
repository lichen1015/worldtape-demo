const BINS = 8192;
let geometry, active, depths, nearPlane;
const histogram = new Uint32Array(BINS);
const offsets = new Uint32Array(BINS);

self.onmessage = ({data}) => {
  if (data.geometry) {
    nearPlane = data.nearPlane ?? .02;
    geometry = new Float32Array(data.geometry);
    active = new Uint32Array(geometry.length/16);
    depths = new Float32Array(active.length);
    return;
  }
  const start = performance.now();
  const {camera, time, id} = data;
  const [vx,vy,vz] = camera.forward;
  const [ex,ey,ez] = camera.eye;
  const cameraDepth = vx*ex + vy*ey + vz*ez;
  let n = 0, nearest = Infinity, farthest = -Infinity;
  for (let i=0, k=0; k<geometry.length; ++i, k+=16) {
    const dt = time-geometry[k+7];
    const ratio = dt/Math.max(geometry[k+14], 1e-8);
    const gate = geometry[k+15];
    const opacity = geometry[k+3]*(gate+(1-gate)*Math.exp(-.5*ratio*ratio));
    if (opacity < 1/255) continue;
    const z = vx*(geometry[k]+dt*geometry[k+4])
            + vy*(geometry[k+1]+dt*geometry[k+5])
            + vz*(geometry[k+2]+dt*geometry[k+6]) - cameraDepth;
    if (z <= nearPlane) continue;
    active[n] = i;
    depths[n++] = z;
    nearest = Math.min(nearest, z);
    farthest = Math.max(farthest, z);
  }
  const scale = (BINS-1)/Math.max(1e-6, farthest-nearest);
  histogram.fill(0);
  for (let i=0; i<n; i++) histogram[((farthest-depths[i])*scale)|0]++;
  for (let k=0, total=0; k<BINS; k++) {
    offsets[k] = total;
    total += histogram[k];
  }
  const order = new Uint32Array(n);
  for (let i=0; i<n; i++) order[offsets[((farthest-depths[i])*scale)|0]++] = active[i];
  self.postMessage({camera,time,id,order,sortMs:performance.now()-start}, [order.buffer]);
};

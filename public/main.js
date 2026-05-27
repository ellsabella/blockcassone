var hilbert;
var cubeSize;
var R;
var blocks;
var placer;
var placedPlanes;
var lineBatch;
var hilbertVerts;

function setup() {
  createCanvas(windowWidth, windowHeight, WEBGL);
  R = new Random();
  noiseSeed(R.random_int(0, 99999));
  hilbert = generateHilbert3D(3);
  assignPlaneProperties(hilbert, R);
  buildPlaneEdges(hilbert);
  cubeSize = min(width, height) * 0.6;

  // Build the full block hierarchy
  blocks = buildBlocks(hilbert);

  // Place planes using jigsaw placement
  placer = createPlacement(hilbert);
  for (var i = 0; i < 60; i++) {
    placer.placeNext(R);
  }
  placedPlanes = placer.getPlaced();

  // Pre-compute draw data
  var scale = cubeSize / 2;
  lineBatch = buildPlaneLineBatch(hilbert, placedPlanes, scale);

  // Pre-scale Hilbert curve vertices
  hilbertVerts = [];
  for (var j = 0; j < hilbert.vertices.length; j++) {
    var v = hilbert.vertices[j];
    hilbertVerts.push(v.x * scale, v.y * scale, v.z * scale);
  }

  // Log placement results
  console.log("Hash:", inputData.hash);
  console.log("Vertices:", hilbert.vertices.length);
  console.log("Placed:", placedPlanes.length, "planes");

  noLoop();
}

function draw() {
  background(0);
  orbitControl();

  // Draw the Hilbert curve
  stroke(255, 0, 0, 200);
  strokeWeight(5);
  noFill();
  beginShape();
  for (var i = 0; i < hilbertVerts.length; i += 3) {
    vertex(hilbertVerts[i], hilbertVerts[i + 1], hilbertVerts[i + 2]);
  }
  endShape();

  // Draw all plane lines with per-vertex fade
  drawPlaneLinesBatched(lineBatch, 1.5, 200);
}

function mouseDragged() {
  redraw();
}

function mouseWheel() {
  redraw();
}

function windowResized() {
  resizeCanvas(windowWidth, windowHeight);
  cubeSize = min(width, height) * 0.6;

  var scale = cubeSize / 2;
  lineBatch = buildPlaneLineBatch(hilbert, placedPlanes, scale);
  hilbertVerts = [];
  for (var j = 0; j < hilbert.vertices.length; j++) {
    var v = hilbert.vertices[j];
    hilbertVerts.push(v.x * scale, v.y * scale, v.z * scale);
  }
  redraw();
}

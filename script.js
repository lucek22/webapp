import {
  PoseLandmarker,
  FilesetResolver,
  DrawingUtils
} from "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.3";
const ort = window.ort;

/* ============================================================================
 * CHANGES IN THIS VERSION vs. v2:
 *
 * 1. ONNX output shape is now auto-detected at runtime. YOLOv8-seg exported
 *    without NMS produces [1, 38, 8400] (features-first / "transposed"),
 *    while post-NMS exports produce [1, 8400, 38] (detections-first).
 *    The previous code hardcoded the detections-first layout, so on a raw
 *    export it was reading feature-channel data as confidence scores and
 *    coordinate data as feature weights — producing garbage boxes.
 *    A new `getFeature()` helper reads either layout correctly.
 *
 * 2. Coordinate format (xyxy vs. cx,cy,w,h) is now controlled by a single
 *    constant MODEL_IS_RAW_XYWH rather than the previous heuristic
 *    `if (x2 < x1)`, which silently failed whenever the object was wider
 *    than its center x-coordinate (e.g. a wide reference near the left edge).
 *
 * 3. A `paperWidthNormalized` sanity check rejects detections that are
 *    implausibly wide (>80% of frame) or implausibly narrow (<1% of frame).
 *    Both cases would have previously produced near-zero or absurdly large
 *    height estimates.
 *
 * 4. Shape/value diagnostics are logged on every snapshot so format issues
 *    are immediately visible in the browser console.
 *
 * All fixes from v1 (object-fit calibration, foot landmarks, ear-anchored
 * head, roll correction, z-axis wingspan, visibility checks, no emergency
 * brake) are still present.
 * ==========================================================================*/

// ---------------------------------------------------------------------------
// SET THIS TO MATCH HOW ref.onnx WAS EXPORTED:
//   true  = raw YOLOv8-seg output, no NMS baked in.
//           Coordinates are normalized [0,1] cx,cy,w,h.
//   false = post-NMS export (e.g. exported with --simplify or NMS layer).
//           Coordinates are already xyxy in 640px space.
// Check your export command: if it used `model.export(format="onnx")` with
// no extra arguments, this should be true. If it included a custom NMS
// wrapper it should be false.
// ---------------------------------------------------------------------------
const MODEL_IS_RAW_XYWH = false;

// ---------------------------------------------------------------------------
// MINIMUM CONFIDENCE TO ACCEPT A DETECTION.
// 0.10 is very permissive. Raise toward 0.35-0.45 once the model is
// performing reliably to avoid false positives anchoring your scale.
// ---------------------------------------------------------------------------
const ONNX_CONF_THRESHOLD = 0.25;

let poseLandmarker = undefined;
let onnxSession = undefined;
let webcamRunning = false;
let lastVideoTime = -1;
let lastSentTimestamp = -1;
let webcamStream = null;
window.latestScreenLandmarks = null;

let landmarkBuffer = [];
const BUFFER_MAX_SIZE = 30;

const video = document.getElementById("webcam");
const canvasElement = document.getElementById("output_canvas");
const canvasCtx = canvasElement.getContext("2d");
const enableWebcamButton = document.getElementById("webcamButton");
const captureButton = document.getElementById("captureButton");
const countdownOverlay = document.getElementById("countdownOverlay");
const resultsCard = document.getElementById("resultsCard");
const heightResult = document.getElementById("heightResult");
const wingspanResult = document.getElementById("wingspanResult");
const scaleNote = document.getElementById("scaleNote");
const drawingUtils = new DrawingUtils(canvasCtx);

const cameraFacingSelect = document.getElementById("cameraFacing");
const statusBanner = document.getElementById("statusBanner");

const calibrationModeSelect = document.getElementById("calibrationMode");
const cardSliderContainer = document.getElementById("cardSliderContainer");
const cardGuide = document.getElementById("cardGuide");
const cardSizeSlider = document.getElementById("cardSizeSlider");
const cardSliderValue = document.getElementById("cardSliderValue");

const aiTipsCard = document.getElementById("aiTipsCard");
const aiFeedbackBadge = document.getElementById("aiFeedbackBadge");
const aiFeedbackText = document.getElementById("aiFeedbackText");

let isONNXProcessing = false;
let latestONNXResult = null;
let lastONNXDetectionTime = 0;
let isManualFallbackActive = false;

// --- ANATOMICAL / CALIBRATION CONSTANTS ---
const AVG_IPD_CM = 6.3;
const CROWN_ABOVE_EAR_RATIO = 0.07;
const FINGER_EXTENSION_CM = 8;
const VISIBILITY_THRESHOLD = 0.5;
const PLAUSIBLE_HEIGHT_CM = [100, 230];
const PLAUSIBLE_WINGSPAN_CM = [120, 230];

// Landmarks required for the measurement; used for the visibility check
const REQUIRED_LANDMARKS = [0, 2, 5, 7, 8, 11, 12, 15, 16, 19, 20, 27, 28, 29, 30, 31, 32];

// ---------------------------------------------------------------------------
// ONNX OUTPUT PARSING HELPERS
// ---------------------------------------------------------------------------

// Reads feature index `f` for detection index `i` from a flat Float32 array,
// handling both possible tensor layouts produced by YOLOv8-seg ONNX exports:
//
//   Normal  (isTransposed = false): [1, num_detections, num_features]
//     → data[i * num_features + f]
//
//   Transposed (isTransposed = true): [1, num_features, num_detections]
//     → data[f * num_detections + i]
//
// Which layout you have depends on the export. Check the logged dims to confirm.
function getFeature(data, i, f, numFeatures, numDetections, isTransposed) {
  return isTransposed
    ? data[f * numDetections + i]
    : data[i * numFeatures + f];
}

// Parses all detections from a raw ONNX output tensor, returning the single
// highest-confidence class-0 detection that passes the confidence threshold
// and width sanity check, or null if none qualify.
//
// Returns { x1, y1, x2, y2, score, maskWeights } with coordinates in
// 640px xyxy space, ready for mask drawing and width measurement.
function parseBestDetection(output0) {
  const dims0 = output0.dims;
  const data0 = output0.data;

  // --- SHAPE DIAGNOSTIC (logged on every snapshot) ---
  // If dims0 is [1, 38, 8400] the layout is transposed; [1, 8400, 38] is normal.
  // If the feature count is not 38, your model has a different output format.
  console.log("[ONNX] output0 dims:", dims0);
  console.log("[ONNX] First 38 raw values (Detection 0):", Array.from(data0.slice(0, 38)));
  if (dims0[1] > 1) {
    console.log("[ONNX] Detection 1 raw values (38 features):", Array.from(data0.slice(38, 76)));
  }

  // Auto-detect layout: the detection count is always the larger of the two
  // non-batch dimensions; the feature count is the smaller one.
  const isTransposed = dims0[1] < dims0[2];
  const numDetections = isTransposed ? dims0[2] : dims0[1];
  const numFeatures   = isTransposed ? dims0[1] : dims0[2];

  console.log(`[ONNX] Layout: ${isTransposed ? "transposed [1,features,detections]" : "normal [1,detections,features]"}`);
  console.log(`[ONNX] num_detections=${numDetections}, num_features=${numFeatures}`);

  if (numFeatures < 6) {
    console.error("[ONNX] Unexpectedly few features — output format may be unsupported.");
    return null;
  }

  let bestDetection = null;
  let bestScore = ONNX_CONF_THRESHOLD;

  for (let i = 0; i < numDetections; i++) {
    let score;
    let classId;
    let maskWeightsOffset;

    // Detect if this is an end-to-end (NMS baked-in) model output [1, 300, 38],
    // where index 4 is the confidence score and index 5 is the integer Class ID.
    const isEnd2End = (numDetections <= 300);

    if (isEnd2End) {
      score = getFeature(data0, i, 4, numFeatures, numDetections, isTransposed);
      classId = Math.round(getFeature(data0, i, 5, numFeatures, numDetections, isTransposed));
      maskWeightsOffset = 6;
    } else {
      // Non-end-to-end fallback (multi-label sigmoid scores for each class)
      const numClasses = Math.max(1, numFeatures - 4 - 32); // e.g. 38 - 36 = 2
      let maxScore = -1;
      let predictedClassId = -1;
      
      for (let c = 0; c < numClasses; c++) {
        const clsScore = getFeature(data0, i, 4 + c, numFeatures, numDetections, isTransposed);
        if (clsScore > maxScore) {
          maxScore = clsScore;
          predictedClassId = c;
        }
      }
      score = maxScore;
      classId = predictedClassId;
      maskWeightsOffset = 4 + numClasses;
    }

    if (classId !== 0 || score <= bestScore) continue;

    let x1 = getFeature(data0, i, 0, numFeatures, numDetections, isTransposed);
    let y1 = getFeature(data0, i, 1, numFeatures, numDetections, isTransposed);
    let x2 = getFeature(data0, i, 2, numFeatures, numDetections, isTransposed);
    let y2 = getFeature(data0, i, 3, numFeatures, numDetections, isTransposed);

    if (MODEL_IS_RAW_XYWH) {
      // Coordinates are normalized cx,cy,w,h → scale to 640px, then convert
      x1 *= 640; y1 *= 640; x2 *= 640; y2 *= 640;
      const cx = x1, cy = y1, w = x2, h = y2;
      x1 = cx - w / 2;
      y1 = cy - h / 2;
      x2 = cx + w / 2;
      y2 = cy + h / 2;
    } else {
      // Coordinates are already xyxy; scale from normalized [0,1] if needed
      const maxCoordVal = Math.max(Math.abs(x1), Math.abs(x2), Math.abs(y1), Math.abs(y2));
      if (maxCoordVal <= 5.0) {
        x1 *= 640; y1 *= 640; x2 *= 640; y2 *= 640;
      }
    }

    // Read the 32 mask prototype weights (features 6 to 37 or 4+numClasses to 37)
    const numMaskWeights = Math.min(32, numFeatures - maskWeightsOffset);
    const maskWeights = new Float32Array(numMaskWeights);
    for (let j = 0; j < numMaskWeights; j++) {
      maskWeights[j] = getFeature(data0, i, maskWeightsOffset + j, numFeatures, numDetections, isTransposed);
    }

    bestScore = score;
    bestDetection = { x1, y1, x2, y2, score, maskWeights };
  }

  if (!bestDetection) {
    console.log(`[ONNX] No detection above threshold (${ONNX_CONF_THRESHOLD}).`);
    return null;
  }

  // --- WIDTH SANITY CHECK ---
  // A valid 20cm reference object held at body distance should occupy
  // roughly 2-60% of the frame width. Anything outside that range is
  // almost certainly a false positive or a format error.
  const boxWidthIn640 = Math.abs(bestDetection.x2 - bestDetection.x1);
  const boxWidthFraction = boxWidthIn640 / 640;

  console.log(`[ONNX] Best detection: score=${bestDetection.score.toFixed(3)}, ` +
    `box=[${bestDetection.x1.toFixed(1)},${bestDetection.y1.toFixed(1)},` +
    `${bestDetection.x2.toFixed(1)},${bestDetection.y2.toFixed(1)}], ` +
    `width_fraction=${boxWidthFraction.toFixed(3)}`);

  if (boxWidthFraction > 0.8) {
    console.warn(`[ONNX] Rejecting detection: box is ${(boxWidthFraction * 100).toFixed(0)}% of frame width — ` +
      "likely a format parsing error or a false positive. Check the dims log above.");
    return null;
  }

  if (boxWidthFraction < 0.01) {
    console.warn("[ONNX] Rejecting detection: box width is < 1% of frame — implausibly small.");
    return null;
  }

  return bestDetection;
}

// ---------------------------------------------------------------------------
// UI HELPERS
// ---------------------------------------------------------------------------

function showBanner(type, title, message) {
  statusBanner.className = `status-banner ${type}`;
  statusBanner.innerHTML = `<h4>⚠️ ${title}</h4><p>${message}</p>`;
  statusBanner.classList.remove("hidden");
}

function hideBanner() {
  statusBanner.classList.add("hidden");
}

function checkSecureContext() {
  const isLocalhost =
    window.location.hostname === "localhost" ||
    window.location.hostname === "127.0.0.1";
  if (!window.isSecureContext && !isLocalhost) {
    showBanner(
      "error",
      "Camera Access Warning: Secure Connection Required",
      "Modern mobile browsers strictly block camera access over insecure <b>HTTP</b> connections.<br><br>" +
      "<b>To resolve this on your phone:</b><br>" +
      "1. Host this page over a secure <b>HTTPS</b> connection (e.g., using GitHub Pages, Vercel, Netlify).<br>" +
      "2. Or use a secure tunnel like <b>ngrok</b> or <b>localtunnel</b>.<br>" +
      "3. Standard IP addresses (like <code>http://192.168.x.x</code>) will <b>not</b> work on mobile."
    );
  }
}
checkSecureContext();

// ---------------------------------------------------------------------------
// MATH / GEOMETRY HELPERS
// ---------------------------------------------------------------------------

function formatToFeetAndInches(cm) {
  if (!cm || isNaN(cm)) return "0' 0\"";
  const totalInches = cm / 2.54;
  const feet = Math.floor(totalInches / 12);
  const inches = Math.round(totalInches % 12);
  if (inches === 12) return `${feet + 1}' 0"`;
  return `${feet}' ${inches}"`;
}

// Converts normalized landmark (x, y) into unit space where both axes share
// the same scale (x scaled by aspect ratio so 1 unit = 1/videoHeight in both axes)
function toUnitSpace(x, y, aspect) {
  return { x: x * aspect, y: y };
}

function rotatePoint(p, angle) {
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  return {
    x: p.x * cos - p.y * sin,
    y: p.x * sin + p.y * cos
  };
}

// Converts the calibration overlay's CSS pixel width into a fraction of the
// actual native video frame width, accounting for CSS object-fit scaling/cropping.
function getCardWidthNormalized(cardWidthPx) {
  const containerW = video.parentElement.clientWidth || video.videoWidth;
  const containerH = video.parentElement.clientHeight || video.videoHeight;
  const videoW = video.videoWidth;
  const videoH = video.videoHeight;

  if (!videoW || !videoH || !containerW || !containerH) {
    return cardWidthPx / (containerW || 1);
  }

  const objectFit = getComputedStyle(video).objectFit;

  if (objectFit === "cover" || objectFit === "contain" || objectFit === "scale-down") {
    const scale = (objectFit === "cover")
      ? Math.max(containerW / videoW, containerH / videoH)
      : Math.min(containerW / videoW, containerH / videoH);
    return (cardWidthPx / scale) / videoW;
  }

  // "fill" or unset — each axis scaled independently, no crop
  return cardWidthPx / containerW;
}

// Returns the rolling-average landmarks across the buffer, including visibility
function getSmoothedLandmarks() {
  if (landmarkBuffer.length === 0) return window.latestScreenLandmarks;

  const numLandmarks = landmarkBuffer[0].length;
  const smoothed = [];

  for (let i = 0; i < numLandmarks; i++) {
    let sumX = 0, sumY = 0, sumZ = 0, sumVis = 0, visCount = 0;
    landmarkBuffer.forEach(frame => {
      if (frame[i]) {
        sumX += frame[i].x;
        sumY += frame[i].y;
        sumZ += frame[i].z;
        if (typeof frame[i].visibility === "number") {
          sumVis += frame[i].visibility;
          visCount++;
        }
      }
    });
    smoothed.push({
      x: sumX / landmarkBuffer.length,
      y: sumY / landmarkBuffer.length,
      z: sumZ / landmarkBuffer.length,
      visibility: visCount > 0 ? sumVis / visCount : undefined
    });
  }
  return smoothed;
}

// ---------------------------------------------------------------------------
// ONNX PRE-PROCESSING
// ---------------------------------------------------------------------------

// Letterbox-resizes the video frame to 640×640 and converts to a
// Float32 NCHW tensor for ONNX inference.
function preprocessVideoFrame(videoElement) {
  const targetSize = 640;
  const tempCanvas = document.createElement("canvas");
  tempCanvas.width = targetSize;
  tempCanvas.height = targetSize;
  const ctx = tempCanvas.getContext("2d");

  const srcW = videoElement.videoWidth;
  const srcH = videoElement.videoHeight;
  const scale = Math.min(targetSize / srcW, targetSize / srcH);
  const dstW = srcW * scale;
  const dstH = srcH * scale;
  const dx = (targetSize - dstW) / 2;
  const dy = (targetSize - dstH) / 2;

  ctx.fillStyle = "rgb(114, 114, 114)"; // Change "black" to this
  ctx.fillRect(0, 0, targetSize, targetSize);
  ctx.drawImage(videoElement, 0, 0, srcW, srcH, dx, dy, dstW, dstH);

  const imgData = ctx.getImageData(0, 0, targetSize, targetSize);
  const { data } = imgData;

  const rChannel = new Float32Array(targetSize * targetSize);
  const gChannel = new Float32Array(targetSize * targetSize);
  const bChannel = new Float32Array(targetSize * targetSize);

  for (let i = 0; i < data.length; i += 4) {
    const index = i / 4;
    rChannel[index] = data[i]     / 255.0;
    gChannel[index] = data[i + 1] / 255.0;
    bChannel[index] = data[i + 2] / 255.0;
  }

  const tensorData = new Float32Array(3 * targetSize * targetSize);
  tensorData.set(rChannel, 0);
  tensorData.set(gChannel, targetSize * targetSize);
  tensorData.set(bChannel, 2 * targetSize * targetSize);

  return {
    tensor: new ort.Tensor("float32", tensorData, [1, 3, targetSize, targetSize]),
    padX: dx,
    padY: dy,
    scale
  };
}

// ---------------------------------------------------------------------------
// ONNX SEGMENTATION MASK RENDERER
// ---------------------------------------------------------------------------

function drawSegmentationMask(ctx, protoTensor, bestDetection, padX, padY, scale) {
  const maskW = 160;
  const maskH = 160;
  const maskCanvas = document.createElement("canvas");
  maskCanvas.width = maskW;
  maskCanvas.height = maskH;
  const maskCtx = maskCanvas.getContext("2d");
  const maskImgData = maskCtx.createImageData(maskW, maskH);
  const data = maskImgData.data;

  const proto = protoTensor.data;
  const weights = bestDetection.maskWeights;

  // Bounding box in 160×160 mask space (proto is 4× downsampled from 640×640)
  const mx1 = bestDetection.x1 / 4;
  const my1 = bestDetection.y1 / 4;
  const mx2 = bestDetection.x2 / 4;
  const my2 = bestDetection.y2 / 4;

  let minC = maskW;
  let maxC = -1;
  let minR = maskH;
  let maxR = -1;

  for (let r = 0; r < maskH; r++) {
    for (let c = 0; c < maskW; c++) {
      const idx = r * maskW + c;
      const pixelOffset = idx * 4;

      if (c >= mx1 && c <= mx2 && r >= my1 && r <= my2) {
        let sum = 0;
        for (let i = 0; i < weights.length; i++) {
          sum += weights[i] * proto[i * maskW * maskH + idx];
        }
        const prob = 1 / (1 + Math.exp(-sum));
        if (prob > 0.75) {
          data[pixelOffset]     = 0;
          data[pixelOffset + 1] = 255;
          data[pixelOffset + 2] = 255;
          data[pixelOffset + 3] = 120;

          if (c < minC) minC = c;
          if (c > maxC) maxC = c;
          if (r < minR) minR = r;
          if (r > maxR) maxR = r;
        } else {
          data[pixelOffset + 3] = 0;
        }
      } else {
        data[pixelOffset + 3] = 0;
      }
    }
  }

  maskCtx.putImageData(maskImgData, 0, 0);

  // Map 640×640 tensor space back to native video canvas dimensions
  const drawX = -padX / scale;
  const drawY = -padY / scale;
  const drawW = 640 / scale;
  const drawH = 640 / scale;

  ctx.save();
  ctx.drawImage(maskCanvas, drawX, drawY, drawW, drawH);

  // Resolve tight coordinates in 640px space, falling back to model predicted box if empty
  let tightX1 = bestDetection.x1;
  let tightY1 = bestDetection.y1;
  let tightX2 = bestDetection.x2;
  let tightY2 = bestDetection.y2;

  if (maxC >= minC) {
    tightX1 = minC * 4;
    tightY1 = minR * 4;
    tightX2 = maxC * 4;
    tightY2 = maxR * 4;
  }

  // HUD bounding box in video canvas space (using tight coordinates)
  const bx1 = (tightX1 - padX) / scale;
  const by1 = (tightY1 - padY) / scale;
  const bx2 = (tightX2 - padX) / scale;
  const by2 = (tightY2 - padY) / scale;
  const bw = bx2 - bx1;
  const bh = by2 - by1;

  // Subtle fill
  ctx.fillStyle = "rgba(0, 255, 255, 0.04)";
  ctx.fillRect(bx1, by1, bw, bh);

  // Thin bounding rectangle
  ctx.strokeStyle = "rgba(0, 255, 255, 0.35)";
  ctx.lineWidth = 1.5;
  ctx.shadowColor = "#00FFFF";
  ctx.shadowBlur = 4;
  ctx.strokeRect(bx1, by1, bw, bh);

  // Corner brackets
  ctx.strokeStyle = "#00FFFF";
  ctx.lineWidth = 4;
  ctx.shadowBlur = 12;
  const len = Math.min(20, Math.min(Math.abs(bw), Math.abs(bh)) * 0.25);

  [[bx1, by1, 1, 1], [bx2, by1, -1, 1], [bx1, by2, 1, -1], [bx2, by2, -1, -1]]
    .forEach(([cx, cy, sx, sy]) => {
      ctx.beginPath();
      ctx.moveTo(cx + sx * len, cy);
      ctx.lineTo(cx, cy);
      ctx.lineTo(cx, cy + sy * len);
      ctx.stroke();
    });

  // Confidence label pill
  const confPct = (bestDetection.score * 100).toFixed(0);
  const label = `🎯 AI REFERENCE: ${confPct}%`;
  ctx.font = "bold 13px system-ui, -apple-system, sans-serif";
  const labelWidth = ctx.measureText(label).width;
  const pillPx = 12, pillPy = 6;
  const pillW = labelWidth + pillPx * 2;
  const pillH = 13 + pillPy * 2;
  let pillY = by1 - pillH - 6;
  if (pillY < 10) pillY = by1 + 6;

  ctx.fillStyle = "rgba(15, 23, 42, 0.9)";
  ctx.shadowBlur = 0;
  ctx.beginPath();
  if (typeof ctx.roundRect === "function") {
    ctx.roundRect(bx1, pillY, pillW, pillH, 6);
  } else {
    ctx.rect(bx1, pillY, pillW, pillH);
  }
  ctx.fill();

  ctx.strokeStyle = "rgba(0, 255, 255, 0.7)";
  ctx.lineWidth = 1.5;
  ctx.stroke();

  ctx.fillStyle = "#00FFFF";
  ctx.shadowColor = "#00FFFF";
  ctx.shadowBlur = 2;
  ctx.fillText(label, bx1 + pillPx, pillY + pillH - pillPy - 2);

  ctx.restore();

  // Return the tight 640px bounding box
  return { x1: tightX1, y1: tightY1, x2: tightX2, y2: tightY2 };
}

// ---------------------------------------------------------------------------
// AI INITIALIZATION
// ---------------------------------------------------------------------------

async function initializeAI() {
  try {
    const vision = await FilesetResolver.forVisionTasks(
      "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.3/wasm"
    );
    poseLandmarker = await PoseLandmarker.createFromOptions(vision, {
      baseOptions: {
        modelAssetPath: "https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task",
        delegate: "CPU"
      },
      runningMode: "VIDEO",
      numPoses: 1,
      minPoseDetectionConfidence: 0.4,
      minPosePresenceConfidence: 0.3,
      minTrackingConfidence: 0.3
    });

    ort.env.wasm.wasmPaths = "https://cdn.jsdelivr.net/npm/onnxruntime-web@1.19.0/dist/";

    const hasWebGPU = navigator.gpu !== undefined;
    const providers = hasWebGPU ? ["webgpu", "wasm"] : ["wasm"];
    console.log("Initializing ONNX Engine with providers:", providers);

    onnxSession = await ort.InferenceSession.create("./ref.onnx", {
      executionProviders: providers
    });
    console.log(`ONNX Engine ready (${hasWebGPU ? "WebGPU" : "WASM"}).`);

    enableWebcamButton.disabled = false;
    enableWebcamButton.innerText = "Start Webcam";

    if (statusBanner.classList.contains("error") && statusBanner.innerHTML.includes("Initialization")) {
      hideBanner();
    }
  } catch (error) {
    console.error("Initialization failure:", error);
    showBanner(
      "error",
      "Model Loading Failed",
      `Failed to load AI components: <b>${error.message || error}</b>.<br><br>` +
      "Check that <code>ref.onnx</code> is in the same directory as this page and " +
      "that you are running a modern browser (Chrome/Edge recommended)."
    );
    enableWebcamButton.disabled = false;
    enableWebcamButton.innerText = "Retry Loading Model";
  }
}
initializeAI();

// ---------------------------------------------------------------------------
// CALIBRATION OVERLAY UI
// ---------------------------------------------------------------------------

let guideLeft = null;
let guideTop = null;

function updateCalibrationMode() {
  const mode = calibrationModeSelect.value;
  const labelEl = cardGuide.querySelector(".card-guide-label");

  // Reset manual fallback if active
  if (isManualFallbackActive) {
    isManualFallbackActive = false;
    captureButton.innerText = "Start 3s Timer & Measure";
    hideBanner();
  }

  if (mode === "a4") {
    if (aiTipsCard) aiTipsCard.classList.remove("hidden");
    if (aiFeedbackBadge) {
      webcamRunning
        ? aiFeedbackBadge.classList.remove("hidden")
        : aiFeedbackBadge.classList.add("hidden");
    }
  } else {
    if (aiTipsCard) aiTipsCard.classList.add("hidden");
    if (aiFeedbackBadge) aiFeedbackBadge.classList.add("hidden");
  }

  if (mode === "card" || mode === "letter") {
    cardSliderContainer.classList.remove("hidden");
    if (webcamRunning) cardGuide.classList.remove("hidden");
    labelEl.innerText = mode === "card" ? "Align Credit Card Here" : "Align Letter Paper Here";
    updateCardSize();
  } else {
    cardSliderContainer.classList.add("hidden");
    cardGuide.classList.add("hidden");
  }
}

calibrationModeSelect.addEventListener("change", updateCalibrationMode);

function updateCardSize() {
  const width = parseInt(cardSizeSlider.value);
  const mode = calibrationModeSelect.value;

  let aspectRatio = 1.5858; // Credit Card (85.6mm / 53.98mm)
  if (mode === "letter") aspectRatio = 1.2941; // US Letter landscape (11" / 8.5")

  const height = Math.round(width / aspectRatio);
  const oldWidth = cardGuide.clientWidth || width;
  const oldHeight = cardGuide.clientHeight || height;

  cardGuide.style.width  = `${width}px`;
  cardGuide.style.height = `${height}px`;
  cardSliderValue.innerText = `${width}px`;

  const parentWidth  = video.parentElement.clientWidth  || 640;
  const parentHeight = video.parentElement.clientHeight || 480;

  if (guideLeft === null || guideTop === null) {
    guideLeft = (parentWidth  - width)  / 2;
    guideTop  = (parentHeight - height) / 2;
  } else {
    const centerX = guideLeft + oldWidth  / 2;
    const centerY = guideTop  + oldHeight / 2;
    guideLeft = centerX - width  / 2;
    guideTop  = centerY - height / 2;
  }

  guideLeft = Math.max(0, Math.min(parentWidth  - width,  guideLeft));
  guideTop  = Math.max(0, Math.min(parentHeight - height, guideTop));

  cardGuide.style.left = `${guideLeft}px`;
  cardGuide.style.top  = `${guideTop}px`;
}

cardSizeSlider.addEventListener("input", updateCardSize);
updateCardSize();

window.addEventListener("resize", () => {
  const mode = calibrationModeSelect.value;
  if (mode === "card" || mode === "letter") updateCardSize();
});

// Drag behaviour for the overlay guide
let isDragging = false;
let startX, startY, startLeft, startTop;

cardGuide.addEventListener("mousedown", dragStart);
document.addEventListener("mousemove", dragMove);
document.addEventListener("mouseup", dragEnd);
cardGuide.addEventListener("touchstart", dragStart, { passive: true });
document.addEventListener("touchmove", dragMove, { passive: false });
document.addEventListener("touchend", dragEnd);

function dragStart(e) {
  const clientX = e.touches ? e.touches[0].clientX : e.clientX;
  const clientY = e.touches ? e.touches[0].clientY : e.clientY;
  isDragging = true;
  startX = clientX; startY = clientY;
  startLeft = guideLeft; startTop = guideTop;
  cardGuide.style.cursor = "grabbing";
}

function dragMove(e) {
  if (!isDragging) return;
  if (e.cancelable) e.preventDefault();
  const clientX = e.touches ? e.touches[0].clientX : e.clientX;
  const clientY = e.touches ? e.touches[0].clientY : e.clientY;
  const width  = cardGuide.clientWidth;
  const height = cardGuide.clientHeight;
  const parentWidth  = video.parentElement.clientWidth  || 640;
  const parentHeight = video.parentElement.clientHeight || 480;
  guideLeft = Math.max(0, Math.min(parentWidth  - width,  startLeft + clientX - startX));
  guideTop  = Math.max(0, Math.min(parentHeight - height, startTop  + clientY - startY));
  cardGuide.style.left = `${guideLeft}px`;
  cardGuide.style.top  = `${guideTop}px`;
}

function dragEnd() {
  isDragging = false;
  cardGuide.style.cursor = "grab";
}

// ---------------------------------------------------------------------------
// WEBCAM LIFECYCLE
// ---------------------------------------------------------------------------

function stopWebcam() {
  return new Promise(resolve => {
    webcamRunning = false;
    enableWebcamButton.innerText = "Start Webcam";
    captureButton.disabled = true;
    cardGuide.classList.add("hidden");
    if (aiFeedbackBadge) aiFeedbackBadge.classList.add("hidden");
    latestONNXResult = null;
    
    // Reset manual fallback if active
    if (isManualFallbackActive) {
      isManualFallbackActive = false;
      cardSliderContainer.classList.add("hidden");
      captureButton.innerText = "Start 3s Timer & Measure";
      hideBanner();
    }
    
    if (webcamStream) {
      webcamStream.getTracks().forEach(t => t.stop());
      webcamStream = null;
    }
    video.srcObject = null;
    canvasCtx.clearRect(0, 0, canvasElement.width, canvasElement.height);
    resolve();
  });
}

async function startWebcam() {
  if (!poseLandmarker || !onnxSession) {
    alert("AI models are not fully loaded yet. Please wait.");
    return;
  }
  hideBanner();

  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    showBanner("error", "Camera Blocked: Secure Context Required",
      "Your browser is blocking camera access because this page is not served over HTTPS.");
    return;
  }

  webcamRunning = true;
  enableWebcamButton.innerText = "Stop Webcam";
  captureButton.disabled = false;
  landmarkBuffer = [];
  latestONNXResult = null;

  const mode = calibrationModeSelect.value;
  if (mode === "card" || mode === "letter") cardGuide.classList.remove("hidden");
  if (mode === "a4" && aiFeedbackBadge) aiFeedbackBadge.classList.remove("hidden");

  const selectedFacing = cameraFacingSelect.value || "user";

  const constraints = [
    { video: { width: { ideal: 1920 }, height: { ideal: 1080 }, facingMode: selectedFacing } },
    { video: { facingMode: selectedFacing } },
    { video: true }
  ];

  for (let attempt = 0; attempt < constraints.length; attempt++) {
    try {
      const stream = await navigator.mediaDevices.getUserMedia(constraints[attempt]);
      webcamStream = stream;
      video.srcObject = stream;
      video.onplaying = () => {
        canvasCtx.clearRect(0, 0, canvasElement.width, canvasElement.height);
        predictWebcam();
      };
      return;
    } catch (err) {
      console.warn(`Camera attempt ${attempt + 1} failed:`, err);
      if (attempt === constraints.length - 1) {
        let msg = "Could not access the camera. ";
        if (err.name === "NotAllowedError" || err.name === "PermissionDeniedError") {
          msg += "<b>Permission denied</b> — check your browser camera settings.";
        } else if (err.name === "NotFoundError") {
          msg += "<b>No camera found</b> matching your selection.";
        } else {
          msg += `<b>Details:</b> ${err.message || err}`;
        }
        showBanner("error", "Webcam Access Failed", msg);
        await stopWebcam();
      }
    }
  }
}

enableWebcamButton.addEventListener("click", () => {
  if (enableWebcamButton.innerText === "Retry Loading Model") {
    enableWebcamButton.disabled = true;
    enableWebcamButton.innerText = "Loading Model...";
    initializeAI();
    return;
  }
  webcamRunning ? stopWebcam() : startWebcam();
});

cameraFacingSelect.addEventListener("change", () => {
  if (webcamRunning) stopWebcam().then(() => startWebcam());
});

captureButton.addEventListener("click", () => {
  if (isManualFallbackActive) {
    // Run the measurement calculation immediately without countdown
    processSelfSnap();
    return;
  }

  let count = 3;
  landmarkBuffer = [];
  captureButton.disabled = true;
  countdownOverlay.classList.remove("hidden");
  countdownOverlay.innerText = count;

  const timer = setInterval(() => {
    count--;
    if (count > 0) {
      countdownOverlay.innerText = count;
    } else {
      clearInterval(timer);
      countdownOverlay.innerText = "📸";
      setTimeout(() => {
        countdownOverlay.classList.add("hidden");
        processSelfSnap();
        captureButton.disabled = false;
      }, 500);
    }
  }, 1000);
});

// ---------------------------------------------------------------------------
// CORE MEASUREMENT ENGINE
// ---------------------------------------------------------------------------

async function processSelfSnap() {
  const sl = getSmoothedLandmarks();
  if (!sl) {
    alert("MediaPipe can't see your body clearly. Step back so your head and feet are both visible.");
    return;
  }

  const mode = calibrationModeSelect.value;
  const videoW = video.videoWidth;
  const videoH = video.videoHeight;
  const aspect = videoW / (videoH || 1);

  // Preprocess the video frame for ONNX inference while the camera is still running.
  // This avoids reading from a stopped/stale video stream which could yield empty/black frames.
  let preprocessedFrame = null;
  if (mode === "a4" && !isManualFallbackActive && onnxSession) {
    try {
      preprocessedFrame = preprocessVideoFrame(video);
    } catch (preprocessErr) {
      console.error("Error preprocessing video frame:", preprocessErr);
    }
  }

  // Freeze the stream AFTER capturing the current frame to a canvas.
  // Only capture/stop if manual fallback isn't already active (which means we've already frozen the stream).
  if (!isManualFallbackActive) {
    canvasCtx.clearRect(0, 0, canvasElement.width, canvasElement.height);
    canvasCtx.drawImage(video, 0, 0, canvasElement.width, canvasElement.height);

    // Now it's safe to stop the stream
    webcamRunning = false;
    if (webcamStream) {
      webcamStream.getTracks().forEach(t => t.stop());
      webcamStream = null;
    }
    enableWebcamButton.innerText = "Start Webcam";
    captureButton.disabled = true;
    cardGuide.classList.add("hidden");
  }

  // Draw pose landmarks on the frozen frame
  drawingUtils.drawLandmarks(sl, { radius: 4, color: "#FF0000" });
  drawingUtils.drawConnectors(sl, PoseLandmarker.POSE_CONNECTIONS, { color: "#00FF00", lineWidth: 3 });

  // Visibility check
  const lowConfidence = REQUIRED_LANDMARKS.filter(
    i => sl[i] && typeof sl[i].visibility === "number" && sl[i].visibility < VISIBILITY_THRESHOLD
  );
  if (lowConfidence.length > 0) {
    console.warn("Low-confidence landmarks:", lowConfidence);
    showBanner(
      "warning",
      "Some Body Points Weren't Clearly Visible",
      "For the best result, make sure your full body (head, ears, hands, and feet) " +
      "is in frame, well-lit, and unobstructed."
    );
  }

  try {
    let cmPerUnitSpace;
    let calibrationSource = "Default";

    // -----------------------------------------------------------------------
    // STEP 1: CALIBRATE SCALE
    // -----------------------------------------------------------------------
    if (mode === "a4") {
      let paperWidthNormalized = null;

      if (isManualFallbackActive) {
        const cardWidthPx = parseInt(cardSizeSlider.value);
        const cardWidthNormalized = getCardWidthNormalized(cardWidthPx);
        cmPerUnitSpace = 20.0 / (cardWidthNormalized * aspect);
        calibrationSource = `Manual 20cm Overlay (${cardWidthPx}px)`;
        paperWidthNormalized = cardWidthNormalized;
      } else {
        if (onnxSession && preprocessedFrame) {
          isONNXProcessing = true;

          try {
            const { tensor, padX, padY, scale } = preprocessedFrame;
            const outputMap = await onnxSession.run({ images: tensor });

            // Resolve output tensors by name, with index fallback
            const keys = Object.keys(outputMap);
            const output0 = outputMap.output0 || outputMap[keys[0]];
            const output1 = outputMap.output1 || outputMap[keys[1]];

            const bestDetection = parseBestDetection(output0);

            if (bestDetection) {
              const tightBBox = drawSegmentationMask(canvasCtx, output1, bestDetection, padX, padY, scale);

              const adjustedWidthPx = Math.abs(tightBBox.x2 - tightBBox.x1) / scale;
              paperWidthNormalized = adjustedWidthPx / videoW;

              // NOTE: If your ONNX model was trained on actual A4 paper use 21.0.
              // If it was trained on a custom 20cm object, use 20.0.
              // They cannot both be correct — check your training data.
              const realPaperWidthCm = 20.0;
              cmPerUnitSpace = realPaperWidthCm / (paperWidthNormalized * aspect);
              calibrationSource = "ONNX AI 20cm Reference";
              console.log(`[Snapshot] Scale: ${cmPerUnitSpace.toFixed(2)} cm/unit`);
            }
          } catch (onnxErr) {
            console.warn("ONNX snapshot inference failed:", onnxErr);
          } finally {
            isONNXProcessing = false;
          }
        }
      }

      if (!paperWidthNormalized) {
        isManualFallbackActive = true;
        
        const labelEl = cardGuide.querySelector(".card-guide-label");
        labelEl.innerText = "Align 20cm Reference Here";
        cardGuide.classList.remove("hidden");
        cardSliderContainer.classList.remove("hidden");
        updateCardSize();

        captureButton.innerText = "Confirm Manual Alignment & Measure";
        captureButton.disabled = false;

        showBanner(
          "warning",
          "AI Reference Detection Failed",
          "The AI model could not detect your reference object.<br><br>" +
          "<b>Don't worry!</b> We've shown a manual 20cm overlay square on your frozen picture.<br>" +
          "Please drag and resize the square over your reference object, then click <b>Confirm Manual Alignment & Measure</b>."
        );
        if (resultsCard) resultsCard.classList.add("hidden");
        return;
      }

    } else if (mode === "card") {
      const cardWidthPx = parseInt(cardSizeSlider.value);
      const cardWidthNormalized = getCardWidthNormalized(cardWidthPx);
      cmPerUnitSpace = 8.56 / (cardWidthNormalized * aspect);
      calibrationSource = `Card Overlay (${cardWidthPx}px)`;

    } else if (mode === "letter") {
      const cardWidthPx = parseInt(cardSizeSlider.value);
      const cardWidthNormalized = getCardWidthNormalized(cardWidthPx);
      cmPerUnitSpace = 27.94 / (cardWidthNormalized * aspect);
      calibrationSource = `Letter Paper Overlay (${cardWidthPx}px)`;

    } else if (mode === "ipd") {
      const dxEye = (sl[2].x - sl[5].x) * aspect;
      const dyEye =  sl[2].y - sl[5].y;
      const eyeDist = Math.sqrt(dxEye * dxEye + dyEye * dyEye);
      cmPerUnitSpace = AVG_IPD_CM / eyeDist;
      calibrationSource = "Eye Distance (IPD)";
    }

    // -----------------------------------------------------------------------
    // STEP 2: MEASURE BODY IN UNIT SPACE
    // -----------------------------------------------------------------------

    // Ground point: lowest of ankle/heel/toe landmark per foot
    const leftFootY  = Math.max(sl[27].y, sl[29].y, sl[31].y);
    const rightFootY = Math.max(sl[28].y, sl[30].y, sl[32].y);
    const groundY = (leftFootY + rightFootY) / 2;
    const groundX = (sl[29].x + sl[30].x) / 2; // heel landmarks

    // Head top: ear midpoint + crown offset (more stable than nose under tilt)
    const earY = (sl[7].y + sl[8].y) / 2;
    const earX = (sl[7].x + sl[8].x) / 2;
    const crownOffset = Math.abs(groundY - earY) * CROWN_ABOVE_EAR_RATIO;
    const topOfHeadY = earY - crownOffset;
    const topOfHeadX = earX;

    // Camera roll correction via shoulder line
    const shoulderUnit = toUnitSpace(sl[12].x - sl[11].x, sl[12].y - sl[11].y, aspect);
    const rollAngle = Math.atan2(shoulderUnit.y, shoulderUnit.x);

    const topPoint    = rotatePoint(toUnitSpace(topOfHeadX, topOfHeadY, aspect), -rollAngle);
    const groundPoint = rotatePoint(toUnitSpace(groundX,    groundY,    aspect), -rollAngle);

    const bodyScreenHeight = Math.abs(groundPoint.y - topPoint.y);

    // Wingspan: index-finger knuckles (landmarks 19/20) + fingertip extension
    // z-axis included to correct for arms angled toward/away from the camera
    const dxSpan = (sl[19].x - sl[20].x) * aspect;
    const dySpan =  sl[19].y - sl[20].y;
    const dzSpan = (sl[19].z - sl[20].z) * aspect;
    const handSpanDist = Math.sqrt(dxSpan * dxSpan + dySpan * dySpan + dzSpan * dzSpan);

    // -----------------------------------------------------------------------
    // STEP 3: CONVERT TO REAL UNITS
    // -----------------------------------------------------------------------
    const finalHeightCm   = bodyScreenHeight * cmPerUnitSpace;
    const finalWingspanCm = (handSpanDist    * cmPerUnitSpace) + (2 * FINGER_EXTENSION_CM);

    // -----------------------------------------------------------------------
    // STEP 4: PLAUSIBILITY CHECK
    // -----------------------------------------------------------------------
    const heightOOR   = finalHeightCm   < PLAUSIBLE_HEIGHT_CM[0]   || finalHeightCm   > PLAUSIBLE_HEIGHT_CM[1];
    const wingspanOOR = finalWingspanCm < PLAUSIBLE_WINGSPAN_CM[0] || finalWingspanCm > PLAUSIBLE_WINGSPAN_CM[1];

    if (heightOOR || wingspanOOR) {
      showBanner(
        "warning",
        "Unusual Measurement Detected",
        `Estimated height: <b>${finalHeightCm.toFixed(1)} cm</b>, ` +
        `wingspan: <b>${finalWingspanCm.toFixed(1)} cm</b>.<br><br>` +
        "One or both values are outside the expected adult range. This usually means " +
        "the calibration reference was the wrong size, too close/far from the camera, " +
        "or your full body wasn't visible. Check the console for ONNX diagnostic logs."
      );
    }

    heightResult.innerText   = `${formatToFeetAndInches(finalHeightCm)} (${finalHeightCm.toFixed(1)} cm)`;
    wingspanResult.innerText = `${formatToFeetAndInches(finalWingspanCm)} (${finalWingspanCm.toFixed(1)} cm)`;
    scaleNote.innerHTML = `Calibration source: <b>${calibrationSource}</b> — ` +
      `scale ${cmPerUnitSpace.toFixed(1)} cm/unit`;
    resultsCard.classList.remove("hidden");

    if (isManualFallbackActive) {
      isManualFallbackActive = false;
      cardGuide.classList.add("hidden");
      cardSliderContainer.classList.add("hidden");
      captureButton.innerText = "Start 3s Timer & Measure";
      hideBanner();
    }

  } catch (err) {
    console.error("Measurement error:", err);
    alert("Analysis failed — see browser console for details.");
  }
}

function updateAIFeedbackBadge() {
  if (!aiFeedbackBadge || !aiFeedbackText) return;

  if (calibrationModeSelect.value === "a4" && webcamRunning) {
    aiFeedbackBadge.classList.remove("hidden");
    aiFeedbackText.innerText = "AI Reference Calibration: Ready on Capture";
    aiFeedbackBadge.classList.add("detected");
  } else {
    aiFeedbackBadge.classList.add("hidden");
  }
}

// ---------------------------------------------------------------------------
// MAIN RENDER LOOP
// ---------------------------------------------------------------------------

async function predictWebcam() {
  if (canvasElement.width !== video.videoWidth || canvasElement.height !== video.videoHeight) {
    canvasElement.width  = video.videoWidth;
    canvasElement.height = video.videoHeight;
  }

  if (video.currentTime !== lastVideoTime && video.readyState >= 3) {
    lastVideoTime = video.currentTime;

    let timestampMs = performance.now();
    if (timestampMs <= lastSentTimestamp) timestampMs = lastSentTimestamp + 1;
    lastSentTimestamp = timestampMs;

    try {
      const frameBitmap = await createImageBitmap(video);
      const results = poseLandmarker.detectForVideo(frameBitmap, timestampMs);
      frameBitmap.close();

      canvasCtx.clearRect(0, 0, canvasElement.width, canvasElement.height);

      if (results.landmarks && results.landmarks.length > 0) {
        window.latestScreenLandmarks = results.landmarks[0];
        landmarkBuffer.push(JSON.parse(JSON.stringify(results.landmarks[0])));
        if (landmarkBuffer.length > BUFFER_MAX_SIZE) landmarkBuffer.shift();

        for (const landmark of results.landmarks) {
          drawingUtils.drawLandmarks(landmark, { radius: 4, color: "#FF0000" });
          drawingUtils.drawConnectors(landmark, PoseLandmarker.POSE_CONNECTIONS,
            { color: "#00FF00", lineWidth: 3 });
        }
      }

      updateAIFeedbackBadge();

    } catch (error) {
      console.error("Frame loop error:", error);
    }
  }

  if (webcamRunning) {
    if ("requestVideoFrameCallback" in video) {
      video.requestVideoFrameCallback(predictWebcam);
    } else {
      window.requestAnimationFrame(predictWebcam);
    }
  }
}
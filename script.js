import {
  PoseLandmarker,
  FilesetResolver,
  DrawingUtils
} from "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.3";
const ort = window.ort;

let poseLandmarker = undefined;
let onnxSession = undefined; // Swapped out roboflowProject for ONNX session
let webcamRunning = false;
let lastVideoTime = -1;
let lastSentTimestamp = -1;
let webcamStream = null;
window.latestScreenLandmarks = null;

// Temporal smoothing variables to reduce pose-detection jitter
let landmarkBuffer = [];
const BUFFER_MAX_SIZE = 30; // Stores the last 30 frames (~1 second of video)

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

// Camera and Status Banner elements
const cameraFacingSelect = document.getElementById("cameraFacing");
const statusBanner = document.getElementById("statusBanner");

// Calibration Mode UI elements
const calibrationModeSelect = document.getElementById("calibrationMode");
const cardSliderContainer = document.getElementById("cardSliderContainer");
const cardGuide = document.getElementById("cardGuide");
const cardSizeSlider = document.getElementById("cardSizeSlider");
const cardSliderValue = document.getElementById("cardSliderValue");

// Real-time AI Reference tracking elements
const aiTipsCard = document.getElementById("aiTipsCard");
const aiFeedbackBadge = document.getElementById("aiFeedbackBadge");
const aiFeedbackText = document.getElementById("aiFeedbackText");

let isONNXProcessing = false;
let latestONNXResult = null;
let lastONNXDetectionTime = 0;

// Helper to display clean, premium status banners
function showBanner(type, title, message) {
  statusBanner.className = `status-banner ${type}`;
  statusBanner.innerHTML = `
    <h4>⚠️ ${title}</h4>
    <p>${message}</p>
  `;
  statusBanner.classList.remove("hidden");
}

function hideBanner() {
  statusBanner.classList.add("hidden");
}

// Check for Secure Context on Load
function checkSecureContext() {
  const isLocalhost = window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1";
  if (!window.isSecureContext && !isLocalhost) {
    showBanner(
      "error",
      "Camera Access Warning: Secure Connection Required",
      "Modern mobile browsers strictly block camera access over insecure <b>HTTP</b> connections.<br><br>" +
      "<b>To resolve this on your phone:</b><br>" +
      "1. Host this page over a secure <b>HTTPS</b> connection (e.g., using GitHub Pages, Vercel, Netlify).<br>" +
      "2. Or use a secure tunnel like <b>ngrok</b> or <b>localtunnel</b> to expose your computer's local port to your phone.<br>" +
      "3. Standard IP addresses (like <code>http://192.168.x.x</code>) will <b>not</b> show the camera prompt on iOS/Android."
    );
  }
}
checkSecureContext();

// --- ANATOMICAL / CALIBRATION CONSTANTS ---
const AVG_IPD_CM = 6.3;              
const CROWN_ABOVE_EAR_RATIO = 0.07;  
const FINGER_EXTENSION_CM = 8;       
const VISIBILITY_THRESHOLD = 0.5;    
const PLAUSIBLE_HEIGHT_CM = [100, 230];
const PLAUSIBLE_WINGSPAN_CM = [120, 230];

const REQUIRED_LANDMARKS = [0, 2, 5, 7, 8, 11, 12, 15, 16, 19, 20, 27, 28, 29, 30, 31, 32];

function formatToFeetAndInches(cm) {
  if (!cm || isNaN(cm)) return "0' 0\"";
  const totalInches = cm / 2.54;
  const feet = Math.floor(totalInches / 12);
  const inches = Math.round(totalInches % 12);
  if (inches === 12) return `${feet + 1}' 0"`;
  return `${feet}' ${inches}"`;
}

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

    const cardWidthInVideoPx = cardWidthPx / scale;
    return cardWidthInVideoPx / videoW;
  }

  return cardWidthPx / containerW;
}

function getSmoothedLandmarks() {
  if (landmarkBuffer.length === 0) return window.latestScreenLandmarks;

  const numLandmarks = landmarkBuffer[0].length;
  const smoothed = [];

  for (let i = 0; i < numLandmarks; i++) {
    let sumX = 0, sumY = 0, sumZ = 0;
    let sumVis = 0, visCount = 0;

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

// --- NEW ONNX IMAGE PRE-PROCESSING HELPER ---
// Resizes and normalizes the active <video> canvas into a 1x3x640x640 Float32 Tensor
function preprocessVideoFrame(videoElement) {
  const targetSize = 640;
  const tempCanvas = document.createElement("canvas");
  tempCanvas.width = targetSize;
  tempCanvas.height = targetSize;
  const ctx = tempCanvas.getContext("2d");
  
  // Square padding letterbox resize logic
  const srcW = videoElement.videoWidth;
  const srcH = videoElement.videoHeight;
  const scale = Math.min(targetSize / srcW, targetSize / srcH);
  const dstW = srcW * scale;
  const dstH = srcH * scale;
  const dx = (targetSize - dstW) / 2;
  const dy = (targetSize - dstH) / 2;
  
  ctx.fillStyle = "black";
  ctx.fillRect(0, 0, targetSize, targetSize);
  ctx.drawImage(videoElement, 0, 0, srcW, srcH, dx, dy, dstW, dstH);
  
  const imgData = ctx.getImageData(0, 0, targetSize, targetSize);
  const { data } = imgData;
  
  // Allocate NCHW Float32 arrays
  const rChannel = new Float32Array(targetSize * targetSize);
  const gChannel = new Float32Array(targetSize * targetSize);
  const bChannel = new Float32Array(targetSize * targetSize);
  
  for (let i = 0; i < data.length; i += 4) {
    const index = i / 4;
    rChannel[index] = data[i] / 255.0;     // R
    gChannel[index] = data[i + 1] / 255.0; // G
    bChannel[index] = data[i + 2] / 255.0; // B
  }
  
  const tensorData = new Float32Array(3 * targetSize * targetSize);
  tensorData.set(rChannel, 0);
  tensorData.set(gChannel, targetSize * targetSize);
  tensorData.set(bChannel, 2 * targetSize * targetSize);
  
  return {
    tensor: new ort.Tensor("float32", tensorData, [1, 3, targetSize, targetSize]),
    padX: dx,
    padY: dy,
    scale: scale
  };
}

// --- NEW ONNX SEGMENTATION MASK VISUALIZER ---
// Computes the 160x160 mask linear combination, crops to bounding box, and draws on ctx
function drawSegmentationMask(ctx, protoTensor, bestDetection, padX, padY, scale) {
  const maskW = 160;
  const maskH = 160;
  const maskCanvas = document.createElement("canvas");
  maskCanvas.width = maskW;
  maskCanvas.height = maskH;
  const maskCtx = maskCanvas.getContext("2d");
  const maskImgData = maskCtx.createImageData(maskW, maskH);
  const data = maskImgData.data;

  const proto = protoTensor.data; // Float32Array size 32 * 160 * 160
  const weights = bestDetection.maskWeights; // Float32Array size 32

  // Bounding box in 160x160 space (downscaled by 4 from 640x640)
  const mx1 = bestDetection.x1 / 4;
  const my1 = bestDetection.y1 / 4;
  const mx2 = bestDetection.x2 / 4;
  const my2 = bestDetection.y2 / 4;

  for (let r = 0; r < maskH; r++) {
    for (let c = 0; c < maskW; c++) {
      const idx = r * maskW + c;
      const pixelOffset = idx * 4;

      // Crop mask to bounding box
      if (c >= mx1 && c <= mx2 && r >= my1 && r <= my2) {
        // Dot product of weights and prototypes
        let sum = 0;
        for (let i = 0; i < 32; i++) {
          sum += weights[i] * proto[i * maskW * maskH + idx];
        }
        
        // Sigmoid activation
        const prob = 1 / (1 + Math.exp(-sum));

        if (prob > 0.5) {
          // Neon Cyan overlay with 50% opacity
          data[pixelOffset] = 0;        // R
          data[pixelOffset + 1] = 255;  // G
          data[pixelOffset + 2] = 255;  // B
          data[pixelOffset + 3] = 120;  // A
        } else {
          data[pixelOffset + 3] = 0;    // Transparent
        }
      } else {
        data[pixelOffset + 3] = 0;      // Transparent
      }
    }
  }

  maskCtx.putImageData(maskImgData, 0, 0);

  // Map 640x640 space back to native video canvas space
  const drawX = -padX / scale;
  const drawY = -padY / scale;
  const drawW = 640 / scale;
  const drawH = 640 / scale;

  ctx.save();
  ctx.drawImage(maskCanvas, drawX, drawY, drawW, drawH);
  
  // Draw glowing border around the bounding box
  const bx1 = (bestDetection.x1 - padX) / scale;
  const by1 = (bestDetection.y1 - padY) / scale;
  const bx2 = (bestDetection.x2 - padX) / scale;
  const by2 = (bestDetection.y2 - padY) / scale;

  ctx.strokeStyle = "#00FFFF";
  ctx.lineWidth = 4;
  ctx.shadowColor = "#00FFFF";
  ctx.shadowBlur = 10;
  ctx.strokeRect(bx1, by1, bx2 - bx1, by2 - by1);

  // Add bold text label
  ctx.fillStyle = "#00FFFF";
  ctx.font = "bold 16px sans-serif";
  ctx.shadowBlur = 4;
  ctx.fillText("Reference Paper AI Cutout", bx1 + 5, by1 - 10);
  ctx.restore();
}

// Global initialization asynchronous launcher
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

    // Configure WASM paths for robust fallback
    ort.env.wasm.wasmPaths = 'https://cdn.jsdelivr.net/npm/onnxruntime-web@1.19.0/dist/';

    // Detect if WebGPU is available in browser
    const hasWebGPU = (navigator.gpu !== undefined);
    const providers = hasWebGPU ? ['webgpu', 'wasm'] : ['wasm'];
    console.log("Initializing ONNX Engine with providers:", providers);

    onnxSession = await ort.InferenceSession.create('./ref.onnx', {
      executionProviders: providers
    });
    console.log(`Local ONNX Engine Confirmed with ${hasWebGPU ? "WebGPU" : "WASM fallback"}.`);

    enableWebcamButton.disabled = false;
    enableWebcamButton.innerText = "Start Webcam";
    
    if (statusBanner.classList.contains("error") && statusBanner.innerHTML.includes("Initialization")) {
      hideBanner();
    }
  } catch (error) {
    console.error("Initialization failure: ", error);
    showBanner(
      "error",
      "Model Loading Failed",
      `Failed to load AI posture components: <b>${error.message || error}</b>.<br><br>` +
      "This can happen if your browser has issues initializing WebGPU/WebAssembly, or if the model file is missing.<br>" +
      "Please make sure you are running a modern browser like Chrome/Edge and click the retry button below."
    );
    enableWebcamButton.disabled = false;
    enableWebcamButton.innerText = "Retry Loading Model";
  }
}
initializeAI();

let guideLeft = null;
let guideTop = null;

function updateCalibrationMode() {
  const mode = calibrationModeSelect.value;
  const labelEl = cardGuide.querySelector('.card-guide-label');
  
  if (mode === "a4") {
    if (aiTipsCard) aiTipsCard.classList.remove("hidden");
    if (webcamRunning && aiFeedbackBadge) {
      aiFeedbackBadge.classList.remove("hidden");
    } else if (aiFeedbackBadge) {
      aiFeedbackBadge.classList.add("hidden");
    }
  } else {
    if (aiTipsCard) aiTipsCard.classList.add("hidden");
    if (aiFeedbackBadge) aiFeedbackBadge.classList.add("hidden");
  }
  
  if (mode === "card" || mode === "letter") {
    cardSliderContainer.classList.remove("hidden");
    if (webcamRunning) {
      cardGuide.classList.remove("hidden");
    }
    
    if (mode === "card") {
      labelEl.innerText = "Align Credit Card Here";
    } else {
      labelEl.innerText = "Align Letter Paper Here";
    }
    
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
  
  let aspectRatio = 1.5858; // Credit Card
  if (mode === "letter") {
    aspectRatio = 1.2941; // US Letter Landscape
  } else if (mode === "a4") {
    aspectRatio = 1.4142; // A4 Paper Landscape (297mm / 210mm)
  }
  
  const height = Math.round(width / aspectRatio);
  
  const oldWidth = cardGuide.clientWidth || width;
  const oldHeight = cardGuide.clientHeight || height;
  
  cardGuide.style.width = `${width}px`;
  cardGuide.style.height = `${height}px`;
  cardSliderValue.innerText = `${width}px`;
  
  const parentWidth = video.parentElement.clientWidth || 640;
  const parentHeight = video.parentElement.clientHeight || 480;
  
  if (guideLeft === null || guideTop === null) {
    guideLeft = (parentWidth - width) / 2;
    guideTop = (parentHeight - height) / 2;
  } else {
    const centerX = guideLeft + oldWidth / 2;
    const centerY = guideTop + oldHeight / 2;
    guideLeft = centerX - width / 2;
    guideTop = centerY - height / 2;
  }
  
  guideLeft = Math.max(0, Math.min(parentWidth - width, guideLeft));
  guideTop = Math.max(0, Math.min(parentHeight - height, guideTop));
  
  cardGuide.style.left = `${guideLeft}px`;
  cardGuide.style.top = `${guideTop}px`;
}

cardSizeSlider.addEventListener("input", updateCardSize);
updateCardSize();

window.addEventListener("resize", () => {
  const mode = calibrationModeSelect.value;
  if (mode === "card" || mode === "letter") {
    updateCardSize();
  }
});

let isDragging = false;
let startX, startY;
let startLeft, startTop;

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
  startX = clientX;
  startY = clientY;
  startLeft = guideLeft;
  startTop = guideTop;
  cardGuide.style.cursor = "grabbing";
}

function dragMove(e) {
  if (!isDragging) return;
  if (e.cancelable) e.preventDefault();
  
  const clientX = e.touches ? e.touches[0].clientX : e.clientX;
  const clientY = e.touches ? e.touches[0].clientY : e.clientY;
  
  const dx = clientX - startX;
  const dy = clientY - startY;
  
  const width = cardGuide.clientWidth;
  const height = cardGuide.clientHeight;
  const parentWidth = video.parentElement.clientWidth || 640;
  const parentHeight = video.parentElement.clientHeight || 480;
  
  guideLeft = Math.max(0, Math.min(parentWidth - width, startLeft + dx));
  guideTop = Math.max(0, Math.min(parentHeight - height, startTop + dy));
  
  cardGuide.style.left = `${guideLeft}px`;
  cardGuide.style.top = `${guideTop}px`;
}

function dragEnd() {
  isDragging = false;
  cardGuide.style.cursor = "grab";
}

function stopWebcam() {
  return new Promise((resolve) => {
    webcamRunning = false;
    enableWebcamButton.innerText = "Start Webcam";
    captureButton.disabled = true;
    cardGuide.classList.add("hidden");
    if (aiFeedbackBadge) aiFeedbackBadge.classList.add("hidden");
    latestONNXResult = null;
    
    if (webcamStream) { 
      webcamStream.getTracks().forEach(track => track.stop()); 
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
    showBanner(
      "error",
      "Camera Blocked: Secure Context Required",
      "Your mobile browser is blocking camera access because this page is not served over a secure (HTTPS) connection."
    );
    return;
  }

  webcamRunning = true;
  enableWebcamButton.innerText = "Stop Webcam";
  captureButton.disabled = false;
  landmarkBuffer = []; 
  latestONNXResult = null;
  
  const mode = calibrationModeSelect.value;
  if (mode === "card" || mode === "letter") {
    cardGuide.classList.remove("hidden");
  }
  if (mode === "a4") {
    if (aiFeedbackBadge) aiFeedbackBadge.classList.remove("hidden");
  }

  const selectedFacing = cameraFacingSelect.value || "user";
  
  const highResConstraints = {
    video: { width: { ideal: 1920 }, height: { ideal: 1080 }, facingMode: selectedFacing }
  };
  const standardConstraints = { video: { facingMode: selectedFacing } };
  const genericConstraints = { video: true };

  async function tryStream(constraints, attemptNumber) {
    try {
      const stream = await navigator.mediaDevices.getUserMedia(constraints);
      webcamStream = stream;
      video.srcObject = stream;
      video.onplaying = () => {
        canvasCtx.clearRect(0, 0, canvasElement.width, canvasElement.height);
        predictWebcam(); 
      };
    } catch (err) {
      if (attemptNumber === 1) await tryStream(standardConstraints, 2);
      else if (attemptNumber === 2) await tryStream(genericConstraints, 3);
      else {
        showBanner("error", "Webcam Access Failed", "All camera connection vectors blocked.");
        await stopWebcam();
      }
    }
  }
  await tryStream(highResConstraints, 1);
}

enableWebcamButton.addEventListener("click", () => {
  if (enableWebcamButton.innerText === "Retry Loading Model") {
    enableWebcamButton.disabled = true;
    enableWebcamButton.innerText = "Loading Model...";
    initializeAI();
    return;
  }
  if (webcamRunning) stopWebcam();
  else startWebcam();
});

cameraFacingSelect.addEventListener("change", () => {
  if (webcamRunning) {
    stopWebcam().then(() => { startWebcam(); });
  }
});

captureButton.addEventListener("click", () => {
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

// --- CORE MATHEMATICAL MEASUREMENT ENGINE WITH LOCAL WEBGPU DECODER ---
async function processSelfSnap() {
  const sl = getSmoothedLandmarks();
  if (!sl) {
    alert("MediaPipe can't see your body frame clearly. Step further back so your head and feet are visible!");
    return;
  }

  // Freeze the webcam and capture the exact frame onto the canvas
  webcamRunning = false;
  if (webcamStream) {
    webcamStream.getTracks().forEach(track => track.stop());
    webcamStream = null;
  }
  enableWebcamButton.innerText = "Start Webcam";
  captureButton.disabled = true;
  cardGuide.classList.add("hidden");

  // Redraw the current video image onto the canvas to hold it frozen
  canvasCtx.clearRect(0, 0, canvasElement.width, canvasElement.height);
  canvasCtx.drawImage(video, 0, 0, canvasElement.width, canvasElement.height);

  // Draw the MediaPipe landmarks on this frozen frame
  drawingUtils.drawLandmarks(sl, { radius: 4, color: "#FF0000" });
  drawingUtils.drawConnectors(sl, PoseLandmarker.POSE_CONNECTIONS, { color: "#00FF00", lineWidth: 3 });

  const lowConfidence = REQUIRED_LANDMARKS.filter(
    i => sl[i] && typeof sl[i].visibility === "number" && sl[i].visibility < VISIBILITY_THRESHOLD
  );
  if (lowConfidence.length > 0) {
    showBanner(
      "warning",
      "Some Body Points Weren't Clearly Visible",
      "For the most accurate reading, make sure your full body is in frame."
    );
  }

  try {
    const aspect = video.videoWidth / video.videoHeight;
    const mode = calibrationModeSelect.value;

    let cmPerUnitSpace;
    let calibrationSource = "Default";

    // --- STEP 1: CALIBRATE SCALE VIA LOCAL ONNX WEBGPU SESSION ---
    if (mode === "a4") {
      let paperWidthNormalized = null;
      if (onnxSession) {
        // Wait for any active background ONNX inference to finish to avoid race conditions
        let attempts = 0;
        while (isONNXProcessing && attempts < 50) {
          await new Promise(resolve => setTimeout(resolve, 20));
          attempts++;
        }
        
        // Lock the session for the snapshot
        isONNXProcessing = true;

        try {
          // Preprocess local video frame to get tensor configuration metadata
          const { tensor, padX, padY, scale } = preprocessVideoFrame(video);
          
          // Execute execution pass asynchronously via browser's ONNX pipeline
          const outputMap = await onnxSession.run({ images: tensor });
          
          // Access output layers safely
          const output0 = outputMap.output0 || outputMap[Object.keys(outputMap)[0]];
          const output1 = outputMap.output1 || outputMap[Object.keys(outputMap)[1]];
          
          const dims0 = output0.dims; // [1, 300, 38]
          const data0 = output0.data;
          const numDetections = dims0[1]; // 300
          const numFeatures = dims0[2]; // 38

          let bestDetection = null;
          let maxConf = 0.15; // Minimum detection confidence score threshold (increased sensitivity)

          for (let i = 0; i < numDetections; i++) {
            const offset = i * numFeatures;
            const score = data0[offset + 4];
            const classId = data0[offset + 5];

            // We look for class 0 ('Reference') with the highest score
            if (classId === 0 && score > maxConf) {
              maxConf = score;
              
              const x1 = data0[offset + 0];
              const y1 = data0[offset + 1];
              const x2 = data0[offset + 2];
              const y2 = data0[offset + 3];

              const maskWeights = new Float32Array(32);
              for (let j = 0; j < 32; j++) {
                maskWeights[j] = data0[offset + 6 + j];
              }

              bestDetection = { x1, y1, x2, y2, score, maskWeights };
            }
          }
          
          if (bestDetection && Math.abs(bestDetection.x2 - bestDetection.x1) >= 10) {
            // Draw the cutout overlay onto the frozen video canvas
            drawSegmentationMask(canvasCtx, output1, bestDetection, padX, padY, scale);

            // Denormalize bounding box width back to standard native video coordinates
            const adjustedWidthPx = Math.abs(bestDetection.x2 - bestDetection.x1) / scale;
            paperWidthNormalized = adjustedWidthPx / video.videoWidth;
            
            const realPaperWidthCm = 20.0;
            cmPerUnitSpace = realPaperWidthCm / (paperWidthNormalized * aspect);
            calibrationSource = "ONNX AI 20cm Cutout";
            console.log(`ONNX calibrated unit scale: ${cmPerUnitSpace.toFixed(2)} cm/unit`);
          } else {
            bestDetection = null;
          }
        } catch (onnxErr) {
          console.warn("Local ONNX pipeline processing failure:", onnxErr);
        } finally {
          isONNXProcessing = false;
        }
      }

      if (!paperWidthNormalized) {
        showBanner(
          "error",
          "AI Reference Detection Failed",
          "The AI model could not detect your 20cm reference object in this frame.<br><br>" +
          "<b>To help the AI find it:</b><br>" +
          "1. Hold the object by its very edges (don't cover its shape with your fingers).<br>" +
          "2. Use a flat, solid-colored reference object that stands out against your clothing.<br>" +
          "3. Ensure the room is well-lit and there are no bright lights directly behind you."
        );
        if (resultsCard) resultsCard.classList.add("hidden");
        return;
      }
    } else if (mode === "card") {
      const cardWidthPx = parseInt(cardSizeSlider.value);
      const cardWidthNormalized = getCardWidthNormalized(cardWidthPx);
      const cardScreenDistance = cardWidthNormalized * aspect;
      const realCardWidthCm = 8.56; 
      cmPerUnitSpace = realCardWidthCm / cardScreenDistance;
      calibrationSource = `Card Overlay (${cardWidthPx}px)`;
    } else if (mode === "letter") {
      const cardWidthPx = parseInt(cardSizeSlider.value);
      const cardWidthNormalized = getCardWidthNormalized(cardWidthPx);
      const cardScreenDistance = cardWidthNormalized * aspect;
      const realLetterWidthCm = 27.94; 
      cmPerUnitSpace = realLetterWidthCm / cardScreenDistance;
      calibrationSource = `Letter Paper Overlay (${cardWidthPx}px)`;
    } else if (mode === "ipd") {
      const dxEye = (sl[2].x - sl[5].x) * aspect;
      const dyEye = sl[2].y - sl[5].y;
      const eyeScreenDistance = Math.sqrt(dxEye * dxEye + dyEye * dyEye);
      cmPerUnitSpace = AVG_IPD_CM / eyeScreenDistance;
      calibrationSource = "Eye Distance IPD";
    }

    // --- STEP 2: MEASURE YOUR BODY SIZES IN UNITLESS SCREEN SPACE ---
    const leftFootY = Math.max(sl[27].y, sl[29].y, sl[31].y);
    const rightFootY = Math.max(sl[28].y, sl[30].y, sl[32].y);
    const leftFootX = sl[29].x; 
    const rightFootX = sl[30].x;

    const groundY = (leftFootY + rightFootY) / 2;
    const groundX = (leftFootX + rightFootX) / 2;

    const earY = (sl[7].y + sl[8].y) / 2;
    const earX = (sl[7].x + sl[8].x) / 2;

    const roughEarToGround = Math.abs(groundY - earY);
    const crownOffset = roughEarToGround * CROWN_ABOVE_EAR_RATIO;

    const topOfHeadY = earY - crownOffset;
    const topOfHeadX = earX;

    const shoulderUnit = toUnitSpace(
      sl[12].x - sl[11].x,
      sl[12].y - sl[11].y,
      aspect
    );
    const rollAngle = Math.atan2(shoulderUnit.y, shoulderUnit.x);

    const topPoint = rotatePoint(toUnitSpace(topOfHeadX, topOfHeadY, aspect), -rollAngle);
    const groundPoint = rotatePoint(toUnitSpace(groundX, groundY, aspect), -rollAngle);

    const bodyScreenHeight = Math.abs(groundPoint.y - topPoint.y);

    const dxSpan = (sl[19].x - sl[20].x) * aspect;
    const dySpan = sl[19].y - sl[20].y;
    const dzSpan = (sl[19].z - sl[20].z) * aspect;
    const handSpanScreenDistance = Math.sqrt(dxSpan * dxSpan + dySpan * dySpan + dzSpan * dzSpan);

    // --- STEP 3: MULTIPLY OUT THE FINAL VALUES ---
    let finalHeightCm = bodyScreenHeight * cmPerUnitSpace;
    let finalWingspanCm = (handSpanScreenDistance * cmPerUnitSpace) + (2 * FINGER_EXTENSION_CM);

    // --- STEP 4: PLAUSIBILITY CHECK ---
    const heightOutOfRange = finalHeightCm < PLAUSIBLE_HEIGHT_CM[0] || finalHeightCm > PLAUSIBLE_HEIGHT_CM[1];
    const wingspanOutOfRange = finalWingspanCm < PLAUSIBLE_WINGSPAN_CM[0] || finalWingspanCm > PLAUSIBLE_WINGSPAN_CM[1];

    if (heightOutOfRange || wingspanOutOfRange) {
      showBanner(
        "warning",
        "Unusual Measurement Detected",
        "Double-check your calibration setup and try capturing again."
      );
    }

    heightResult.innerText = `${formatToFeetAndInches(finalHeightCm)} (${finalHeightCm.toFixed(1)} cm)`;
    wingspanResult.innerText = `${formatToFeetAndInches(finalWingspanCm)} (${finalWingspanCm.toFixed(1)} cm)`;
    scaleNote.innerHTML = `Calibration Complete. Source: <b>${calibrationSource}</b> (Scale: ${cmPerUnitSpace.toFixed(1)} cm/unit).`;
    resultsCard.classList.remove("hidden");

  } catch (err) {
    console.error("Ratio Processing Error:", err);
    alert("Analysis failed.");
  }
}

async function runRealtimeONNXInference() {
  if (!webcamRunning || !onnxSession) {
    isONNXProcessing = false;
    return;
  }
  try {
    const { tensor, padX, padY, scale } = preprocessVideoFrame(video);
    const outputMap = await onnxSession.run({ images: tensor });
    
    const output0 = outputMap.output0 || outputMap[Object.keys(outputMap)[0]];
    const output1 = outputMap.output1 || outputMap[Object.keys(outputMap)[1]];
    
    const dims0 = output0.dims;
    const data0 = output0.data;
    const numDetections = dims0[1];
    const numFeatures = dims0[2];

    let bestDetection = null;
    let maxConf = 0.15; // highly sensitive confidence threshold for instant detection feedback

    for (let i = 0; i < numDetections; i++) {
      const offset = i * numFeatures;
      const score = data0[offset + 4];
      const classId = data0[offset + 5];

      if (classId === 0 && score > maxConf) {
        maxConf = score;
        const x1 = data0[offset + 0];
        const y1 = data0[offset + 1];
        const x2 = data0[offset + 2];
        const y2 = data0[offset + 3];

        const maskWeights = new Float32Array(32);
        for (let j = 0; j < 32; j++) {
          maskWeights[j] = data0[offset + 6 + j];
        }

        bestDetection = { x1, y1, x2, y2, score, maskWeights };
      }
    }

    if (bestDetection && Math.abs(bestDetection.x2 - bestDetection.x1) >= 10) {
      latestONNXResult = {
        bestDetection,
        output1,
        padX,
        padY,
        scale
      };
      lastONNXDetectionTime = Date.now();
    } else {
      // If nothing detected for 800ms, clear the cached result to remove ghost overlays
      if (Date.now() - lastONNXDetectionTime > 800) {
        latestONNXResult = null;
      }
    }
  } catch (err) {
    console.warn("Real-time AI reference inference error:", err);
  } finally {
    isONNXProcessing = false;
  }
}

function updateAIFeedbackBadge() {
  if (!aiFeedbackBadge || !aiFeedbackText) return;
  
  if (calibrationModeSelect.value === "a4" && webcamRunning) {
    aiFeedbackBadge.classList.remove("hidden");
    
    const hasRecentDetection = latestONNXResult && (Date.now() - lastONNXDetectionTime < 1000);
    if (hasRecentDetection) {
      const scorePct = (latestONNXResult.bestDetection.score * 100).toFixed(0);
      aiFeedbackText.innerText = `20cm Reference Detected (${scorePct}%)`;
      aiFeedbackBadge.classList.add("detected");
    } else {
      aiFeedbackText.innerText = "Searching for 20cm Reference...";
      aiFeedbackBadge.classList.remove("detected");
    }
  } else {
    aiFeedbackBadge.classList.add("hidden");
  }
}


async function predictWebcam() {
  if (canvasElement.width !== video.videoWidth || canvasElement.height !== video.videoHeight) {
    canvasElement.width = video.videoWidth;
    canvasElement.height = video.videoHeight;
  }

  if (video.currentTime !== lastVideoTime && video.readyState >= 3) {
    lastVideoTime = video.currentTime;
    
    let timestampMs = performance.now();
    if (timestampMs <= lastSentTimestamp) {
      timestampMs = lastSentTimestamp + 1;
    }
    lastSentTimestamp = timestampMs;

    try {
      const frameBitmap = await createImageBitmap(video);
      const results = poseLandmarker.detectForVideo(frameBitmap, timestampMs);
      frameBitmap.close(); 

      // Clear the canvas on every frame to ensure old overlays don't stick
      canvasCtx.clearRect(0, 0, canvasElement.width, canvasElement.height);

      if (results.landmarks && results.landmarks.length > 0) {
        window.latestScreenLandmarks = results.landmarks[0]; 
        
        landmarkBuffer.push(JSON.parse(JSON.stringify(results.landmarks[0])));
        if (landmarkBuffer.length > BUFFER_MAX_SIZE) {
          landmarkBuffer.shift();
        }
        
        for (const landmark of results.landmarks) {
          drawingUtils.drawLandmarks(landmark, { radius: 4, color: "#FF0000" });
          drawingUtils.drawConnectors(landmark, PoseLandmarker.POSE_CONNECTIONS, { color: "#00FF00", lineWidth: 3 });
        }
      }

      // 1. Draw real-time ONNX reference object cutout on top of standard landmarks
      if (calibrationModeSelect.value === "a4" && latestONNXResult && (Date.now() - lastONNXDetectionTime < 1000)) {
        drawSegmentationMask(
          canvasCtx,
          latestONNXResult.output1,
          latestONNXResult.bestDetection,
          latestONNXResult.padX,
          latestONNXResult.padY,
          latestONNXResult.scale
        );
      }

      // 2. Trigger asynchronous background ONNX inference if mode is selected
      if (calibrationModeSelect.value === "a4" && onnxSession && !isONNXProcessing && webcamRunning) {
        isONNXProcessing = true;
        runRealtimeONNXInference();
      }

      // 3. Update the live HUD feedback badge
      updateAIFeedbackBadge();

    } catch (error) {
      console.error("Frame loop detection error context stack: ", error);
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
import {
  PoseLandmarker,
  FilesetResolver,
  DrawingUtils
} from "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.3";
import * as ort from 'onnxruntime-web/webgpu'

let poseLandmarker = undefined;
let roboflowProject = undefined; 
let webcamRunning = false;
let lastVideoTime = -1;
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

// --- API INITIALIZATION ENDPOINTS ---
const ROBOFLOW_API_KEY = "rf_N6zRuV708EeE6xkIOGQSXyS9Bfm1"; 
const MODEL_NAME = "a4-detection"; 
const MODEL_VERSION = 1;

// --- ANATOMICAL / CALIBRATION CONSTANTS ---
// These are population averages used as fallbacks or correction terms.
// Each introduces some per-person error that can't be eliminated without
// additional sensors (depth camera, user-entered personal measurements, etc.)
const AVG_IPD_CM = 6.3;              // Avg adult interpupillary distance (real range ~5.4-7.4cm)
const CROWN_ABOVE_EAR_RATIO = 0.07;  // Crown-to-ear-canal vertical distance as a fraction of total height
const FINGER_EXTENSION_CM = 8;       // Approx. length from index-finger knuckle to fingertip, per hand
const VISIBILITY_THRESHOLD = 0.5;    // Landmarks below this confidence trigger a warning
const PLAUSIBLE_HEIGHT_CM = [100, 230];
const PLAUSIBLE_WINGSPAN_CM = [120, 230];

// Landmarks we rely on for the core measurements; used for the visibility check
const REQUIRED_LANDMARKS = [0, 2, 5, 7, 8, 11, 12, 15, 16, 19, 20, 27, 28, 29, 30, 31, 32];

// Converts raw metrics back to an elegant Imperial display
function formatToFeetAndInches(cm) {
  if (!cm || isNaN(cm)) return "0' 0\"";
  const totalInches = cm / 2.54;
  const feet = Math.floor(totalInches / 12);
  const inches = Math.round(totalInches % 12);
  if (inches === 12) return `${feet + 1}' 0"`;
  return `${feet}' ${inches}"`;
}

// Converts a normalized (x, y) point into "unit space" where both axes share
// the same scale (x is scaled by the video aspect ratio so that 1 unit of x
// and 1 unit of y both correspond to 1 fraction of the video's HEIGHT).
function toUnitSpace(x, y, aspect) {
  return { x: x * aspect, y: y };
}

// Rotates a point in unit space by `angle` radians (used for camera-roll correction)
function rotatePoint(p, angle) {
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  return {
    x: p.x * cos - p.y * sin,
    y: p.x * sin + p.y * cos
  };
}

// Converts a CSS-pixel width of the calibration overlay (card/letter guide)
// into a fraction of the underlying video frame's native width, accounting
// for how the <video> element is sized relative to its native resolution
// via CSS object-fit.
function getCardWidthNormalized(cardWidthPx) {
  const containerW = video.parentElement.clientWidth || video.videoWidth;
  const containerH = video.parentElement.clientHeight || video.videoHeight;
  const videoW = video.videoWidth;
  const videoH = video.videoHeight;

  if (!videoW || !videoH || !containerW || !containerH) {
    // Fallback to the naive ratio if dimensions aren't available yet
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

  // "fill" / "none" / unset — independent axis scaling
  return cardWidthPx / containerW;
}

// Computes the rolling average coordinates (and visibility) for each landmark
// inside the buffer to reduce frame jitter
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

    if (window.roboflow) {
      const rf = window.roboflow.auth({ publishable_key: ROBOFLOW_API_KEY });
      roboflowProject = await rf.load({ model: MODEL_NAME, version: MODEL_VERSION });
      console.log("Roboflow Engine Connection Confirmed.");
    }

    enableWebcamButton.disabled = false;
    enableWebcamButton.innerText = "Start Webcam";
    
    // Clear any previous error banner if load succeeds on retry
    if (statusBanner.classList.contains("error") && statusBanner.innerHTML.includes("Initialization")) {
      hideBanner();
    }
  } catch (error) {
    console.error("Initialization failure: ", error);
    showBanner(
      "error",
      "Model Loading Failed",
      `Failed to load AI posture components: <b>${error.message || error}</b>.<br><br>` +
      "This often happens on slow network connections, if CDN access is temporarily blocked, or if served securely on mobile.<br>" +
      "Please check your internet connection and click the retry button below."
    );
    enableWebcamButton.disabled = false;
    enableWebcamButton.innerText = "Retry Loading Model";
  }
}
initializeAI();

// Positional coordinates for manual calibration guide overlay
let guideLeft = null;
let guideTop = null;

// Toggle visibility of the card overlay and slider depending on the selected mode
function updateCalibrationMode() {
  const mode = calibrationModeSelect.value;
  const labelEl = cardGuide.querySelector('.card-guide-label');
  
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
    
    // Force recalculation of sizes based on mode aspect ratio
    updateCardSize();
  } else {
    cardSliderContainer.classList.add("hidden");
    cardGuide.classList.add("hidden");
  }
}

calibrationModeSelect.addEventListener("change", updateCalibrationMode);

// Resize the manual card guide overlay dynamically matching the range slider
function updateCardSize() {
  const width = parseInt(cardSizeSlider.value);
  const mode = calibrationModeSelect.value;
  
  // Set aspect ratio based on selected mode
  let aspectRatio = 1.5858; // Credit Card (85.6mm / 53.98mm)
  if (mode === "letter") {
    aspectRatio = 1.2941; // US Letter Landscape (11" / 8.5")
  }
  
  const height = Math.round(width / aspectRatio);
  
  const oldWidth = cardGuide.clientWidth || width;
  const oldHeight = cardGuide.clientHeight || height;
  
  cardGuide.style.width = `${width}px`;
  cardGuide.style.height = `${height}px`;
  cardSliderValue.innerText = `${width}px`;
  
  // Keep centered or constrained within dynamic video container bounds
  const parentWidth = video.parentElement.clientWidth || 640;
  const parentHeight = video.parentElement.clientHeight || 480;
  
  if (guideLeft === null || guideTop === null) {
    guideLeft = (parentWidth - width) / 2;
    guideTop = (parentHeight - height) / 2;
  } else {
    // Resize relative to the guide's center
    const centerX = guideLeft + oldWidth / 2;
    const centerY = guideTop + oldHeight / 2;
    guideLeft = centerX - width / 2;
    guideTop = centerY - height / 2;
  }
  
  // Keep inside parent container bounds
  guideLeft = Math.max(0, Math.min(parentWidth - width, guideLeft));
  guideTop = Math.max(0, Math.min(parentHeight - height, guideTop));
  
  cardGuide.style.left = `${guideLeft}px`;
  cardGuide.style.top = `${guideTop}px`;
}

cardSizeSlider.addEventListener("input", updateCardSize);
updateCardSize(); // Set initial size and position

// Listen for window resize/rotation on mobile to keep coordinates correct
window.addEventListener("resize", () => {
  const mode = calibrationModeSelect.value;
  if (mode === "card" || mode === "letter") {
    updateCardSize();
  }
});

// Drag-to-move behaviors for the overlay guide (supporting Mouse and Touches)
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
  
  if (e.cancelable) e.preventDefault(); // Prevent page scrolling while dragging
  
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

// Stop and clean up the active webcam stream
function stopWebcam() {
  return new Promise((resolve) => {
    webcamRunning = false;
    enableWebcamButton.innerText = "Start Webcam";
    captureButton.disabled = true;
    cardGuide.classList.add("hidden");
    
    if (webcamStream) { 
      webcamStream.getTracks().forEach(track => track.stop()); 
      webcamStream = null; 
    }
    video.srcObject = null;
    canvasCtx.clearRect(0, 0, canvasElement.width, canvasElement.height);
    resolve();
  });
}

// Start camera stream with multi-level constraint fallbacks
async function startWebcam() {
  if (!poseLandmarker || !roboflowProject) {
    alert("AI models are not fully loaded yet. Please wait.");
    return;
  }

  // Clear previous warnings/errors
  hideBanner();

  // Validate navigator.mediaDevices existence
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    showBanner(
      "error",
      "Camera Blocked: Secure Context Required",
      "Your mobile browser is blocking camera access because this page is not served over a secure (HTTPS) connection.<br><br>" +
      "Mobile browsers strictly restrict <code>getUserMedia</code> to secure origins.<br><br>" +
      "<b>How to resolve this on your phone:</b><br>" +
      "1. Deploy your app files to a secure host (e.g. GitHub Pages, Vercel, Netlify).<br>" +
      "2. Or run a secure tunnel like <b>ngrok</b> or <b>localtunnel</b> on your machine.<br>" +
      "3. Direct local IPs like <code>192.168.x.x</code> will <b>NOT</b> work on mobile."
    );
    return;
  }

  webcamRunning = true;
  enableWebcamButton.innerText = "Stop Webcam";
  captureButton.disabled = false;
  landmarkBuffer = []; // Clear buffer when webcam starts
  
  const mode = calibrationModeSelect.value;
  if (mode === "card" || mode === "letter") {
    cardGuide.classList.remove("hidden");
  }

  const selectedFacing = cameraFacingSelect.value || "user";
  
  // Try ideal high-res constraints first
  const highResConstraints = {
    video: { 
      width: { ideal: 1920 }, 
      height: { ideal: 1080 }, 
      facingMode: selectedFacing 
    }
  };

  // Standard fallback constraints if high-res fails
  const standardConstraints = {
    video: { 
      facingMode: selectedFacing 
    }
  };

  // Ultimate fallback constraints
  const genericConstraints = {
    video: true
  };

  async function tryStream(constraints, attemptNumber) {
    try {
      console.log(`Requesting camera stream (Attempt ${attemptNumber})...`);
      const stream = await navigator.mediaDevices.getUserMedia(constraints);
      webcamStream = stream;
      video.srcObject = stream;
      video.onplaying = () => {
        canvasCtx.clearRect(0, 0, canvasElement.width, canvasElement.height);
        predictWebcam(); 
      };
      console.log("Webcam stream started successfully.");
    } catch (err) {
      console.warn(`Camera attempt ${attemptNumber} failed:`, err);
      if (attemptNumber === 1) {
        // Retry with standard constraints
        await tryStream(standardConstraints, 2);
      } else if (attemptNumber === 2) {
        // Retry with basic video constraints
        await tryStream(genericConstraints, 3);
      } else {
        // All attempts failed
        console.error("All webcam stream requests failed: ", err);
        
        let errorMsg = "Could not access the camera. ";
        if (err.name === "NotAllowedError" || err.name === "PermissionDeniedError") {
          errorMsg += "<b>Permission Denied:</b> Please check your browser's camera permission settings and reload the page.";
        } else if (err.name === "NotFoundError" || err.name === "DevicesNotFoundError") {
          errorMsg += "<b>Device Not Found:</b> No camera source matching your selection was found.";
        } else {
          errorMsg += `<b>Details:</b> ${err.message || err}`;
        }
        
        showBanner("error", "Webcam Access Failed", errorMsg);
        await stopWebcam();
      }
    }
  }

  await tryStream(highResConstraints, 1);
}

// Control Toggle for Video Capture Stream
enableWebcamButton.addEventListener("click", () => {
  if (enableWebcamButton.innerText === "Retry Loading Model") {
    enableWebcamButton.disabled = true;
    enableWebcamButton.innerText = "Loading Model...";
    initializeAI();
    return;
  }

  if (webcamRunning) {
    stopWebcam();
  } else {
    startWebcam();
  }
});

// Restart camera on facing-mode source change
cameraFacingSelect.addEventListener("change", () => {
  if (webcamRunning) {
    stopWebcam().then(() => {
      startWebcam();
    });
  }
});

// Photo Capture Trigger Interface Configuration
captureButton.addEventListener("click", () => {
  let count = 3;
  landmarkBuffer = []; // Clear buffer to collect fresh frames during the countdown
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

// --- CORE MATHEMATICAL MEASUREMENT ENGINE ---
async function processSelfSnap() {
  const sl = getSmoothedLandmarks();
  if (!sl) {
    alert("MediaPipe can't see your body frame clearly. Step further back so your head and feet are visible!");
    return;
  }

  // --- STEP 0: VISIBILITY / CONFIDENCE CHECK ---
  // Warn (but don't block) if landmarks we depend on are low-confidence —
  // e.g. feet out of frame, hands occluded, ears covered by hair, etc.
  const lowConfidence = REQUIRED_LANDMARKS.filter(
    i => sl[i] && typeof sl[i].visibility === "number" && sl[i].visibility < VISIBILITY_THRESHOLD
  );
  if (lowConfidence.length > 0) {
    console.warn("Low-confidence landmarks:", lowConfidence);
    showBanner(
      "warning",
      "Some Body Points Weren't Clearly Visible",
      "For the most accurate reading, make sure your full body (head, ears, hands, and feet) " +
      "is in frame, well-lit, and not blocked by clothing, hair, or objects, then try again."
    );
  }

  try {
    const aspect = video.videoWidth / video.videoHeight;
    const mode = calibrationModeSelect.value;

    let cmPerUnitSpace;
    let calibrationSource = "Default";

    // --- STEP 1: CALIBRATE SCALE BASED ON SELECTION ---
    if (mode === "a4") {
      let paperWidthNormalized = null;
      if (roboflowProject) {
        try {
          const predictions = await roboflowProject.detect(video);
          console.log("Roboflow Detections:", predictions);

          const paperDetection = predictions.find(p => p.class === "a4" || p.class === "paper" || p.class === "document");
          if (paperDetection) {
            paperWidthNormalized = paperDetection.width / video.videoWidth;
            const realPaperWidthCm = 21.0;
            cmPerUnitSpace = realPaperWidthCm / (paperWidthNormalized * aspect);
            calibrationSource = "Roboflow AI (A4)";
            console.log(`Roboflow calibrated unit scale: ${cmPerUnitSpace.toFixed(2)} cm/unit`);
          }
        } catch (rfErr) {
          console.warn("Roboflow inference failed, falling back:", rfErr);
        }
      }

      if (!paperWidthNormalized) {
        // Fallback uses the index-finger distance, assuming the person is
        // holding the 21.0cm A4 paper sheet between their left (19) and
        // right (20) index finger knuckles.
        console.warn("Using hand-landmark estimation for paper width calibration.");
        const dxPaper = (sl[19].x - sl[20].x) * aspect;
        const dyPaper = sl[19].y - sl[20].y;
        const paperScreenDistance = Math.sqrt(dxPaper * dxPaper + dyPaper * dyPaper);
        const realPaperWidthCm = 21.0; 
        cmPerUnitSpace = realPaperWidthCm / paperScreenDistance;
        calibrationSource = "Hand Track (A4)";
      }
    } else if (mode === "card") {
      // Accounts for CSS object-fit sizing to prevent systematic scale errors
      const cardWidthPx = parseInt(cardSizeSlider.value);
      const cardWidthNormalized = getCardWidthNormalized(cardWidthPx);
      const cardScreenDistance = cardWidthNormalized * aspect;
      const realCardWidthCm = 8.56; // Standard credit card size
      cmPerUnitSpace = realCardWidthCm / cardScreenDistance;
      calibrationSource = `Card Overlay (${cardWidthPx}px)`;
    } else if (mode === "letter") {
      // Same object-fit correction for US Letter paper guide
      const cardWidthPx = parseInt(cardSizeSlider.value);
      const cardWidthNormalized = getCardWidthNormalized(cardWidthPx);
      const cardScreenDistance = cardWidthNormalized * aspect;
      const realLetterWidthCm = 27.94; // Standard US Letter width in landscape (11 inches)
      cmPerUnitSpace = realLetterWidthCm / cardScreenDistance;
      calibrationSource = `Letter Paper Overlay (${cardWidthPx}px)`;
    } else if (mode === "ipd") {
      // Interpupillary Eye Distance (IPD)
      // Landmarks 2 (left eye) and 5 (right eye)
      const dxEye = (sl[2].x - sl[5].x) * aspect;
      const dyEye = sl[2].y - sl[5].y;
      const eyeScreenDistance = Math.sqrt(dxEye * dxEye + dyEye * dyEye);
      cmPerUnitSpace = AVG_IPD_CM / eyeScreenDistance;
      calibrationSource = "Eye Distance IPD";
    }

    // --- STEP 2: MEASURE YOUR BODY SIZES IN UNITLESS SCREEN SPACE ---

    // A. Height
    // Measures to the lowest point of either foot (heel, ankle, toe) to include the sole
    const leftFootY = Math.max(sl[27].y, sl[29].y, sl[31].y);
    const rightFootY = Math.max(sl[28].y, sl[30].y, sl[32].y);
    const leftFootX = sl[29].x; // heel x
    const rightFootX = sl[30].x;

    const groundY = (leftFootY + rightFootY) / 2;
    const groundX = (leftFootX + rightFootX) / 2;

    // Top of head is anchored to ear canals (landmarks 7/8), which are pitch-stable,
    // plus a height-proportional offset for the crown of the head.
    const earY = (sl[7].y + sl[8].y) / 2;
    const earX = (sl[7].x + sl[8].x) / 2;

    const roughEarToGround = Math.abs(groundY - earY);
    const crownOffset = roughEarToGround * CROWN_ABOVE_EAR_RATIO;

    const topOfHeadY = earY - crownOffset;
    const topOfHeadX = earX;

    // Camera roll tilt correction using shoulder line (landmarks 11/12)
    const shoulderUnit = toUnitSpace(
      sl[12].x - sl[11].x,
      sl[12].y - sl[11].y,
      aspect
    );
    const rollAngle = Math.atan2(shoulderUnit.y, shoulderUnit.x);

    const topPoint = rotatePoint(toUnitSpace(topOfHeadX, topOfHeadY, aspect), -rollAngle);
    const groundPoint = rotatePoint(toUnitSpace(groundX, groundY, aspect), -rollAngle);

    const bodyScreenHeight = Math.abs(groundPoint.y - topPoint.y);

    // B. Wingspan
    // Measures between index-finger knuckles (landmarks 19/20) and includes z-axis distance
    // to correct for perspective fore-shortening if arms are angled, plus fingertip offsets.
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
        `The estimated height (${finalHeightCm.toFixed(1)} cm) or wingspan ` +
        `(${finalWingspanCm.toFixed(1)} cm) is outside the typical adult range. ` +
        "This usually means the calibration reference (card, paper, etc.) wasn't sized, " +
        "positioned, or held at the right distance, or your full body wasn't visible in frame. " +
        "Double-check your calibration setup and try capturing again."
      );
    }

    // Update frontend UI dashboard with Imperial and Metric measurements
    heightResult.innerText = `${formatToFeetAndInches(finalHeightCm)} (${finalHeightCm.toFixed(1)} cm)`;
    wingspanResult.innerText = `${formatToFeetAndInches(finalWingspanCm)} (${finalWingspanCm.toFixed(1)} cm)`;
    scaleNote.innerHTML = `Calibration Complete. Source: <b>${calibrationSource}</b> (Scale: ${cmPerUnitSpace.toFixed(1)} cm/unit).`;
    resultsCard.classList.remove("hidden");

  } catch (err) {
    console.error("Ratio Processing Error:", err);
    alert("Analysis failed.");
  }
}

// Live-rendering frame calculation engine loop
async function predictWebcam() {
  if (canvasElement.width !== video.videoWidth || canvasElement.height !== video.videoHeight) {
    canvasElement.width = video.videoWidth;
    canvasElement.height = video.videoHeight;
  }

  if (video.currentTime !== lastVideoTime && video.readyState >= 3) {
    lastVideoTime = video.currentTime;
    const timestampMs = video.currentTime * 1000;

    try {
      const frameBitmap = await createImageBitmap(video);
      const results = poseLandmarker.detectForVideo(frameBitmap, timestampMs);
      frameBitmap.close(); 

      if (results.landmarks && results.landmarks.length > 0) {
        window.latestScreenLandmarks = results.landmarks[0]; 
        
        // Push current pose landmarks into temporal rolling buffer
        landmarkBuffer.push(JSON.parse(JSON.stringify(results.landmarks[0])));
        if (landmarkBuffer.length > BUFFER_MAX_SIZE) {
          landmarkBuffer.shift();
        }
        
        canvasCtx.clearRect(0, 0, canvasElement.width, canvasElement.height);
        for (const landmark of results.landmarks) {
          drawingUtils.drawLandmarks(landmark, { radius: 4, color: "#FF0000" });
          drawingUtils.drawConnectors(landmark, PoseLandmarker.POSE_CONNECTIONS, { color: "#00FF00", lineWidth: 3 });
        }
      }
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
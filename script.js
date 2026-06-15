import {
  PoseLandmarker,
  FilesetResolver,
  DrawingUtils
} from "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.3";

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

// Converts raw metrics back to an elegant Imperial display
function formatToFeetAndInches(cm) {
  if (!cm || isNaN(cm)) return "0' 0\"";
  const totalInches = cm / 2.54;
  const feet = Math.floor(totalInches / 12);
  const inches = Math.round(totalInches % 12);
  if (inches === 12) return `${feet + 1}' 0"`;
  return `${feet}' ${inches}"`;
}

// Computes the rolling average coordinates for each landmark inside the buffer to reduce frame jitter
function getSmoothedLandmarks() {
  if (landmarkBuffer.length === 0) return window.latestScreenLandmarks;

  const numLandmarks = landmarkBuffer[0].length;
  const smoothed = [];

  for (let i = 0; i < numLandmarks; i++) {
    let sumX = 0, sumY = 0, sumZ = 0;
    landmarkBuffer.forEach(frame => {
      if (frame[i]) {
        sumX += frame[i].x;
        sumY += frame[i].y;
        sumZ += frame[i].z;
      }
    });
    smoothed.push({
      x: sumX / landmarkBuffer.length,
      y: sumY / landmarkBuffer.length,
      z: sumZ / landmarkBuffer.length
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
      "This often happens on slow network connections, if CDN access is temporarily blocked, or if served insecurely on mobile.<br>" +
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
        console.warn("Using hand-landmark estimation for paper width calibration.");
        const dxPaper = (sl[19].x - sl[20].x) * aspect;
        const dyPaper = sl[19].y - sl[20].y;
        const paperScreenDistance = Math.sqrt(dxPaper * dxPaper + dyPaper * dyPaper);
        const realPaperWidthCm = 21.0; 
        cmPerUnitSpace = realPaperWidthCm / paperScreenDistance;
        calibrationSource = "Hand Track (A4)";
      }
    } else if (mode === "card") {
      // Manual card alignment overlay
      const cardWidthPx = parseInt(cardSizeSlider.value);
      // Normalized screen space relative to the active CSS parent container width
      const activeContainerWidth = video.parentElement.clientWidth || 640;
      const cardWidthNormalized = cardWidthPx / activeContainerWidth;
      const cardScreenDistance = cardWidthNormalized * aspect;
      const realCardWidthCm = 8.56; // Standard credit card size
      cmPerUnitSpace = realCardWidthCm / cardScreenDistance;
      calibrationSource = `Card Overlay (${cardWidthPx}px)`;
    } else if (mode === "letter") {
      // Manual US Letter paper alignment overlay (Landscape: 11" wide)
      const cardWidthPx = parseInt(cardSizeSlider.value);
      // Normalized screen space relative to the active CSS parent container width
      const activeContainerWidth = video.parentElement.clientWidth || 640;
      const cardWidthNormalized = cardWidthPx / activeContainerWidth;
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
      const averageIpdCm = 6.3; // Standard average adult IPD is 6.3 cm
      cmPerUnitSpace = averageIpdCm / eyeScreenDistance;
      calibrationSource = "Eye Distance IPD";
    }

    // --- STEP 2: MEASURE YOUR BODY SIZES IN UNITLESS SCREEN SPACE ---
    const heelMidX = (sl[29].x + sl[30].x) / 2;
    const heelMidY = (sl[29].y + sl[30].y) / 2;
    
    const eyeMidY = (sl[2].y + sl[5].y) / 2;
    const noseY = sl[0].y;
    const eyeToNoseDist = Math.abs(noseY - eyeMidY);
    
    const headOffset = eyeToNoseDist * 1.3;
    const topOfHeadY = noseY - headOffset;
    const topOfHeadX = sl[0].x;

    const dxBody = (topOfHeadX - heelMidX) * aspect;
    const dyBody = heelMidY - topOfHeadY;
    const bodyScreenHeight = Math.sqrt(dxBody * dxBody + dyBody * dyBody);

    // B. Wingspan: Distance from Left Wrist (15) to Right Wrist (16)
    const dxSpan = (sl[15].x - sl[16].x) * aspect;
    const dySpan = sl[15].y - sl[16].y;
    const wingspanScreenDistance = Math.sqrt(dxSpan * dxSpan + dySpan * dySpan);

    // --- STEP 3: MULTIPLY OUT THE FINAL VALUES ---
    let finalHeightCm = bodyScreenHeight * cmPerUnitSpace;
    let finalWingspanCm = wingspanScreenDistance * cmPerUnitSpace;

    // --- STEP 4: THE FACTOR OF 2 EMERGENCY BRAKE ---
    if (finalHeightCm > 280) { 
      finalHeightCm = finalHeightCm / 2;
      finalWingspanCm = finalWingspanCm / 2;
    } else if (finalHeightCm < 100) {
      finalHeightCm = finalHeightCm * 2;
      finalWingspanCm = finalWingspanCm * 2;
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
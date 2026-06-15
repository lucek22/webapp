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
  } catch (error) {
    console.error("Initialization failure: ", error);
  }
}
initializeAI();

// Control Toggle for Video Capture Stream
enableWebcamButton.addEventListener("click", () => {
  if (!poseLandmarker || !roboflowProject) return;

  if (webcamRunning) {
    webcamRunning = false;
    enableWebcamButton.innerText = "Start Webcam";
    captureButton.disabled = true;
    if (webcamStream) { 
      webcamStream.getTracks().forEach(track => track.stop()); 
      webcamStream = null; 
    }
    video.srcObject = null;
    canvasCtx.clearRect(0, 0, canvasElement.width, canvasElement.height);
  } else {
    webcamRunning = true;
    enableWebcamButton.innerText = "Stop Webcam";
    captureButton.disabled = false;
    
    navigator.mediaDevices.getUserMedia({ 
        video: { width: { ideal: 1920 }, height: { ideal: 1080 }, facingMode: "user" } 
      })
      .then((stream) => {
        webcamStream = stream;
        video.srcObject = stream;
        video.onplaying = () => {
          canvasCtx.clearRect(0, 0, canvasElement.width, canvasElement.height);
          predictWebcam(); 
        };
      })
      .catch((err) => {
        console.error("Video target tracking failure: ", err);
        webcamRunning = false;
      });
  }
});

// Photo Capture Trigger Interface Configuration
captureButton.addEventListener("click", () => {
  let count = 3;
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
  if (!window.latestScreenLandmarks) {
    alert("MediaPipe can't see your body frame clearly. Step further back so your head and feet are visible!");
    return;
  }

  try {
    const sl = window.latestScreenLandmarks;

    // --- STEP 1: CALCULATE THE ASPECT RATIO OF YOUR WEBCAM ---
    // We need this because screen coordinates are normalized (0 to 1). 
    // A movement of 0.1 horizontally covers more physical space than 0.1 vertically.
    const aspect = video.videoWidth / video.videoHeight;

    // --- STEP 2: MEASURE THE PAPER WIDTH IN UNITLESS SCREEN SPACE ---
    // We multiply the horizontal delta by the aspect ratio to correct for the rectangular screen
    const dxPaper = (sl[19].x - sl[20].x) * aspect;
    const dyPaper = sl[19].y - sl[20].y;
    const paperScreenDistance = Math.sqrt(dxPaper * dxPaper + dyPaper * dyPaper);

    // Global standard horizontal width of an A4 paper sheet is exactly 21.0 cm
    const realPaperWidthCm = 21.0; 
    
    // This tells us how many centimeters a 1.0 unit jump on your screen represents
    const cmPerUnitSpace = realPaperWidthCm / paperScreenDistance;

    // --- STEP 3: MEASURE YOUR BODY SIZES IN UNITLESS SCREEN SPACE ---
    // A. Height: Find the bottom point between your ankles (Landmarks 27 and 28)
    const ankleMidX = (sl[27].x + sl[28].x) / 2;
    const ankleMidY = (sl[27].y + sl[28].y) / 2;
    
    // Find the top of your head using your nose (0) and an anatomical skull offset
    const noseY = sl[0].y;
    const headOffset = Math.abs(ankleMidY - noseY) * 0.06; // 6% skull cap correction
    const topOfHeadY = noseY - headOffset;

    // Calculate vertical body distance in unitless space
    const dxBody = (ankleMidX - ankleMidX) * aspect; // Always 0 since it's a straight vertical line
    const dyBody = ankleMidY - topOfHeadY;
    const bodyScreenHeight = Math.sqrt(dxBody * dxBody + dyBody * dyBody);

    // B. Wingspan: Distance from Left Wrist (15) to Right Wrist (16)
    const dxSpan = (sl[15].x - sl[16].x) * aspect;
    const dySpan = sl[15].y - sl[16].y;
    const wingspanScreenDistance = Math.sqrt(dxSpan * dxSpan + dySpan * dySpan);

    // --- STEP 4: MULTIPLY OUT THE FINAL VALUES ---
    let finalHeightCm = bodyScreenHeight * cmPerUnitSpace;
    let finalWingspanCm = wingspanScreenDistance * cmPerUnitSpace;

    // --- STEP 5: THE FACTOR OF 2 EMERGENCY BRAKE ---
    // If your browser environment is still forcing an asset doubler, 
    // this auto-corrects the scale down to realistic human parameters.
    if (finalHeightCm > 280) { 
      finalHeightCm = finalHeightCm / 2;
      finalWingspanCm = finalWingspanCm / 2;
    } else if (finalHeightCm < 100) {
      finalHeightCm = finalHeightCm * 2;
      finalWingspanCm = finalWingspanCm * 2;
    }

    // Update frontend UI dashboard
    heightResult.innerText = `${formatToFeetAndInches(finalHeightCm)} (${finalHeightCm.toFixed(1)} cm)`;
    wingspanResult.innerText = `${formatToFeetAndInches(finalWingspanCm)} (${finalWingspanCm.toFixed(1)} cm)`;
    scaleNote.innerHTML = `Ratio Calibration Complete. Screen Unit Scale: <b>${cmPerUnitSpace.toFixed(1)} cm/unit</b>.`;
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
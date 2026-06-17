window.onerror = function(message, source, lineno, colno, error) {
  showDiagnosticError(`JS Error: ${message} (Line ${lineno}:${colno})`);
  return false;
};
window.onunhandledrejection = function(event) {
  showDiagnosticError(`Unhandled Promise Rejection: ${event.reason}`);
};

function showDiagnosticError(text) {
  let banner = document.getElementById('error-diagnostic-banner');
  if (!banner) {
    banner = document.createElement('div');
    banner.id = 'error-diagnostic-banner';
    banner.style.position = 'fixed';
    banner.style.top = '10px';
    banner.style.left = '50%';
    banner.style.transform = 'translateX(-50%)';
    banner.style.backgroundColor = '#7f1d1d';
    banner.style.color = '#fca5a5';
    banner.style.border = '2px solid #ef4444';
    banner.style.padding = '0.75rem 1.5rem';
    banner.style.borderRadius = '8px';
    banner.style.fontSize = '0.85rem';
    banner.style.fontWeight = 'bold';
    banner.style.zIndex = '9999';
    banner.style.boxShadow = '0 10px 25px rgba(0,0,0,0.5)';
    banner.style.maxWidth = '90%';
    banner.style.textAlign = 'left';
    banner.style.display = 'flex';
    banner.style.flexDirection = 'column';
    banner.style.gap = '0.5rem';
    
    const header = document.createElement('div');
    header.style.display = 'flex';
    header.style.justifyContent = 'space-between';
    header.style.alignItems = 'center';
    header.innerHTML = `
      <span>⚠️ SYSTEM DIAGNOSTIC ERROR DETECTED</span>
      <button onclick="this.parentElement.parentElement.remove()" style="background: none; border: none; color: #fca5a5; font-size: 1.15rem; cursor: pointer; padding: 0 0 0 1rem; line-height: 1;">&times;</button>
    `;
    banner.appendChild(header);
    
    const body = document.createElement('div');
    body.id = 'error-diagnostic-body';
    body.style.fontFamily = 'monospace';
    body.style.whiteSpace = 'pre-wrap';
    body.style.wordBreak = 'break-all';
    banner.appendChild(body);
    
    document.body.appendChild(banner);
  }
  
  const body = document.getElementById('error-diagnostic-body');
  if (body) {
    body.innerText = text + '\n\n💡 Try reloading the page, using Safari/Chrome on Mac, and running via http://localhost:8000.';
  }
}

const videoElement = document.getElementById('webcam');
const canvasElement = document.getElementById('overlay');
const canvasCtx = canvasElement.getContext('2d');
const startButton = document.getElementById('start-btn');
const yoloToggleBtn = document.getElementById('yolo-toggle-btn');
const captureBtn = document.getElementById('capture-btn');
const statusElement = document.getElementById('status');
let yoloModeActive = false;
let frameCount = 0;

const LANDMARK_NAMES = [
  "Nose", "L Eye Inner", "L Eye", "L Eye Outer", "R Eye Inner", "R Eye", "R Eye Outer",
  "L Ear", "R Ear", "Mouth Left", "Mouth Right", "L Shoulder", "R Shoulder",
  "L Elbow", "R Elbow", "L Wrist", "R Wrist", "L Pinky", "R Pinky",
  "L Index", "R Index", "L Thumb", "R Thumb", "L Hip", "R Hip",
  "L Knee", "R Knee", "L Ankle", "R Ankle", "L Heel", "R Heel",
  "L Foot Index", "R Foot Index"
];

// 3-second Countdown & Capture visual states
let countdownValue = 0;
let isCountingDown = false;
let flashOpacity = 0;

// 5-second Capture Snapshot & Freeze frame states
let isCaptureCountingDown = false;
let captureCountdownValue = 0;
let isSnapshotFrozen = false;
let frozenJoints = null;
let frozenMetrics = null;

// Helper canvas for caching frozen frames
const frozenFrameCanvas = document.createElement('canvas');
frozenFrameCanvas.width = 640;
frozenFrameCanvas.height = 480;
const frozenFrameCtx = frozenFrameCanvas.getContext('2d');

const slider = document.getElementById('box-slider');
const sliderValDisplay = document.getElementById('slider-val');
const lockCalButton = document.getElementById('lock-cal-btn');
const landmarkDirectory = document.getElementById('landmark-directory');

// Initialize Landmark Directory (33 Pose Landmarks + 10 Hand Fingertips) on load
if (landmarkDirectory) {
  LANDMARK_NAMES.forEach((name, idx) => {
    const item = document.createElement('div');
    item.style.display = 'flex';
    item.style.justify = 'space-between';
    item.style.alignItems = 'center';
    item.style.fontSize = '0.68rem';
    item.style.padding = '0.2rem 0.4rem';
    item.style.backgroundColor = 'rgba(255, 255, 255, 0.02)';
    item.style.borderRadius = '4px';
    item.style.borderLeft = '2.5px solid #1e293b';
    
    let sideColor = '#9ca3af'; // default face/neutral
    if (idx <= 10) {
      sideColor = '#ec4899'; // face
      item.style.borderLeftColor = sideColor;
    } else if (idx === 11 || idx === 13 || idx === 15 || idx === 17 || idx === 19 || idx === 21) {
      sideColor = '#06b6d4'; // left arm
      item.style.borderLeftColor = sideColor;
    } else if (idx === 12 || idx === 14 || idx === 16 || idx === 18 || idx === 20 || idx === 22) {
      sideColor = '#a855f7'; // right arm
      item.style.borderLeftColor = sideColor;
    } else if (idx === 23 || idx === 25 || idx === 27 || idx === 29 || idx === 31) {
      sideColor = '#10b981'; // left leg
      item.style.borderLeftColor = sideColor;
    } else if (idx === 24 || idx === 26 || idx === 28 || idx === 30 || idx === 32) {
      sideColor = '#f59e0b'; // right leg
      item.style.borderLeftColor = sideColor;
    }

    item.innerHTML = `
      <span style="color: ${sideColor}; font-weight: 600;">#${idx} ${name}</span>
      <span id="lm-status-${idx}" style="color: #64748b; font-family: monospace; font-size: 0.62rem;">Offline</span>
    `;
    landmarkDirectory.appendChild(item);
  });

  // Append Left Hand Fingertips
  const handFingersL = [
    { name: 'Thumb Tip', color: '#ec4899', id: 'val-fingertip-l-0' },
    { name: 'Index Tip', color: '#06b6d4', id: 'val-fingertip-l-1' },
    { name: 'Middle Tip', color: '#a855f7', id: 'val-fingertip-l-2' },
    { name: 'Ring Tip', color: '#10b981', id: 'val-fingertip-l-3' },
    { name: 'Pinky Tip', color: '#f59e0b', id: 'val-fingertip-l-4' }
  ];

  handFingersL.forEach(f => {
    const item = document.createElement('div');
    item.style.display = 'flex';
    item.style.justify = 'space-between';
    item.style.alignItems = 'center';
    item.style.fontSize = '0.68rem';
    item.style.padding = '0.2rem 0.4rem';
    item.style.backgroundColor = 'rgba(255, 255, 255, 0.02)';
    item.style.borderRadius = '4px';
    item.style.borderLeft = `2.5px solid ${f.color}`;
    
    item.innerHTML = `
      <span style="color: ${f.color}; font-weight: 600;">Left ${f.name}</span>
      <span id="${f.id}" style="color: #64748b; font-family: monospace; font-size: 0.62rem;">Offline</span>
    `;
    landmarkDirectory.appendChild(item);
  });

  // Append Right Hand Fingertips
  const handFingersR = [
    { name: 'Thumb Tip', color: '#ec4899', id: 'val-fingertip-r-0' },
    { name: 'Index Tip', color: '#06b6d4', id: 'val-fingertip-r-1' },
    { name: 'Middle Tip', color: '#a855f7', id: 'val-fingertip-r-2' },
    { name: 'Ring Tip', color: '#10b981', id: 'val-fingertip-r-3' },
    { name: 'Pinky Tip', color: '#f59e0b', id: 'val-fingertip-r-4' }
  ];

  handFingersR.forEach(f => {
    const item = document.createElement('div');
    item.style.display = 'flex';
    item.style.justify = 'space-between';
    item.style.alignItems = 'center';
    item.style.fontSize = '0.68rem';
    item.style.padding = '0.2rem 0.4rem';
    item.style.backgroundColor = 'rgba(255, 255, 255, 0.02)';
    item.style.borderRadius = '4px';
    item.style.borderLeft = `2.5px solid ${f.color}`;
    
    item.innerHTML = `
      <span style="color: ${f.color}; font-weight: 600;">Right ${f.name}</span>
      <span id="${f.id}" style="color: #64748b; font-family: monospace; font-size: 0.62rem;">Offline</span>
    `;
    landmarkDirectory.appendChild(item);
  });
}

// UI Metric Elements (LEFT)
const thighLDisp = document.getElementById('val-thigh-l');
const shinLDisp = document.getElementById('val-shin-l');
const footLDisp = document.getElementById('val-foot-l');
const torsoLDisp = document.getElementById('val-torso-l');
const upperarmLDisp = document.getElementById('val-upperarm-l');
const forearmLDisp = document.getElementById('val-forearm-l');

// UI Metric Elements (RIGHT)
const thighRDisp = document.getElementById('val-thigh-r');
const shinRDisp = document.getElementById('val-shin-r');
const footRDisp = document.getElementById('val-foot-r');
const torsoRDisp = document.getElementById('val-torso-r');
const upperarmRDisp = document.getElementById('val-upperarm-r');
const forearmRDisp = document.getElementById('val-forearm-r');

// Widths & Other
const shoulderWDisp = document.getElementById('val-shoulder-w');
const hipWDisp = document.getElementById('val-hip-w');
const heightCmDisp = document.getElementById('val-height-cm');
const heightFtDisp = document.getElementById('val-height-ft');

// UI Angle Elements (Left vs Right)
const kneeAngleLDisp = document.getElementById('angle-knee-l');
const kneeAngleRDisp = document.getElementById('angle-knee-r');
const hipAngleLDisp = document.getElementById('angle-hip-l');
const hipAngleRDisp = document.getElementById('angle-hip-r');
const elbowAngleLDisp = document.getElementById('angle-elbow-l');
const elbowAngleRDisp = document.getElementById('angle-elbow-r');

// UI Hand Tracking Elements
const handStatusLDisp = document.getElementById('hand-status-l');
const handStatusRDisp = document.getElementById('hand-status-r');
const pinchLDisp = document.getElementById('val-pinch-l');
const pinchRDisp = document.getElementById('val-pinch-r');
const spanLDisp = document.getElementById('val-span-l');
const spanRDisp = document.getElementById('val-span-r');

const fingertipLDisps = [
  document.getElementById('val-fingertip-l-0'),
  document.getElementById('val-fingertip-l-1'),
  document.getElementById('val-fingertip-l-2'),
  document.getElementById('val-fingertip-l-3'),
  document.getElementById('val-fingertip-l-4')
];

const fingertipRDisps = [
  document.getElementById('val-fingertip-r-0'),
  document.getElementById('val-fingertip-r-1'),
  document.getElementById('val-fingertip-r-2'),
  document.getElementById('val-fingertip-r-3'),
  document.getElementById('val-fingertip-r-4')
];

canvasElement.width = 640;
canvasElement.height = 480;

// Joint indices mapping
const LEFT_SHOULDER = 11;
const RIGHT_SHOULDER = 12;
const LEFT_ELBOW = 13;
const RIGHT_ELBOW = 14;
const LEFT_WRIST = 15;
const RIGHT_WRIST = 16;
const LEFT_HIP = 23;
const RIGHT_HIP = 24;
const LEFT_KNEE = 25;
const RIGHT_KNEE = 26;
const LEFT_ANKLE = 27;
const RIGHT_ANKLE = 28;
const LEFT_HEEL = 29;
const RIGHT_HEEL = 30;
const LEFT_FOOT_INDEX = 31; // Toe index
const RIGHT_FOOT_INDEX = 32;

// Calibration details
const MARKER_PHYSICAL_SIZE_CM = 20.0; 
let calBoxSize = 150;
let calBoxX = 320; // Center X (640 / 2)
let calBoxY = 240; // Center Y (480 / 2)
let pixelsPerCm = null; // Set to null by default so everything relies strictly on calculations!
let calLocked = false;
let lastVerticalHeightPx = 0; // Updated in pose loop
let lastSkeletalHeightPx = 0; // Posture-independent skeletal stature
let latestArucoMarker = null;
let latestHandResults = null;
let frozenHandResults = null;

slider.addEventListener('input', (e) => {
  calBoxSize = parseInt(e.target.value);
  sliderValDisplay.textContent = `${calBoxSize} px`;
  if (calLocked) {
    calLocked = false;
    lockCalButton.textContent = "Lock 20cm Calibration";
    lockCalButton.style.backgroundColor = '#10b981';
  }
});

lockCalButton.addEventListener('click', () => {
  pixelsPerCm = calBoxSize / MARKER_PHYSICAL_SIZE_CM;
  calLocked = true;
  lockCalButton.textContent = "✅ Scale Locked!";
  lockCalButton.style.backgroundColor = '#059669';
  statusElement.textContent = `Scale calibrated: ${pixelsPerCm.toFixed(2)} px/cm.`;
});

// Preset Position buttons
const posLeftBtn = document.getElementById('pos-left-btn');
const posCenterBtn = document.getElementById('pos-center-btn');
const posRightBtn = document.getElementById('pos-right-btn');

function updatePosBtnStyles(activeBtn) {
  [posLeftBtn, posCenterBtn, posRightBtn].forEach(btn => {
    btn.style.backgroundColor = (btn === activeBtn) ? '#3b82f6' : '#1e293b';
  });
}

posLeftBtn.addEventListener('click', () => {
  calBoxX = 100;
  calBoxY = 240;
  updatePosBtnStyles(posLeftBtn);
});

posCenterBtn.addEventListener('click', () => {
  calBoxX = 320;
  calBoxY = 240;
  updatePosBtnStyles(posCenterBtn);
});

posRightBtn.addEventListener('click', () => {
  calBoxX = 540;
  calBoxY = 240;
  updatePosBtnStyles(posRightBtn);
});

// Mouse/Touch Drag and Drop positioning logic for the calibration box
let isDragging = false;
let dragStartX = 0;
let dragStartY = 0;

canvasElement.addEventListener('mousedown', (e) => {
  const rect = canvasElement.getBoundingClientRect();
  const mouseX = e.clientX - rect.left;
  const mouseY = e.clientY - rect.top;
  
  // Directly map coordinates (canvas is no longer mirrored in CSS)
  const canvasMouseX = (mouseX / rect.width) * 640;
  const canvasMouseY = (mouseY / rect.height) * 480;
  
  const x1 = calBoxX - calBoxSize / 2;
  const y1 = calBoxY - calBoxSize / 2;
  const x2 = calBoxX + calBoxSize / 2;
  const y2 = calBoxY + calBoxSize / 2;
  
  if (canvasMouseX >= x1 - 15 && canvasMouseX <= x2 + 15 && canvasMouseY >= y1 - 15 && canvasMouseY <= y2 + 15) {
    isDragging = true;
    dragStartX = canvasMouseX - calBoxX;
    dragStartY = canvasMouseY - calBoxY;
  }
});

canvasElement.addEventListener('mousemove', (e) => {
  const rect = canvasElement.getBoundingClientRect();
  const mouseX = e.clientX - rect.left;
  const mouseY = e.clientY - rect.top;
  
  const canvasMouseX = (mouseX / rect.width) * 640;
  const canvasMouseY = (mouseY / rect.height) * 480;
  
  const x1 = calBoxX - calBoxSize / 2;
  const y1 = calBoxY - calBoxSize / 2;
  const x2 = calBoxX + calBoxSize / 2;
  const y2 = calBoxY + calBoxSize / 2;
  
  if (canvasMouseX >= x1 - 15 && canvasMouseX <= x2 + 15 && canvasMouseY >= y1 - 15 && canvasMouseY <= y2 + 15) {
    canvasElement.style.cursor = 'move';
  } else {
    if (!isDragging) {
      canvasElement.style.cursor = 'default';
    }
  }
  
  if (isDragging) {
    calBoxX = Math.max(calBoxSize/2, Math.min(640 - calBoxSize/2, canvasMouseX - dragStartX));
    calBoxY = Math.max(calBoxSize/2, Math.min(480 - calBoxSize/2, canvasMouseY - dragStartY));
  }
});

window.addEventListener('mouseup', () => {
  isDragging = false;
});

// Touch support for dragging
canvasElement.addEventListener('touchstart', (e) => {
  if (e.touches.length === 1) {
    const rect = canvasElement.getBoundingClientRect();
    const touch = e.touches[0];
    const mouseX = touch.clientX - rect.left;
    const mouseY = touch.clientY - rect.top;
    
    const canvasMouseX = (mouseX / rect.width) * 640;
    const canvasMouseY = (mouseY / rect.height) * 480;
    
    const x1 = calBoxX - calBoxSize / 2;
    const y1 = calBoxY - calBoxSize / 2;
    const x2 = calBoxX + calBoxSize / 2;
    const y2 = calBoxY + calBoxSize / 2;
    
    if (canvasMouseX >= x1 - 15 && canvasMouseX <= x2 + 15 && canvasMouseY >= y1 - 15 && canvasMouseY <= y2 + 15) {
      isDragging = true;
      dragStartX = canvasMouseX - calBoxX;
      dragStartY = canvasMouseY - calBoxY;
      e.preventDefault();
    }
  }
});

canvasElement.addEventListener('touchmove', (e) => {
  if (isDragging && e.touches.length === 1) {
    const rect = canvasElement.getBoundingClientRect();
    const touch = e.touches[0];
    const mouseX = touch.clientX - rect.left;
    const mouseY = touch.clientY - rect.top;
    
    const canvasMouseX = (mouseX / rect.width) * 640;
    const canvasMouseY = (mouseY / rect.height) * 480;
    
    calBoxX = Math.max(calBoxSize/2, Math.min(640 - calBoxSize/2, canvasMouseX - dragStartX));
    calBoxY = Math.max(calBoxSize/2, Math.min(480 - calBoxSize/2, canvasMouseY - dragStartY));
    e.preventDefault();
  }
});

window.addEventListener('touchend', () => {
  isDragging = false;
});

// ==========================================
// MULTI-UNIT SYSTEM (INCHES BY DEFAULT)
// ==========================================
let useInches = true;
const unitInchBtn = document.getElementById('unit-inch-btn');
const unitCmBtn = document.getElementById('unit-cm-btn');
const heightInputLabel = document.querySelector('label[for="input-user-height"]');
const inputUserHeight = document.getElementById('input-user-height');

function formatLength(cmVal) {
  if (useInches) {
    return `${(cmVal / 2.54).toFixed(1)} in`;
  } else {
    return `${cmVal.toFixed(1)} cm`;
  }
}

function updateHeightInputUnit() {
  if (useInches) {
    heightInputLabel.textContent = "Your Height (inches):";
    const val = parseFloat(inputUserHeight.value);
    if (val > 100) { // If it was in cm, convert to inches
      inputUserHeight.value = (val / 2.54).toFixed(1);
    } else if (isNaN(val)) {
      inputUserHeight.value = "68.9";
    }
  } else {
    heightInputLabel.textContent = "Your Height (cm):";
    const val = parseFloat(inputUserHeight.value);
    if (val < 100) { // If it was in inches, convert to cm
      inputUserHeight.value = (val * 2.54).toFixed(1);
    } else if (isNaN(val)) {
      inputUserHeight.value = "175.0";
    }
  }
}

unitInchBtn.addEventListener('click', () => {
  useInches = true;
  unitInchBtn.style.backgroundColor = '#3b82f6';
  unitInchBtn.style.color = 'white';
  unitCmBtn.style.backgroundColor = 'transparent';
  unitCmBtn.style.color = '#9ca3af';
  updateHeightInputUnit();
  if (isSnapshotFrozen && frozenMetrics) {
    renderDashboard(frozenMetrics);
  }
});

unitCmBtn.addEventListener('click', () => {
  useInches = false;
  unitCmBtn.style.backgroundColor = '#3b82f6';
  unitCmBtn.style.color = 'white';
  unitInchBtn.style.backgroundColor = 'transparent';
  unitInchBtn.style.color = '#9ca3af';
  updateHeightInputUnit();
  if (isSnapshotFrozen && frozenMetrics) {
    renderDashboard(frozenMetrics);
  }
});

// ==========================================
// COMPUTER VISION: ARUCO MARKER SETUP
// ==========================================
let arucoDetector = null;
if (typeof AR !== 'undefined') {
  try {
    // Register standard OpenCV DICT_4X4_50 ID 0 (16 bits)
    AR.DICTIONARIES.DICT_4X4_50 = {
      nBits: 16,
      tau: 1,
      codeList: [0xb532] // ID 0 canonical 4x4 representation
    };
    arucoDetector = new AR.Detector({ dictionaryName: 'DICT_4X4_50' });
  } catch (e) {
    console.warn("Failed to initialize custom ArUco dictionary:", e);
  }
} else {
  console.warn("ArUco library (AR) is not loaded. Auto-calibration will be unavailable.");
}
const offscreenCanvas = document.createElement('canvas');
offscreenCanvas.width = 640;
offscreenCanvas.height = 480;
const offscreenCtx = offscreenCanvas.getContext('2d');

// ==========================================
// 3-WAY CALIBRATION SWITCHER & UI CONTROL
// ==========================================
const tabArucoBtn = document.getElementById('tab-aruco-btn');
const tabCardBtn = document.getElementById('tab-card-btn');
const tabHeightBtn = document.getElementById('tab-height-btn');

const panelAruco = document.getElementById('panel-aruco');
const panelCard = document.getElementById('panel-card');
const panelHeight = document.getElementById('panel-height');
const arucoStatusText = document.getElementById('aruco-status-text');

let activeCalMethod = 'aruco'; // 'aruco', 'card', or 'height'

function switchCalibrationTab(method, activeBtn, activePanel) {
  activeCalMethod = method;
  
  // Update buttons background
  [tabArucoBtn, tabCardBtn, tabHeightBtn].forEach(btn => {
    btn.style.backgroundColor = (btn === activeBtn) ? '#3b82f6' : '#1e293b';
  });

  // Show/Hide panels
  [panelAruco, panelCard, panelHeight].forEach(panel => {
    panel.style.display = (panel === activePanel) ? 'flex' : 'none';
  });

  // Clear lock on switch if transitioning away from manual/height
  if (method !== 'aruco' && calLocked) {
    // Keep pixelsPerCm but allow recalibration
    if (method === 'card') {
      lockCalButton.textContent = "Lock 20cm Calibration";
      lockCalButton.style.backgroundColor = '#10b981';
      calLocked = false;
    }
  }
}

tabArucoBtn.addEventListener('click', () => {
  switchCalibrationTab('aruco', tabArucoBtn, panelAruco);
});

tabCardBtn.addEventListener('click', () => {
  switchCalibrationTab('card', tabCardBtn, panelCard);
});

tabHeightBtn.addEventListener('click', () => {
  switchCalibrationTab('height', tabHeightBtn, panelHeight);
});

const heightCalBtn = document.getElementById('height-cal-btn');

// Camera Flash animation trigger
function triggerFlashEffect() {
  flashOpacity = 0.85;
  const fadeInterval = setInterval(() => {
    flashOpacity -= 0.08;
    if (flashOpacity <= 0) {
      flashOpacity = 0;
      clearInterval(fadeInterval);
    }
  }, 30);
}

heightCalBtn.addEventListener('click', () => {
  if (isCountingDown || isCaptureCountingDown) return; // Prevent clicks during active countdowns

  const activeHeightPx = lastSkeletalHeightPx > 10 ? lastSkeletalHeightPx : lastVerticalHeightPx;
  if (activeHeightPx > 10) {
    // Start 3-second countdown
    isCountingDown = true;
    countdownValue = 3;
    heightCalBtn.textContent = "Get in Position (3s)...";
    heightCalBtn.style.backgroundColor = '#d97706'; // warning orange
    statusElement.textContent = "Stand straight and face the camera. Calibrating in 3 seconds...";

    const intervalId = setInterval(() => {
      countdownValue--;
      if (countdownValue > 0) {
        heightCalBtn.textContent = `Get in Position (${countdownValue}s)...`;
        statusElement.textContent = `Stand straight and face the camera. Calibrating in ${countdownValue} seconds...`;
      } else {
        clearInterval(intervalId);
        isCountingDown = false;

        // Recalculate pixel height at the exact end of countdown
        const captureHeightPx = lastSkeletalHeightPx > 10 ? lastSkeletalHeightPx : lastVerticalHeightPx;
        const inputVal = parseFloat(inputUserHeight.value) || (useInches ? 68.9 : 175.0);
        let actualHeightCm = inputVal;
        if (useInches) {
          actualHeightCm = inputVal * 2.54; // Convert to cm for calibration scale factor
        }

        pixelsPerCm = captureHeightPx / actualHeightCm;
        calLocked = true;
        heightCalBtn.textContent = "✅ Calibrated!";
        heightCalBtn.style.backgroundColor = '#059669';
        statusElement.textContent = `Skeletal-calibrated scale locked: ${pixelsPerCm.toFixed(2)} px/cm.`;
        
        // Trigger camera snapshot visual flash!
        triggerFlashEffect();
      }
    }, 1000);
  } else {
    alert("Please click 'Start Biomechanical Tracking' and stand in view of the camera first!");
  }
});

// MediaPipe Pose Setup
const pose = new Pose({
  locateFile: (file) => {
    return `https://cdn.jsdelivr.net/npm/@mediapipe/pose/${file}`;
  }
});

// Configure Pose options (with built-in neural segmentation mask for background isolation)
pose.setOptions({
  modelComplexity: 1,
  smoothLandmarks: true,
  enableSegmentation: true,
  minDetectionConfidence: 0.5,
  minTrackingConfidence: 0.5
});

// MediaPipe Hands Setup
const hands = new Hands({
  locateFile: (file) => {
    return `https://cdn.jsdelivr.net/npm/@mediapipe/hands/${file}`;
  }
});

hands.setOptions({
  maxNumHands: 2,
  modelComplexity: 1,
  minDetectionConfidence: 0.5,
  minTrackingConfidence: 0.5
});

hands.onResults((results) => {
  latestHandResults = results;
  updateHandTracking(results);
  
  if (!isSnapshotFrozen) {
    drawHandMesh(results.multiHandLandmarks, results.multiHandedness);
  }
});

// YOLO-style background isolation click handler
yoloToggleBtn.addEventListener('click', () => {
  yoloModeActive = !yoloModeActive;
  if (yoloModeActive) {
    yoloToggleBtn.textContent = "Disable YOLO Background Isolation";
    yoloToggleBtn.style.backgroundColor = 'rgba(6, 182, 212, 0.15)';
    yoloToggleBtn.style.borderColor = '#06b6d4';
    yoloToggleBtn.style.color = '#06b6d4';
    
    // Hide standard video underneath so canvas can show the background cutout
    videoElement.style.opacity = '0.05'; 
  } else {
    yoloToggleBtn.textContent = "Enable YOLO Background Isolation";
    yoloToggleBtn.style.backgroundColor = '#0f1626';
    yoloToggleBtn.style.borderColor = 'rgba(6, 182, 212, 0.4)';
    yoloToggleBtn.style.color = '#06b6d4';
    
    // Restore standard video opacity
    videoElement.style.opacity = '1';
  }
});

// Smooth buffers for precise, jitter-free biomechanics
const smoothBuffers = {};
function smooth(key, val) {
  if (!smoothBuffers[key]) smoothBuffers[key] = [];
  const buf = smoothBuffers[key];
  buf.push(val);
  if (buf.length > 15) buf.shift();
  return buf.reduce((a, b) => a + b, 0) / buf.length;
}

// Mathematical Angle Calculator (in degrees)
function calculateAngle(p_vertex, p_arm1, p_arm2) {
  const v1 = { x: p_arm1.x - p_vertex.x, y: p_arm1.y - p_vertex.y };
  const v2 = { x: p_arm2.x - p_vertex.x, y: p_arm2.y - p_vertex.y };
  
  const dotProduct = v1.x * v2.x + v1.y * v2.y;
  const mag1 = Math.hypot(v1.x, v1.y);
  const mag2 = Math.hypot(v2.x, v2.y);
  
  if (mag1 === 0 || mag2 === 0) return 0;
  
  const cosTheta = dotProduct / (mag1 * mag2);
  // Clamp to prevent floating point domain errors
  const clampedCos = Math.max(-1, Math.min(1, cosTheta));
  return Math.round(Math.acos(clampedCos) * (180 / Math.PI));
}

pose.onResults((results) => {
  canvasCtx.save();
  canvasCtx.clearRect(0, 0, canvasElement.width, canvasElement.height);

  // YOLO-style Background Masking
  if (results.segmentationMask && yoloModeActive) {
    canvasCtx.drawImage(results.segmentationMask, 0, 0, canvasElement.width, canvasElement.height);
    canvasCtx.globalCompositeOperation = 'source-in';
    canvasCtx.drawImage(results.image, 0, 0, canvasElement.width, canvasElement.height);
    canvasCtx.globalCompositeOperation = 'source-over';
  }

  // Draw ArUco box overlay if detected and active tab is 'aruco'
  if (latestArucoMarker && activeCalMethod === 'aruco') {
    const corners = latestArucoMarker.corners.map(c => ({ x: 640 - c.x, y: c.y }));
    canvasCtx.beginPath();
    canvasCtx.moveTo(corners[0].x, corners[0].y);
    canvasCtx.lineTo(corners[1].x, corners[1].y);
    canvasCtx.lineTo(corners[2].x, corners[2].y);
    canvasCtx.lineTo(corners[3].x, corners[3].y);
    canvasCtx.closePath();
    canvasCtx.strokeStyle = '#10b981';
    canvasCtx.lineWidth = 3.5;
    canvasCtx.stroke();

    canvasCtx.fillStyle = 'rgba(16, 185, 129, 0.15)';
    canvasCtx.fill();

    canvasCtx.fillStyle = '#10b981';
    canvasCtx.font = 'bold 11px sans-serif';
    canvasCtx.fillText(`ARUCO ID 0 DETECTED (${formatLength(20.0)})`, corners[0].x, corners[0].y - 8);
  }

  // 1. Draw Direct Card Calibration Guide Box (only if activeCalMethod is 'card')
  if (activeCalMethod === 'card') {
    const x1 = calBoxX - calBoxSize / 2;
    const y1 = calBoxY - calBoxSize / 2;
    
    canvasCtx.beginPath();
    canvasCtx.rect(x1, y1, calBoxSize, calBoxSize);
    canvasCtx.strokeStyle = calLocked ? '#10b981' : '#ec4899'; 
    canvasCtx.lineWidth = 3;
    if (!calLocked) canvasCtx.setLineDash([6, 4]);
    canvasCtx.stroke();
    canvasCtx.setLineDash([]); 

    // Calibration box label
    canvasCtx.fillStyle = calLocked ? '#10b981' : '#ec4899';
    canvasCtx.font = 'bold 11px sans-serif';
    canvasCtx.fillText(calLocked ? "SCARLET CALIBRATION LOCKED" : "ALIGN PRINTED 200mm SQUARE IN BOX", x1 + 5, y1 - 8);
  }

  // 2. Extract and Map landmarks
  if (results.poseLandmarks) {
    const lm = results.poseLandmarks;

    // Update Landmark Directory status in a throttled way to maintain 60 FPS
    frameCount++;
    if (frameCount % 10 === 0) {
      LANDMARK_NAMES.forEach((name, idx) => {
        const statusSpan = document.getElementById(`lm-status-${idx}`);
        if (statusSpan) {
          const landmark = lm[idx];
          if (landmark && landmark.visibility > 0.5) {
            statusSpan.textContent = "Online";
            statusSpan.style.color = "#10b981"; // neon emerald
          } else if (landmark) {
            statusSpan.textContent = "Low Vis";
            statusSpan.style.color = "#f59e0b"; // neon amber
          } else {
            statusSpan.textContent = "Offline";
            statusSpan.style.color = "#64748b";
          }
        }
      });
    }

    // Helper to mirror X coordinate for canvas drawing
    const mirrorX = (normX) => (1.0 - normX) * 640;

    // Resolve normalized coordinates to pixels (LEFT)
    const shoulder_l = { x: mirrorX(lm[LEFT_SHOULDER].x), y: lm[LEFT_SHOULDER].y * 480 };
    const elbow_l = { x: mirrorX(lm[LEFT_ELBOW].x), y: lm[LEFT_ELBOW].y * 480 };
    const wrist_l = { x: mirrorX(lm[LEFT_WRIST].x), y: lm[LEFT_WRIST].y * 480 };
    const hip_l = { x: mirrorX(lm[LEFT_HIP].x), y: lm[LEFT_HIP].y * 480 };
    const knee_l = { x: mirrorX(lm[LEFT_KNEE].x), y: lm[LEFT_KNEE].y * 480 };
    const ankle_l = { x: mirrorX(lm[LEFT_ANKLE].x), y: lm[LEFT_ANKLE].y * 480 };
    const heel_l = { x: mirrorX(lm[LEFT_HEEL].x), y: lm[LEFT_HEEL].y * 480 };
    const toe_l = { x: mirrorX(lm[LEFT_FOOT_INDEX].x), y: lm[LEFT_FOOT_INDEX].y * 480 };

    // Resolve normalized coordinates to pixels (RIGHT)
    const shoulder_r = { x: mirrorX(lm[RIGHT_SHOULDER].x), y: lm[RIGHT_SHOULDER].y * 480 };
    const elbow_r = { x: mirrorX(lm[RIGHT_ELBOW].x), y: lm[RIGHT_ELBOW].y * 480 };
    const wrist_r = { x: mirrorX(lm[RIGHT_WRIST].x), y: lm[RIGHT_WRIST].y * 480 };
    const hip_r = { x: mirrorX(lm[RIGHT_HIP].x), y: lm[RIGHT_HIP].y * 480 };
    const knee_r = { x: mirrorX(lm[RIGHT_KNEE].x), y: lm[RIGHT_KNEE].y * 480 };
    const ankle_r = { x: mirrorX(lm[RIGHT_ANKLE].x), y: lm[RIGHT_ANKLE].y * 480 };
    const heel_r = { x: mirrorX(lm[RIGHT_HEEL].x), y: lm[RIGHT_HEEL].y * 480 };
    const toe_r = { x: mirrorX(lm[RIGHT_FOOT_INDEX].x), y: lm[RIGHT_FOOT_INDEX].y * 480 };

    // --- CALCULATE HEAD TOP ---
    const shoulder_mid = {
      x: (shoulder_l.x + shoulder_r.x) / 2,
      y: (shoulder_l.y + shoulder_r.y) / 2
    };
    const ear_mid = {
      x: (mirrorX(lm[7].x) + mirrorX(lm[8].x)) / 2,
      y: (lm[7].y * 480 + lm[8].y * 480) / 2
    };
    // The top of the head (crown) is approximately 65% of the shoulder-to-ear neck height above the ear level
    const shoulder_to_ear_px = Math.abs(shoulder_mid.y - ear_mid.y);
    const head_top = {
      x: ear_mid.x,
      y: ear_mid.y - (shoulder_to_ear_px * 0.65)
    };

    const all_landmarks = lm.map(l => ({ x: mirrorX(l.x), y: l.y * 480 }));

    // Draw the full 33 MediaPipe pose landmarks skeletal mesh
    drawFullSkeletalMesh(all_landmarks);

    // --- DRAW NEON SKELETAL MARKERS ---
    // Shoulder and Hip spans
    drawBone(shoulder_l, shoulder_r, '#6366f1'); 
    drawBone(hip_l, hip_r, '#6366f1'); 
    
    // Torso Lines
    drawBone(shoulder_l, hip_l, '#38bdf8'); 
    drawBone(shoulder_r, hip_r, '#38bdf8'); 

    // Left Arm & Leg
    drawBone(shoulder_l, elbow_l, '#ec4899'); 
    drawBone(elbow_l, wrist_l, '#f43f5e'); 
    drawBone(hip_l, knee_l, '#a855f7'); 
    drawBone(knee_l, ankle_l, '#06b6d4'); 
    drawBone(ankle_l, heel_l, '#10b981'); 
    drawBone(heel_l, toe_l, '#10b981'); 

    // Right Arm & Leg
    drawBone(shoulder_r, elbow_r, '#ec4899'); 
    drawBone(elbow_r, wrist_r, '#f43f5e'); 
    drawBone(hip_r, knee_r, '#a855f7'); 
    drawBone(knee_r, ankle_r, '#06b6d4'); 
    drawBone(ankle_r, heel_r, '#10b981'); 
    drawBone(heel_r, toe_r, '#10b981'); 

    // Joint Nodes
    drawJoint(shoulder_l, '#6366f1');
    drawJoint(shoulder_r, '#6366f1');
    drawJoint(elbow_l, '#d946ef');
    drawJoint(elbow_r, '#d946ef');
    drawJoint(wrist_l, '#f43f5e');
    drawJoint(wrist_r, '#f43f5e');
    drawJoint(hip_l, '#a855f7');
    drawJoint(hip_r, '#a855f7');
    drawJoint(knee_l, '#10b981');
    drawJoint(knee_r, '#10b981');
    drawJoint(ankle_l, '#06b6d4');
    drawJoint(ankle_r, '#06b6d4');
    drawJoint(toe_l, '#10b981');
    drawJoint(toe_r, '#10b981');

    // --- CALCULATE REAL-TIME FLEXION ANGLES ---
    const kneeAngleL = calculateAngle(knee_l, hip_l, ankle_l);
    const kneeAngleR = calculateAngle(knee_r, hip_r, ankle_r);
    const hipAngleL = calculateAngle(hip_l, shoulder_l, knee_l);
    const hipAngleR = calculateAngle(hip_r, shoulder_r, knee_r);
    const elbowAngleL = calculateAngle(elbow_l, shoulder_l, wrist_l);
    const elbowAngleR = calculateAngle(elbow_r, shoulder_r, wrist_r);

    kneeAngleLDisp.textContent = `${kneeAngleL}°`;
    kneeAngleRDisp.textContent = `${kneeAngleR}°`;
    hipAngleLDisp.textContent = `${hipAngleL}°`;
    hipAngleRDisp.textContent = `${hipAngleR}°`;
    elbowAngleLDisp.textContent = `${elbowAngleL}°`;
    elbowAngleRDisp.textContent = `${elbowAngleR}°`;

    // --- CALCULATE PHYSICAL LENGTHS (IF SCALE LOCKED) ---
    if (pixelsPerCm) {
      // Left segment calculations
      const thigh_l_px = Math.hypot(hip_l.x - knee_l.x, hip_l.y - knee_l.y);
      const shin_l_px = Math.hypot(knee_l.x - ankle_l.x, knee_l.y - ankle_l.y);
      const foot_l_px = Math.hypot(ankle_l.x - toe_l.x, ankle_l.y - toe_l.y);
      const torso_l_px = Math.hypot(shoulder_l.x - hip_l.x, shoulder_l.y - hip_l.y);
      const upperarm_l_px = Math.hypot(shoulder_l.x - elbow_l.x, shoulder_l.y - elbow_l.y);
      const forearm_l_px = Math.hypot(elbow_l.x - wrist_l.x, elbow_l.y - wrist_l.y);

      // Right segment calculations
      const thigh_r_px = Math.hypot(hip_r.x - knee_r.x, hip_r.y - knee_r.y);
      const shin_r_px = Math.hypot(knee_r.x - ankle_r.x, knee_r.y - ankle_r.y);
      const foot_r_px = Math.hypot(ankle_r.x - toe_r.x, ankle_r.y - toe_r.y);
      const torso_r_px = Math.hypot(shoulder_r.x - hip_r.x, shoulder_r.y - hip_r.y);
      const upperarm_r_px = Math.hypot(shoulder_r.x - elbow_r.x, shoulder_r.y - elbow_r.y);
      const forearm_r_px = Math.hypot(elbow_r.x - wrist_r.x, elbow_r.y - wrist_r.y);

      const shoulderW_px = Math.hypot(shoulder_l.x - shoulder_r.x, shoulder_l.y - shoulder_r.y);
      const hipW_px = Math.hypot(hip_l.x - hip_r.x, hip_l.y - hip_r.y);

      // Vertical height using lowest foot contacts (heels/toes) as the ground plane
      const foot_l_bottom = Math.max(heel_l.y, toe_l.y);
      const foot_r_bottom = Math.max(heel_r.y, toe_r.y);
      const ground_y = (foot_l_bottom + foot_r_bottom) / 2;
      const vertical_height_px = Math.abs(ground_y - head_top.y);
      lastVerticalHeightPx = vertical_height_px; // Save for input-based calibration

      // Anatomical (Skeletal) posture-independent stature calculation
      const head_segment_px = Math.hypot(head_top.x - shoulder_mid.x, head_top.y - shoulder_mid.y);
      const hip_mid_x = (hip_l.x + hip_r.x) / 2;
      const hip_mid_y = (hip_l.y + hip_r.y) / 2;
      const torso_segment_px = Math.hypot(shoulder_mid.x - hip_mid_x, shoulder_mid.y - hip_mid_y);
      
      const leg_l_px = Math.hypot(hip_l.x - knee_l.x, hip_l.y - knee_l.y) + 
                       Math.hypot(knee_l.x - ankle_l.x, knee_l.y - ankle_l.y) + 
                       Math.hypot(ankle_l.x - heel_l.x, ankle_l.y - heel_l.y);
                       
      const leg_r_px = Math.hypot(hip_r.x - knee_r.x, hip_r.y - knee_r.y) + 
                       Math.hypot(knee_r.x - ankle_r.x, knee_r.y - ankle_r.y) + 
                       Math.hypot(ankle_r.x - heel_r.x, ankle_r.y - heel_r.y);
                       
      const average_leg_px = (leg_l_px + leg_r_px) / 2;
      const skeletal_height_px = head_segment_px + torso_segment_px + average_leg_px;
      lastSkeletalHeightPx = skeletal_height_px; // Save for input-based calibration

      const skeletal_height_cm = skeletal_height_px / pixelsPerCm;
      const live_height_cm = vertical_height_px / pixelsPerCm;

      // Convert to direct physical units and apply smoothing
      const liveMetrics = {
        thigh_l: smooth('thigh_l', thigh_l_px / pixelsPerCm),
        thigh_r: smooth('thigh_r', thigh_r_px / pixelsPerCm),
        shin_l: smooth('shin_l', shin_l_px / pixelsPerCm),
        shin_r: smooth('shin_r', shin_r_px / pixelsPerCm),
        foot_l: smooth('foot_l', foot_l_px / pixelsPerCm),
        foot_r: smooth('foot_r', foot_r_px / pixelsPerCm),
        
        torso_l: smooth('torso_l', torso_l_px / pixelsPerCm),
        torso_r: smooth('torso_r', torso_r_px / pixelsPerCm),
        upperarm_l: smooth('upperarm_l', upperarm_l_px / pixelsPerCm),
        upperarm_r: smooth('upperarm_r', upperarm_r_px / pixelsPerCm),
        forearm_l: smooth('forearm_l', forearm_l_px / pixelsPerCm),
        forearm_r: smooth('forearm_r', forearm_r_px / pixelsPerCm),

        shoulderW: smooth('shoulderW', shoulderW_px / pixelsPerCm),
        hipW: smooth('hipW', hipW_px / pixelsPerCm),

        skeletal_height: smooth('body_height_skeletal', skeletal_height_cm),
        live_height: smooth('body_height_live', live_height_cm),

        kneeAngleL: kneeAngleL,
        kneeAngleR: kneeAngleR,
        hipAngleL: hipAngleL,
        hipAngleR: hipAngleR,
        elbowAngleL: elbowAngleL,
        elbowAngleR: elbowAngleR
      };

      // Render live biometrics to dashboard
      renderDashboard(liveMetrics);

      // Position ruler on whichever side has more margin
      const body_xs = [shoulder_l.x, shoulder_r.x, hip_l.x, hip_r.x, knee_l.x, knee_r.x, ankle_l.x, ankle_r.x];
      const min_x = Math.min(...body_xs);
      const max_x = Math.max(...body_xs);
      const ruler_x = max_x + 40 < 620 ? max_x + 40 : min_x - 40 > 20 ? min_x - 40 : 50;

      // Compute feet & inches string for ruler label
      const live_inches = liveMetrics.live_height / 2.54;
      const live_feet = Math.floor(live_inches / 12);
      const live_inches_left = live_inches % 12;
      const live_feet_inches_str = `${live_feet}' ${live_inches_left.toFixed(1)}"`;

      // Draw head top indicator node
      drawJoint(head_top, '#06b6d4');

      // Draw the live ruler graphics
      drawRulerGraphics(ruler_x, head_top, ground_y, liveMetrics.live_height, live_feet_inches_str, heel_l, heel_r);

      // Capture freeze frame hook
      if (isCaptureCountingDown && captureCountdownValue === 0) {
        captureSnapshot({
          shoulder_l, elbow_l, wrist_l, hip_l, knee_l, ankle_l, heel_l, toe_l,
          shoulder_r, elbow_r, wrist_r, hip_r, knee_r, ankle_r, heel_r, toe_r,
          head_top, ground_y, ruler_x, live_feet_inches_str,
          smoothed_live_height: liveMetrics.live_height,
          kneeAngleL, kneeAngleR, hipAngleL, hipAngleR, elbowAngleL, elbowAngleR,
          all_landmarks: all_landmarks
        }, liveMetrics);
      }

      statusElement.textContent = `✅ Calibrated Tracking active. Real-time biometrics rendering.`;
    } else {
      statusElement.textContent = "⚠️ Scale not calibrated yet. Lock your 200mm marker calibration first.";
    }
  } else {
    statusElement.textContent = "🔍 Scanning for a person... Align your printed marker first.";
  }

  // --- 5-SECOND CAPTURE COUNTDOWN OVERLAY ---
  if (isCaptureCountingDown && captureCountdownValue > 0) {
    canvasCtx.fillStyle = 'rgba(9, 13, 22, 0.75)';
    canvasCtx.fillRect(0, 0, canvasElement.width, canvasElement.height);

    // Tech borders
    canvasCtx.strokeStyle = 'rgba(124, 58, 237, 0.3)';
    canvasCtx.lineWidth = 2;
    canvasCtx.strokeRect(20, 20, canvasElement.width - 40, canvasElement.height - 40);

    canvasCtx.fillStyle = '#a78bfa'; // violet
    canvasCtx.strokeStyle = 'rgba(124, 58, 237, 0.5)';
    canvasCtx.lineWidth = 4;
    canvasCtx.textAlign = 'center';
    canvasCtx.textBaseline = 'middle';
    
    // Large countdown number
    canvasCtx.font = 'bold 105px sans-serif';
    canvasCtx.fillText(captureCountdownValue, canvasElement.width / 2, canvasElement.height / 2 - 30);
    canvasCtx.strokeText(captureCountdownValue, canvasElement.width / 2, canvasElement.height / 2 - 30);

    // Instruction text
    canvasCtx.font = 'bold 20px sans-serif';
    canvasCtx.fillStyle = '#ffffff';
    canvasCtx.fillText("PREPARING SNAPSHOT", canvasElement.width / 2, canvasElement.height / 2 + 55);
    
    canvasCtx.font = '500 13px sans-serif';
    canvasCtx.fillStyle = '#cbd5e1';
    canvasCtx.fillText("Step back, stand straight, and hold your pose", canvasElement.width / 2, canvasElement.height / 2 + 85);
  }

  // --- CAMERA SNAPSHOT FLASH EFFECT ---
  if (flashOpacity > 0) {
    canvasCtx.fillStyle = `rgba(255, 255, 255, ${flashOpacity})`;
    canvasCtx.fillRect(0, 0, canvasElement.width, canvasElement.height);
  }

  canvasCtx.restore();
});

// ==========================================
// HAND TRACKING & BIOMETRICS HELPER FUNCTIONS
// ==========================================
const FINGER_COLORS = {
  thumb: '#ec4899',   // Pink
  index: '#06b6d4',   // Cyan
  middle: '#a855f7',  // Purple
  ring: '#10b981',    // Emerald
  pinky: '#f59e0b'    // Amber
};

function updateHandTracking(results) {
  if (isSnapshotFrozen) return;

  const multiLandmarks = results.multiHandLandmarks;
  const multiHandedness = results.multiHandedness;

  let leftDetected = false;
  let rightDetected = false;

  if (multiLandmarks && multiHandedness) {
    multiLandmarks.forEach((landmarks, index) => {
      const handedness = multiHandedness[index];
      const side = handedness.label; // 'Left' or 'Right'
      
      if (side === 'Left') leftDetected = true;
      if (side === 'Right') rightDetected = true;

      const wrist = { x: (1.0 - landmarks[0].x) * 640, y: landmarks[0].y * 480 };
      const thumbTip = { x: (1.0 - landmarks[4].x) * 640, y: landmarks[4].y * 480 };
      const indexTip = { x: (1.0 - landmarks[8].x) * 640, y: landmarks[8].y * 480 };
      const middleTip = { x: (1.0 - landmarks[12].x) * 640, y: landmarks[12].y * 480 };
      const ringTip = { x: (1.0 - landmarks[16].x) * 640, y: landmarks[16].y * 480 };
      const pinkyTip = { x: (1.0 - landmarks[20].x) * 640, y: landmarks[20].y * 480 };

      let pinchSpanStr = "--.- cm";
      let handSpanStr = "--.- cm";

      if (pixelsPerCm) {
        const pinchPx = Math.hypot(thumbTip.x - indexTip.x, thumbTip.y - indexTip.y);
        const pinchCm = pinchPx / pixelsPerCm;
        pinchSpanStr = formatLength(smooth(side + '_pinch', pinchCm));

        const spanPx = Math.hypot(wrist.x - middleTip.x, wrist.y - middleTip.y);
        const spanCm = spanPx / pixelsPerCm;
        handSpanStr = formatLength(smooth(side + '_span', spanCm));
      }

      const tips = [thumbTip, indexTip, middleTip, ringTip, pinkyTip];

      if (side === 'Left') {
        if (handStatusLDisp) {
          handStatusLDisp.textContent = `Left Hand: Tracked (${(handedness.score * 100).toFixed(0)}%)`;
          handStatusLDisp.style.color = "#10b981";
        }
        if (pinchLDisp) pinchLDisp.textContent = pinchSpanStr;
        if (spanLDisp) spanLDisp.textContent = handSpanStr;

        fingertipLDisps.forEach((disp, idx) => {
          if (disp) {
            const pt = tips[idx];
            disp.textContent = `(${pt.x.toFixed(0)}, ${pt.y.toFixed(0)})`;
            disp.style.color = "#10b981";
          }
        });
      } else if (side === 'Right') {
        if (handStatusRDisp) {
          handStatusRDisp.textContent = `Right Hand: Tracked (${(handedness.score * 100).toFixed(0)}%)`;
          handStatusRDisp.style.color = "#10b981";
        }
        if (pinchRDisp) pinchRDisp.textContent = pinchSpanStr;
        if (spanRDisp) spanRDisp.textContent = handSpanStr;

        fingertipRDisps.forEach((disp, idx) => {
          if (disp) {
            const pt = tips[idx];
            disp.textContent = `(${pt.x.toFixed(0)}, ${pt.y.toFixed(0)})`;
            disp.style.color = "#10b981";
          }
        });
      }
    });
  }

  // If left/right hands are not detected, reset their fingertip displays to Offline
  if (!leftDetected) {
    if (handStatusLDisp) {
      handStatusLDisp.textContent = "Left Hand: Offline";
      handStatusLDisp.style.color = "#64748b";
    }
    if (pinchLDisp) pinchLDisp.textContent = "--.- cm";
    if (spanLDisp) spanLDisp.textContent = "--.- cm";
    fingertipLDisps.forEach(disp => {
      if (disp) {
        disp.textContent = "Offline";
        disp.style.color = "#64748b";
      }
    });
  }
  if (!rightDetected) {
    if (handStatusRDisp) {
      handStatusRDisp.textContent = "Right Hand: Offline";
      handStatusRDisp.style.color = "#64748b";
    }
    if (pinchRDisp) pinchRDisp.textContent = "--.- cm";
    if (spanRDisp) spanRDisp.textContent = "--.- cm";
    fingertipRDisps.forEach(disp => {
      if (disp) {
        disp.textContent = "Offline";
        disp.style.color = "#64748b";
      }
    });
  }
}

function drawHandMesh(multiHandLandmarks, multiHandedness) {
  if (!multiHandLandmarks) return;

  multiHandLandmarks.forEach((landmarks, handIdx) => {
    const handedness = multiHandedness ? multiHandedness[handIdx] : null;
    const isLeft = handedness ? handedness.label === 'Left' : true;
    const sidePrefix = isLeft ? 'L' : 'R';

    const pts = landmarks.map(lm => ({ x: (1.0 - lm.x) * 640, y: lm.y * 480 }));

    canvasCtx.beginPath();
    canvasCtx.moveTo(pts[0].x, pts[0].y);
    canvasCtx.lineTo(pts[1].x, pts[1].y);
    canvasCtx.lineTo(pts[5].x, pts[5].y);
    canvasCtx.lineTo(pts[9].x, pts[9].y);
    canvasCtx.lineTo(pts[13].x, pts[13].y);
    canvasCtx.lineTo(pts[17].x, pts[17].y);
    canvasCtx.closePath();
    canvasCtx.strokeStyle = 'rgba(99, 102, 241, 0.45)';
    canvasCtx.lineWidth = 1.5;
    canvasCtx.stroke();
    canvasCtx.fillStyle = 'rgba(99, 102, 241, 0.05)';
    canvasCtx.fill();

    const drawFingerBones = (indices, color) => {
      canvasCtx.beginPath();
      canvasCtx.moveTo(pts[indices[0]].x, pts[indices[0]].y);
      for (let i = 1; i < indices.length; i++) {
        canvasCtx.lineTo(pts[indices[i]].x, pts[indices[i]].y);
      }
      canvasCtx.strokeStyle = color + '80';
      canvasCtx.lineWidth = 2.0;
      canvasCtx.stroke();
    };

    drawFingerBones([1, 2, 3, 4], FINGER_COLORS.thumb);
    drawFingerBones([5, 6, 7, 8], FINGER_COLORS.index);
    drawFingerBones([9, 10, 11, 12], FINGER_COLORS.middle);
    drawFingerBones([13, 14, 15, 16], FINGER_COLORS.ring);
    drawFingerBones([17, 18, 19, 20], FINGER_COLORS.pinky);

    pts.forEach((pt, idx) => {
      if ([4, 8, 12, 16, 20].includes(idx)) return;
      if (idx === 0) {
        canvasCtx.beginPath();
        canvasCtx.arc(pt.x, pt.y, 4, 0, 2 * Math.PI);
        canvasCtx.fillStyle = '#6366f1';
        canvasCtx.fill();
        canvasCtx.strokeStyle = '#ffffff';
        canvasCtx.lineWidth = 1.0;
        canvasCtx.stroke();
        return;
      }

      let color = '#6366f1';
      if (idx >= 1 && idx <= 3) color = FINGER_COLORS.thumb;
      else if (idx >= 5 && idx <= 7) color = FINGER_COLORS.index;
      else if (idx >= 9 && idx <= 11) color = FINGER_COLORS.middle;
      else if (idx >= 13 && idx <= 15) color = FINGER_COLORS.ring;
      else if (idx >= 17 && idx <= 19) color = FINGER_COLORS.pinky;

      canvasCtx.beginPath();
      canvasCtx.arc(pt.x, pt.y, 2.5, 0, 2 * Math.PI);
      canvasCtx.fillStyle = color;
      canvasCtx.fill();
    });

    const tips = [
      { idx: 4, color: FINGER_COLORS.thumb, label: sidePrefix + ' Thumb' },
      { idx: 8, color: FINGER_COLORS.index, label: sidePrefix + ' Index' },
      { idx: 12, color: FINGER_COLORS.middle, label: sidePrefix + ' Middle' },
      { idx: 16, color: FINGER_COLORS.ring, label: sidePrefix + ' Ring' },
      { idx: 20, color: FINGER_COLORS.pinky, label: sidePrefix + ' Pinky' }
    ];

    tips.forEach(tip => {
      const pt = pts[tip.idx];
      
      canvasCtx.beginPath();
      canvasCtx.arc(pt.x, pt.y, 7, 0, 2 * Math.PI);
      canvasCtx.fillStyle = tip.color + '40';
      canvasCtx.fill();

      canvasCtx.beginPath();
      canvasCtx.arc(pt.x, pt.y, 3.5, 0, 2 * Math.PI);
      canvasCtx.fillStyle = tip.color;
      canvasCtx.fill();
      canvasCtx.strokeStyle = '#ffffff';
      canvasCtx.lineWidth = 1.0;
      canvasCtx.stroke();
    });
  });
}

// ==========================================
// CAPTURE TIMER & SNAPSHOT HELPER FUNCTIONS
// ==========================================
const POSE_CONNECTIONS = [
  [0, 1], [1, 2], [2, 3], [3, 7],
  [0, 4], [4, 5], [5, 6], [6, 8],
  [9, 10],
  [11, 12],
  [11, 13], [13, 15],
  [12, 14], [14, 16],
  [15, 17], [15, 19], [15, 21], [17, 19],
  [16, 18], [16, 20], [16, 22], [18, 20],
  [11, 23], [12, 24],
  [23, 24],
  [23, 25], [25, 27],
  [24, 26], [26, 28],
  [27, 29], [29, 31], [27, 31],
  [28, 30], [30, 32], [28, 32]
];

function drawFullSkeletalMesh(landmarks) {
  if (!landmarks || landmarks.length < 33) return;

  // 1. Draw thin, semi-transparent skeletal mesh connections
  canvasCtx.beginPath();
  POSE_CONNECTIONS.forEach(([i, j]) => {
    const p1 = landmarks[i];
    const p2 = landmarks[j];
    if (p1 && p2) {
      canvasCtx.moveTo(p1.x, p1.y);
      canvasCtx.lineTo(p2.x, p2.y);
    }
  });
  canvasCtx.strokeStyle = 'rgba(99, 102, 241, 0.45)'; // Sleek translucent indigo vector line
  canvasCtx.lineWidth = 1.5;
  canvasCtx.stroke();

  // 2. Draw all 33 pose landmark nodes with color-coded glowing aesthetics
  landmarks.forEach((p, idx) => {
    if (!p) return;
    
    let color = '#6366f1'; // Default Indigo
    if (idx <= 10) {
      color = '#ec4899'; // Head/Face landmarks: Bright Pink
    } else if (idx === 11 || idx === 13 || idx === 15 || idx === 17 || idx === 19 || idx === 21) {
      color = '#06b6d4'; // Left Arm: Neon Cyan
    } else if (idx === 12 || idx === 14 || idx === 16 || idx === 18 || idx === 20 || idx === 22) {
      color = '#a855f7'; // Right Arm: Neon Purple
    } else if (idx === 23 || idx === 25 || idx === 27 || idx === 29 || idx === 31) {
      color = '#10b981'; // Left Leg/Foot: Neon Emerald
    } else if (idx === 24 || idx === 26 || idx === 28 || idx === 30 || idx === 32) {
      color = '#f59e0b'; // Right Leg/Foot: Neon Amber
    }

    // Render glowing nodes
    canvasCtx.beginPath();
    canvasCtx.arc(p.x, p.y, 4, 0, 2 * Math.PI);
    canvasCtx.fillStyle = color;
    canvasCtx.fill();
    canvasCtx.strokeStyle = '#ffffff';
    canvasCtx.lineWidth = 1.0;
    canvasCtx.stroke();
  });
}

function renderDashboard(metrics) {
  if (!metrics) return;

  // Render Left/Right segment lengths
  thighLDisp.textContent = formatLength(metrics.thigh_l);
  thighRDisp.textContent = formatLength(metrics.thigh_r);
  shinLDisp.textContent = formatLength(metrics.shin_l);
  shinRDisp.textContent = formatLength(metrics.shin_r);
  footLDisp.textContent = formatLength(metrics.foot_l);
  footRDisp.textContent = formatLength(metrics.foot_r);
  
  torsoLDisp.textContent = formatLength(metrics.torso_l);
  torsoRDisp.textContent = formatLength(metrics.torso_r);
  upperarmLDisp.textContent = formatLength(metrics.upperarm_l);
  upperarmRDisp.textContent = formatLength(metrics.upperarm_r);
  forearmLDisp.textContent = formatLength(metrics.forearm_l);
  forearmRDisp.textContent = formatLength(metrics.forearm_r);

  shoulderWDisp.textContent = formatLength(metrics.shoulderW);
  hipWDisp.textContent = formatLength(metrics.hipW);

  // Render height
  const skeletal_inches = metrics.skeletal_height / 2.54;
  const skeletal_feet = Math.floor(skeletal_inches / 12);
  const skeletal_inches_left = skeletal_inches % 12;
  const skeletal_feet_inches_str = `${skeletal_feet}' ${skeletal_inches_left.toFixed(1)}"`;

  if (useInches) {
    heightCmDisp.textContent = skeletal_feet_inches_str;
    heightFtDisp.textContent = `${metrics.skeletal_height.toFixed(1)} cm (Stature)`;
  } else {
    heightCmDisp.textContent = `${metrics.skeletal_height.toFixed(1)} cm`;
    heightFtDisp.textContent = `${skeletal_feet_inches_str} (Stature)`;
  }

  // Render angles
  kneeAngleLDisp.textContent = `${metrics.kneeAngleL}°`;
  kneeAngleRDisp.textContent = `${metrics.kneeAngleR}°`;
  hipAngleLDisp.textContent = `${metrics.hipAngleL}°`;
  hipAngleRDisp.textContent = `${metrics.hipAngleR}°`;
  elbowAngleLDisp.textContent = `${metrics.elbowAngleL}°`;
  elbowAngleRDisp.textContent = `${metrics.elbowAngleR}°`;
}

function drawRulerGraphics(ruler_x, head_top, ground_y, live_height, live_feet_inches_str, heel_l, heel_r) {
  // Vertical indicator line
  canvasCtx.beginPath();
  canvasCtx.moveTo(ruler_x, head_top.y);
  canvasCtx.lineTo(ruler_x, ground_y);
  canvasCtx.strokeStyle = '#06b6d4';
  canvasCtx.lineWidth = 2.5;
  canvasCtx.stroke();

  // Top bracket
  canvasCtx.beginPath();
  canvasCtx.moveTo(ruler_x - 10, head_top.y);
  canvasCtx.lineTo(ruler_x + 10, head_top.y);
  canvasCtx.stroke();

  // Bottom bracket
  canvasCtx.beginPath();
  canvasCtx.moveTo(ruler_x - 10, ground_y);
  canvasCtx.lineTo(ruler_x + 10, ground_y);
  canvasCtx.stroke();

  // Text labels along ruler
  canvasCtx.fillStyle = '#06b6d4';
  canvasCtx.font = 'bold 11px sans-serif';
  const rulerLabel = useInches ? live_feet_inches_str : `${live_height.toFixed(1)} cm`;
  canvasCtx.fillText(`Live: ${rulerLabel}`, ruler_x > 320 ? ruler_x + 15 : ruler_x - (useInches ? 95 : 80), (head_top.y + ground_y) / 2);

  // Connecting indicator line from head to ruler
  canvasCtx.beginPath();
  canvasCtx.moveTo(head_top.x, head_top.y);
  canvasCtx.lineTo(ruler_x, head_top.y);
  canvasCtx.strokeStyle = 'rgba(6, 182, 212, 0.4)';
  canvasCtx.setLineDash([4, 4]);
  canvasCtx.stroke();
  canvasCtx.setLineDash([]);

  // Connecting indicator line from ground contact center to ruler
  canvasCtx.beginPath();
  canvasCtx.moveTo((heel_l.x + heel_r.x)/2, ground_y);
  canvasCtx.lineTo(ruler_x, ground_y);
  canvasCtx.strokeStyle = 'rgba(6, 182, 212, 0.4)';
  canvasCtx.setLineDash([4, 4]);
  canvasCtx.stroke();
  canvasCtx.setLineDash([]);
}

function captureSnapshot(joints, metrics) {
  isCaptureCountingDown = false;
  
  // Save deep copies of the joints coordinates and dashboard metrics
  frozenJoints = JSON.parse(JSON.stringify(joints));
  frozenMetrics = JSON.parse(JSON.stringify(metrics));
  frozenHandResults = latestHandResults ? JSON.parse(JSON.stringify(latestHandResults)) : null;
  
  // Save current frame image from canvas (if YOLO background isolated) or webcam
  frozenFrameCtx.clearRect(0, 0, 640, 480);
  if (yoloModeActive) {
    // Main canvas currently holds the isolated composite frame (before overlays were drawn)
    frozenFrameCtx.drawImage(canvasElement, 0, 0);
  } else {
    // Grab direct webcam stream
    frozenFrameCtx.drawImage(videoElement, 0, 0);
  }

  isSnapshotFrozen = true;
  videoElement.style.opacity = '0'; // Completely hide live video feed under the canvas
  
  // Set capture button to reset mode
  captureBtn.textContent = "Reset & Resume Live Tracking";
  captureBtn.classList.remove('btn-capture');
  captureBtn.classList.add('btn-capture-reset');
  
  statusElement.textContent = "📸 SNAPSHOT CAPTURED! Biomechanical statistics frozen on screen.";
  
  // Trigger visual flash
  triggerFlashEffect();
}

function drawFrozenSnapshot() {
  canvasCtx.save();
  canvasCtx.clearRect(0, 0, canvasElement.width, canvasElement.height);

  // 1. Draw the frozen frame
  canvasCtx.drawImage(frozenFrameCanvas, 0, 0, canvasElement.width, canvasElement.height);

  // 2. Draw the frozen skeleton
  if (frozenJoints) {
    const {
      shoulder_l, elbow_l, wrist_l, hip_l, knee_l, ankle_l, heel_l, toe_l,
      shoulder_r, elbow_r, wrist_r, hip_r, knee_r, ankle_r, heel_r, toe_r,
      head_top, ground_y, ruler_x, live_feet_inches_str, smoothed_live_height,
      kneeAngleL, kneeAngleR, hipAngleL, hipAngleR, elbowAngleL, elbowAngleR,
      all_landmarks
    } = frozenJoints;

    // Draw the full skeletal mesh
    drawFullSkeletalMesh(all_landmarks);

    // Draw bones
    drawBone(shoulder_l, shoulder_r, '#6366f1'); 
    drawBone(hip_l, hip_r, '#6366f1'); 
    drawBone(shoulder_l, hip_l, '#38bdf8'); 
    drawBone(shoulder_r, hip_r, '#38bdf8'); 

    drawBone(shoulder_l, elbow_l, '#ec4899'); 
    drawBone(elbow_l, wrist_l, '#f43f5e'); 
    drawBone(hip_l, knee_l, '#a855f7'); 
    drawBone(knee_l, ankle_l, '#06b6d4'); 
    drawBone(ankle_l, heel_l, '#10b981'); 
    drawBone(heel_l, toe_l, '#10b981'); 

    drawBone(shoulder_r, elbow_r, '#ec4899'); 
    drawBone(elbow_r, wrist_r, '#f43f5e'); 
    drawBone(hip_r, knee_r, '#a855f7'); 
    drawBone(knee_r, ankle_r, '#06b6d4'); 
    drawBone(ankle_r, heel_r, '#10b981'); 
    drawBone(heel_r, toe_r, '#10b981'); 

    // Draw joints
    drawJoint(shoulder_l, '#6366f1');
    drawJoint(shoulder_r, '#6366f1');
    drawJoint(elbow_l, '#d946ef');
    drawJoint(elbow_r, '#d946ef');
    drawJoint(wrist_l, '#f43f5e');
    drawJoint(wrist_r, '#f43f5e');
    drawJoint(hip_l, '#a855f7');
    drawJoint(hip_r, '#a855f7');
    drawJoint(knee_l, '#10b981');
    drawJoint(knee_r, '#10b981');
    drawJoint(ankle_l, '#06b6d4');
    drawJoint(ankle_r, '#06b6d4');
    drawJoint(toe_l, '#10b981');
    drawJoint(toe_r, '#10b981');
    drawJoint(head_top, '#06b6d4');

    // Draw ruler
    canvasCtx.beginPath();
    canvasCtx.moveTo(ruler_x, head_top.y);
    canvasCtx.lineTo(ruler_x, ground_y);
    canvasCtx.strokeStyle = '#06b6d4';
    canvasCtx.lineWidth = 2.5;
    canvasCtx.stroke();

    canvasCtx.beginPath();
    canvasCtx.moveTo(ruler_x - 10, head_top.y);
    canvasCtx.lineTo(ruler_x + 10, head_top.y);
    canvasCtx.stroke();

    canvasCtx.beginPath();
    canvasCtx.moveTo(ruler_x - 10, ground_y);
    canvasCtx.lineTo(ruler_x + 10, ground_y);
    canvasCtx.stroke();

    canvasCtx.fillStyle = '#06b6d4';
    canvasCtx.font = 'bold 11px sans-serif';
    const rulerLabel = useInches ? live_feet_inches_str : `${smoothed_live_height.toFixed(1)} cm`;
    canvasCtx.fillText(`Captured: ${rulerLabel}`, ruler_x > 320 ? ruler_x + 15 : ruler_x - (useInches ? 115 : 100), (head_top.y + ground_y) / 2);

    // Connecting lines
    canvasCtx.beginPath();
    canvasCtx.moveTo(head_top.x, head_top.y);
    canvasCtx.lineTo(ruler_x, head_top.y);
    canvasCtx.strokeStyle = 'rgba(6, 182, 212, 0.4)';
    canvasCtx.setLineDash([4, 4]);
    canvasCtx.stroke();
    canvasCtx.setLineDash([]);

    canvasCtx.beginPath();
    canvasCtx.moveTo((heel_l.x + heel_r.x)/2, ground_y);
    canvasCtx.lineTo(ruler_x, ground_y);
    canvasCtx.strokeStyle = 'rgba(6, 182, 212, 0.4)';
    canvasCtx.setLineDash([4, 4]);
    canvasCtx.stroke();
    canvasCtx.setLineDash([]);
  }

  // Draw frozen hand skeletons if available
  if (frozenHandResults) {
    drawHandMesh(frozenHandResults.multiHandLandmarks, frozenHandResults.multiHandedness);
  }

  // 3. Draw pulsing SNAPSHOT FROZEN badge
  const pulse = 1 + 0.05 * Math.sin(Date.now() / 200);
  canvasCtx.save();
  canvasCtx.translate(canvasElement.width / 2, 40);
  canvasCtx.scale(pulse, pulse);
  
  canvasCtx.fillStyle = 'rgba(239, 68, 68, 0.85)'; // vibrant neon red/coral badge
  canvasCtx.strokeStyle = '#ef4444';
  canvasCtx.lineWidth = 1.5;
  
  drawRoundedRect(canvasCtx, -100, -15, 200, 30, 6);
  canvasCtx.fill();
  canvasCtx.stroke();
  
  canvasCtx.fillStyle = '#ffffff';
  canvasCtx.font = 'bold 12px sans-serif';
  canvasCtx.textAlign = 'center';
  canvasCtx.textBaseline = 'middle';
  canvasCtx.fillText('📸 SNAPSHOT FROZEN', 0, 0);
  canvasCtx.restore();

  // 4. Draw camera flash if still active
  if (flashOpacity > 0) {
    canvasCtx.fillStyle = `rgba(255, 255, 255, ${flashOpacity})`;
    canvasCtx.fillRect(0, 0, canvasElement.width, canvasElement.height);
  }

  canvasCtx.restore();
}

function drawRoundedRect(ctx, x, y, width, height, radius) {
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.lineTo(x + width - radius, y);
  ctx.quadraticCurveTo(x + width, y, x + width, y + radius);
  ctx.lineTo(x + width, y + height - radius);
  ctx.quadraticCurveTo(x + width, y + height, x + width - radius, y + height);
  ctx.lineTo(x + radius, y + height);
  ctx.quadraticCurveTo(x, y + height, x, y + height - radius);
  ctx.lineTo(x, y + radius);
  ctx.quadraticCurveTo(x, y, x + radius, y);
  ctx.closePath();
}

captureBtn.addEventListener('click', () => {
  if (isSnapshotFrozen) {
    // Reset and Resume live tracking
    isSnapshotFrozen = false;
    frozenJoints = null;
    frozenMetrics = null;
    frozenHandResults = null;
    
    // Restore standard video feed visibility
    if (yoloModeActive) {
      videoElement.style.opacity = '0.05';
    } else {
      videoElement.style.opacity = '1.0';
    }
    
    // Restore capture button styling
    captureBtn.textContent = "Start 5s Capture Snapshot";
    captureBtn.classList.remove('btn-capture-reset');
    captureBtn.classList.add('btn-capture');
    
    statusElement.textContent = "Live biomechanical tracking resumed.";
    return;
  }
  
  if (isCaptureCountingDown || isCountingDown) return; // Prevent double trigger
  
  // Ensure tracking has actually found landmarks at least once (i.e. scale calibration or skeletal tracking active)
  if (lastVerticalHeightPx === 0) {
    alert("Please stand in view of the camera and let the system track your body before capturing a snapshot!");
    return;
  }
  
  // Start 5-second countdown
  isCaptureCountingDown = true;
  captureCountdownValue = 5;
  captureBtn.textContent = "Get in Position (5s)...";
  statusElement.textContent = "Preparing snapshot. Step back and stand straight in view of the camera...";
  
  const captureInterval = setInterval(() => {
    captureCountdownValue--;
    if (captureCountdownValue > 0) {
      captureBtn.textContent = `Get in Position (${captureCountdownValue}s)...`;
      statusElement.textContent = `Preparing snapshot. Calibrating posture in ${captureCountdownValue} seconds...`;
    } else {
      clearInterval(captureInterval);
      // Zero state trigger. The main frame processor loop will detect this inside 'onResults'
      // and call captureSnapshot() with the frame matching this exact tick!
    }
  }, 1000);
});

function drawJoint(point, color) {
  canvasCtx.beginPath();
  canvasCtx.arc(point.x, point.y, 6, 0, 2 * Math.PI);
  canvasCtx.fillStyle = color;
  canvasCtx.fill();
  canvasCtx.strokeStyle = 'white';
  canvasCtx.lineWidth = 1.5;
  canvasCtx.stroke();
}

function drawBone(p1, p2, color) {
  canvasCtx.beginPath();
  canvasCtx.moveTo(p1.x, p1.y);
  canvasCtx.lineTo(p2.x, p2.y);
  canvasCtx.strokeStyle = color;
  canvasCtx.lineWidth = 3.5;
  canvasCtx.stroke();
}

let activeStream = null;

async function startCamera() {
  statusElement.textContent = "Requesting webcam access...";
  startButton.style.display = 'none';
  yoloToggleBtn.style.display = 'block';
  captureBtn.style.display = 'block';

  try {
    activeStream = await navigator.mediaDevices.getUserMedia({
      audio: false,
      video: {
        width: { ideal: 640 },
        height: { ideal: 480 },
        facingMode: "user"
      }
    });
    
    videoElement.srcObject = activeStream;
    
    // Wait for video metadata to load and then start playing
    videoElement.onloadedmetadata = () => {
      videoElement.play();
      statusElement.textContent = "Camera active. Syncing with computer vision models...";
    };

    // Frame loop processor
    async function processFrame() {
      if (!activeStream || videoElement.paused || videoElement.ended) return;
      try {
        if (isSnapshotFrozen) {
          // Direct high-fidelity manual rendering loop when frozen to save CPU resources
          drawFrozenSnapshot();
          requestAnimationFrame(processFrame);
          return;
        }
        // Draw current webcam frame to offscreen canvas for ArUco scanning
        offscreenCtx.drawImage(videoElement, 0, 0, 640, 480);
        const imageData = offscreenCtx.getImageData(0, 0, 640, 480);
        const markers = arucoDetector ? arucoDetector.detect(imageData) : [];
        
        let found = null;
        for (const marker of markers) {
          if (marker.id === 0) {
            found = marker;
            break;
          }
        }
        latestArucoMarker = found;

        if (found) {
          const corners = found.corners;
          const d01 = Math.hypot(corners[0].x - corners[1].x, corners[0].y - corners[1].y);
          const d12 = Math.hypot(corners[1].x - corners[2].x, corners[1].y - corners[2].y);
          const d23 = Math.hypot(corners[2].x - corners[3].x, corners[2].y - corners[3].y);
          const d30 = Math.hypot(corners[3].x - corners[0].x, corners[3].y - corners[0].y);
          const edgeLengthPx = (d01 + d12 + d23 + d30) / 4;

          // Smooth calibration scale to avoid webcam noise
          const smoothedScale = smooth('scale_factor', edgeLengthPx / MARKER_PHYSICAL_SIZE_CM);
          pixelsPerCm = smoothedScale;
          calLocked = true;

          if (activeCalMethod === 'aruco') {
            arucoStatusText.innerHTML = `✅ ArUco Detected! Scale: <strong style="color: #06b6d4;">${pixelsPerCm.toFixed(1)} px/cm</strong>`;
          }
        } else {
          if (activeCalMethod === 'aruco') {
            if (pixelsPerCm) {
              arucoStatusText.innerHTML = `✅ Scale Calibrated: <strong style="color: #06b6d4;">${pixelsPerCm.toFixed(1)} px/cm</strong>`;
            } else {
              arucoStatusText.innerHTML = `🔍 Scanning for ArUco DICT_4X4_50 ID 0 (200mm)...`;
            }
          }
        }

        // Sync with MediaPipe Pose Models
        await pose.send({ image: videoElement });

        // Sync with MediaPipe Hands Models
        await hands.send({ image: videoElement });
      } catch (poseErr) {
        console.error("Frame processing error:", poseErr);
      }
      requestAnimationFrame(processFrame);
    }

    // Start processing once stream is playing
    videoElement.onplay = () => {
      statusElement.textContent = "Active tracking. Present your printed ArUco marker to calibrate scale!";
      processFrame();
    };

  } catch (err) {
    console.error("Camera access failed:", err);
    startButton.style.display = 'block';
    if (err.name === 'NotAllowedError') {
      statusElement.innerHTML = `<span style="color: #f87171; font-weight: bold;">❌ Camera Permission Denied!</span><br>Please click the camera/lock icon in your browser address bar and change camera permissions to 'Allow'.`;
    } else if (err.name === 'NotReadableError') {
      statusElement.innerHTML = `<span style="color: #f87171; font-weight: bold;">❌ Camera in use by another app!</span><br>Another app (Zoom, Teams, FaceTime, or a terminal script) is currently locking your camera. Please close it and try again.`;
    } else {
      statusElement.innerHTML = `<span style="color: #f87171; font-weight: bold;">❌ Error: ${err.message}</span><br>Please make sure you are loading this page via 'http://localhost:8000' and not 'file://' (which blocks camera access).`;
    }
  }
}

startButton.addEventListener('click', startCamera);

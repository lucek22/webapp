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

// ==========================================
// PERSISTENT OFFLINE STORAGE (INDEXEDDB)
// ==========================================
class SnapshotStore {
  constructor() {
    this.dbName = "ScarletBiomechanics";
    this.dbVersion = 1;
    this.db = null;
  }

  init() {
    return new Promise((resolve, reject) => {
      if (!window.indexedDB) {
        console.warn("IndexedDB is not supported in this browser. Persistent saving will be disabled.");
        reject(new Error("IndexedDB not supported"));
        return;
      }
      const request = indexedDB.open(this.dbName, this.dbVersion);

      request.onerror = (event) => {
        console.error("IndexedDB open error:", event.target.error);
        reject(event.target.error);
      };

      request.onsuccess = (event) => {
        this.db = event.target.result;
        resolve(this.db);
      };

      request.onupgradeneeded = (event) => {
        const db = event.target.result;
        if (!db.objectStoreNames.contains("snapshots")) {
          db.createObjectStore("snapshots", { keyPath: "id", autoIncrement: true });
        }
      };
    });
  }

  save(snapshot) {
    return new Promise((resolve, reject) => {
      if (!this.db) {
        reject(new Error("Database not initialized"));
        return;
      }
      const transaction = this.db.transaction(["snapshots"], "readwrite");
      const store = transaction.objectStore("snapshots");
      const request = store.add(snapshot);

      request.onsuccess = () => resolve(request.result);
      request.onerror = (e) => reject(e.target.error);
    });
  }

  getAll() {
    return new Promise((resolve, reject) => {
      if (!this.db) {
        reject(new Error("Database not initialized"));
        return;
      }
      const transaction = this.db.transaction(["snapshots"], "readonly");
      const store = transaction.objectStore("snapshots");
      const request = store.getAll();

      request.onsuccess = () => resolve(request.result);
      request.onerror = (e) => reject(e.target.error);
    });
  }

  get(id) {
    return new Promise((resolve, reject) => {
      if (!this.db) {
        reject(new Error("Database not initialized"));
        return;
      }
      const transaction = this.db.transaction(["snapshots"], "readonly");
      const store = transaction.objectStore("snapshots");
      const request = store.get(Number(id));

      request.onsuccess = () => resolve(request.result);
      request.onerror = (e) => reject(e.target.error);
    });
  }

  delete(id) {
    return new Promise((resolve, reject) => {
      if (!this.db) {
        reject(new Error("Database not initialized"));
        return;
      }
      const transaction = this.db.transaction(["snapshots"], "readwrite");
      const store = transaction.objectStore("snapshots");
      const request = store.delete(Number(id));

      request.onsuccess = () => resolve();
      request.onerror = (e) => reject(e.target.error);
    });
  }
}

const snapshotStore = new SnapshotStore();
let dbInitialized = false;

// ==========================================
// CONSTANTS & CONFIGURATION
// ==========================================
const LANDMARK_NAMES = [
  "Nose", "L Eye Inner", "L Eye", "L Eye Outer", "R Eye Inner", "R Eye", "R Eye Outer",
  "L Ear", "R Ear", "Mouth Left", "Mouth Right", "L Shoulder", "R Shoulder",
  "L Elbow", "R Elbow", "L Wrist", "R Wrist", "L Pinky", "R Pinky",
  "L Index", "R Index", "L Thumb", "R Thumb", "L Hip", "R Hip",
  "L Knee", "R Knee", "L Ankle", "R Ankle", "L Heel", "R Heel",
  "L Foot Index", "R Foot Index"
];

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

const FINGER_COLORS = {
  thumb: '#ec4899',   // Pink
  index: '#06b6d4',   // Cyan
  middle: '#a855f7',  // Purple
  ring: '#10b981',    // Emerald
  pinky: '#f59e0b'    // Amber
};

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

const MARKER_PHYSICAL_SIZE_CM = 20.0;

// ==========================================
// GLOBAL STATE VARIABLES (SHARED)
// ==========================================
let pixelsPerCm = null; // Set to null by default so everything relies strictly on calculations!
let calLocked = false;
let useInches = true;
let currentFacingMode = "user";

let calBoxSize = 150;
let calBoxX = 320; // Center X (640 / 2)
let calBoxY = 240; // Center Y (480 / 2)

let lastVerticalHeightPx = 0; // Updated in pose loop
let lastSkeletalHeightPx = 0; // Posture-independent skeletal stature
let latestArucoMarker = null;
let latestHandResults = null;
let frozenHandResults = null;

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

let yoloModeActive = false;
let frameCount = 0;

let latestLeftMiddleTip = null;
let latestRightMiddleTip = null;

let activeStream = null;
let activeCalMethod = 'aruco'; // 'aruco' or 'height'

const smoothBuffers = {};

// ==========================================
// MATH & STRING FORMATTING HELPER FUNCTIONS
// ==========================================
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

function getCanvasX(normX) {
  return currentFacingMode === "user" ? (1.0 - normX) * 640 : normX * 640;
}

function formatLength(cmVal) {
  if (useInches) {
    return `${(cmVal / 2.54).toFixed(1)} in`;
  } else {
    return `${cmVal.toFixed(1)} cm`;
  }
}

function updateHeightInputUnit() {
  const heightInputLabel = document.querySelector('label[for="input-user-height"]');
  const inputUserHeight = document.getElementById('input-user-height');
  if (!heightInputLabel || !inputUserHeight) return;

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

function formatSkeletalHeight(heightCm) {
  const skeletal_inches = heightCm / 2.54;
  const skeletal_feet = Math.floor(skeletal_inches / 12);
  const skeletal_inches_left = skeletal_inches % 12;
  if (useInches) {
    return `${skeletal_feet}' ${skeletal_inches_left.toFixed(1)}"`;
  } else {
    return `${heightCm.toFixed(1)} cm`;
  }
}

function getDomMeasurementCm(elementId) {
  const elem = document.getElementById(elementId);
  if (!elem) return null;
  const text = elem.textContent.trim();
  if (text.includes('--.-') || text === 'Offline' || text === '') return null;
  
  const num = parseFloat(text);
  if (isNaN(num)) return null;
  
  if (text.endsWith('in')) {
    return num * 2.54;
  }
  return num;
}


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

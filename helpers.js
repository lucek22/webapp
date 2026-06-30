window.onerror = function(message, source, lineno, colno, error) {
  showDiagnosticError(`JS Error: ${message} (Line ${lineno}:${colno})`);
  return false;
};
window.onunhandledrejection = function(event) {
  showDiagnosticError(`Unhandled Promise Rejection: ${event.reason}`);
};

export function showDiagnosticError(text) {
  let banner = document.getElementById('error-diagnostic-banner');
  if (!banner) {
    banner = document.createElement('div');
    banner.id = 'error-diagnostic-banner';
    
    const header = document.createElement('div');
    header.className = 'header';
    header.innerHTML = `
      <span>⚠️ SYSTEM DIAGNOSTIC ERROR DETECTED</span>
      <button onclick="this.parentElement.parentElement.remove()" class="close-btn">&times;</button>
    `;
    banner.appendChild(header);
    
    const body = document.createElement('div');
    body.id = 'error-diagnostic-body';
    body.className = 'body';
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
export class SnapshotStore {
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

export const snapshotStore = new SnapshotStore();

// ==========================================
// CONSTANTS & CONFIGURATION
// ==========================================
export const LANDMARK_NAMES = [
  "Nose", "L Eye Inner", "L Eye", "L Eye Outer", "R Eye Inner", "R Eye", "R Eye Outer",
  "L Ear", "R Ear", "Mouth Left", "Mouth Right", "L Shoulder", "R Shoulder",
  "L Elbow", "R Elbow", "L Wrist", "R Wrist", "L Pinky", "R Pinky",
  "L Index", "R Index", "L Thumb", "R Thumb", "L Hip", "R Hip",
  "L Knee", "R Knee", "L Ankle", "R Ankle", "L Heel", "R Heel",
  "L Foot Index", "R Foot Index"
];

export const POSE_CONNECTIONS = [
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

export const FINGER_COLORS = {
  thumb: '#ec4899',   // Pink
  index: '#06b6d4',   // Cyan
  middle: '#d4a017',  // Warm Gold
  ring: '#10b981',    // Emerald
  pinky: '#f59e0b'    // Amber
};

// Joint indices mapping
export const LEFT_SHOULDER = 11;
export const RIGHT_SHOULDER = 12;
export const LEFT_ELBOW = 13;
export const RIGHT_ELBOW = 14;
export const LEFT_WRIST = 15;
export const RIGHT_WRIST = 16;
export const LEFT_HIP = 23;
export const RIGHT_HIP = 24;
export const LEFT_KNEE = 25;
export const RIGHT_KNEE = 26;
export const LEFT_ANKLE = 27;
export const RIGHT_ANKLE = 28;
export const LEFT_HEEL = 29;
export const RIGHT_HEEL = 30;
export const LEFT_FOOT_INDEX = 31; // Toe index
export const RIGHT_FOOT_INDEX = 32;

export const MARKER_PHYSICAL_SIZE_CM = 20.0;

// ==========================================
// GLOBAL STATE VARIABLES (SHARED)
// ==========================================
export const state = {
  canvasWidth: 640,
  canvasHeight: 480,
  pixelsPerCm: null,
  calLocked: false,
  useInches: true,
  currentFacingMode: "user",
  wallPerspectiveEnabled: false,
  wallPerspectiveFactor: 1.09, // Increases px/cm scale, decreasing calculated height to correct for being closer to the camera when standing beside wall-mounted ArUco
  calBoxSize: 150,
  calBoxX: 320,
  calBoxY: 240,
  lastVerticalHeightPx: 0,
  lastSkeletalHeightPx: 0,
  latestArucoMarker: null,
  latestHandResults: null,
  frozenHandResults: null,
  countdownValue: 0,
  isCountingDown: false,
  flashOpacity: 0,
  isCaptureCountingDown: false,
  captureCountdownValue: 0,
  isSnapshotFrozen: false,
  frozenJoints: null,
  frozenMetrics: null,
  yoloModeActive: false,
  frameCount: 0,
  latestLeftMiddleTip: null,
  latestRightMiddleTip: null,
  activeStream: null,
  activeCalMethod: 'aruco',
  inputHeightCm: 175.006,
  validationHeightCm: 175.006,
  dbInitialized: false,
  autoActive: false,
  autoState: 'IDLE',
  holdTimerMs: 0,
  lockoutTimerMs: 0,
  lastFrameTime: Date.now(),
  currentGroupId: null,
  frozenAutoJoints: null,
  frozenAutoMetrics: null,
  metricsA: null,
  metricsT: null,
  metricsOverhead: null,
  imageA: null,
  imageT: null,
  imageOverhead: null,
  REQ_HOLD_MS: 2500,
  LOCKOUT_MS: 3500,
  scaleFactor3D: null
};

const smoothBuffers = {};
const lastEmaValues = {};

// ==========================================
// MATH & STRING FORMATTING HELPER FUNCTIONS
// ==========================================
export function smooth(key, val, windowSize = 15, emaAlpha = 0.15) {
  if (!smoothBuffers[key]) smoothBuffers[key] = [];
  const buf = smoothBuffers[key];
  buf.push(val);
  if (buf.length > windowSize) buf.shift();

  // 1. Median filtering to reject tracking glitch outlier spikes
  const sorted = [...buf].sort((a, b) => a - b);
  const median = sorted[Math.floor(sorted.length / 2)];

  // 2. Exponential Moving Average (EMA) to eliminate high-frequency jitter
  if (lastEmaValues[key] === undefined) {
    lastEmaValues[key] = median;
    return median;
  }
  
  lastEmaValues[key] = emaAlpha * median + (1 - emaAlpha) * lastEmaValues[key];
  return lastEmaValues[key];
}

export function clearSmoothBuffer(key) {
  if (key === '*') {
    for (const k in smoothBuffers) {
      delete smoothBuffers[k];
    }
    for (const k in lastEmaValues) {
      delete lastEmaValues[k];
    }
  } else {
    delete smoothBuffers[key];
    delete lastEmaValues[key];
  }
}


export function calculateAngle(p_vertex, p_arm1, p_arm2) {
  const v1 = { x: p_arm1.x - p_vertex.x, y: p_arm1.y - p_vertex.y };
  const v2 = { x: p_arm2.x - p_vertex.x, y: p_arm2.y - p_vertex.y };
  
  const dotProduct = v1.x * v2.x + v1.y * v2.y;
  const mag1 = Math.hypot(v1.x, v1.y);
  const mag2 = Math.hypot(v2.x, v2.y);
  
  if (mag1 === 0 || mag2 === 0) return 0;
  
  const cosTheta = dotProduct / (mag1 * mag2);
  const clampedCos = Math.max(-1, Math.min(1, cosTheta));
  return Math.round(Math.acos(clampedCos) * (180 / Math.PI));
}

export function getCanvasX(normX) {
  const width = state.canvasWidth || 640;
  return state.currentFacingMode === "user" ? (1.0 - normX) * width : normX * width;
}

export function formatLength(cmVal) {
  if (state.useInches) {
    return `${(cmVal / 2.54).toFixed(1)} inches`;
  } else {
    return `${cmVal.toFixed(1)} cm`;
  }
}

export function updateHeightInputUnit() {
  const heightInputLabel = document.querySelector('label[for="input-user-height"]');
  const inputUserHeight = document.getElementById('input-user-height');
  const valHeightLabel = document.getElementById('validation-height-label');
  const inputValidationHeight = document.getElementById('input-validation-height');

  if (heightInputLabel && inputUserHeight) {
    if (state.useInches) {
      heightInputLabel.textContent = "Your Height (inches):";
      const val = parseFloat(inputUserHeight.value);
      if (val > 100) { // If it was in cm, convert to inches
        inputUserHeight.value = parseFloat((val / 2.54).toFixed(2));
      } else if (isNaN(val)) {
        inputUserHeight.value = "68.9";
      }
    } else {
      heightInputLabel.textContent = "Your Height (cm):";
      const val = parseFloat(inputUserHeight.value);
      if (val < 100) { // If it was in inches, convert to cm
        inputUserHeight.value = parseFloat((val * 2.54).toFixed(2));
      } else if (isNaN(val)) {
        inputUserHeight.value = "175";
      }
    }
  }

  if (valHeightLabel && inputValidationHeight) {
    if (state.useInches) {
      valHeightLabel.textContent = "Your True Height (inches):";
      const val = parseFloat(inputValidationHeight.value);
      if (val > 100) { // If it was in cm, convert to inches
        inputValidationHeight.value = parseFloat((val / 2.54).toFixed(2));
      } else if (isNaN(val)) {
        inputValidationHeight.value = "68.9";
      }
    } else {
      valHeightLabel.textContent = "Your True Height (cm):";
      const val = parseFloat(inputValidationHeight.value);
      if (val < 100) { // If it was in inches, convert to cm
        inputValidationHeight.value = parseFloat((val * 2.54).toFixed(2));
      } else if (isNaN(val)) {
        inputValidationHeight.value = "175";
      }
    }
  }
}

export function formatSkeletalHeight(heightCm) {
  const skeletal_inches = heightCm / 2.54;
  const skeletal_feet = Math.floor(skeletal_inches / 12);
  const skeletal_inches_left = skeletal_inches % 12;
  if (state.useInches) {
    return `${skeletal_feet}' ${skeletal_inches_left.toFixed(1)}"`;
  } else {
    return `${heightCm.toFixed(1)} cm`;
  }
}

export function getDomMeasurementCm(elementId) {
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

export function triggerFlashEffect() {
  state.flashOpacity = 0.85;
  const fadeInterval = setInterval(() => {
    state.flashOpacity -= 0.08;
    if (state.flashOpacity <= 0) {
      state.flashOpacity = 0;
      clearInterval(fadeInterval);
    }
  }, 30);
}

export function drawRoundedRect(ctx, x, y, width, height, radius) {
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

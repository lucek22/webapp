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
    this.dbVersion = 2;
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
        if (!db.objectStoreNames.contains("profiles")) {
          db.createObjectStore("profiles", { keyPath: "id", autoIncrement: true });
        }
      };
    });
  }

  _dbRequest(storeName, mode, operation, ...args) {
    return new Promise((resolve, reject) => {
      if (!this.db) {
        reject(new Error("Database not initialized"));
        return;
      }
      const transaction = this.db.transaction([storeName], mode);
      const store = transaction.objectStore(storeName);
      const request = store[operation](...args);

      request.onsuccess = () => resolve(request.result);
      request.onerror = (e) => reject(e.target.error);
    });
  }

  save(snapshot) {
    return this._dbRequest("snapshots", "readwrite", "add", snapshot);
  }

  getAll() {
    return this._dbRequest("snapshots", "readonly", "getAll");
  }

  get(id) {
    return this._dbRequest("snapshots", "readonly", "get", Number(id));
  }

  delete(id) {
    return this._dbRequest("snapshots", "readwrite", "delete", Number(id));
  }

  // ==========================================
  // PROFILE PERSISTENCE OPERATIONS
  // ==========================================
  saveProfile(profile) {
    return this._dbRequest("profiles", "readwrite", "put", profile);
  }

  getProfile(id) {
    return this._dbRequest("profiles", "readonly", "get", Number(id));
  }

  getAllProfiles() {
    return this._dbRequest("profiles", "readonly", "getAll");
  }

  deleteProfile(id) {
    return this._dbRequest("profiles", "readwrite", "delete", Number(id));
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
  thumb: '#FFFFFF',  
  index: '#FFFFFF',   
  middle: '#FFFFFF',  
  ring: '#FFFFFF',    
  pinky: '#FFFFFF'    
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
  currentMode: "posture",
  squatTestingSide: "left",
  squatPeaks: {
    kneeL: 0,
    kneeR: 0,
    hipL: 0,
    hipR: 0,
    ankleL: 0,
    ankleR: 0,
    maxKneeCaveL: 0,
    maxKneeCaveR: 0,
    valgusFirstTimestamp: null,
    valgusPeakTimestamp: null,
    valgusPeakScore: 0
  },
  shoulderTestingSide: "left",
  shoulderPeaks: {
    excursionL: 0,
    excursionR: 0,
    startAngleL: 0,
    startAngleR: 0,
    endAngleL: 0,
    endAngleR: 0,
    jointsL: null,
    jointsR: null
  },
  shoulderRotation: {
    maxExternalRotationL: 0,
    maxInternalRotationL: 0,
    maxExternalRotationR: 0,
    maxInternalRotationR: 0,
    timeSeriesL: [],
    timeSeriesR: []
  },
  hipRotation: {
    maxExternalRotationL: 0,
    maxInternalRotationL: 0,
    maxExternalRotationR: 0,
    maxInternalRotationR: 0,
    timeSeriesL: [],
    timeSeriesR: []
  },
  isUploadedMedia: false,
  uploadedMediaType: null,
  latestPoseResults: null,
  activeModalSnapshotId: null,
  pixelsPerCm: null,
  calLocked: false,
  useInches: true,
  currentFacingMode: "user",
  wallPerspectiveEnabled: false,
  calBoxSize: 150,
  calBoxX: 320,
  calBoxY: 240,
  lastVerticalHeightPx: 0,
  lastSkeletalHeightPx: 0,
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
  cameraDevices: [],
  activeCameraIndex: -1,
  activeCalMethod: 'height',
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
  importedPortfolioMetrics: null,
  imageA: null,
  imageT: null,
  imageOverhead: null,
  REQ_HOLD_MS: 2500,
  LOCKOUT_MS: 3500,
  activeProfileId: null,
  activeSessionId: null,
  allProfiles: [],
  isEditingProfileMetrics: false,
  isRecording: false,

  recordedChunks: [],
  mediaRecorder: null,
  scaleFactor3D: null,
  imageSquatL: null,
  imageSquatR: null,
  imageSquatFrontal: null,
  videoSquatL: null,
  videoSquatR: null,
  videoSquatFrontal: null,
  imageShoulderLStart: null,
  imageShoulderLEnd: null,
  imageShoulderRStart: null,
  imageShoulderREnd: null,
  videoShoulderL: null,
  videoShoulderR: null,
  videos: []
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
  if (!p_vertex || !p_arm1 || !p_arm2 || p_vertex.x === undefined || p_arm1.x === undefined || p_arm2.x === undefined) return 0;
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
  if (state.isUploadedMedia || state.activeModalVideoProcessing) {
    return normX * width;
  }
  return state.currentFacingMode === "user" ? (1.0 - normX) * width : normX * width;
}

export function formatLength(cmVal) {
  if (cmVal === null || cmVal === undefined || isNaN(cmVal)) {
    return state.useInches ? "--.- inches" : "--.- cm";
  }
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
  
  if (text.endsWith('in') || text.endsWith('inches') || text.includes('inch')) {
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

let cachedROMThresholds = null;

export async function getROMThresholds() {
  if (cachedROMThresholds) return cachedROMThresholds;
  try {
    const response = await fetch('rom_thresholds.txt');
    if (response.ok) {
      const text = await response.text();
      cachedROMThresholds = parseROMThresholds(text);
      console.log("[ROM] Loaded ROM thresholds from file:", cachedROMThresholds);
    } else {
      console.warn("[ROM] Could not load rom_thresholds.txt, using defaults");
      cachedROMThresholds = getDefaultROMThresholds();
    }
  } catch (err) {
    console.error("[ROM] Error reading rom_thresholds.txt, using defaults:", err);
    cachedROMThresholds = getDefaultROMThresholds();
  }
  return cachedROMThresholds;
}

export function parseROMThresholds(text) {
  const thresholds = {};
  const lines = text.split('\n');
  for (let line of lines) {
    line = line.trim();
    if (!line || line.startsWith('#') || line.startsWith('//')) continue;
    
    const parts = line.split('|');
    if (parts.length === 2) {
      const highVal = parseFloat(parts[1].trim());
      const leftPart = parts[0].trim();
      
      const spaceIdx = leftPart.lastIndexOf(' ');
      if (spaceIdx !== -1) {
        const testName = leftPart.substring(0, spaceIdx).trim();
        const lowVal = parseFloat(leftPart.substring(spaceIdx).trim());
        
        if (!isNaN(lowVal) && !isNaN(highVal)) {
          thresholds[testName] = { low: lowVal, high: highVal };
        }
      }
    }
  }
  return thresholds;
}

export function getDefaultROMThresholds() {
  return {
    "External Rotation": { low: 60, high: 85 },
    "Internal Rotation": { low: 50, high: 75 },
    "Shoulder Flexion": { low: 150, high: 170 },
    "Knee Flexion": { low: 80, high: 110 },
    "Hip External Rotation": { low: 30, high: 45 },
    "Hip Internal Rotation": { low: 30, high: 45 }
  };
}

export function calculateROMGrade(value, low, high) {
  const absVal = Math.abs(value);
  if (absVal === 0) return null; // Avoid grading unrecorded sessions
  if (absVal <= low) return 1;
  if (absVal <= high) return 2;
  return 3;
}

export function updateShoulderRotationGrades(shRot, thresholds) {
  const extT = thresholds?.["External Rotation"] || { low: 60, high: 85 };
  const intT = thresholds?.["Internal Rotation"] || { low: 50, high: 75 };
  
  shRot.gradeExternalL = calculateROMGrade(shRot.maxExternalRotationL, extT.low, extT.high);
  shRot.gradeInternalL = calculateROMGrade(shRot.maxInternalRotationL, intT.low, intT.high);
  shRot.gradeExternalR = calculateROMGrade(shRot.maxExternalRotationR, extT.low, extT.high);
  shRot.gradeInternalR = calculateROMGrade(shRot.maxInternalRotationR, intT.low, intT.high);
}


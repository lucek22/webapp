// ==========================================
// MEDIAPIPE CORE CV MODELS SETUP & CALCULATIONS
// ==========================================
import {
  state,
  smooth,
  calculateAngle,
  getCanvasX,
  formatLength,
  LEFT_SHOULDER,
  RIGHT_SHOULDER,
  LEFT_ELBOW,
  RIGHT_ELBOW,
  LEFT_WRIST,
  RIGHT_WRIST,
  LEFT_HIP,
  RIGHT_HIP,
  LEFT_KNEE,
  RIGHT_KNEE,
  LEFT_ANKLE,
  RIGHT_ANKLE,
  LEFT_HEEL,
  RIGHT_HEEL,
  LEFT_FOOT_INDEX,
  RIGHT_FOOT_INDEX,
  FINGER_COLORS
} from './helpers.js';

// MediaPipe Pose Setup
export const pose = new Pose({
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
export const hands = new Hands({
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

// Callbacks registered dynamically
let onPoseResults = null;
let drawHandMesh = null;

export function setupMediaPipeCallbacks(onPoseResultsCb, drawHandMeshCb) {
  onPoseResults = onPoseResultsCb;
  drawHandMesh = drawHandMeshCb;
}

// Register model callbacks
hands.onResults((results) => {
  state.latestHandResults = results;
  updateHandTracking(results);
  
  if (!state.isSnapshotFrozen && drawHandMesh) {
    drawHandMesh(results.multiHandLandmarks, results.multiHandedness);
  }
});

pose.onResults((results) => {
  if (onPoseResults) {
    onPoseResults(results);
  }
});

// ==========================================
// BIOMECHANICAL CALCULATIONS LOGIC
// ==========================================

/**
 * Extract landmarks, calculate joints in pixels, vertical/skeletal heights, and joint angles.
 * @param {Object} results MediaPipe pose results 
 * @returns {Object|null} Calculations record or null.
 */
export function calculatePoseMetrics(results) {
  if (!results.poseLandmarks) return null;

  const lm = results.poseLandmarks;
  const mirrorX = getCanvasX;

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

  // --- CALCULATE REAL-TIME FLEXION ANGLES ---
  const kneeAngleL = calculateAngle(knee_l, hip_l, ankle_l);
  const kneeAngleR = calculateAngle(knee_r, hip_r, ankle_r);
  const hipAngleL = calculateAngle(hip_l, shoulder_l, knee_l);
  const hipAngleR = calculateAngle(hip_r, shoulder_r, knee_r);
  const elbowAngleL = calculateAngle(elbow_l, shoulder_l, wrist_l);
  const elbowAngleR = calculateAngle(elbow_r, shoulder_r, wrist_r);

  // Vertical height ground plane
  const foot_l_bottom = Math.max(heel_l.y, toe_l.y);
  const foot_r_bottom = Math.max(heel_r.y, toe_r.y);
  const ground_y = (foot_l_bottom + foot_r_bottom) / 2;

  let liveMetrics = null;

  // --- CALCULATE PHYSICAL LENGTHS (IF SCALE LOCKED) ---
  if (state.pixelsPerCm) {
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

    // Left Finger to Toe (middle fingertip or index fallback or wrist fallback to foot index/toe landmark)
    const finger_l = state.latestLeftMiddleTip || all_landmarks[19] || wrist_l;
    const fingerToToeL_px = Math.hypot(finger_l.x - toe_l.x, finger_l.y - toe_l.y);

    // Right Finger to Toe (middle fingertip or index fallback or wrist fallback to foot index/toe landmark)
    const finger_r = state.latestRightMiddleTip || all_landmarks[20] || wrist_r;
    const fingerToToeR_px = Math.hypot(finger_r.x - toe_r.x, finger_r.y - toe_r.y);

    // Vertical height using lowest foot contacts (heels/toes) as the ground plane
    const vertical_height_px = Math.abs(ground_y - head_top.y);
    state.lastVerticalHeightPx = vertical_height_px; // Save for input-based calibration

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
    state.lastSkeletalHeightPx = skeletal_height_px; // Save for input-based calibration

    const skeletal_height_cm = skeletal_height_px / state.pixelsPerCm;
    const live_height_cm = vertical_height_px / state.pixelsPerCm;

    // Calculate Wingspan (using Middle Fingertips if detected, or Pose Indexes 19 & 20 as fallback)
    let wingspan_cm = 0;
    if (state.latestLeftMiddleTip && state.latestRightMiddleTip) {
      const dist_px = Math.hypot(state.latestLeftMiddleTip.x - state.latestRightMiddleTip.x, state.latestLeftMiddleTip.y - state.latestRightMiddleTip.y);
      wingspan_cm = dist_px / state.pixelsPerCm;
    } else {
      // Fallback: Use Pose indexes 19 and 20 (L Index and R Index)
      const leftIdx = all_landmarks[19];
      const rightIdx = all_landmarks[20];
      if (leftIdx && rightIdx) {
        const dist_px = Math.hypot(leftIdx.x - rightIdx.x, leftIdx.y - rightIdx.y);
        wingspan_cm = dist_px / state.pixelsPerCm;
      }
    }

    // Convert to direct physical units and apply smoothing
    liveMetrics = {
      thigh_l: smooth('thigh_l', thigh_l_px / state.pixelsPerCm),
      thigh_r: smooth('thigh_r', thigh_r_px / state.pixelsPerCm),
      shin_l: smooth('shin_l', shin_l_px / state.pixelsPerCm),
      shin_r: smooth('shin_r', shin_r_px / state.pixelsPerCm),
      foot_l: smooth('foot_l', foot_l_px / state.pixelsPerCm),
      foot_r: smooth('foot_r', foot_r_px / state.pixelsPerCm),
      
      torso_l: smooth('torso_l', torso_l_px / state.pixelsPerCm),
      torso_r: smooth('torso_r', torso_r_px / state.pixelsPerCm),
      upperarm_l: smooth('upperarm_l', upperarm_l_px / state.pixelsPerCm),
      upperarm_r: smooth('upperarm_r', upperarm_r_px / state.pixelsPerCm),
      forearm_l: smooth('forearm_l', forearm_l_px / state.pixelsPerCm),
      forearm_r: smooth('forearm_r', forearm_r_px / state.pixelsPerCm),

      fingerToToeL: smooth('finger_to_toe_l', fingerToToeL_px / state.pixelsPerCm),
      fingerToToeR: smooth('finger_to_toe_r', fingerToToeR_px / state.pixelsPerCm),
      shoulderW: smooth('shoulderW', shoulderW_px / state.pixelsPerCm),
      hipW: smooth('hipW', hipW_px / state.pixelsPerCm),
      wingspan: smooth('wingspan_distance', wingspan_cm),

      skeletal_height: smooth('body_height_skeletal', skeletal_height_cm),
      live_height: smooth('body_height_live', live_height_cm),

      kneeAngleL, kneeAngleR, hipAngleL, hipAngleR, elbowAngleL, elbowAngleR
    };

    // Real-time Pose Detection Logic
    let detectedPose = "A-Pose";
    if (liveMetrics.skeletal_height > 0) {
      const wingspanRatio = liveMetrics.wingspan / liveMetrics.skeletal_height;
      const avgFingerToToe = (liveMetrics.fingerToToeL + liveMetrics.fingerToToeR) / 2;
      const fingerToToeRatio = avgFingerToToe / liveMetrics.skeletal_height;

      if (wingspanRatio > 0.83) {
        detectedPose = "T-Pose";
      } else if (fingerToToeRatio > 1.20) {
        detectedPose = "Overhead Reach";
      } else {
        detectedPose = "A-Pose";
      }
    }
    liveMetrics.pose = detectedPose;
  }

  return {
    shoulder_l, elbow_l, wrist_l, hip_l, knee_l, ankle_l, heel_l, toe_l,
    shoulder_r, elbow_r, wrist_r, hip_r, knee_r, ankle_r, heel_r, toe_r,
    head_top, ground_y, all_landmarks,
    kneeAngleL, kneeAngleR, hipAngleL, hipAngleR, elbowAngleL, elbowAngleR,
    liveMetrics
  };
}

/**
 * Handle Hand Tracking metrics updates on the UI.
 * @param {Object} results MediaPipe hands results 
 */
export function updateHandTracking(results) {
  if (state.isSnapshotFrozen) return;

  const multiLandmarks = results.multiHandLandmarks;
  const multiHandedness = results.multiHandedness;

  let leftDetected = false;
  let rightDetected = false;

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

  if (multiLandmarks && multiHandedness) {
    multiLandmarks.forEach((landmarks, index) => {
      const handedness = multiHandedness[index];
      const side = handedness.label; // 'Left' or 'Right'
      
      if (side === 'Left') leftDetected = true;
      if (side === 'Right') rightDetected = true;

      const wrist = { x: getCanvasX(landmarks[0].x), y: landmarks[0].y * 480 };
      const thumbTip = { x: getCanvasX(landmarks[4].x), y: landmarks[4].y * 480 };
      const indexTip = { x: getCanvasX(landmarks[8].x), y: landmarks[8].y * 480 };
      const middleTip = { x: getCanvasX(landmarks[12].x), y: landmarks[12].y * 480 };
      const ringTip = { x: getCanvasX(landmarks[16].x), y: landmarks[16].y * 480 };
      const pinkyTip = { x: getCanvasX(landmarks[20].x), y: landmarks[20].y * 480 };

      let pinchSpanStr = "--.- cm";
      let handSpanStr = "--.- cm";

      if (state.pixelsPerCm) {
        const pinchPx = Math.hypot(thumbTip.x - indexTip.x, thumbTip.y - indexTip.y);
        const pinchCm = pinchPx / state.pixelsPerCm;
        pinchSpanStr = formatLength(smooth(side + '_pinch', pinchCm));

        const spanPx = Math.hypot(wrist.x - middleTip.x, wrist.y - middleTip.y);
        const spanCm = spanPx / state.pixelsPerCm;
        handSpanStr = formatLength(smooth(side + '_span', spanCm));
      }

      const tips = [thumbTip, indexTip, middleTip, ringTip, pinkyTip];

      if (side === 'Left') {
        state.latestLeftMiddleTip = middleTip;
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
        state.latestRightMiddleTip = middleTip;
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
    state.latestLeftMiddleTip = null;
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
    state.latestRightMiddleTip = null;
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

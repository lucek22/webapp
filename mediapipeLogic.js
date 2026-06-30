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

  // Safety check: Make sure all required landmarks exist in the poseLandmarks array
  const requiredIndices = [7, 8, 11, 12, 13, 14, 15, 16, 23, 24, 25, 26, 27, 28, 29, 30, 31, 32];
  for (const idx of requiredIndices) {
    if (!lm[idx]) {
      console.warn(`Missing required landmark index ${idx} in calculatePoseMetrics`);
      return null;
    }
  }

  const mirrorX = getCanvasX;
  const height = state.canvasHeight || 480;

  // Resolve normalized coordinates to pixels (LEFT)
  const shoulder_l = { x: mirrorX(lm[LEFT_SHOULDER].x), y: lm[LEFT_SHOULDER].y * height };
  const elbow_l = { x: mirrorX(lm[LEFT_ELBOW].x), y: lm[LEFT_ELBOW].y * height };
  const wrist_l = { x: mirrorX(lm[LEFT_WRIST].x), y: lm[LEFT_WRIST].y * height };
  const hip_l = { x: mirrorX(lm[LEFT_HIP].x), y: lm[LEFT_HIP].y * height };
  const knee_l = { x: mirrorX(lm[LEFT_KNEE].x), y: lm[LEFT_KNEE].y * height };
  const ankle_l = { x: mirrorX(lm[LEFT_ANKLE].x), y: lm[LEFT_ANKLE].y * height };
  const heel_l = { x: mirrorX(lm[LEFT_HEEL].x), y: lm[LEFT_HEEL].y * height };
  const toe_l = { x: mirrorX(lm[LEFT_FOOT_INDEX].x), y: lm[LEFT_FOOT_INDEX].y * height };

  // Resolve normalized coordinates to pixels (RIGHT)
  const shoulder_r = { x: mirrorX(lm[RIGHT_SHOULDER].x), y: lm[RIGHT_SHOULDER].y * height };
  const elbow_r = { x: mirrorX(lm[RIGHT_ELBOW].x), y: lm[RIGHT_ELBOW].y * height };
  const wrist_r = { x: mirrorX(lm[RIGHT_WRIST].x), y: lm[RIGHT_WRIST].y * height };
  const hip_r = { x: mirrorX(lm[RIGHT_HIP].x), y: lm[RIGHT_HIP].y * height };
  const knee_r = { x: mirrorX(lm[RIGHT_KNEE].x), y: lm[RIGHT_KNEE].y * height };
  const ankle_r = { x: mirrorX(lm[RIGHT_ANKLE].x), y: lm[RIGHT_ANKLE].y * height };
  const heel_r = { x: mirrorX(lm[RIGHT_HEEL].x), y: lm[RIGHT_HEEL].y * height };
  const toe_r = { x: mirrorX(lm[RIGHT_FOOT_INDEX].x), y: lm[RIGHT_FOOT_INDEX].y * height };

  // --- CALCULATE HEAD TOP ---
  const shoulder_mid = {
    x: (shoulder_l.x + shoulder_r.x) / 2,
    y: (shoulder_l.y + shoulder_r.y) / 2
  };
  const hip_mid_x = (hip_l.x + hip_r.x) / 2;
  const hip_mid_y = (hip_l.y + hip_r.y) / 2;
  const ear_mid = {
    x: (mirrorX(lm[7].x) + mirrorX(lm[8].x)) / 2,
    y: (lm[7].y * height + lm[8].y * height) / 2
  };
  // The top of the head (crown) is approximately 65% of the shoulder-to-ear neck height or 70% of ear-to-ear distance above ear level (maximum to prevent shrugging/posture errors)
  const shoulder_to_ear_px = Math.abs(shoulder_mid.y - ear_mid.y);
  const ear_to_ear_px = Math.hypot(mirrorX(lm[7].x) - mirrorX(lm[8].x), (lm[7].y - lm[8].y) * height);
  const ear_to_crown_px = Math.max(shoulder_to_ear_px * 0.65, ear_to_ear_px * 0.70);
  const head_top = {
    x: ear_mid.x,
    y: ear_mid.y - ear_to_crown_px
  };

  const all_landmarks = lm.map(l => ({ x: mirrorX(l.x), y: l.y * height }));

  // --- CALCULATE REAL-TIME FLEXION ANGLES ---
  const kneeAngleL = calculateAngle(knee_l, hip_l, ankle_l);
  const kneeAngleR = calculateAngle(knee_r, hip_r, ankle_r);
  const hipAngleL = calculateAngle(hip_l, shoulder_l, knee_l);
  const hipAngleR = calculateAngle(hip_r, shoulder_r, knee_r);
  const elbowAngleL = calculateAngle(elbow_l, shoulder_l, wrist_l);
  const elbowAngleR = calculateAngle(elbow_r, shoulder_r, wrist_r);
  const ankleAngleL = calculateAngle(ankle_l, knee_l, toe_l);
  const ankleAngleR = calculateAngle(ankle_r, knee_r, toe_r);

  // Vertical height ground plane
  const foot_l_bottom = Math.max(heel_l.y, toe_l.y);
  const foot_r_bottom = Math.max(heel_r.y, toe_r.y);
  const ground_y = (foot_l_bottom + foot_r_bottom) / 2;

  let liveMetrics = null;
  const wl = results.poseWorldLandmarks;

  // Auto-calibrate state.pixelsPerCm using pre-measured portfolio stature if present
  if (state.importedPortfolioMetrics && state.importedPortfolioMetrics.skeletal_height) {
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
    if (skeletal_height_px > 10) {
      state.pixelsPerCm = skeletal_height_px / state.importedPortfolioMetrics.skeletal_height;
      state.calLocked = true;
    }
  }

  // Perform 3D calculations if world landmarks are available
  if (wl && wl.length > 0) {
    const wl_shoulder_l = wl[LEFT_SHOULDER];
    const wl_shoulder_r = wl[RIGHT_SHOULDER];
    const wl_ear_l = wl[7];
    const wl_ear_r = wl[8];
    const wl_hip_l = wl[LEFT_HIP];
    const wl_hip_r = wl[RIGHT_HIP];
    const wl_knee_l = wl[LEFT_KNEE];
    const wl_knee_r = wl[RIGHT_KNEE];
    const wl_ankle_l = wl[LEFT_ANKLE];
    const wl_ankle_r = wl[RIGHT_ANKLE];
    const wl_heel_l = wl[LEFT_HEEL];
    const wl_heel_r = wl[RIGHT_HEEL];
    const wl_toe_l = wl[LEFT_FOOT_INDEX];
    const wl_toe_r = wl[RIGHT_FOOT_INDEX];
    const wl_elbow_l = wl[LEFT_ELBOW];
    const wl_elbow_r = wl[RIGHT_ELBOW];
    const wl_wrist_l = wl[LEFT_WRIST];
    const wl_wrist_r = wl[RIGHT_WRIST];

    const wl_shoulder_mid = {
      x: (wl_shoulder_l.x + wl_shoulder_r.x) / 2,
      y: (wl_shoulder_l.y + wl_shoulder_r.y) / 2,
      z: (wl_shoulder_l.z + wl_shoulder_r.z) / 2
    };

    const wl_ear_mid = {
      x: (wl_ear_l.x + wl_ear_r.x) / 2,
      y: (wl_ear_l.y + wl_ear_r.y) / 2,
      z: (wl_ear_l.z + wl_ear_r.z) / 2
    };

    const shoulder_to_ear_wl = Math.hypot(
      wl_shoulder_mid.x - wl_ear_mid.x,
      wl_shoulder_mid.y - wl_ear_mid.y,
      wl_shoulder_mid.z - wl_ear_mid.z
    );

    const ear_to_ear_wl = Math.hypot(
      wl_ear_l.x - wl_ear_r.x,
      wl_ear_l.y - wl_ear_r.y,
      wl_ear_l.z - wl_ear_r.z
    );

    const ear_to_crown_wl = Math.max(shoulder_to_ear_wl * 0.65, ear_to_ear_wl * 0.70);

    const wl_head_top = {
      x: wl_ear_mid.x,
      y: wl_ear_mid.y - ear_to_crown_wl,
      z: wl_ear_mid.z
    };

    const wl_hip_mid = {
      x: (wl_hip_l.x + wl_hip_r.x) / 2,
      y: (wl_hip_l.y + wl_hip_r.y) / 2,
      z: (wl_hip_l.z + wl_hip_r.z) / 2
    };

    // Calculate virtual segment lengths in 3D (converted from meters to cm by * 100)
    const thigh_l_wl = Math.hypot(wl_hip_l.x - wl_knee_l.x, wl_hip_l.y - wl_knee_l.y, wl_hip_l.z - wl_knee_l.z) * 100;
    const thigh_r_wl = Math.hypot(wl_hip_r.x - wl_knee_r.x, wl_hip_r.y - wl_knee_r.y, wl_hip_r.z - wl_knee_r.z) * 100;

    const shin_l_wl = Math.hypot(wl_knee_l.x - wl_ankle_l.x, wl_knee_l.y - wl_ankle_l.y, wl_knee_l.z - wl_ankle_l.z) * 100;
    const shin_r_wl = Math.hypot(wl_knee_r.x - wl_ankle_r.x, wl_knee_r.y - wl_ankle_r.y, wl_knee_r.z - wl_ankle_r.z) * 100;

    const foot_l_wl = Math.hypot(wl_ankle_l.x - wl_toe_l.x, wl_ankle_l.y - wl_toe_l.y, wl_ankle_l.z - wl_toe_l.z) * 100;
    const foot_r_wl = Math.hypot(wl_ankle_r.x - wl_toe_r.x, wl_ankle_r.y - wl_toe_r.y, wl_ankle_r.z - wl_toe_r.z) * 100;

    const torso_l_wl = Math.hypot(wl_shoulder_l.x - wl_hip_l.x, wl_shoulder_l.y - wl_hip_l.y, wl_shoulder_l.z - wl_hip_l.z) * 100;
    const torso_r_wl = Math.hypot(wl_shoulder_r.x - wl_hip_r.x, wl_shoulder_r.y - wl_hip_r.y, wl_shoulder_r.z - wl_hip_r.z) * 100;

    const upperarm_l_wl = Math.hypot(wl_shoulder_l.x - wl_elbow_l.x, wl_shoulder_l.y - wl_elbow_l.y, wl_shoulder_l.z - wl_elbow_l.z) * 100;
    const upperarm_r_wl = Math.hypot(wl_shoulder_r.x - wl_elbow_r.x, wl_shoulder_r.y - wl_elbow_r.y, wl_shoulder_r.z - wl_elbow_r.z) * 100;

    const forearm_l_wl = Math.hypot(wl_elbow_l.x - wl_wrist_l.x, wl_elbow_l.y - wl_wrist_l.y, wl_elbow_l.z - wl_wrist_l.z) * 100;
    const forearm_r_wl = Math.hypot(wl_elbow_r.x - wl_wrist_r.x, wl_elbow_r.y - wl_wrist_r.y, wl_elbow_r.z - wl_wrist_r.z) * 100;

    const shoulderW_wl = Math.hypot(wl_shoulder_l.x - wl_shoulder_r.x, wl_shoulder_l.y - wl_shoulder_r.y, wl_shoulder_l.z - wl_shoulder_r.z) * 100;
    const hipW_wl = Math.hypot(wl_hip_l.x - wl_hip_r.x, wl_hip_l.y - wl_hip_r.y, wl_hip_l.z - wl_hip_r.z) * 100;

    const wl_finger_l = wl[19] || wl[LEFT_WRIST];
    const fingerToToeL_wl = Math.hypot(wl_finger_l.x - wl_toe_l.x, wl_finger_l.y - wl_toe_l.y, wl_finger_l.z - wl_toe_l.z) * 100;

    const wl_finger_r = wl[20] || wl[RIGHT_WRIST];
    const fingerToToeR_wl = Math.hypot(wl_finger_r.x - wl_toe_r.x, wl_finger_r.y - wl_toe_r.y, wl_finger_r.z - wl_toe_r.z) * 100;

    const wl_left_index = wl[19] || wl[LEFT_WRIST];
    const wl_right_index = wl[20] || wl[RIGHT_WRIST];
    // Posture-independent, segment-summed path for 3D wingspan:
    // (Left hand + Left forearm + Left upper arm + Shoulder width + Right upper arm + Right forearm + Right hand)
    // Note: We scale wrist-to-index distance by 1.42x to estimate the full hand length up to the middle fingertip,
    // as MediaPipe Pose only tracks up to the index finger knuckle/tip.
    const hand_l_wl = Math.hypot(wl_wrist_l.x - wl_left_index.x, wl_wrist_l.y - wl_left_index.y, wl_wrist_l.z - wl_left_index.z) * 100 * 1.42;
    const hand_r_wl = Math.hypot(wl_wrist_r.x - wl_right_index.x, wl_wrist_r.y - wl_right_index.y, wl_wrist_r.z - wl_right_index.z) * 100 * 1.42;
    // Note: We apply an anatomical correction factor of 1.11x to compensate for MediaPipe's systemic 
    // monocular depth compression/smoothing of outstretched limbs and neutral shoulder joint center-of-rotation placement.
    const wingspan_wl = (upperarm_l_wl + forearm_l_wl + hand_l_wl + shoulderW_wl + upperarm_r_wl + forearm_r_wl + hand_r_wl) * 1.11;

    // Direct straight fingertip-to-fingertip distance for pose detection (posture-dependent)
    const wingspan_straight_wl = Math.hypot(
      wl_left_index.x - wl_right_index.x,
      wl_left_index.y - wl_right_index.y,
      wl_left_index.z - wl_right_index.z
    ) * 100 * 1.42 * 1.11;

    // Skeletal (posture-independent) stature calculation in 3D
    const head_segment_wl = Math.hypot(wl_head_top.x - wl_shoulder_mid.x, wl_head_top.y - wl_shoulder_mid.y, wl_head_top.z - wl_shoulder_mid.z) * 100;
    const torso_segment_wl = Math.hypot(wl_shoulder_mid.x - wl_hip_mid.x, wl_shoulder_mid.y - wl_hip_mid.y, wl_shoulder_mid.z - wl_hip_mid.z) * 100;

    const leg_l_wl = (
      Math.hypot(wl_hip_l.x - wl_knee_l.x, wl_hip_l.y - wl_knee_l.y, wl_hip_l.z - wl_knee_l.z) +
      Math.hypot(wl_knee_l.x - wl_ankle_l.x, wl_knee_l.y - wl_ankle_l.y, wl_knee_l.z - wl_ankle_l.z) +
      Math.hypot(wl_ankle_l.x - wl_heel_l.x, wl_ankle_l.y - wl_heel_l.y, wl_ankle_l.z - wl_heel_l.z)
    ) * 100;

    const leg_r_wl = (
      Math.hypot(wl_hip_r.x - wl_knee_r.x, wl_hip_r.y - wl_knee_r.y, wl_hip_r.z - wl_knee_r.z) +
      Math.hypot(wl_knee_r.x - wl_ankle_r.x, wl_knee_r.y - wl_ankle_r.y, wl_knee_r.z - wl_ankle_r.z) +
      Math.hypot(wl_ankle_r.x - wl_heel_r.x, wl_ankle_r.y - wl_heel_r.y, wl_ankle_r.z - wl_heel_r.z)
    ) * 100;

    const average_leg_wl = (leg_l_wl + leg_r_wl) / 2;
    const skeletal_height_wl = head_segment_wl + torso_segment_wl + average_leg_wl;

    // Ground plane vertical height in 3D
    const wl_foot_l_bottom = Math.max(wl_heel_l.y, wl_toe_l.y);
    const wl_foot_r_bottom = Math.max(wl_heel_r.y, wl_toe_r.y);
    const wl_ground_y = (wl_foot_l_bottom + wl_foot_r_bottom) / 2;
    const wl_vertical_height_cm = Math.abs(wl_ground_y - wl_head_top.y) * 100;

    const torso_segment_px = Math.hypot(shoulder_mid.x - hip_mid_x, shoulder_mid.y - hip_mid_y);

    // --- DETERMINE 3D LANDMARK SCALE FACTOR ---
    let scaleFactor3D = null;

    if (state.activeCalMethod === 'height') {
      if (state.inputHeightCm && skeletal_height_wl > 10) {
        const rawScale3D = state.inputHeightCm / skeletal_height_wl;
        scaleFactor3D = smooth('scale_factor_3d_height', rawScale3D, 8, 0.25);
        state.scaleFactor3D = scaleFactor3D;
      }
    } else if (state.activeCalMethod === 'aruco' || state.activeCalMethod === 'card') {
      if (state.pixelsPerCm) {
        // Only update the 3D scale factor when calibration is active/unlocked.
        // In ArUco mode, only update when the marker is actively detected in the current frame.
        // Once they put it away and step back, the 3D scale remains locked and fully depth-invariant!
        let shouldUpdate3DScale = false;
        if (state.activeCalMethod === 'aruco') {
          shouldUpdate3DScale = !!state.latestArucoMarker;
        } else if (state.activeCalMethod === 'card') {
          shouldUpdate3DScale = !state.calLocked || !state.scaleFactor3D;
        }

        // Strictly do not calculate/update scaleFactor3D in ArUco mode unless we actively have a marker detected!
        // This prevents the scale factor from initializing to some incorrect state when starting or when noise occurs.
        const canCalculate = (state.activeCalMethod === 'aruco') ? !!state.latestArucoMarker : (shouldUpdate3DScale || !state.scaleFactor3D);

        if (canCalculate) {
          // Find real torso length using 2d distance between shoulders and hips compared with the 2D calibration factor
          const realTorsoLengthCm = torso_segment_px / state.pixelsPerCm;
          if (torso_segment_wl > 5) {
            const rawScale3D = realTorsoLengthCm / torso_segment_wl;
            scaleFactor3D = smooth('scale_factor_3d_aruco', rawScale3D, 8, 0.25);
            state.scaleFactor3D = scaleFactor3D;
          }
        } else {
          // Use locked/stable scale factor to ensure depth invariance
          scaleFactor3D = state.scaleFactor3D;
        }
      }
    }

    // Maintain 2D calibration state for any 2D canvas drawing / manual fallback, hand tracking, etc.
    const vertical_height_px = Math.abs(ground_y - head_top.y);
    const head_segment_px = Math.hypot(head_top.x - shoulder_mid.x, head_top.y - shoulder_mid.y);
>>>>>>> 3d-landmark-change
    const leg_l_px = Math.hypot(hip_l.x - knee_l.x, hip_l.y - knee_l.y) + 
                     Math.hypot(knee_l.x - ankle_l.x, knee_l.y - ankle_l.y) + 
                     Math.hypot(ankle_l.x - heel_l.x, ankle_l.y - heel_l.y);
    const leg_r_px = Math.hypot(hip_r.x - knee_r.x, hip_r.y - knee_r.y) + 

    state.lastVerticalHeightPx = vertical_height_px;
    state.lastSkeletalHeightPx = skeletal_height_px;

    if (state.importedPortfolioMetrics && state.importedPortfolioMetrics.skeletal_height) {
      if (skeletal_height_px > 10) {
        state.pixelsPerCm = skeletal_height_px / state.importedPortfolioMetrics.skeletal_height;
        state.calLocked = true;
      }
    } else if (state.activeCalMethod === 'height' && state.inputHeightCm && skeletal_height_px > 10) {
      const rawScale = skeletal_height_px / state.inputHeightCm;
      state.pixelsPerCm = smooth('height_scale_calibration', rawScale, 8, 0.25);
    }

    if (scaleFactor3D !== null && scaleFactor3D !== undefined) {
      let skeletal_height_cm = skeletal_height_wl * scaleFactor3D;
      if (state.activeCalMethod === 'height' && state.inputHeightCm) {
        skeletal_height_cm = state.inputHeightCm;
      }

      liveMetrics = {
        thigh_l: smooth('thigh_l', thigh_l_wl * scaleFactor3D, 8, 0.25),
        thigh_r: smooth('thigh_r', thigh_r_wl * scaleFactor3D, 8, 0.25),
        shin_l: smooth('shin_l', shin_l_wl * scaleFactor3D, 8, 0.25),
        shin_r: smooth('shin_r', shin_r_wl * scaleFactor3D, 8, 0.25),
        foot_l: smooth('foot_l', foot_l_wl * scaleFactor3D, 8, 0.25),
        foot_r: smooth('foot_r', foot_r_wl * scaleFactor3D, 8, 0.25),
        
        torso_l: smooth('torso_l', torso_l_wl * scaleFactor3D, 8, 0.25),
        torso_r: smooth('torso_r', torso_r_wl * scaleFactor3D, 8, 0.25),
        upperarm_l: smooth('upperarm_l', upperarm_l_wl * scaleFactor3D, 8, 0.25),
        upperarm_r: smooth('upperarm_r', upperarm_r_wl * scaleFactor3D, 8, 0.25),
        forearm_l: smooth('forearm_l', forearm_l_wl * scaleFactor3D, 8, 0.25),
        forearm_r: smooth('forearm_r', forearm_r_wl * scaleFactor3D, 8, 0.25),

        fingerToToeL: smooth('finger_to_toe_l', fingerToToeL_wl * scaleFactor3D, 8, 0.25),
        fingerToToeR: smooth('finger_to_toe_r', fingerToToeR_wl * scaleFactor3D, 8, 0.25),
        shoulderW: smooth('shoulderW', shoulderW_wl * scaleFactor3D, 8, 0.25),
        hipW: smooth('hipW', hipW_wl * scaleFactor3D, 8, 0.25),
        wingspan: smooth('wingspan_distance', wingspan_wl * scaleFactor3D, 8, 0.25),

        skeletal_height: state.activeCalMethod === 'height' && state.inputHeightCm ? state.inputHeightCm : smooth('body_height_skeletal', skeletal_height_cm, 8, 0.25),
        live_height: smooth('body_height_live', wl_vertical_height_cm * scaleFactor3D, 8, 0.25),

        kneeAngleL, kneeAngleR, hipAngleL, hipAngleR, elbowAngleL, elbowAngleR
      };

      // Real-time Pose Detection Logic
      let detectedPose = "A-Pose";
      if (liveMetrics.skeletal_height > 0) {
        const wingspanStraightCm = smooth('wingspan_straight', wingspan_straight_wl * scaleFactor3D, 8, 0.25);
        const wingspanRatio = wingspanStraightCm / liveMetrics.skeletal_height;
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
  } else if (state.pixelsPerCm || state.activeCalMethod === 'height') {    // 2D Fallback Calculations (in case 3D world landmarks are not available in current environment)
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

    let activePixelsPerCm = state.pixelsPerCm;
    if (state.activeCalMethod === 'height' && state.inputHeightCm && skeletal_height_px > 10) {
      const rawScale = skeletal_height_px / state.inputHeightCm;
      activePixelsPerCm = smooth('height_scale_calibration', rawScale, 8, 0.25);
      state.pixelsPerCm = activePixelsPerCm;
    } else if (state.autoActive && state.metricsA && state.metricsA.skeletal_height) {
      activePixelsPerCm = skeletal_height_px / state.metricsA.skeletal_height;
    }

    let skeletal_height_cm = skeletal_height_px / activePixelsPerCm;
    const live_height_cm = vertical_height_px / activePixelsPerCm;

    if (state.activeCalMethod === 'height' && state.inputHeightCm) {
      skeletal_height_cm = state.inputHeightCm;
    }

    // Calculate Wingspan using posture-independent segment-summed path (shoulders + upperarms + forearms + hands)
    // Note: We scale wrist-to-index distance by 1.42x if falling back to Pose index landmark (Hands model offline),
    // since the Pose index landmark is shorter than the actual middle fingertip.
    const left_hand_is_fallback = !state.latestLeftMiddleTip;
    const hand_l_px = Math.hypot(wrist_l.x - finger_l.x, wrist_l.y - finger_l.y) * (left_hand_is_fallback ? 1.42 : 1.0);

    const right_hand_is_fallback = !state.latestRightMiddleTip;
    const hand_r_px = Math.hypot(wrist_r.x - finger_r.x, wrist_r.y - finger_r.y) * (right_hand_is_fallback ? 1.42 : 1.0);

    // Apply the same 1.11x compensation factor to align with 3D and correct for MediaPipe skeletal deficits
    const wingspan_px = (upperarm_l_px + forearm_l_px + hand_l_px + shoulderW_px + upperarm_r_px + forearm_r_px + hand_r_px) * 1.11;
    const wingspan_cm = wingspan_px / activePixelsPerCm;

    // Direct straight fingertip-to-fingertip distance for pose detection (posture-dependent)
    const straight_wingspan_px = Math.hypot(finger_l.x - finger_r.x, finger_l.y - finger_r.y) * (left_hand_is_fallback || right_hand_is_fallback ? 1.42 : 1.0) * 1.11;
    const straight_wingspan_cm = straight_wingspan_px / activePixelsPerCm;

    liveMetrics = {
      thigh_l: smooth('thigh_l', thigh_l_px / activePixelsPerCm),
      thigh_r: smooth('thigh_r', thigh_r_px / activePixelsPerCm),
      shin_l: smooth('shin_l', shin_l_px / activePixelsPerCm),
      shin_r: smooth('shin_r', shin_r_px / activePixelsPerCm),
      foot_l: smooth('foot_l', foot_l_px / activePixelsPerCm),
      foot_r: smooth('foot_r', foot_r_px / activePixelsPerCm),
      
      torso_l: smooth('torso_l', torso_l_px / activePixelsPerCm),
      torso_r: smooth('torso_r', torso_r_px / activePixelsPerCm),
      upperarm_l: smooth('upperarm_l', upperarm_l_px / activePixelsPerCm),
      upperarm_r: smooth('upperarm_r', upperarm_r_px / activePixelsPerCm),
      forearm_l: smooth('forearm_l', forearm_l_px / activePixelsPerCm),
      forearm_r: smooth('forearm_r', forearm_r_px / activePixelsPerCm),

      fingerToToeL: smooth('finger_to_toe_l', fingerToToeL_px / activePixelsPerCm),
      fingerToToeR: smooth('finger_to_toe_r', fingerToToeR_px / activePixelsPerCm),
      shoulderW: smooth('shoulderW', shoulderW_px / activePixelsPerCm),
      hipW: smooth('hipW', hipW_px / activePixelsPerCm),
      wingspan: smooth('wingspan_distance', wingspan_cm),

      skeletal_height: state.activeCalMethod === 'height' && state.inputHeightCm ? state.inputHeightCm : smooth('body_height_skeletal', skeletal_height_cm),
      live_height: smooth('body_height_live', live_height_cm),

      kneeAngleL, kneeAngleR, hipAngleL, hipAngleR, elbowAngleL, elbowAngleR
    };

    let detectedPose = "A-Pose";
    if (liveMetrics.skeletal_height > 0) {
      const wingspanStraightCm = smooth('wingspan_straight', straight_wingspan_cm);
      const wingspanRatio = wingspanStraightCm / liveMetrics.skeletal_height;
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
    ankleAngleL, ankleAngleR,
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

  const height = state.canvasHeight || 480;

  if (multiLandmarks && multiHandedness) {
    multiLandmarks.forEach((landmarks, index) => {
      const handedness = multiHandedness[index];
      const side = handedness.label; // 'Left' or 'Right'
      
      if (side === 'Left') leftDetected = true;
      if (side === 'Right') rightDetected = true;


      const wrist = { x: getCanvasX(landmarks[0].x), y: landmarks[0].y * height };
      const thumbTip = { x: getCanvasX(landmarks[4].x), y: landmarks[4].y * height };
      const indexTip = { x: getCanvasX(landmarks[8].x), y: landmarks[8].y * height };
      const middleTip = { x: getCanvasX(landmarks[12].x), y: landmarks[12].y * height };
      const ringTip = { x: getCanvasX(landmarks[16].x), y: landmarks[16].y * height };
      const pinkyTip = { x: getCanvasX(landmarks[20].x), y: landmarks[20].y * height };

      let pinchSpanStr = state.useInches ? "--.- inches" : "--.- cm";
      let handSpanStr = state.useInches ? "--.- inches" : "--.- cm";

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
          handStatusLDisp.classList.add('text-emerald');
          handStatusLDisp.classList.remove('text-slate');
        }
        if (pinchLDisp) pinchLDisp.textContent = pinchSpanStr;
        if (spanLDisp) spanLDisp.textContent = handSpanStr;

        fingertipLDisps.forEach((disp, idx) => {
          if (disp) {
            const pt = tips[idx];
            disp.textContent = `(${pt.x.toFixed(0)}, ${pt.y.toFixed(0)})`;
            disp.classList.add('text-emerald');
            disp.classList.remove('text-slate');
          }
        });
      } else if (side === 'Right') {
        state.latestRightMiddleTip = middleTip;
        if (handStatusRDisp) {
          handStatusRDisp.textContent = `Right Hand: Tracked (${(handedness.score * 100).toFixed(0)}%)`;
          handStatusRDisp.classList.add('text-emerald');
          handStatusRDisp.classList.remove('text-slate');
        }
        if (pinchRDisp) pinchRDisp.textContent = pinchSpanStr;
        if (spanRDisp) spanRDisp.textContent = handSpanStr;

        fingertipRDisps.forEach((disp, idx) => {
          if (disp) {
            const pt = tips[idx];
            disp.textContent = `(${pt.x.toFixed(0)}, ${pt.y.toFixed(0)})`;
            disp.classList.add('text-emerald');
            disp.classList.remove('text-slate');
          }
        });
      }
    });
  }

  const resetText = state.useInches ? "--.- inches" : "--.- cm";

  // If left/right hands are not detected, reset their fingertip displays to Offline
  const fallbackStr = state.useInches ? "--.- in" : "--.- cm";
  if (!leftDetected) {
    state.latestLeftMiddleTip = null;
    if (handStatusLDisp) {
      handStatusLDisp.textContent = "Left Hand: Offline";
      handStatusLDisp.classList.add('text-slate');
      handStatusLDisp.classList.remove('text-emerald');
    }
    if (pinchLDisp) pinchLDisp.textContent = resetText;
    if (spanLDisp) spanLDisp.textContent = resetText;
    fingertipLDisps.forEach(disp => {
      if (disp) {
        disp.textContent = "Offline";
        disp.classList.add('text-slate');
        disp.classList.remove('text-emerald');
      }
    });
  }
  if (!rightDetected) {
    state.latestRightMiddleTip = null;
    if (handStatusRDisp) {
      handStatusRDisp.textContent = "Right Hand: Offline";
      handStatusRDisp.classList.add('text-slate');
      handStatusRDisp.classList.remove('text-emerald');
    }
    if (pinchRDisp) pinchRDisp.textContent = resetText;
    if (spanRDisp) spanRDisp.textContent = resetText;
    fingertipRDisps.forEach(disp => {
      if (disp) {
        disp.textContent = "Offline";
        disp.classList.add('text-slate');
        disp.classList.remove('text-emerald');
      }
    });
  }
}

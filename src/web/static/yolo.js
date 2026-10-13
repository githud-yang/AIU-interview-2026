/** Assemble the same live detector used by the showcase, with this page's controls. */
import { initializeShowcaseYolo } from "./showcase-yolo.js?v=stage-live-20261013-c";

initializeShowcaseYolo({
  section: document.getElementById("main"),
  observeSection(_section, onVisible) { onVisible(true); return () => {}; },
  controlIds: {
    "stage-yolo-source": "source-select", "stage-yolo-start": "start-btn",
    "stage-yolo-stop": "stop-btn", "stage-yolo-refresh": "refresh-btn",
    "stage-yolo-view": "view-btn", "stage-yolo-image": "video",
    "stage-yolo-placeholder": "video-placeholder", "stage-yolo-status": "detection-status",
    "stage-yolo-notice": "yolo-msg", "stage-yolo-source-label": "active-source",
    "stage-yolo-fps": "fps", "stage-yolo-frames": "frame-count",
  },
  onSnapshot(snapshot) {
    document.getElementById("detection-model").textContent = snapshot.model || "—";
    const seconds = Number.isFinite(snapshot.elapsed_seconds) ? Math.max(0, Math.floor(snapshot.elapsed_seconds)) : null;
    document.getElementById("elapsed").textContent = seconds === null ? "—" : `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
  },
});

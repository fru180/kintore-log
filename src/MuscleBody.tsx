import { useEffect, useMemo, useRef, useState } from "react";
import { ChevronLeft, ChevronRight, RotateCcw, X, ZoomIn, ZoomOut } from "lucide-react";
import { createPortal } from "react-dom";
import * as THREE from "three";
import { DRACOLoader } from "three/addons/loaders/DRACOLoader.js";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";

import { modelMuscleIds } from "./muscleModel";
import {
  exercisesForSelectableMuscle,
  selectableMuscleId,
  selectableMuscleLabel,
  type SelectableMuscleId,
} from "./muscleSelection";
import { muscleLabels, type MuscleId } from "./muscles";

type RecordStatus = "loading" | "ready" | "error";
type ModelStatus = "waiting" | "loading" | "ready" | "error";

interface MuscleBodyProps {
  muscles: MuscleId[];
}

interface TrainedMusclesCardProps extends MuscleBodyProps {
  status: RecordStatus;
}

interface ModelMuscleMesh {
  mesh: THREE.Mesh;
  muscles: MuscleId[];
  selectableMuscle: SelectableMuscleId | null;
}

function disposeObject(object: THREE.Object3D) {
  const geometries = new Set<THREE.BufferGeometry>();
  const materials = new Set<THREE.Material>();

  object.traverse((child) => {
    if (!(child instanceof THREE.Mesh)) return;
    geometries.add(child.geometry);
    const childMaterials = Array.isArray(child.material) ? child.material : [child.material];
    childMaterials.forEach((material) => materials.add(material));
  });

  geometries.forEach((geometry) => geometry.dispose());
  materials.forEach((material) => material.dispose());
}

function muscleBodyAriaLabel(muscles: Iterable<MuscleId>) {
  const labels = Array.from(muscles, (muscle) => muscleLabels[muscle]);
  const detail = labels.length ? `鍛えた筋肉: ${labels.join("、")}` : "鍛えた筋肉はありません";
  return `3D人体図。${detail}。主要な筋肉をタップすると対応種目を確認できます。等倍では左右ドラッグで回転、拡大中はドラッグで表示領域を移動できます`;
}

interface MuscleDetailSheetProps {
  muscle: SelectableMuscleId;
  onClose: () => void;
}

function MuscleDetailSheet({ muscle, onClose }: MuscleDetailSheetProps) {
  const exercises = exercisesForSelectableMuscle(muscle);
  const label = selectableMuscleLabel(muscle);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      onClose();
    };
    document.addEventListener("keydown", onKeyDown);

    return () => {
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [onClose]);

  return createPortal(
    <div className="muscle-sheet-backdrop">
      <section
        className="muscle-detail-sheet"
        role="dialog"
        aria-labelledby="muscle-detail-title"
        aria-describedby="muscle-detail-description"
      >
        <div className="muscle-sheet-handle" aria-hidden="true" />
        <header className="muscle-detail-heading">
          <div>
            <span>SELECTED MUSCLE</span>
            <h3 id="muscle-detail-title">{label}</h3>
          </div>
          <button type="button" onClick={onClose} aria-label="閉じる">
            <X size={20} />
          </button>
        </header>

        <div id="muscle-detail-description" className="muscle-detail-exercises">
          <h4>鍛えられる種目</h4>
          {exercises.length ? (
            <ul>
              {exercises.map((exercise) => (
                <li key={exercise}>{exercise}</li>
              ))}
            </ul>
          ) : (
            <p>対応種目なし</p>
          )}
        </div>
      </section>
    </div>,
    document.body,
  );
}

function MuscleBody({ muscles }: MuscleBodyProps) {
  const wrapperRef = useRef<HTMLDivElement>(null);
  const mountRef = useRef<HTMLDivElement>(null);
  const applyHighlightRef = useRef<((active: ReadonlySet<MuscleId>) => void) | null>(null);
  const activeMusclesRef = useRef<ReadonlySet<MuscleId>>(new Set(muscles));
  const [shouldLoad, setShouldLoad] = useState(false);
  const [modelStatus, setModelStatus] = useState<ModelStatus>("waiting");
  const [progress, setProgress] = useState(0);
  const [selectedMuscle, setSelectedMuscle] = useState<SelectableMuscleId | null>(null);

  const activeKey = muscles.slice().sort().join("|");

  useEffect(() => {
    const element = wrapperRef.current;
    if (!element) return;

    if (!("IntersectionObserver" in window)) {
      setShouldLoad(true);
      return;
    }

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (!entry.isIntersecting) return;
        setShouldLoad(true);
        observer.disconnect();
      },
      { rootMargin: "500px 0px" },
    );
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!shouldLoad) return;
    const mount = mountRef.current;
    if (!mount) return;

    setModelStatus("loading");
    let disposed = false;
    let anatomyModel: THREE.Object3D | null = null;
    let animationFrame = 0;
    let renderer: THREE.WebGLRenderer;

    try {
      renderer = new THREE.WebGLRenderer({
        alpha: true,
        antialias: true,
        powerPreference: "high-performance",
      });
    } catch {
      setModelStatus("error");
      return;
    }

    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.15;
    renderer.domElement.className = "muscle-canvas";
    renderer.domElement.tabIndex = 0;
    renderer.domElement.setAttribute("role", "img");
    renderer.domElement.setAttribute("aria-label", muscleBodyAriaLabel(activeMusclesRef.current));
    mount.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.01, 100);
    const modelGroup = new THREE.Group();
    scene.add(modelGroup);

    scene.add(new THREE.HemisphereLight(0xfff6e7, 0x331712, 2.5));
    const keyLight = new THREE.DirectionalLight(0xfff4db, 3.1);
    keyLight.position.set(3, 4, 5);
    scene.add(keyLight);
    const fillLight = new THREE.DirectionalLight(0xff7066, 1.35);
    fillLight.position.set(-4, 1, 3);
    scene.add(fillLight);
    const rimLight = new THREE.DirectionalLight(0xb8ffec, 1.25);
    rimLight.position.set(2, 3, -5);
    scene.add(rimLight);

    const inactiveMaterial = new THREE.MeshStandardMaterial({
      color: 0x7d2824,
      roughness: 0.68,
      metalness: 0,
      side: THREE.DoubleSide,
    });
    const activeMaterial = new THREE.MeshStandardMaterial({
      color: 0xd7ff45,
      emissive: 0x405400,
      emissiveIntensity: 0.38,
      roughness: 0.48,
      metalness: 0,
      side: THREE.DoubleSide,
    });
    const modelMeshes: ModelMuscleMesh[] = [];

    const render = () => {
      animationFrame = requestAnimationFrame(render);
      renderer.render(scene, camera);
    };

    let verticalHalf = 1;
    let zoom = 1;
    let panX = 0;
    let panY = 0;
    const setPan = (nextX: number, nextY: number) => {
      if (zoom <= 1) {
        panX = 0;
        panY = 0;
      } else {
        const aspect = Math.max(mount.clientWidth, 1) / Math.max(mount.clientHeight, 1);
        const maxX = verticalHalf * aspect * (1 - 1 / zoom);
        const maxY = verticalHalf * (1 - 1 / zoom);
        panX = THREE.MathUtils.clamp(nextX, -maxX, maxX);
        panY = THREE.MathUtils.clamp(nextY, -maxY, maxY);
      }
      modelGroup.position.set(panX, panY, 0);
    };
    const resize = () => {
      const width = Math.max(mount.clientWidth, 1);
      const height = Math.max(mount.clientHeight, 1);
      const aspect = width / height;
      camera.top = verticalHalf;
      camera.bottom = -verticalHalf;
      camera.left = -verticalHalf * aspect;
      camera.right = verticalHalf * aspect;
      camera.updateProjectionMatrix();
      renderer.setSize(width, height, false);
      setPan(panX, panY);
    };
    const resizeObserver = new ResizeObserver(resize);
    resizeObserver.observe(mount);
    resize();

    const applyHighlight = (active: ReadonlySet<MuscleId>) => {
      const hasSelection = active.size > 0;
      inactiveMaterial.transparent = hasSelection;
      inactiveMaterial.opacity = hasSelection ? 0.24 : 0.94;
      inactiveMaterial.depthWrite = !hasSelection;
      inactiveMaterial.needsUpdate = true;

      modelMeshes.forEach(({ mesh, muscles: meshMuscles }) => {
        const highlighted = meshMuscles.some((muscle) => active.has(muscle));
        mesh.material = highlighted ? activeMaterial : inactiveMaterial;
        mesh.renderOrder = highlighted ? 3 : 1;
      });
    };
    applyHighlightRef.current = applyHighlight;

    let yaw = 0;
    let dragging = false;
    let pointerX = 0;
    let pointerY = 0;
    let pinchDistance = 0;
    let pointerStartX = 0;
    let pointerStartY = 0;
    let pointerMoved = false;
    let multiPointerGesture = false;
    const pointers = new Map<number, { x: number; y: number }>();
    const setYaw = (nextYaw: number) => {
      yaw = nextYaw;
      modelGroup.rotation.y = yaw;
    };
    const rotateBy = (amount: number) => setYaw(yaw + amount);
    const setZoom = (nextZoom: number) => {
      zoom = THREE.MathUtils.clamp(nextZoom, 0.75, 2.5);
      camera.zoom = zoom;
      camera.updateProjectionMatrix();
      canvas.classList.toggle("is-pannable", zoom > 1);
      setPan(panX, panY);
    };
    const zoomBy = (amount: number) => setZoom(zoom + amount);
    const canvas = renderer.domElement;
    const raycaster = new THREE.Raycaster();
    const pointerPosition = new THREE.Vector2();
    const selectMuscleAt = (clientX: number, clientY: number) => {
      const rect = canvas.getBoundingClientRect();
      pointerPosition.set(
        ((clientX - rect.left) / rect.width) * 2 - 1,
        -((clientY - rect.top) / rect.height) * 2 + 1,
      );
      raycaster.setFromCamera(pointerPosition, camera);
      const selectableMeshes = modelMeshes.filter(({ selectableMuscle }) => selectableMuscle !== null);
      const intersection = raycaster.intersectObjects(
        selectableMeshes.map(({ mesh }) => mesh),
        false,
      )[0];
      if (!intersection) return;
      const selected = selectableMeshes.find(({ mesh }) => mesh === intersection.object)?.selectableMuscle;
      if (selected) setSelectedMuscle(selected);
    };
    const onPointerDown = (event: PointerEvent) => {
      pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
      pointerX = event.clientX;
      pointerY = event.clientY;
      canvas.setPointerCapture(event.pointerId);
      if (pointers.size === 1) {
        pointerStartX = event.clientX;
        pointerStartY = event.clientY;
        pointerMoved = false;
        multiPointerGesture = false;
        dragging = true;
        canvas.classList.add("is-dragging");
      } else if (pointers.size === 2) {
        const [first, second] = Array.from(pointers.values());
        pinchDistance = Math.hypot(second.x - first.x, second.y - first.y);
        pointerMoved = true;
        multiPointerGesture = true;
        dragging = false;
        canvas.classList.remove("is-dragging");
      }
    };
    const onPointerMove = (event: PointerEvent) => {
      if (!pointers.has(event.pointerId)) return;
      pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
      if (pointers.size === 2) {
        const [first, second] = Array.from(pointers.values());
        const distance = Math.hypot(second.x - first.x, second.y - first.y);
        if (pinchDistance > 0) setZoom(zoom * (distance / pinchDistance));
        pinchDistance = distance;
        event.preventDefault();
        return;
      }
      if (!dragging) return;
      const pointerDistance = Math.hypot(event.clientX - pointerStartX, event.clientY - pointerStartY);
      if (!pointerMoved && pointerDistance <= 6) return;
      pointerMoved = true;
      const deltaX = event.clientX - pointerX;
      const deltaY = event.clientY - pointerY;
      pointerX = event.clientX;
      pointerY = event.clientY;
      if (zoom > 1) {
        const worldPerPixel = (verticalHalf * 2) / (Math.max(mount.clientHeight, 1) * zoom);
        setPan(panX + deltaX * worldPerPixel, panY - deltaY * worldPerPixel);
        event.preventDefault();
      } else {
        rotateBy(deltaX * 0.012);
      }
    };
    const stopDragging = (event: PointerEvent, allowSelection: boolean) => {
      const shouldSelect =
        allowSelection && pointers.size === 1 && !pointerMoved && !multiPointerGesture && event.button === 0;
      pointers.delete(event.pointerId);
      if (canvas.hasPointerCapture(event.pointerId)) {
        canvas.releasePointerCapture(event.pointerId);
      }
      pinchDistance = 0;
      if (pointers.size === 1) {
        const [remaining] = pointers.values();
        pointerX = remaining.x;
        pointerY = remaining.y;
        dragging = true;
        canvas.classList.add("is-dragging");
      } else {
        dragging = false;
        canvas.classList.remove("is-dragging");
      }
      if (shouldSelect) selectMuscleAt(event.clientX, event.clientY);
    };
    const onPointerUp = (event: PointerEvent) => stopDragging(event, true);
    const onPointerCancel = (event: PointerEvent) => stopDragging(event, false);
    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      setZoom(zoom * Math.exp(-event.deltaY * 0.0015));
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "ArrowLeft") {
        rotateBy(-Math.PI / 12);
        event.preventDefault();
      } else if (event.key === "ArrowRight") {
        rotateBy(Math.PI / 12);
        event.preventDefault();
      } else if (event.key === "+" || event.key === "=") {
        zoomBy(0.2);
        event.preventDefault();
      } else if (event.key === "-" || event.key === "_") {
        zoomBy(-0.2);
        event.preventDefault();
      } else if (event.key === "Home") {
        setYaw(0);
        setZoom(1);
        setPan(0, 0);
        event.preventDefault();
      }
    };
    canvas.addEventListener("pointerdown", onPointerDown);
    canvas.addEventListener("pointermove", onPointerMove);
    canvas.addEventListener("pointerup", onPointerUp);
    canvas.addEventListener("pointercancel", onPointerCancel);
    canvas.addEventListener("wheel", onWheel, { passive: false });
    canvas.addEventListener("keydown", onKeyDown);

    const dracoLoader = new DRACOLoader();
    dracoLoader.setDecoderPath(`${import.meta.env.BASE_URL}draco/`);
    dracoLoader.setWorkerLimit(2);
    const loader = new GLTFLoader();
    loader.setDRACOLoader(dracoLoader);
    loader.load(
      `${import.meta.env.BASE_URL}models/body.glb`,
      (gltf) => {
        if (disposed) {
          disposeObject(gltf.scene);
          return;
        }

        anatomyModel = gltf.scene;
        const originalMaterials = new Set<THREE.Material>();
        anatomyModel.traverse((object) => {
          if (!(object instanceof THREE.Mesh)) return;
          if (object.userData.type !== "muscle") {
            object.visible = false;
            return;
          }

          const materials = Array.isArray(object.material) ? object.material : [object.material];
          materials.forEach((material) => originalMaterials.add(material));
          object.material = inactiveMaterial;
          modelMeshes.push({
            mesh: object,
            muscles: modelMuscleIds(object),
            selectableMuscle: selectableMuscleId(object),
          });
        });
        originalMaterials.forEach((material) => material.dispose());

        const bounds = new THREE.Box3().setFromObject(anatomyModel);
        const center = bounds.getCenter(new THREE.Vector3());
        const size = bounds.getSize(new THREE.Vector3());
        anatomyModel.position.sub(center);
        verticalHalf = Math.max(size.y * 0.56, 0.8);
        const maxDimension = Math.max(size.x, size.y, size.z);
        camera.position.set(0, 0, maxDimension * 2.8);
        camera.near = 0.01;
        camera.far = maxDimension * 8;
        camera.lookAt(0, 0, 0);
        camera.updateProjectionMatrix();
        modelGroup.add(anatomyModel);
        applyHighlight(activeMusclesRef.current);
        resize();
        setProgress(100);
        setModelStatus("ready");
      },
      (event) => {
        if (disposed || !event.total) return;
        setProgress(Math.min(99, Math.round((event.loaded / event.total) * 100)));
      },
      () => {
        if (!disposed) setModelStatus("error");
      },
    );

    render();

    return () => {
      disposed = true;
      cancelAnimationFrame(animationFrame);
      resizeObserver.disconnect();
      canvas.removeEventListener("pointerdown", onPointerDown);
      canvas.removeEventListener("pointermove", onPointerMove);
      canvas.removeEventListener("pointerup", onPointerUp);
      canvas.removeEventListener("pointercancel", onPointerCancel);
      canvas.removeEventListener("wheel", onWheel);
      canvas.removeEventListener("keydown", onKeyDown);
      if (anatomyModel) disposeObject(anatomyModel);
      inactiveMaterial.dispose();
      activeMaterial.dispose();
      dracoLoader.dispose();
      renderer.dispose();
      canvas.remove();
      applyHighlightRef.current = null;
    };
  }, [shouldLoad]);

  useEffect(() => {
    const active = new Set(muscles);
    activeMusclesRef.current = active;
    applyHighlightRef.current?.(active);
    const canvas = mountRef.current?.querySelector("canvas");
    if (canvas) {
      canvas.setAttribute("aria-label", muscleBodyAriaLabel(muscles));
    }
  }, [activeKey, muscles]);

  const rotate = (amount: number) => {
    const canvas = mountRef.current?.querySelector("canvas");
    if (!canvas) return;
    const event = new KeyboardEvent("keydown", {
      key: amount < 0 ? "ArrowLeft" : "ArrowRight",
      bubbles: true,
    });
    canvas.dispatchEvent(event);
    canvas.focus();
  };

  const reset = () => {
    const canvas = mountRef.current?.querySelector("canvas");
    if (!canvas) return;
    canvas.dispatchEvent(new KeyboardEvent("keydown", { key: "Home", bubbles: true }));
    canvas.focus();
  };

  const zoom = (amount: number) => {
    const canvas = mountRef.current?.querySelector("canvas");
    if (!canvas) return;
    canvas.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: amount < 0 ? "-" : "+",
        bubbles: true,
      }),
    );
    canvas.focus();
  };

  return (
    <>
      <div ref={wrapperRef} className="muscle-stage-wrap">
        <div ref={mountRef} className="muscle-stage">
          {modelStatus !== "ready" && (
            <div className={`muscle-model-status ${modelStatus === "error" ? "error" : ""}`}>
              <span>
                {modelStatus === "error"
                  ? "3Dモデルを表示できませんでした"
                  : modelStatus === "loading"
                    ? "解剖モデルを読み込み中…"
                    : "3D人体図を準備中…"}
              </span>
              {modelStatus === "loading" && (
                <div className="muscle-load-track" aria-hidden="true">
                  <i style={{ width: `${progress}%` }} />
                </div>
              )}
            </div>
          )}
        </div>

        {modelStatus === "ready" && (
          <div className="muscle-controls" aria-label="人体図の回転と拡大縮小操作">
            <button type="button" onClick={() => zoom(-1)} aria-label="縮小">
              <ZoomOut size={16} strokeWidth={2.3} />
            </button>
            <button type="button" onClick={() => rotate(-1)} aria-label="左へ回転">
              <ChevronLeft size={18} strokeWidth={2.3} />
            </button>
            <button type="button" onClick={reset} aria-label="表示をリセット">
              <RotateCcw size={15} strokeWidth={2.3} />
              リセット
            </button>
            <button type="button" onClick={() => rotate(1)} aria-label="右へ回転">
              <ChevronRight size={18} strokeWidth={2.3} />
            </button>
            <button type="button" onClick={() => zoom(1)} aria-label="拡大">
              <ZoomIn size={16} strokeWidth={2.3} />
            </button>
          </div>
        )}
      </div>
      {selectedMuscle && (
        <MuscleDetailSheet muscle={selectedMuscle} onClose={() => setSelectedMuscle(null)} />
      )}
    </>
  );
}

export function TrainedMusclesCard({ muscles, status }: TrainedMusclesCardProps) {
  const labels = useMemo(() => muscles.map((muscle) => muscleLabels[muscle]), [muscles]);

  return (
    <section className="trained-muscles-card" aria-labelledby="trained-muscles-heading">
      <header className="trained-muscles-heading">
        <div>
          <span className="trained-muscles-kicker">BODY MAP</span>
          <h2 id="trained-muscles-heading">鍛えた部位</h2>
          <p>この日の記録から自動表示</p>
        </div>
        {status === "ready" && labels.length > 0 && (
          <span className="trained-muscles-count">{labels.length} 部位</span>
        )}
      </header>

      <div className="trained-muscles-content">
        <MuscleBody muscles={muscles} />

        <div className="trained-muscles-summary">
          <div className="muscle-legend">
            <i aria-hidden="true" />
            ライム色：鍛えた筋肉
          </div>
          {status === "loading" ? (
            <p className="muscle-empty">記録を確認しています…</p>
          ) : status === "error" ? (
            <p className="muscle-empty error">記録を読み込めませんでした。</p>
          ) : labels.length ? (
            <ul className="muscle-tags" aria-label="鍛えた筋肉">
              {labels.map((label) => (
                <li key={label}>{label}</li>
              ))}
            </ul>
          ) : (
            <p className="muscle-empty">この日の種目を記録すると、鍛えた筋肉がライム色で表示されます。</p>
          )}
          <p className="muscle-drag-hint">
            主要な筋肉をタップすると対応種目を確認できます。等倍は横ドラッグで回転、拡大中はドラッグで上下左右へ移動できます
          </p>
        </div>
      </div>

      <p className="muscle-attribution">
        3D model: <a href="https://www.z-anatomy.com/">Z-Anatomy</a> / BodyParts3D · web optimization by{" "}
        <a href="https://github.com/hpfrei/body-anatomy-3d-viewer">hpfrei</a> ·{" "}
        <a href="https://creativecommons.org/licenses/by-sa/4.0/">CC BY-SA 4.0</a>
      </p>
    </section>
  );
}

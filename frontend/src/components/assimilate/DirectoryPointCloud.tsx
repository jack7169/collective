import { useMemo, useRef, useState, useCallback } from "react";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { OrbitControls, Text, Billboard } from "@react-three/drei";
import * as THREE from "three";
import type { TreeDiffNode } from "@/api/types";
import { formatBytes } from "@/lib/format";

// Colors matching the diff theme
const COLORS = {
  both: new THREE.Color("#22c55e"),     // green — shared
  only_a: new THREE.Color("#f97316"),   // orange — unique to A
  only_b: new THREE.Color("#3b82f6"),   // blue — unique to B
  dir: new THREE.Color("#6b7280"),      // gray — directory node
  selected: new THREE.Color("#facc15"), // yellow — selected
};

interface PointData {
  position: [number, number, number];
  color: THREE.Color;
  size: number;
  name: string;
  fullPath: string;
  status: "both" | "only_a" | "only_b";
  fileSize: number;
  isDir: boolean;
}

// Layout: pack files into a 3D spiral grouped by directory
function layoutNodes(
  nodes: TreeDiffNode[],
  dirA: string,
  dirB: string,
): PointData[] {
  const points: PointData[] = [];
  let globalIndex = 0;

  function walk(
    nodeList: TreeDiffNode[],
    parentPos: [number, number, number],
    depth: number,
    parentPath: string,
  ) {
    const spread = Math.max(8, nodeList.length * 0.5);

    nodeList.forEach((node, i) => {
      globalIndex++;
      // Spiral layout: angle based on index, radius based on depth
      const angle = (i / Math.max(nodeList.length, 1)) * Math.PI * 2;
      const radius = spread * 0.4;
      const x = parentPos[0] + Math.cos(angle) * radius;
      const y = parentPos[1] + (depth * -3);
      const z = parentPos[2] + Math.sin(angle) * radius;

      const maxSize = Math.max(node.size_a ?? 0, node.size_b ?? 0, 1);
      const sizeScale = Math.max(0.1, Math.min(1.5, Math.log10(maxSize + 1) / 3));

      const path = `${parentPath}/${node.name}`;

      points.push({
        position: [x, y, z],
        color: node.is_dir ? COLORS.dir : COLORS[node.status],
        size: node.is_dir ? 0.3 : sizeScale,
        name: node.name,
        fullPath: path,
        status: node.status,
        fileSize: maxSize,
        isDir: node.is_dir,
      });

      if (node.children && node.children.length > 0) {
        walk(node.children, [x, y, z], depth + 1, path);
      }
    });
  }

  walk(nodes, [0, 0, 0], 0, "");
  return points;
}

// Instanced points for performance
function PointCloud({ points, onSelect }: { points: PointData[]; onSelect: (p: PointData | null) => void }) {
  const meshRef = useRef<THREE.InstancedMesh>(null);
  const dummy = useMemo(() => new THREE.Object3D(), []);
  const colorArray = useMemo(() => new Float32Array(points.length * 3), [points.length]);

  useMemo(() => {
    points.forEach((p, i) => {
      colorArray[i * 3] = p.color.r;
      colorArray[i * 3 + 1] = p.color.g;
      colorArray[i * 3 + 2] = p.color.b;
    });
  }, [points, colorArray]);

  useMemo(() => {
    if (!meshRef.current) return;
    points.forEach((p, i) => {
      dummy.position.set(...p.position);
      dummy.scale.setScalar(p.size);
      dummy.updateMatrix();
      meshRef.current!.setMatrixAt(i, dummy.matrix);
    });
    meshRef.current.instanceMatrix.needsUpdate = true;
  }, [points, dummy]);

  const handleClick = useCallback(
    (e: any) => {
      e.stopPropagation();
      if (e.instanceId != null && e.instanceId < points.length) {
        onSelect(points[e.instanceId]);
      }
    },
    [points, onSelect],
  );

  if (points.length === 0) return null;

  return (
    <instancedMesh
      ref={meshRef}
      args={[undefined, undefined, points.length]}
      onClick={handleClick}
    >
      <sphereGeometry args={[0.3, 12, 12]}>
        <instancedBufferAttribute
          attach="attributes-color"
          args={[colorArray, 3]}
        />
      </sphereGeometry>
      <meshStandardMaterial vertexColors toneMapped={false} />
    </instancedMesh>
  );
}

// Directory connection lines
function ConnectionLines({ points }: { points: PointData[] }) {
  const dirPoints = points.filter((p) => p.isDir);
  if (dirPoints.length < 2) return null;

  const positions: number[] = [];
  // Connect directories at adjacent depths
  for (let i = 0; i < dirPoints.length - 1; i++) {
    const a = dirPoints[i];
    const b = dirPoints[i + 1];
    positions.push(...a.position, ...b.position);
  }

  return (
    <lineSegments>
      <bufferGeometry>
        <bufferAttribute
          attach="attributes-position"
          args={[new Float32Array(positions), 3]}
        />
      </bufferGeometry>
      <lineBasicMaterial color="#333" opacity={0.3} transparent />
    </lineSegments>
  );
}

// Floating label for selected point
function SelectionLabel({ point }: { point: PointData }) {
  return (
    <Billboard position={[point.position[0], point.position[1] + 1.5, point.position[2]]}>
      <Text fontSize={0.4} color="white" anchorX="center" anchorY="bottom" outlineWidth={0.05} outlineColor="black">
        {point.name}
      </Text>
      <Text
        fontSize={0.25}
        color="#999"
        anchorX="center"
        anchorY="top"
        position={[0, -0.15, 0]}
      >
        {point.isDir ? "Directory" : formatBytes(point.fileSize)}
        {" · "}
        {point.status === "both" ? "Shared" : point.status === "only_a" ? "Only in A" : "Only in B"}
      </Text>
    </Billboard>
  );
}

function Scene({
  points,
  selected,
  onSelect,
}: {
  points: PointData[];
  selected: PointData | null;
  onSelect: (p: PointData | null) => void;
}) {
  return (
    <>
      <ambientLight intensity={0.6} />
      <pointLight position={[20, 20, 20]} intensity={1} />
      <pointLight position={[-20, -10, -20]} intensity={0.3} />

      <PointCloud points={points} onSelect={onSelect} />
      <ConnectionLines points={points} />

      {selected && <SelectionLabel point={selected} />}

      <OrbitControls
        makeDefault
        enableDamping
        dampingFactor={0.1}
        rotateSpeed={0.5}
        zoomSpeed={0.8}
      />

      {/* Click background to deselect */}
      <mesh visible={false} onClick={() => onSelect(null)}>
        <sphereGeometry args={[100]} />
      </mesh>
    </>
  );
}

interface DirectoryPointCloudProps {
  treeData: TreeDiffNode[];
  dirA: string;
  dirB: string;
}

export function DirectoryPointCloud({ treeData, dirA, dirB }: DirectoryPointCloudProps) {
  const [selected, setSelected] = useState<PointData | null>(null);

  const points = useMemo(
    () => layoutNodes(treeData, dirA, dirB),
    [treeData, dirA, dirB],
  );

  if (points.length === 0) {
    return (
      <div className="flex items-center justify-center h-full text-muted-foreground text-sm">
        No data to visualize
      </div>
    );
  }

  return (
    <div className="relative h-full w-full bg-[#0a0a0a] rounded-lg overflow-hidden">
      <Canvas
        camera={{ position: [15, 10, 15], fov: 60, near: 0.1, far: 500 }}
        gl={{ antialias: true }}
      >
        <Scene points={points} selected={selected} onSelect={setSelected} />
      </Canvas>

      {/* Legend overlay */}
      <div className="absolute bottom-3 left-3 flex gap-3 text-[10px] text-white/70 bg-black/50 rounded px-2 py-1">
        <span className="flex items-center gap-1">
          <span className="w-2 h-2 rounded-full bg-green-500" /> Shared
        </span>
        <span className="flex items-center gap-1">
          <span className="w-2 h-2 rounded-full bg-orange-500" /> Only A
        </span>
        <span className="flex items-center gap-1">
          <span className="w-2 h-2 rounded-full bg-blue-500" /> Only B
        </span>
        <span className="flex items-center gap-1">
          <span className="w-2 h-2 rounded-full bg-gray-500" /> Directory
        </span>
      </div>

      {/* Stats overlay */}
      <div className="absolute top-3 right-3 text-[10px] text-white/50 bg-black/50 rounded px-2 py-1">
        {points.length} nodes · Click to inspect · Scroll to zoom · Drag to orbit
      </div>

      {/* Selected info */}
      {selected && (
        <div className="absolute top-3 left-3 bg-black/80 border border-white/10 rounded-lg px-3 py-2 max-w-xs">
          <p className="text-xs font-medium text-white truncate">{selected.name}</p>
          <p className="text-[10px] text-white/60 font-mono truncate">{selected.fullPath}</p>
          <div className="flex gap-3 mt-1 text-[10px]">
            <span className="text-white/50">
              {selected.isDir ? "Directory" : formatBytes(selected.fileSize)}
            </span>
            <span
              className={
                selected.status === "both" ? "text-green-400" :
                selected.status === "only_a" ? "text-orange-400" :
                "text-blue-400"
              }
            >
              {selected.status === "both" ? "Shared" : selected.status === "only_a" ? "Only in A" : "Only in B"}
            </span>
          </div>
        </div>
      )}
    </div>
  );
}

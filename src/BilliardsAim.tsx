import { useMemo, useRef, useState, useEffect } from 'react';
// Basic 2:1 table using SVG coordinates; responsive via viewBox
// Units: arbitrary; ball radius ~12, table 1000x500 inner play field

const TABLE_W = 1000;
const TABLE_H = 500;
const BALL_R = 12;
const CUSHION = 30; // visual cushion width around inner field

// Pockets coords (6-pocket pool): corners and middles
const pockets = [
  { id: 'TL', x: 0, y: 0 },
  { id: 'TM', x: TABLE_W / 2, y: 0 },
  { id: 'TR', x: TABLE_W, y: 0 },
  { id: 'BL', x: 0, y: TABLE_H },
  { id: 'BM', x: TABLE_W / 2, y: TABLE_H },
  { id: 'BR', x: TABLE_W, y: TABLE_H },
];

type Point = { x: number; y: number };

type Mode = 'pocket' | 'rail1';

function clamp(val: number, min: number, max: number) {
  return Math.min(Math.max(val, min), max);
}

function clampPointToInner({ x, y }: Point): Point {
  // Keep balls inside play area (0..TABLE_W/H), with radius padding
  return {
    x: clamp(x, BALL_R, TABLE_W - BALL_R),
    y: clamp(y, BALL_R, TABLE_H - BALL_R),
  };
}

function dist(a: Point, b: Point) {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return Math.hypot(dx, dy);
}

function sub(a: Point, b: Point): Point { return { x: a.x - b.x, y: a.y - b.y }; }
function add(a: Point, b: Point): Point { return { x: a.x + b.x, y: a.y + b.y }; }
function mul(a: Point, k: number): Point { return { x: a.x * k, y: a.y * k }; }
function len(v: Point) { return Math.hypot(v.x, v.y); }
function norm(v: Point): Point { const l = len(v) || 1; return { x: v.x / l, y: v.y / l }; }
function dot(a: Point, b: Point) { return a.x * b.x + a.y * b.y; }
function angleBetween(a: Point, b: Point) {
  const na = norm(a); const nb = norm(b);
  return Math.acos(clamp(dot(na, nb), -1, 1));
}

// Reflect vector v across a normal n (unit)
function reflect(v: Point, n: Point): Point {
  const nn = norm(n);
  const k = 2 * dot(v, nn);
  return sub(v, mul(nn, k));
}

// Compute ghost ball center: on line from pocket to object through object by one ball radius*2
function ghostBallForPocket(object: Point, pocket: Point): Point {
  const v = sub(object, pocket); // from pocket -> object
  const n = norm(v);
  // ghost center behind object towards cue: object + n * (2*BALL_R)
  return add(object, mul(n, 2 * BALL_R));
}

// Constrain a point to the nearest point on rails (axis-aligned edges): return point and which edge
type RailEdge = 'top' | 'bottom' | 'left' | 'right';
function clampToRail(p: Point): { point: Point; edge: RailEdge } {
  // Choose nearest edge by min distance to each line
  const dTop = p.y; // distance to y=0
  const dBottom = TABLE_H - p.y;
  const dLeft = p.x; // to x=0
  const dRight = TABLE_W - p.x;
  const min = Math.min(dTop, dBottom, dLeft, dRight);
  if (min === dTop) return { point: { x: clamp(p.x, 0, TABLE_W), y: 0 }, edge: 'top' };
  if (min === dBottom) return { point: { x: clamp(p.x, 0, TABLE_W), y: TABLE_H }, edge: 'bottom' };
  if (min === dLeft) return { point: { x: 0, y: clamp(p.y, 0, TABLE_H) }, edge: 'left' };
  return { point: { x: TABLE_W, y: clamp(p.y, 0, TABLE_H) }, edge: 'right' };
}

function edgeNormal(edge: RailEdge): Point {
  switch (edge) {
    case 'top': return { x: 0, y: 1 };
    case 'bottom': return { x: 0, y: -1 };
    case 'left': return { x: 1, y: 0 };
    case 'right': return { x: -1, y: 0 };
  }
}

// Hit test helper
function isInsideCircle(p: Point, c: Point, r: number) {
  return dist(p, c) <= r;
}

// Convert client coords to SVG coords
function clientToSvg(svg: SVGSVGElement, evt: PointerEvent): Point {
  const pt = svg.createSVGPoint();
  pt.x = evt.clientX; pt.y = evt.clientY;
  const ctm = svg.getScreenCTM();
  if (!ctm) return { x: 0, y: 0 };
  const inv = ctm.inverse();
  const sp = pt.matrixTransform(inv);
  // Subtract outer frame (cushion is drawn outside 0..TABLEW/H via viewBox padding), but our viewBox uses 0..(TABLE+2CUSHION)
  // We'll place playfield at offset CUSHION
  return { x: sp.x - CUSHION, y: sp.y - CUSHION };
}

export default function BilliardsAim() {
  const svgRef = useRef<SVGSVGElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);

  // Detect coarse pointer (touch) to enlarge hit targets
  const isCoarse = useMemo(() => (typeof window !== 'undefined' && 'matchMedia' in window) ? window.matchMedia('(pointer: coarse)').matches : false, []);
  const HIT_SCALE = isCoarse ? 2.0 : 1.4;
  const RAIL_HIT_HALF = isCoarse ? 22 : 14; // half-size of square hitbox

  const [mode, setMode] = useState<Mode>('pocket');
  const [cue, setCue] = useState<Point>({ x: TABLE_W * 0.25, y: TABLE_H * 0.7 });
  const [obj, setObj] = useState<Point>({ x: TABLE_W * 0.6, y: TABLE_H * 0.4 });
  const [selectedPocketId, setSelectedPocketId] = useState<string>('BR');
  const [railPoint, setRailPoint] = useState<Point>({ x: TABLE_W * 0.7, y: 10 });
  const [isFullscreen, setIsFullscreen] = useState(false);

  useEffect(() => {
    function onFsChange() {
      setIsFullscreen(Boolean(document.fullscreenElement || (document as any).webkitFullscreenElement));
    }
    document.addEventListener('fullscreenchange', onFsChange);
    document.addEventListener('webkitfullscreenchange', onFsChange as any);
    return () => {
      document.removeEventListener('fullscreenchange', onFsChange);
      document.removeEventListener('webkitfullscreenchange', onFsChange as any);
    };
  }, []);

  function toggleFullscreen() {
    const el = containerRef.current || document.documentElement;
    const doc = document as any;
    if (!document.fullscreenElement && !doc.webkitFullscreenElement) {
      (el.requestFullscreen?.() || doc.webkitRequestFullscreen?.call(el))?.catch?.(() => {});
    } else {
      (document.exitFullscreen?.() || doc.webkitExitFullscreen?.())?.catch?.(() => {});
    }
  }

  // Derived pocket
  const selectedPocket = useMemo(() => pockets.find(p => p.id === selectedPocketId)!, [selectedPocketId]);

  // Ghost ball and angles for pocket mode
  const pocketData = useMemo(() => {
    const ghost = ghostBallForPocket(obj, selectedPocket);
    const objToPocket = sub(selectedPocket, obj);
    const objToCue = sub(cue, obj);
    const cutAngleRad = angleBetween(objToPocket, objToCue);
    return {
      ghost,
      cueLine: { a: cue, b: ghost },
      objToPocket,
      cutAngleDeg: (cutAngleRad * 180) / Math.PI,
    };
  }, [cue, obj, selectedPocket]);

  // Rail mode: constrain railPoint to nearest edge, then draw cue->rail->obj with equal angles visualized
  const railData = useMemo(() => {
    const { point: rp, edge } = clampToRail(railPoint);
    const incoming = sub(rp, cue); // vector towards cushion
    const normal = edgeNormal(edge);
    const reflected = reflect(incoming, normal);
    // Construct desired outgoing direction from rail towards object: from rp to obj
    const toObj = sub(obj, rp);
    // Angle with outgoing vs reflected (for perfect mirror they'd match). Measure mismatch to help adjust.
    const mismatchRad = angleBetween(reflected, toObj);

    return { rp, edge, incoming, normal, reflected, toObj, mismatchDeg: (mismatchRad * 180) / Math.PI };
  }, [railPoint, cue, obj]);

  type DragTarget = 'cue' | 'obj' | 'rail' | 'none' | `pocket:${string}`;
  const dragRef = useRef<{ target: DragTarget }>({ target: 'none' });

  function onPointerDown(e: React.PointerEvent<SVGSVGElement>) {
    const svg = svgRef.current; if (!svg) return;
    (e.target as Element).setPointerCapture?.(e.pointerId);
    // Prevent page scroll/zoom on touch while dragging inside SVG
    e.preventDefault();
    const p = clientToSvg(svg, e.nativeEvent);

    // Hit pockets first (larger radius for easy tap)
    for (const pk of pockets) {
      // pockets are in inner coords
      if (isInsideCircle(p, pk, 20 * (isCoarse ? 1.3 : 1))) {
        dragRef.current.target = `pocket:${pk.id}`;
        setSelectedPocketId(pk.id);
        return;
      }
    }

    if (isInsideCircle(p, cue, BALL_R * HIT_SCALE)) { dragRef.current.target = 'cue'; return; }
    if (isInsideCircle(p, obj, BALL_R * HIT_SCALE)) { dragRef.current.target = 'obj'; return; }

    // rail handle (small square near rp)
    const rp = railData.rp;
    if (Math.abs(p.x - rp.x) <= RAIL_HIT_HALF && Math.abs(p.y - rp.y) <= RAIL_HIT_HALF) { dragRef.current.target = 'rail'; return; }

    dragRef.current.target = 'none';
  }

  function onPointerMove(e: React.PointerEvent<SVGSVGElement>) {
    const svg = svgRef.current; if (!svg) return;
    const t = dragRef.current.target;
    if (t === 'none') return;
    // Prevent accidental page panning on touch while moving
    e.preventDefault();
    const p = clientToSvg(svg, e.nativeEvent);

    if (t === 'cue') setCue(clampPointToInner(p));
    else if (t === 'obj') setObj(clampPointToInner(p));
    else if (t === 'rail') {
      // Allow anywhere; we'll clamp to nearest edge when drawing
      setRailPoint({ x: clamp(p.x, 0, TABLE_W), y: clamp(p.y, 0, TABLE_H) });
    } else if (t.startsWith('pocket:')) {
      // change pocket on drag over
      for (const pk of pockets) {
        if (isInsideCircle(p, pk, 25 * (isCoarse ? 1.3 : 1))) { setSelectedPocketId(pk.id); break; }
      }
    }
  }

  function onPointerUp() {
    dragRef.current.target = 'none';
  }

  // Styling constants
  const outerW = TABLE_W + CUSHION * 2;
  const outerH = TABLE_H + CUSHION * 2;

  // Utility to translate inner coords by cushion offset for drawing
  const T = (p: Point) => ({ x: p.x + CUSHION, y: p.y + CUSHION });

  return (
    <div ref={containerRef} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div className="controls-row" style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
        <label>
          Chế độ:
          <select value={mode} onChange={(e) => setMode(e.target.value as Mode)} style={{ marginLeft: 8, padding: '8px 10px' }}>
            <option value="pocket">Ngắm bi vào lỗ</option>
            <option value="rail1">Một băng (1 cushion)</option>
          </select>
        </label>
        {mode === 'pocket' && (
          <div style={{ display: 'flex', gap: 16 }}>
            <div>Chọn lỗ: {selectedPocketId}</div>
            <div>Góc cắt (bi đỏ): {pocketData.cutAngleDeg.toFixed(1)}°</div>
          </div>
        )}
        {mode === 'rail1' && (
          <div style={{ display: 'flex', gap: 16 }}>
            <div>Điểm băng: {railData.edge.toUpperCase()}</div>
            <div>Độ lệch phản xạ: {railData.mismatchDeg.toFixed(1)}° (0° là chuẩn)</div>
          </div>
        )}
        <button onClick={() => { setCue({ x: TABLE_W * 0.25, y: TABLE_H * 0.7 }); setObj({ x: TABLE_W * 0.6, y: TABLE_H * 0.4 }); setRailPoint({ x: TABLE_W * 0.7, y: 10 }); }}>
          Reset vị trí
        </button>
        <button onClick={toggleFullscreen}>{isFullscreen ? 'Thoát toàn màn hình' : 'Toàn màn hình'}</button>
      </div>

      <svg
        ref={svgRef}
        viewBox={`0 0 ${outerW} ${outerH}`}
        width="100%"
        style={{ maxWidth: 1000, width: '100%', height: 'auto', background: '#0a5c2b', borderRadius: 12, boxShadow: '0 8px 20px rgba(0,0,0,0.3)', touchAction: 'none' }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
      >
        {/* Table frame and playfield */}
        <rect x={0} y={0} width={outerW} height={outerH} rx={12} fill="#2e1f0f" />
        <rect x={CUSHION} y={CUSHION} width={TABLE_W} height={TABLE_H} fill="#0a5c2b" stroke="#0e7c3a" strokeWidth={3} />

        {/* Pockets (inside coordinates) */}
        {pockets.map((pk) => (
          <g key={pk.id}>
            <circle cx={T(pk).x} cy={T(pk).y} r={18} fill="#000" opacity={0.8} />
            <circle cx={T(pk).x} cy={T(pk).y} r={22} fill="none" stroke={pk.id === selectedPocketId ? '#ffd166' : 'transparent'} strokeWidth={3} />
            {/* Hit target (invisible, handles drag/select) - we already hit test in JS */}
          </g>
        ))}

        {/* Draw guides based on mode */}
        {mode === 'pocket' && (
          <g>
            {/* ghost ball */}
            <circle cx={T(pocketData.ghost).x} cy={T(pocketData.ghost).y} r={BALL_R} fill="#fff8" stroke="#fff" strokeDasharray="4 4" />
            {/* line cue to ghost */}
            <line x1={T(cue).x} y1={T(cue).y} x2={T(pocketData.ghost).x} y2={T(pocketData.ghost).y} stroke="#ffd166" strokeWidth={2} />
            {/* line object to pocket */}
            <line x1={T(obj).x} y1={T(obj).y} x2={T(selectedPocket).x} y2={T(selectedPocket).y} stroke="#90e0ef" strokeWidth={2} strokeDasharray="6 6" />
          </g>
        )}

        {mode === 'rail1' && (
          <g>
            {/* Rail point marker (clamped) */}
            <rect x={T(railData.rp).x - 10} y={T(railData.rp).y - 10} width={20} height={20} fill="#ffd166" stroke="#000" />
            {/* Incoming path */}
            <line x1={T(cue).x} y1={T(cue).y} x2={T(railData.rp).x} y2={T(railData.rp).y} stroke="#ffd166" strokeWidth={2} />
            {/* Outgoing to object */}
            <line x1={T(railData.rp).x} y1={T(railData.rp).y} x2={T(obj).x} y2={T(obj).y} stroke="#90e0ef" strokeWidth={2} />
            {/* Normal at rail */}
            {(() => {
              const n = edgeNormal(railData.edge);
              const base = T(railData.rp);
              const tip = T(add(railData.rp, mul(n, 40)));
              return <line x1={base.x} y1={base.y} x2={tip.x} y2={tip.y} stroke="#ff6b6b" strokeWidth={1.5} strokeDasharray="4 4" />;
            })()}
          </g>
        )}

        {/* Balls */}
        {/* cue ball */}
        <circle cx={T(cue).x} cy={T(cue).y} r={BALL_R} fill="#fff" stroke="#ddd" strokeWidth={2} />
        {/* object ball */}
        <circle cx={T(obj).x} cy={T(obj).y} r={BALL_R} fill="#e63946" stroke="#8d1d26" strokeWidth={2} />

        {/* Labels overlay */}
        <g fontFamily="system-ui, -apple-system, Segoe UI, Roboto, Arial" fontSize={12} fill="#fff">
          {mode === 'pocket' && (
            <text x={12} y={outerH - 14}>{`Gợi ý: kéo bi trắng/bi đỏ để thay đổi, bấm chọn lỗ, đường vàng là hướng chạm ghost-ball.`}</text>
          )}
          {mode === 'rail1' && (
            <text x={12} y={outerH - 14}>{`Gợi ý: kéo ô vàng để chọn điểm băng; điều chỉnh tới khi độ lệch ≈ 0°.`}</text>
          )}
        </g>
      </svg>

      <small style={{ color: '#999' }}>
        Lưu ý: Mô phỏng đơn giản (không tính trượt, xoáy, va chạm cạnh bàn thật). Dùng để ước lượng góc và hình dung đường bi.
      </small>
    </div>
  );
}

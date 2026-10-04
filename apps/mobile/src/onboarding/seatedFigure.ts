// Geometry of the seated figure, in centimetres: floor at y = 0, up is negative, face to the right.
// Proportions: head (chin to crown) 23; hand 17; forearm 24.5; upper arm 28 (a 24.5 cm one cannot reach a
// 73 cm tabletop from seated shoulder height); phone 15 x 7.2 x 0.9, turned about 25 degrees so a sliver of its
// back with the camera bump shows. The torso sits 2 degrees back against a reclined chair back.

type Point = readonly [number, number];

const LEAN_DEG = -2;
const PHONE_DEG = 12;
const HEAD_DEG = 6;
const UPPER_ARM = 28;
const FOREARM = 24.5;
const FOREARM_DEG = 15;
const ELBOW_Y = -77.5;
const HIP: Point = [0, -54];
const WRIST_IN_PHONE: Point = [5, 2.5];
const PHONE_BACK = 3.05;

const round = (value: number) => Math.round(value * 100) / 100;
const radians = (deg: number) => (deg * Math.PI) / 180;

function rotate([x, y]: Point, deg: number, [originX, originY]: Point = [0, 0]): Point {
  const angle = radians(deg);
  return [
    round(originX + x * Math.cos(angle) - y * Math.sin(angle)),
    round(originY + x * Math.sin(angle) + y * Math.cos(angle)),
  ];
}

const polygon = (points: readonly Point[]) => `M${points.map((point) => point.join(' ')).join(' L')} Z`;

// Closed smooth curve through the points (Catmull-Rom converted to cubic Beziers).
function smooth(points: readonly Point[]): string {
  const count = points.length;
  const pointAt = (index: number): Point => points[(index + count) % count] ?? [0, 0];
  const segments = points.map((_, index) => {
    const [before, from, to, after] = [
      pointAt(index - 1),
      pointAt(index),
      pointAt(index + 1),
      pointAt(index + 2),
    ];
    const control1 = [round(from[0] + (to[0] - before[0]) / 6), round(from[1] + (to[1] - before[1]) / 6)];
    const control2 = [round(to[0] - (after[0] - from[0]) / 6), round(to[1] - (after[1] - from[1]) / 6)];
    return `C${control1.join(' ')} ${control2.join(' ')} ${to.join(' ')}`;
  });
  return `M${pointAt(0).join(' ')} ${segments.join(' ')} Z`;
}

function limb(from: Point, to: Point, fromThickness: number, toThickness: number): string {
  const [dx, dy] = [to[0] - from[0], to[1] - from[1]];
  const length = Math.hypot(dx, dy);
  const [nx, ny] = [-dy / length, dx / length];
  const side = (point: Point, thickness: number, sign: number): Point => [
    round(point[0] + (sign * nx * thickness) / 2),
    round(point[1] + (sign * ny * thickness) / 2),
  ];
  return polygon([
    side(from, fromThickness, 1),
    side(to, toThickness, 1),
    side(to, toThickness, -1),
    side(from, fromThickness, -1),
  ]);
}

const torsoPoint = (point: Point) => rotate(point, LEAN_DEG, HIP);
const shoulder = torsoPoint([3, -44]);
const elbow: Point = [round(shoulder[0] + Math.sqrt(UPPER_ARM ** 2 - (ELBOW_Y - shoulder[1]) ** 2)), ELBOW_Y];
const wrist: Point = [
  round(elbow[0] + FOREARM * Math.cos(radians(FOREARM_DEG))),
  round(elbow[1] - FOREARM * Math.sin(radians(FOREARM_DEG))),
];
const wristOffset = rotate(WRIST_IN_PHONE, PHONE_DEG);
const phoneOrigin: Point = [round(wrist[0] - wristOffset[0]), round(wrist[1] - wristOffset[1])];
const phonePoint = (point: Point) => rotate(point, PHONE_DEG, phoneOrigin);
const head = torsoPoint([5, -65]);
const headPoint = (point: Point) => rotate(point, HEAD_DEG, head);
const phonePoints = (points: readonly Point[]) => points.map(phonePoint);

const chair = [
  { x: -17.2, y: -97, width: 4.5, height: 54, rx: 2, tilt: 2 },
  { x: -16.5, y: -46, width: 38.5, height: 3.4, rx: 1.6, tilt: 0 },
  { x: -15.2, y: -43, width: 2.4, height: 43, rx: 0, tilt: 0 },
  { x: 17.5, y: -43, width: 2.4, height: 43, rx: 0, tilt: 0 },
] as const;

const TABLE_X = 16.5;
const table = [
  { x: TABLE_X, y: -73.4, width: 130, height: 3.4, rx: 1.2 },
  { x: TABLE_X + 9, y: -70.5, width: 2.6, height: 70.5, rx: 0 },
  { x: 120, y: -70.5, width: 2.6, height: 70.5, rx: 0 },
] as const;

const legs = smooth([
  [-12, -45.2],
  [10, -45.2],
  [40, -45],
  [44, -44],
  [42.5, -30],
  [44, -10],
  [44.5, -6.5],
  [51, -6.5],
  [52.5, -24],
  [53, -43],
  [53.6, -51],
  [49, -57.5],
  [30, -58.5],
  [8, -59.5],
  [-6, -59],
]);
const shoe =
  'M43 -7.5 C43 -9 44.5 -9.5 46 -9.5 L52 -9.5 C55 -7.5 61 -6.2 66 -5.4 C69 -4.9 70 -3 70 -1.6 L70 0 L43 0 Z';

const torso = smooth(
  (
    [
      [-13, 8.8],
      [-11.6, -8],
      [-12.6, -25],
      [-12.9, -34],
      [-6.5, -45.5],
      [2, -48.5],
      [9, -47],
      [13, -40],
      [14.6, -28],
      [14.2, -14],
      [15, -3],
      [8, 1.5],
      [-4, 6],
    ] as const
  ).map(torsoPoint),
);

// Neck runs from under the skull and jaw into the collar, set back from the face as in real anatomy.
const neck = smooth([
  headPoint([-5.4, 4.6]),
  headPoint([-1.5, 8.6]),
  headPoint([3.6, 9.8]),
  torsoPoint([8.6, -47.4]),
  torsoPoint([3.5, -48.4]),
  torsoPoint([-1.6, -47.6]),
]);

const face = smooth([
  [0, -11.5],
  [6.5, -9.8],
  [9.4, -5],
  [10, -0.5],
  [10.8, 1.6],
  [9.6, 3],
  [9.4, 6.6],
  [7.4, 10.4],
  [3.4, 11.5],
  [-2, 9],
  [-7, 5.6],
  [-9.3, 0],
  [-8.4, -6.5],
  [-5, -10.3],
]);
const hair = smooth([
  [-9.6, 1.5],
  [-9.4, -6.8],
  [-5.4, -11.1],
  [0.4, -12.3],
  [6.4, -10.6],
  [9.4, -6.6],
  [6, -7.6],
  [1.5, -7.2],
  [-3, -4.6],
  [-5.4, 1.6],
  [-7.6, 4.8],
]);

const phoneEdge = smooth(
  phonePoints([
    [-0.9, -0.5],
    [-0.75, -0.05],
    [0.4, 0],
    [PHONE_BACK - 0.6, 0],
    [PHONE_BACK, -0.6],
    [PHONE_BACK, -14.4],
    [PHONE_BACK - 0.6, -15],
    [0.4, -15],
    [-0.75, -14.95],
    [-0.9, -14.5],
    [-0.92, -7.5],
  ]),
);
const phoneBack = smooth(
  phonePoints([
    [0.15, -0.5],
    [PHONE_BACK - 0.55, -0.35],
    [PHONE_BACK - 0.3, -0.7],
    [PHONE_BACK - 0.3, -14.3],
    [PHONE_BACK - 0.55, -14.65],
    [0.15, -14.5],
    [0.05, -7.5],
  ]),
);
const phoneRim = polygon(
  phonePoints([
    [-0.78, -0.9],
    [-0.55, -0.9],
    [-0.55, -14.1],
    [-0.78, -14.1],
  ]),
);
const cameraBump = smooth(
  phonePoints([
    [0.3, -14.5],
    [2.75, -14.5],
    [2.8, -12.3],
    [2.75, -10.05],
    [0.3, -10.05],
    [0.25, -12.3],
  ]),
);

// Hand seen from the thumb side: palm on the back of the phone, index fingertip over the camera bump.
const palm = smooth(
  phonePoints([
    [3.6, 4.2],
    [7.6, 2.2],
    [7.2, -2.5],
    [5.2, -6.4],
    [2.9, -7.2],
    [0.8, -5.6],
    [0.9, -1.5],
    [1.9, 2.4],
  ]),
);
const index = smooth(
  phonePoints([
    [0.72, -5.9],
    [0.7, -10.6],
    [0.72, -13.1],
    [1.55, -14.05],
    [2.4, -13.1],
    [2.45, -10.8],
    [2.7, -7.6],
    [3.9, -6.4],
  ]),
);
const thumb = smooth(
  phonePoints([
    [2.8, 1.4],
    [0.8, -1.6],
    [-0.7, -4.4],
    [-1.25, -6.1],
    [-0.6, -6.7],
    [0.5, -5.4],
    [2.4, -2.6],
    [4.6, -0.4],
  ]),
);
const fingernail = smooth(
  phonePoints([
    [1.15, -13.45],
    [1.55, -13.7],
    [1.95, -13.45],
    [1.9, -12.75],
    [1.2, -12.75],
  ]),
);

const phoneMid = phonePoint([PHONE_BACK, -8.5]);

// Magnified rear-camera inset: lens ring 1.1 cm and flash 0.5 cm, 1.4 cm apart, enlarged 7x, with a
// 1.7 cm fingertip pad lying flat over both.
const MAGNIFY = 7;
const INSET_RADIUS = 26;
const insetCentre: Point = [99, -106];
const lens: Point = [insetCentre[0] - 6, insetCentre[1] - 8];
const flash: Point = [lens[0], lens[1] + 1.4 * MAGNIFY];
const padWidth = 1.7 * MAGNIFY;
const tipY = lens[1] - 0.8 * MAGNIFY;
const insetBottom = insetCentre[1] + INSET_RADIUS + 2;

export const seatedFigure = {
  viewBox: { x: -25, y: -136, width: 150, height: 138.5 },
  chair,
  table,
  legs,
  shoe,
  torso,
  neck,
  face,
  hair,
  head: { x: head[0], y: head[1], tilt: HEAD_DEG },
  shoulder,
  elbow,
  wrist,
  sleeve: limb(shoulder, elbow, 9.4, 8.4),
  forearm: limb(elbow, wrist, 7, 4.6),
  phoneEdge,
  phoneBack,
  phoneRim,
  cameraBump,
  palm,
  index,
  thumb,
  fingernail,
  phoneMid,
  camera: phonePoint([1.55, -12.3]),
  elbowLabelFrom: elbow[0] + 5.5,
  inset: {
    centre: insetCentre,
    radius: INSET_RADIUS,
    magnify: MAGNIFY,
    lens,
    flash,
    padWidth,
    padPath: `M${lens[0] - padWidth / 2} ${insetBottom} V${tipY + padWidth / 2} A${padWidth / 2} ${padWidth / 2} 0 0 1 ${lens[0] + padWidth / 2} ${tipY + padWidth / 2} V${insetBottom} Z`,
    padCreases: `M${lens[0] - padWidth / 2 + 2} ${flash[1] + 1.3 * MAGNIFY} q${padWidth / 2 - 2} 1.2 ${padWidth - 4} 0 M${lens[0] - padWidth / 2 + 2.5} ${flash[1] + 1.3 * MAGNIFY + 2} q${padWidth / 2 - 2.5} 1 ${padWidth - 5} 0`,
  },
} as const;

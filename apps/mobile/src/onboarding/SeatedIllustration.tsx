import Svg, { Circle, ClipPath, Defs, Ellipse, G, Line, Path, Rect, Text as SvgText } from 'react-native-svg';

import { useTheme } from '@/theme';

import { seatedFigure } from './seatedFigure';

const LABEL_SIZE = 5.6;
const INSET_LABEL_SIZE = 4.4;
// Only used to shade the figure's own colours; page colours always come from the theme.
const BLACK = '#000000';
const WHITE = '#ffffff';
// The chair back leans about its seat joint.
const CHAIR_PIVOT = '-12.7 -45';
const LINE_WIDTH = 0.45;
const LONG_LABEL = 22;
const LABEL_LINE_HEIGHT = 6.6;

type SeatedIllustrationProps = {
  phoneLabel: string;
  elbowLabel: string;
  // With the labels, the figure also shows a magnified fingertip over the lens and flash.
  pressInset?: { lensLabel: string; flashLabel: string };
};

const rgb = (hex: string) => [1, 3, 5].map((start) => parseInt(hex.slice(start, start + 2), 16));

// Blends `first` with `second`; `firstShare` is the fraction of `first` kept (0 to 1).
function mix(first: string, second: string, firstShare: number): string {
  const [from, to] = [rgb(first), rgb(second)];
  const channels = from.map((channel, index) =>
    Math.round(channel * firstShare + (to[index] ?? 0) * (1 - firstShare))
      .toString(16)
      .padStart(2, '0'),
  );
  return `#${channels.join('')}`;
}

const darken = (colour: string, keep: number) => mix(colour, BLACK, keep);
const lighten = (colour: string, keep: number) => mix(colour, WHITE, keep);

function splitLabel(label: string): string[] {
  if (label.length <= LONG_LABEL) return [label];
  const words = label.split(' ');
  const half = Math.ceil(words.length / 2);
  return [words.slice(0, half).join(' '), words.slice(half).join(' ')];
}

// Side view of a seated adult against a chair back, elbow on the table, phone held at chest height with the
// index fingertip on the rear camera. Scales with its container: the viewBox sets the shape, not the pixels.
export function SeatedIllustration({ phoneLabel, elbowLabel, pressInset }: SeatedIllustrationProps) {
  const { colors } = useTheme();
  const { viewBox, inset } = seatedFigure;
  const skinShade = darken(colors.illustrationSkin, 0.84);
  const shirt = mix(colors.illustrationTorso, colors.surface3, 0.55);
  const sleeve = darken(shirt, 0.88);
  const pants = mix(colors.textDim, colors.surface3, 0.6);
  const deviceFace = lighten(colors.illustrationDevice, 0.86);
  const bumpFill = lighten(colors.illustrationDevice, 0.62);
  const [camX, camY] = seatedFigure.camera;
  const [phoneX, phoneY] = seatedFigure.phoneMid;
  const [insetX, insetY] = inset.centre;
  const insetLabels = pressInset
    ? ([
        [inset.lens, inset.magnify * 0.55, pressInset.lensLabel],
        [inset.flash, inset.magnify * 0.25, pressInset.flashLabel],
      ] as const)
    : [];
  const padRight = inset.lens[0] + inset.padWidth / 2;
  return (
    <Svg
      testID="seated-illustration"
      width="100%"
      style={{ aspectRatio: viewBox.width / viewBox.height }}
      viewBox={`${viewBox.x} ${viewBox.y} ${viewBox.width} ${viewBox.height}`}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
    >
      <Line
        x1={viewBox.x}
        x2={viewBox.x + viewBox.width}
        y1={0}
        y2={0}
        stroke={colors.line2}
        strokeWidth={0.7}
      />
      {seatedFigure.chair.map((part) => (
        <Rect
          key={`${part.x}-${part.y}`}
          x={part.x}
          y={part.y}
          width={part.width}
          height={part.height}
          rx={part.rx}
          fill={colors.line2}
          transform={part.tilt ? `rotate(${part.tilt} ${CHAIR_PIVOT})` : undefined}
        />
      ))}
      {seatedFigure.table.map((part) => (
        <Rect
          key={`${part.x}-${part.y}`}
          x={part.x}
          y={part.y}
          width={part.width}
          height={part.height}
          rx={part.rx}
          fill={colors.line2}
        />
      ))}
      <Path d={seatedFigure.legs} fill={pants} />
      <Path d={seatedFigure.shoe} fill={colors.illustrationShoe} />
      <Path d={seatedFigure.torso} fill={shirt} />
      <Path d={seatedFigure.neck} fill={skinShade} />
      <G transform={`translate(${seatedFigure.head.x} ${seatedFigure.head.y}) rotate(${seatedFigure.head.tilt})`}>
        <Path d={seatedFigure.face} fill={colors.illustrationSkin} />
        <Path d={seatedFigure.hair} fill={colors.illustrationHair} />
        <Ellipse cx={-2.6} cy={0.6} rx={1.9} ry={2.8} fill={skinShade} />
        <Circle cx={6.6} cy={-1.6} r={0.75} fill={BLACK} />
      </G>
      <Path d={seatedFigure.forearm} fill={colors.illustrationSkin} />
      <Circle cx={seatedFigure.wrist[0]} cy={seatedFigure.wrist[1]} r={2.3} fill={colors.illustrationSkin} />
      <Circle cx={seatedFigure.elbow[0]} cy={seatedFigure.elbow[1]} r={3.5} fill={colors.illustrationSkin} />
      <Path d={seatedFigure.sleeve} fill={sleeve} />
      <Circle cx={seatedFigure.shoulder[0]} cy={seatedFigure.shoulder[1]} r={4.7} fill={sleeve} />
      <Circle cx={seatedFigure.elbow[0]} cy={seatedFigure.elbow[1]} r={4.2} fill={sleeve} />
      <Ellipse
        cx={seatedFigure.elbow[0]}
        cy={-73.3}
        rx={5}
        ry={0.5}
        fill={BLACK}
        opacity={0.12}
      />
      <Path
        d={seatedFigure.phoneEdge}
        fill={colors.illustrationDevice}
        stroke={colors.illustrationDeviceLine}
        strokeWidth={0.3}
      />
      <Path d={seatedFigure.phoneBack} fill={deviceFace} />
      <Path d={seatedFigure.phoneRim} fill={colors.illustrationDeviceLine} />
      <Path d={seatedFigure.cameraBump} fill={bumpFill} />
      <Path d={seatedFigure.palm} fill={colors.illustrationSkin} />
      <Path d={seatedFigure.index} fill={colors.illustrationSkin} />
      <Path d={seatedFigure.thumb} fill={darken(colors.illustrationSkin, 0.93)} />
      <Path d={seatedFigure.fingernail} fill={WHITE} opacity={0.28} />
      <Path
        d={`M${seatedFigure.elbowLabelFrom} -75.6 H58`}
        stroke={colors.textDim}
        strokeWidth={LINE_WIDTH}
        strokeDasharray="1 1"
      />
      <SvgText x={60} y={-73.9} fontSize={LABEL_SIZE} fill={colors.textDim}>
        {elbowLabel}
      </SvgText>
      {pressInset ? (
        <G testID="seated-press-inset">
          <Line
            x1={camX + 0.8}
            y1={camY}
            x2={insetX - inset.radius * 0.97}
            y2={insetY + 4}
            stroke={colors.textDim}
            strokeWidth={LINE_WIDTH}
          />
          <Circle cx={camX} cy={camY} r={2.6} fill="none" stroke={colors.textDim} strokeWidth={LINE_WIDTH} />
          <Circle cx={insetX} cy={insetY} r={inset.radius + 0.6} fill={colors.line2} />
          <Defs>
            <ClipPath id="seated-inset-clip">
              <Circle cx={insetX} cy={insetY} r={inset.radius} />
            </ClipPath>
          </Defs>
          <G clipPath="url(#seated-inset-clip)">
            <Rect
              x={insetX - inset.radius}
              y={insetY - inset.radius}
              width={inset.radius * 2}
              height={inset.radius * 2}
              fill={colors.surface2}
            />
            <Rect
              x={insetX - 22}
              y={insetY - 21}
              width={60}
              height={70}
              rx={7}
              fill={colors.illustrationDevice}
            />
            <Rect
              x={inset.lens[0] - 6.5}
              y={inset.lens[1] - 6.5}
              width={13}
              height={13 + 1.4 * inset.magnify}
              rx={5.5}
              fill={lighten(colors.illustrationDevice, 0.8)}
            />
            <Circle
              cx={inset.lens[0]}
              cy={inset.lens[1]}
              r={0.55 * inset.magnify}
              fill={colors.illustrationLens}
              stroke={colors.illustrationDeviceLine}
              strokeWidth={0.6}
            />
            <Circle
              cx={inset.flash[0]}
              cy={inset.flash[1]}
              r={0.25 * inset.magnify}
              fill={colors.illustrationFlash}
            />
            <Path d={inset.padPath} fill={colors.illustrationSkin} opacity={0.93} />
            <Path d={inset.padCreases} stroke={skinShade} strokeWidth={0.7} fill="none" />
            <Circle
              cx={inset.lens[0]}
              cy={inset.lens[1]}
              r={0.55 * inset.magnify}
              fill="none"
              stroke={colors.text}
              strokeWidth={1}
              strokeDasharray="1.6 1.1"
            />
            <Circle
              cx={inset.flash[0]}
              cy={inset.flash[1]}
              r={0.25 * inset.magnify}
              fill="none"
              stroke={colors.text}
              strokeWidth={1}
              strokeDasharray="1.2 0.9"
            />
            {insetLabels.map(([[pointX, pointY], pointRadius, text]) => (
              <G key={text}>
                <Path
                  d={`M${pointX + pointRadius + 0.6} ${pointY} H${padRight + 3.2}`}
                  stroke={colors.illustrationOnDevice}
                  strokeWidth={0.5}
                />
                <SvgText
                  x={padRight + 4}
                  y={pointY + 1.5}
                  fontSize={INSET_LABEL_SIZE}
                  fontWeight="600"
                  fill={colors.illustrationOnDevice}
                >
                  {text}
                </SvgText>
              </G>
            ))}
          </G>
        </G>
      ) : (
        <G>
          <Path
            d={`M${phoneX + 7.4} ${phoneY} H${phoneX + 5.2}`}
            stroke={colors.textDim}
            strokeWidth={LINE_WIDTH}
          />
          {splitLabel(phoneLabel).map((line, index) => (
            <SvgText
              key={line}
              x={phoneX + 8.6}
              y={phoneY + 1.9 + index * LABEL_LINE_HEIGHT}
              fontSize={LABEL_SIZE}
              fill={colors.textDim}
            >
              {line}
            </SvgText>
          ))}
        </G>
      )}
    </Svg>
  );
}

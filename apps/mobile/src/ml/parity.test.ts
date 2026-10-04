/** @jest-environment node */
import type * as OrtNode from 'onnxruntime-node';

// ML-3 (Node half): every model in models/parity-vectors.json, run through the same ONNX Runtime build the
// phone links (onnxruntime-node 1.24.3), must match the vectors the Python export recorded. The phone's React
// Native runtime is not exercised here.
// https://onnxruntime.ai/docs/api/js/classes/InferenceSession.html
// https://onnxruntime.ai/docs/api/js/classes/Tensor.html

type Hash = { update(bytes: Uint8Array): Hash; digest(encoding: 'hex'): string };
const { createHash } = jest.requireActual<{ createHash(algorithm: 'sha256'): Hash }>('crypto');
const fs = jest.requireActual<{ readFileSync(file: string): Uint8Array }>('fs');
const path = jest.requireActual<{ join(...parts: string[]): string; dirname(file: string): string }>('path');

type Values = Record<'dims' | 'data', number[]>;
type VectorModel = {
  file: string;
  onnxSha256: string;
  inputs: Record<string, Values>;
  outputs: Record<string, Values>;
};
type Vectors = { tolerance: number; models: Record<string, VectorModel> };

const testPath = expect.getState().testPath;
if (!testPath) throw new Error('Jest did not report this test file path');
const modelsFolder = path.join(path.dirname(testPath), '..', '..', '..', '..', 'models');
const vectors = JSON.parse(
  Buffer.from(fs.readFileSync(path.join(modelsFolder, 'parity-vectors.json'))).toString('utf8'),
) as Vectors;

// onnxruntime-node builds its output tensors in Node's main realm and onnxruntime-common checks typed arrays
// with instanceof, so it is loaded with the main realm's require and given that realm's Float32Array.
const vm = jest.requireActual('vm');
const ort: typeof OrtNode = vm.runInThisContext('process').mainModule.require('onnxruntime-node');
const MainFloat32Array = vm.runInThisContext('Float32Array');

function maxAbsError(actual: ArrayLike<number>, expected: readonly number[]): number {
  return expected.reduce(
    (worst, value, index) => Math.max(worst, Math.abs((actual[index] as number) - value)),
    0,
  );
}

describe('ONNX parity with models/parity-vectors.json', () => {
  it('lists models and a tolerance', () => {
    expect(vectors.tolerance).toBeGreaterThan(0);
    expect(Object.keys(vectors.models).length).toBeGreaterThan(0);
  });

  describe.each(Object.entries(vectors.models))('%s', (_name, model) => {
    it('is the model file the vectors were made from', () => {
      const actual = createHash('sha256')
        .update(fs.readFileSync(path.join(modelsFolder, model.file)))
        .digest('hex');
      expect(actual).toBe(model.onnxSha256.toLowerCase());
    });

    it('matches every recorded output within the file tolerance', async () => {
      const session = await ort.InferenceSession.create(path.join(modelsFolder, model.file), {
        intraOpNumThreads: 1,
      });
      expect([...session.inputNames].sort()).toEqual(Object.keys(model.inputs).sort());
      const declared = Object.fromEntries(
        session.inputMetadata.map((input) => [input.name, input.isTensor ? input.type : 'not a tensor']),
      );
      const feeds: Record<string, OrtNode.Tensor> = {};
      for (const [input, values] of Object.entries(model.inputs)) {
        // Float32 is what runtime.ts feeds; a model declaring another input type needs a typed tensor here.
        expect(declared[input]).toBe('float32');
        expect(values.data).toHaveLength(values.dims.reduce((product, dim) => product * dim, 1));
        feeds[input] = new ort.Tensor('float32', MainFloat32Array.from(values.data), values.dims);
      }
      const outputs = await session.run(feeds);
      for (const [output, expected] of Object.entries(model.outputs)) {
        const tensor = outputs[output];
        if (!tensor) throw new Error(`the run returned no ${output}`);
        expect([...tensor.dims]).toEqual(expected.dims);
        const error = maxAbsError(tensor.data as ArrayLike<number>, expected.data);
        expect(error).toBeLessThanOrEqual(vectors.tolerance);
      }
    });
  });
});

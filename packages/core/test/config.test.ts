import { DSP_CONFIG } from '../src';
import sharedConfig from '../../../ml/lumen_dsp/dsp_config.json';

// §10.2: TypeScript and Python read the same parameters; any drift fails CI.
describe('DSP config parity', () => {
  it('config.ts matches ml/lumen_dsp/dsp_config.json exactly', () => {
    expect(DSP_CONFIG).toStrictEqual(sharedConfig);
  });
});

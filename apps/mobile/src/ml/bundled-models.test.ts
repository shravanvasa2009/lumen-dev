import { bundledManifest, bundledModelFiles } from './bundled-models';

describe('the bundled models', () => {
  it('list a Metro asset for every shipped file in the manifest', () => {
    const { models } = bundledManifest as { models: { ships: boolean; file: string }[] };
    const shipped = models.filter((entry) => entry.ships).map((entry) => entry.file);
    expect(shipped.length).toBeGreaterThan(0);
    expect(Object.keys(bundledModelFiles).sort()).toEqual([...shipped].sort());
  });
});

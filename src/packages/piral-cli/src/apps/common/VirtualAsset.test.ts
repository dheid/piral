import { VirtualAsset } from './VirtualAsset';

describe('VirtualAsset extension module', () => {
  it('Generates the right module entry for react', () => {
    const asset = new VirtualAsset('/react.vm', {
      rootDir: '/',
    });
    const content = asset.generate();
    expect(content.js).toBe("module.exports=require('react');");
  });

  it('Generates the right module entry for a scoped package', () => {
    const asset = new VirtualAsset('/@smapiot/foobar.vm', {
      rootDir: '/',
    });
    const content = asset.generate();
    expect(content.js).toBe("module.exports=require('@smapiot/foobar');");
  });
});

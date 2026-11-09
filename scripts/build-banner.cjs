// Renders assets/brand/banner.html to banner.png with Electron, so the banner is
// set in the app's own font. Run with `npm run banner`.
const { app, BrowserWindow } = require('electron');
const { writeFileSync } = require('node:fs');
const path = require('node:path');

const WIDTH = 1920;
const HEIGHT = 1200;
const brand = path.join(__dirname, '..', 'assets', 'brand');

app.disableHardwareAcceleration();
app.whenReady().then(async () => {
  const win = new BrowserWindow({
    width: WIDTH,
    height: HEIGHT,
    show: false,
    useContentSize: true,
    enableLargerThanScreen: true,
    webPreferences: { offscreen: true },
  });
  win.webContents.setFrameRate(4);
  win.setContentSize(WIDTH, HEIGHT);
  await win.loadFile(path.join(brand, 'banner.html'));
  await win.webContents.executeJavaScript(
    'Promise.all([document.fonts.ready, ...[...document.images].map((i) => i.decode())])',
  );
  await new Promise((resolve) => setTimeout(resolve, 1200));
  const image = await win.webContents.capturePage({
    x: 0,
    y: 0,
    width: WIDTH,
    height: HEIGHT,
  });
  writeFileSync(path.join(brand, 'banner.png'), image.toPNG());
  console.log('wrote banner.png', image.getSize());
  app.exit(0);
});

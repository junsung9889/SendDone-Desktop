// Modules to control application life and create native browser window
const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const fs = require('fs').promises;
const path = require('path');
const network = require('./Network');
const { Sender } = require('./Sender');
const { Receiver } = require('./Receiver');
const isDev = require('electron-is-dev');

var mainWindow = null;
/**
 * @type {Sender}
 */
var sender = null;
/**
 * @type {Receiver}
 */
var receiver = null;
/**
 * @type {String}
 */
var myId = 'hello';
/**
 * @type {String}
 */
var myIp = '';

function createWindow() {
  // Create the browser window.
  const mainWindow = new BrowserWindow({
    title: 'SendDone',
    minWidth: 800,
    minHeight: 600,
    width: 800,
    height: 600,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      enableRemoteModule: false,
      nodeIntegration: false,
      contextIsolation: false
    },
    show: false
  });

  if (isDev) {
    console.log('Running in development');
    // When in development, run react start first.
    // The main electron window will load the react webpage like below.
    mainWindow.loadURL('http://localhost:3000');
    mainWindow.maximize();
  }
  else {
    console.log('Running in production');
    // removeMenu will remove debugger menu too. Comment the below line if not wanted.
    mainWindow.removeMenu();
    // When in production, run react build first.
    // The main electron window will load the react built packs like below.
    mainWindow.loadFile(path.join(__dirname, '../build/index.html')).then(() => {
      console.log('Loaded index.html');
    }).catch(() => {
      console.log('Loading index.html failed');
    });
  }
  return mainWindow;
}

// This method will be called when Electron has finished
// initialization and is ready to create browser windows.
// Some APIs can only be used after this event occurs.
app.whenReady().then(() => {
  mainWindow = createWindow();
  mainWindow.once('ready-to-show', () => {
    // Show the window only after fully loaded.
    mainWindow.show();
  })

  app.on('activate', function () {
    // On macOS it's common to re-create a window in the app when the
    // dock icon is clicked and there are no other windows open.
    if (BrowserWindow.getAllWindows().length === 0) {
      mainWindow = createWindow();
    }
  })
});

// Quit when all windows are closed, except on macOS. There, it's common
// for applications and their menu bar to stay active until the user quits
// explicitly with Cmd + Q.
app.on('window-all-closed', function () {
  if (receiver && receiver.isExposed())
    receiver.closeServerSocket();
  if (process.platform !== 'darwin') {
    app.quit();
  }
})

// Handle inter process communications with renderer processes.
ipcMain.handle('openFile', async () => {
  let tmp = dialog.showOpenDialogSync(mainWindow, {
    title: "Open File(s)",
    properties: ["openFile", "multiSelections"]
  });
  let ret = {};
  if (!tmp)
    return ret;
  for (item of tmp) {
    try {
      let size = (await fs.stat(item)).size;
      ret[path.basename(item)] = { path: item, name: path.basename(item), dir: '.', type: 'file', size: size };
    } catch (err) {
      // Maybe No permission or file system error. Skip it.
    }
  }
  return ret;
})

ipcMain.handle('openDirectory', async () => {
  /**
   * Sub item will be added to the parameter item Object recursively.
   * @param {{ path: string, name:string, dir: string }} item 
   */
  async function addSubItems(item) {
    try {
      let itemStat = await fs.stat(item.path);
      if (itemStat.isDirectory()) {
        item.type = 'directory';
        item.items = {};
        for (let subItem of (await fs.readdir(item.path))) {
          item.items[subItem] = { path: path.join(item.path, subItem), name: subItem, dir: path.join(item.dir, item.name) };
          await addSubItems(item.items[subItem]);
        }
      }
      else {
        item.type = 'file';
        item.size = (await fs.stat(item.path)).size;
      }
    } catch (err) {
      // Maybe No permission or file system error. Skip it.
    }
    return;
  }
  let tmp = dialog.showOpenDialogSync(mainWindow, {
    title: "Open Directory(s)",
    properties: ["openDirectory", "multiSelections"]
  });
  let ret = {};
  if (!tmp)
    return ret;
  for (let item of tmp) {
    ret[path.basename(item)] = { path: item, name: path.basename(item), dir: '.', type: 'directory', items: {} };
    await addSubItems(ret[path.basename(item)]);
  }
  return ret;
})

ipcMain.handle('get-networks', () => {
  return network.getMyNetworks();
})

ipcMain.handle('openServerSocket', (event, arg) => {
  if (receiver) {
    receiver.closeServerSocket();
  }
  myIp = arg;
  receiver = new Receiver(myIp, myId);
  return true;
})

ipcMain.handle('closeServerSocket', () => {
  if (receiver) {
    receiver.closeServerSocket();
    receiver = null;
    return true;
  }
  return false;
})

ipcMain.handle('isServerSocketOpen', () => {
  return receiver && receiver.isExposed();
})

ipcMain.handle('set-id', (event, arg) => {
  myId = arg;
})

ipcMain.handle('send', (event, arg) => {
  // Close receiver.
  if (receiver) {
    receiver.setStateBusy();
  }
  const ip = arg.ip;
  const itmes = arg.items;
  if (!sender) {
    sender = new Sender('id');
    sender.send(items, ip);
  }
})

ipcMain.handle('get-send-state', () => {
  if (sender) {
    const state = sender.getState();
    if (state === network.STATE.SEND_REQUEST) {
      return { state: state };
    }
    if (state === network.STATE.SEND) {
      const speed = sender.getSpeed();
      return { state: state, speed: speed };
    }
    if (state === network.STATE.SEND_DONE) {
      dialog.showMessageBox(mainWindow, { message: 'Send Complete~!' });
      sender = null;
      return { state: state };
    }
    return { state: state };
  }
  return null;
})

ipcMain.handle('finish-send', () => {
  if (receiver) {
    receiver.setStateIdle();
  }
})

ipcMain.handle('getRecvState', () => {
  if (receiver) {
    const state = receiver.getState();
    if (state === network.STATE.RECV_WAIT) {
      return { state: state, itemArray: receiver.getitemArray() };
    }
    if (state === network.STATE.RECV) {
      const speed = sender.getSpeed();
      return { state: state, speed: speed };
    }
    if (state === network.STATE.RECV_DONE) {
      dialog.showMessageBox(mainWindow, { message: 'Receive Complete~!' });
      receiver.setStateIdle();
      return { state: state };
    }
    return { state: state };
  }
  return null;
})

ipcMain.handle('acceptRecv', () => {
  if (receiver) {
    receiver.acceptRecv(app.getPath('downloads'));
  }
})

ipcMain.handle('rejectRecv', () => {
  if (receiver) {
    receiver.acceptRecv(app.getPath('downloads'));
  }
})

ipcMain.handle('setDownloadDirectory', () => {
  let ret = dialog.showOpenDialogSync(mainWindow, {
    title: "Set Download Directory",
    properties: ["openDirectory"]
  });
  return ret[0];
})
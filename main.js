import { app, BrowserWindow, ipcMain, Notification, Tray, Menu, nativeImage } from 'electron';
import path from 'path';
import fs from 'fs';
import Store from 'electron-store';
import cron from 'node-cron';
import SpadaClient from './src/services/spada-client.js';
import Scheduler from './src/services/scheduler.js';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const store = new Store();
let mainWindow;
let tray;
let spadaClient;
let scheduler;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 900,
    minHeight: 600,
    frame: false,
    titleBarStyle: 'hidden',
    backgroundColor: '#0a0e1a',
    icon: path.join(__dirname, 'assets', 'icon.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      backgroundThrottling: false
    }
  });

  mainWindow.loadFile('index.html');

  mainWindow.on('close', (event) => {
    event.preventDefault();
    mainWindow.hide();
  });
}

function createTray() {
  // Try normal dirname first, fallback to process.cwd() if running via npm run dev
  const iconPath = fs.existsSync(path.join(__dirname, 'assets', 'icon.png'))
    ? path.join(__dirname, 'assets', 'icon.png')
    : path.join(process.cwd(), 'assets', 'icon.png');

  let trayIcon;
  try {
    trayIcon = nativeImage.createFromPath(iconPath);
  } catch (e) {
    console.error("Gagal memuat icon system tray:", e);
    trayIcon = nativeImage.createEmpty();
  }

  tray = new Tray(trayIcon);
  const contextMenu = Menu.buildFromTemplate([
    { label: 'Buka SPADA App', click: () => mainWindow.show() },
    { label: 'separator', type: 'separator' },
    { label: 'Keluar', click: () => { mainWindow.destroy(); app.quit(); } }
  ]);
  tray.setToolTip('SPADA App - E-Learning UPN');
  tray.setContextMenu(contextMenu);
  tray.on('click', () => mainWindow.show());
}

function showNotification(title, body) {
  if (Notification.isSupported()) {
    const notification = new Notification({ title, body, icon: path.join(__dirname, 'assets', 'icon.png') });
    notification.show();
    notification.on('click', () => mainWindow.show());
  }
}

// IPC Handlers
ipcMain.handle('window:minimize', () => mainWindow.minimize());
ipcMain.handle('window:maximize', () => {
  if (mainWindow.isMaximized()) mainWindow.unmaximize();
  else mainWindow.maximize();
});
ipcMain.handle('window:close', () => mainWindow.hide());

ipcMain.handle('auth:login', async (event, { username, password }) => {
  try {
    spadaClient = new SpadaClient('https://spada.upnyk.ac.id');
    const result = await spadaClient.login(username, password);
    if (result.success) {
      store.set('credentials', { username, password });
      store.set('userInfo', result.userInfo);

      // Start scheduler after login
      scheduler = new Scheduler(spadaClient, showNotification, store);
      scheduler.start();
    }
    return result;
  } catch (error) {
    return { success: false, error: error.message };
  }
});

ipcMain.handle('auth:autoLogin', async () => {
  const credentials = store.get('credentials');
  if (!credentials) return { success: false, error: 'No saved credentials' };
  try {
    spadaClient = new SpadaClient('https://spada.upnyk.ac.id');
    const result = await spadaClient.login(credentials.username, credentials.password);
    if (result.success) {
      store.set('userInfo', result.userInfo);
      scheduler = new Scheduler(spadaClient, showNotification, store);
      scheduler.start();
    }
    return result;
  } catch (error) {
    return { success: false, error: error.message };
  }
});

ipcMain.handle('auth:logout', async () => {
  store.delete('credentials');
  store.delete('userInfo');
  if (scheduler) scheduler.stop();
  spadaClient = null;
  return { success: true };
});

ipcMain.handle('courses:getAll', async () => {
  try {
    if (!spadaClient) return { success: false, error: 'Not logged in' };
    const courses = await spadaClient.getCourses();
    return { success: true, data: courses };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

ipcMain.handle('course:getContent', async (event, courseId) => {
  try {
    if (!spadaClient) return { success: false, error: 'Not logged in' };
    const content = await spadaClient.getCourseContent(courseId);
    return { success: true, data: content };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

ipcMain.handle('attendance:getSessions', async (event, attendanceId) => {
  try {
    if (!spadaClient) return { success: false, error: 'Not logged in' };
    const sessions = await spadaClient.getAttendanceSessions(attendanceId);
    return { success: true, data: sessions };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

ipcMain.handle('attendance:submit', async (event, { sessionId, attendanceId }) => {
  try {
    if (!spadaClient) return { success: false, error: 'Not logged in' };
    const result = await spadaClient.submitAttendance(sessionId, attendanceId);
    return result;
  } catch (error) {
    return { success: false, error: error.message };
  }
});

ipcMain.handle('assignments:getDetail', async (event, assignId) => {
  try {
    if (!spadaClient) return { success: false, error: 'Not logged in' };
    const detail = await spadaClient.getAssignmentDetail(assignId);
    return { success: true, data: detail };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

ipcMain.handle('assignments:submit', async (event, { assignId, filePath }) => {
  try {
    if (!spadaClient) return { success: false, error: 'Not logged in' };
    const result = await spadaClient.submitAssignment(assignId, filePath);
    return result;
  } catch (error) {
    return { success: false, error: error.message };
  }
});

ipcMain.handle('announcements:get', async (event, forumId) => {
  try {
    if (!spadaClient) return { success: false, error: 'Not logged in' };
    const announcements = await spadaClient.getAnnouncements(forumId);
    return { success: true, data: announcements };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

ipcMain.handle('settings:get', () => {
  return {
    autoAttendance: store.get('autoAttendance', true),
    notifications: store.get('notifications', true),
    deadlineReminder: store.get('deadlineReminder', 3),
    pollingInterval: store.get('pollingInterval', 5)
  };
});

ipcMain.handle('settings:set', (event, settings) => {
  Object.entries(settings).forEach(([key, value]) => store.set(key, value));
  if (scheduler) {
    scheduler.updateSettings(settings);
  }
  return { success: true };
});

ipcMain.handle('store:get', (event, key) => store.get(key));
ipcMain.handle('store:set', (event, key, value) => store.set(key, value));

ipcMain.handle('app:notify', (event, { title, body }) => {
  showNotification(title, body);
  return true;
});

app.whenReady().then(() => {
  createWindow();
  createTray();

  // Auto login if credentials saved
  const credentials = store.get('credentials');
  if (credentials) {
    mainWindow.webContents.once('did-finish-load', () => {
      mainWindow.webContents.send('auto-login');
    });
  }
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});

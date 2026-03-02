const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('spadaAPI', {
    // Window controls
    minimize: () => ipcRenderer.invoke('window:minimize'),
    maximize: () => ipcRenderer.invoke('window:maximize'),
    close: () => ipcRenderer.invoke('window:close'),

    // Auth
    login: (username, password) => ipcRenderer.invoke('auth:login', { username, password }),
    autoLogin: () => ipcRenderer.invoke('auth:autoLogin'),
    logout: () => ipcRenderer.invoke('auth:logout'),

    // Courses
    getCourses: () => ipcRenderer.invoke('courses:getAll'),
    getCourseContent: (courseId) => ipcRenderer.invoke('course:getContent', courseId),

    // Attendance
    getAttendanceSessions: (attendanceId) => ipcRenderer.invoke('attendance:getSessions', attendanceId),
    submitAttendance: (sessionId, attendanceId) => ipcRenderer.invoke('attendance:submit', { sessionId, attendanceId }),

    // Assignments
    getAssignmentDetail: (assignId) => ipcRenderer.invoke('assignments:getDetail', assignId),
    submitAssignment: (assignId, filePath) => ipcRenderer.invoke('assignments:submit', { assignId, filePath }),

    // Announcements
    getAnnouncements: (forumId) => ipcRenderer.invoke('announcements:get', forumId),

    // Settings
    getSettings: () => ipcRenderer.invoke('settings:get'),
    saveSettings: (settings) => ipcRenderer.invoke('settings:set', settings),

    // Notifications
    showNotification: (title, body) => ipcRenderer.invoke('app:notify', { title, body }),

    // Store
    storeGet: (key) => ipcRenderer.invoke('store:get', key),
    storeSet: (key, value) => ipcRenderer.invoke('store:set', key, value),

    // Events from main
    onAutoLogin: (callback) => ipcRenderer.on('auto-login', callback),
    onNotification: (callback) => ipcRenderer.on('notification', (event, data) => callback(data))
});

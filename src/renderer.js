// SPADA App - Mobile Renderer
import SpadaClient from './services/spada-client.js';

const spada = new SpadaClient();

const App = {
    currentPage: 'login',
    courses: [],
    currentCourse: null,
    currentTab: 'materials',
    savedCredentials: null,
    assignmentOriginPage: 'assignments', // 'assignments' or 'course-detail'

    // ========================
    // INITIALIZATION
    // ========================
    init() {
        this.bindNavigation();
        this.bindLoginForm();
        this.bindSettings();
        this.bindActions();
        this.tryAutoLogin();

        // Auto-refresh dashboard stats & trigger auto-attendance every 5 mins while app is open
        setInterval(() => {
            if (this.currentPage !== 'login' && this.courses.length > 0) {
                this.loadDashboardStats();
            }
        }, 5 * 60 * 1000);
    },

    // ========================
    // LOCAL STORAGE
    // ========================
    saveCredentials(username, password) {
        localStorage.setItem('spada_credentials', JSON.stringify({ username, password }));
    },

    getCredentials() {
        try {
            return JSON.parse(localStorage.getItem('spada_credentials'));
        } catch { return null; }
    },

    clearCredentials() {
        localStorage.removeItem('spada_credentials');
        localStorage.removeItem('spada_settings');
    },

    getSettings() {
        try {
            return JSON.parse(localStorage.getItem('spada_settings')) || { autoAttendance: true, notifications: true };
        } catch { return { autoAttendance: true, notifications: true }; }
    },

    saveSettings(settings) {
        const current = this.getSettings();
        localStorage.setItem('spada_settings', JSON.stringify({ ...current, ...settings }));
    },

    // ========================
    // NAVIGATION
    // ========================
    bindNavigation() {
        document.querySelectorAll('.nav-item[data-page]').forEach(btn => {
            btn.addEventListener('click', () => {
                this.navigateTo(btn.dataset.page);
            });
        });
    },

    navigateTo(page) {
        document.querySelectorAll('.nav-item[data-page]').forEach(b => b.classList.remove('active'));
        const navBtn = document.querySelector(`.nav-item[data-page="${page}"]`);
        if (navBtn) navBtn.classList.add('active');

        this.showPage(page);
        this.loadPageData(page);
    },

    showPage(pageName) {
        document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
        const pageEl = document.getElementById(`page-${pageName}`);
        if (pageEl) pageEl.classList.add('active');

        const bottomNav = document.getElementById('bottom-nav');
        bottomNav.style.display = pageName === 'login' ? 'none' : 'flex';

        this.currentPage = pageName;
    },

    async loadPageData(page) {
        switch (page) {
            case 'dashboard': await this.loadDashboard(); break;
            case 'courses': await this.loadCourses(); break;
            case 'attendance': await this.loadAllAttendance(); break;
            case 'assignments': await this.loadAllAssignments(); break;
            case 'settings': this.loadSettings(); break;
        }
    },

    // ========================
    // AUTH
    // ========================
    bindLoginForm() {
        document.getElementById('login-form').addEventListener('submit', async (e) => {
            e.preventDefault();
            const username = document.getElementById('username').value;
            const password = document.getElementById('password').value;
            const remember = document.getElementById('remember-me').checked;

            this.setLoginLoading(true);
            this.hideLoginError();

            const result = await spada.login(username, password);
            this.setLoginLoading(false);

            if (result.success) {
                if (remember) this.saveCredentials(username, password);
                this.onLoginSuccess(result.userInfo);
            } else {
                this.showLoginError(result.error || 'Login gagal.');
            }
        });

        document.getElementById('btn-logout').addEventListener('click', () => {
            this.clearCredentials();
            this.courses = [];
            this.showPage('login');
            this.showToast('Logout', 'Berhasil keluar', 'info');
        });
    },

    async tryAutoLogin() {
        const creds = this.getCredentials();
        if (!creds) return;

        document.getElementById('username').value = creds.username;
        document.getElementById('password').value = creds.password;

        this.setLoginLoading(true);
        try {
            const result = await spada.login(creds.username, creds.password);
            this.setLoginLoading(false);
            if (result.success) {
                this.onLoginSuccess(result.userInfo);
            }
        } catch {
            this.setLoginLoading(false);
        }
    },

    onLoginSuccess(userInfo) {
        this.navigateTo('dashboard');
        this.showToast('Login Berhasil', `Selamat datang, ${userInfo?.name || 'User'}!`, 'success');
    },

    setLoginLoading(loading) {
        const btn = document.getElementById('btn-login-submit');
        const btnText = btn.querySelector('.btn-text');
        const btnLoader = btn.querySelector('.btn-loader');
        btnText.style.display = loading ? 'none' : 'inline';
        btnLoader.style.display = loading ? 'inline' : 'none';
        btn.disabled = loading;
    },

    showLoginError(msg) {
        const el = document.getElementById('login-error');
        el.textContent = msg;
        el.style.display = 'block';
    },

    hideLoginError() {
        document.getElementById('login-error').style.display = 'none';
    },

    // ========================
    // DASHBOARD
    // ========================
    async loadDashboard() {
        try {
            const courses = await spada.getCourses();
            this.courses = courses;
            document.getElementById('stat-courses').textContent = courses.length;
            this.renderDashboardCourses();

            const settings = this.getSettings();
            document.getElementById('stat-auto').textContent = settings.autoAttendance ? 'ON' : 'OFF';

            this.loadDashboardStats();
        } catch (error) {
            this.showToast('Error', 'Gagal memuat dashboard', 'error');
        }
    },

    async loadDashboardStats() {
        let pendingAttendance = 0;
        let activeAssignments = 0;
        const deadlines = [];

        // Load all courses in parallel
        const coursePromises = this.courses.map(async (course) => {
            try {
                // Get assignments from bulk endpoint (fast - 1 request per course)
                const assignments = await spada.getAllAssignmentsForCourse(course.id);
                activeAssignments += assignments.filter(a => !this.isAssignmentSubmitted(a.submissionStatus)).length;
                for (const a of assignments) {
                    if (a.dueDate) {
                        deadlines.push({ name: a.name, courseName: course.name, dueDate: a.dueDate, status: a.submissionStatus, moduleId: a.moduleId });
                    }
                }

                // Get course content for attendance
                const content = await spada.getCourseContent(course.id);
                course._content = content;
                for (const att of content.attendance) {
                    try {
                        const sessions = await spada.getAttendanceSessions(att.moduleId);

                        // NEW LOGIC: FRONTEND AUTO-ATTENDANCE INJECTION
                        const settings = this.getSettings();
                        if (settings.autoAttendance) {
                            if (!this.checkedAttendanceCache) this.checkedAttendanceCache = new Set();

                            for (const session of sessions) {
                                if (session.canSubmit && session.sessionId && !this.checkedAttendanceCache.has(session.sessionId)) {
                                    // Submit automatically
                                    const result = await spada.submitAttendance(session.sessionId);
                                    if (result.success) {
                                        this.checkedAttendanceCache.add(session.sessionId);
                                        this.showToast('✅ Auto-Absen Berhasil!', `Telah absen Present untuk ${course.name}`, 'success');

                                        // Capacitor Notification if available
                                        if (window.Capacitor && window.Capacitor.Plugins.LocalNotifications && settings.notifications) {
                                            window.Capacitor.Plugins.LocalNotifications.schedule({
                                                notifications: [{
                                                    title: '✅ Auto-Absen Berhasil!',
                                                    body: `Berhasil absen otomatis untuk ${course.name}`,
                                                    id: new Date().getTime(),
                                                    schedule: { at: new Date(Date.now() + 1000) }
                                                }]
                                            });
                                        }

                                        // Desktop (Electron) Notification if available
                                        if (window.electronAPI) {
                                            window.electronAPI.showNotification('✅ Auto-Absen Berhasil (Desktop)!', `Telah absen otomatis untuk ${course.name} saat berjalan di background.`);
                                        }

                                        // Once submitted successfully, pretend it's no longer submittable so badge doesn't increment
                                        session.canSubmit = false;
                                    }
                                }
                            }
                        }

                        // Add remaining submittable sessions (if auto-absen failed or is disabled) to pending badge count
                        pendingAttendance += sessions.filter(s => s.canSubmit).length;
                    } catch { }
                }
            } catch { }
        });

        await Promise.all(coursePromises);

        document.getElementById('stat-attendance').textContent = pendingAttendance;
        document.getElementById('stat-assignments').textContent = activeAssignments;

        if (pendingAttendance > 0) {
            const badge = document.getElementById('attendance-badge');
            badge.textContent = pendingAttendance;
            badge.style.display = 'inline';
        }

        this.renderDeadlines(deadlines);
    },

    renderDashboardCourses() {
        const container = document.getElementById('dashboard-courses');
        if (this.courses.length === 0) {
            container.innerHTML = '<div class="empty-state"><div class="empty-state-icon"><i class="bx bx-book"></i></div><h3>Tidak ada mata kuliah</h3></div>';
            return;
        }

        const icons = ['<i class="bx bxs-book"></i>', '<i class="bx bxs-book-alt"></i>', '<i class="bx bxs-book-content"></i>', '<i class="bx bx-book"></i>', '<i class="bx bxs-book-bookmark"></i>'];
        container.innerHTML = this.courses.map((c, i) => `
            <div class="mini-course-card" data-course-id="${c.id}">
                <span class="mini-course-icon">${icons[i % icons.length]}</span>
                <span class="mini-course-name">${c.name}</span>
            </div>
        `).join('');

        container.querySelectorAll('.mini-course-card').forEach(card => {
            card.addEventListener('click', () => this.openCourseDetail(card.dataset.courseId));
        });
    },

    renderDeadlines(deadlines) {
        const container = document.getElementById('dashboard-deadlines');
        if (deadlines.length === 0) {
            container.innerHTML = '<div class="empty-state"><div class="empty-state-icon"><i class="bx bx-party"></i></div><h3>Tidak ada deadline</h3></div>';
            return;
        }
        // Only show unsubmitted deadlines
        const pending = deadlines.filter(d => !this.isAssignmentSubmitted(d.status));
        if (pending.length === 0) {
            container.innerHTML = '<div class="empty-state"><div class="empty-state-icon"><i class="bx bx-party"></i></div><h3>Semua tugas sudah dikerjakan!</h3></div>';
            return;
        }

        // Parse dates and sort by nearest first
        const now = new Date();
        const parsed = pending.map(d => {
            const date = this._parseMoodleDate(d.dueDate);
            const diff = date ? date.getTime() - now.getTime() : Infinity;
            return { ...d, _date: date, _diff: diff };
        }).sort((a, b) => a._diff - b._diff);

        if (parsed.length === 0) {
            container.innerHTML = '<div class="empty-state"><div class="empty-state-icon"><i class="bx bx-party"></i></div><h3>Tidak ada deadline</h3></div>';
            return;
        }

        container.innerHTML = parsed.map(d => {
            const timeLeft = d._diff > 0 ? this._formatTimeLeft(d._diff) : 'Sudah lewat';
            return `
            <div class="deadline-item" data-module-id="${d.moduleId || ''}" style="cursor:pointer">
                <div class="deadline-icon"><i class="bx bx-task"></i></div>
                <div class="deadline-info">
                    <div class="deadline-name">${d.name}</div>
                    <div class="deadline-course-name">${d.courseName}</div>
                </div>
                <div class="deadline-time-group">
                    <div class="deadline-countdown">${timeLeft}</div>
                    <div class="deadline-date-text">${d.dueDate}</div>
                </div>
            </div>`;
        }).join('');

        container.querySelectorAll('.deadline-item[data-module-id]').forEach(item => {
            if (!item.dataset.moduleId) return;
            item.addEventListener('click', () => {
                this.assignmentOriginPage = 'assignments';
                this.currentCourse = null;
                this.openAssignmentDetail(item.dataset.moduleId);
            });
        });

        // Send local notification for deadlines <= 24 hours
        this._notifyUrgentDeadlines(parsed);
    },

    _notifiedDeadlineIds: new Set(),

    async _notifyUrgentDeadlines(parsed) {
        const urgent = parsed.filter(d => d._diff > 0 && d._diff <= 24 * 60 * 60 * 1000);
        if (urgent.length === 0) return;

        for (const d of urgent) {
            const key = `deadline_${d.moduleId}`;
            if (this._notifiedDeadlineIds.has(key)) continue;
            this._notifiedDeadlineIds.add(key);

            const hoursLeft = Math.floor(d._diff / (1000 * 60 * 60));
            const minsLeft = Math.floor((d._diff % (1000 * 60 * 60)) / (1000 * 60));

            try {
                if (window.Capacitor?.isNativePlatform()) {
                    const { LocalNotifications } = await import('@capacitor/local-notifications');
                    await LocalNotifications.schedule({
                        notifications: [{
                            title: `<i class="bx bx-error-circle"></i> Deadline ${hoursLeft > 0 ? hoursLeft + ' jam' : minsLeft + ' menit'} lagi!`,
                            body: `${d.name}\n${d.courseName}`,
                            id: parseInt(d.moduleId) || Date.now(),
                            schedule: { at: new Date(Date.now() + 1000) },
                            sound: 'default'
                        }]
                    });
                }
            } catch (e) {
                console.log('[Notif] Failed:', e.message);
            }
        }
    },

    _parseMoodleDate(dateStr) {
        if (!dateStr) return null;
        try {
            // Clean Moodle format: "Mon 9 Feb 2026 7:30AM - 7:45AM" -> "Mon 9 Feb 2026 7:30AM"
            let str = dateStr.split('-')[0].trim();
            // Remove day name prefix if present: "Saturday, 2 March" or "Mon 9 Feb" -> "9 Feb..."
            str = str.replace(/^[A-Za-z]+,?\s+/, '');

            // Add space before AM/PM to ensure native Date parser works in V8 (e.g. "7:30AM" -> "7:30 AM")
            str = str.replace(/(\d)(AM|PM)/i, '$1 $2');

            // Native parse works for "9 Feb 2026 7:30 AM"
            let date = new Date(str);
            if (!isNaN(date.getTime())) return date;

            // Manual parse fallback
            const match = str.match(/(\d{1,2})\s+(\w+)\s+(\d{4}),?\s*(\d{1,2}):(\d{2})\s*(AM|PM)?/i);
            if (match) {
                let [, day, mon, year, hour, min, ampm] = match;
                const monthStr = mon.toLowerCase();
                const months = {
                    jan: 0, january: 0, januari: 0,
                    feb: 1, february: 1, februari: 1,
                    mar: 2, march: 2, maret: 2,
                    apr: 3, april: 3,
                    may: 4, mei: 4,
                    jun: 5, june: 5, juni: 5,
                    jul: 6, july: 6, juli: 6,
                    aug: 7, august: 7, agustus: 7,
                    sep: 8, september: 8,
                    oct: 9, october: 9, oktober: 9,
                    nov: 10, november: 10,
                    dec: 11, december: 11, desember: 11
                };
                hour = parseInt(hour);
                if (ampm?.toUpperCase() === 'PM' && hour < 12) hour += 12;
                if (ampm?.toUpperCase() === 'AM' && hour === 12) hour = 0;
                date = new Date(parseInt(year), months[mon.toLowerCase()] ?? 0, parseInt(day), hour, parseInt(min));
                if (!isNaN(date.getTime())) return date;
            }
            return null;
        } catch { return null; }
    },

    _formatTimeLeft(diffMs) {
        const hours = Math.floor(diffMs / (1000 * 60 * 60));
        const days = Math.floor(hours / 24);
        const remainingHours = hours % 24;
        if (days > 0) return `${days} hari ${remainingHours > 0 ? remainingHours + ' jam' : ''} lagi`;
        if (hours > 0) return `${hours} jam lagi`;
        const mins = Math.floor(diffMs / (1000 * 60));
        return `${mins} menit lagi`;
    },

    // ========================
    // COURSES
    // ========================
    async loadCourses() {
        const container = document.getElementById('courses-grid');
        container.innerHTML = '<div class="loading-spinner"></div>';

        try {
            if (this.courses.length === 0) {
                this.courses = await spada.getCourses();
            }

            const colors = ['#00c896', '#3b82f6', '#f59e0b', '#ef4444', '#8b5cf6', '#ec4899', '#06b6d4', '#10b981', '#f97316', '#6366f1'];
            const icons = ['<i class="bx bxs-book"></i>', '<i class="bx bxs-book-alt"></i>', '<i class="bx bxs-book-content"></i>', '<i class="bx bx-book"></i>', '<i class="bx bxs-book-bookmark"></i>'];
            const cards = [];

            for (let i = 0; i < this.courses.length; i++) {
                const course = this.courses[i];
                let badges = '';

                try {
                    const content = await spada.getCourseContent(course.id);
                    course._content = content;
                    if (content.attendance.length > 0) badges += '<span class="course-badge"><i class="bx bx-list-check"></i> Absensi</span>';
                    if (content.assignments.length > 0) badges += `<span class="course-badge"><i class="bx bx-task"></i> ${content.assignments.length} Tugas</span>`;
                    if (content.forums.length > 0) badges += '<span class="course-badge"><i class="bx bx-conversation"></i> Forum</span>';
                    if (content.resources.length > 0) badges += `<span class="course-badge"><i class="bx bx-file"></i> ${content.resources.length} Materi</span>`;
                } catch { }

                cards.push(`
                    <div class="course-card" data-course-id="${course.id}" style="--card-accent: ${colors[i % colors.length]}">
                        <div class="course-card-icon">${icons[i % icons.length]}</div>
                        <div class="course-card-name">${course.name}</div>
                        <div class="course-card-id">ID: ${course.id}</div>
                        <div class="course-card-badges">${badges}</div>
                    </div>
                `);
            }

            container.innerHTML = cards.join('');
            container.querySelectorAll('.course-card').forEach(card => {
                card.addEventListener('click', () => this.openCourseDetail(card.dataset.courseId));
            });
        } catch (error) {
            container.innerHTML = `<div class="empty-state"><div class="empty-state-icon"><i class="bx bx-x-circle"></i></div><h3>Gagal memuat</h3><p>${error.message}</p></div>`;
        }
    },

    // ========================
    // COURSE DETAIL
    // ========================
    async openCourseDetail(courseId) {
        const course = this.courses.find(c => c.id === courseId);
        if (!course) return;

        this.currentCourse = course;
        document.getElementById('course-detail-title').textContent = course.name;
        this.showPage('course-detail');

        document.querySelectorAll('.tab-btn').forEach(btn => {
            btn.onclick = () => {
                document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
                this.currentTab = btn.dataset.tab;
                this.renderCourseTab();
            };
        });

        const fromPage = this.currentPage;
        document.getElementById('btn-back-course').onclick = () => {
            if (fromPage === 'assignments') this.navigateTo('assignments');
            else if (fromPage === 'attendance') this.navigateTo('attendance');
            else this.navigateTo('courses');
        };

        const contentEl = document.getElementById('course-detail-content');
        contentEl.innerHTML = '<div class="loading-spinner"></div>';

        if (!course._content) {
            try {
                course._content = await spada.getCourseContent(courseId);
            } catch {
                contentEl.innerHTML = '<div class="empty-state"><div class="empty-state-icon"><i class="bx bx-x-circle"></i></div><h3>Gagal memuat konten</h3></div>';
                return;
            }
        }

        this.currentTab = 'materials';
        document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
        document.querySelector('.tab-btn[data-tab="materials"]').classList.add('active');
        this.renderCourseTab();
    },

    renderCourseTab() {
        const content = this.currentCourse._content;
        const container = document.getElementById('course-detail-content');

        switch (this.currentTab) {
            case 'materials': this.renderMaterials(container, content); break;
            case 'assignments': this.renderCourseAssignments(container, content); break;
            case 'attendance': this.renderCourseAttendance(container, content); break;
            case 'forums': this.renderCourseForums(container, content); break;
        }
    },

    renderMaterials(container, content) {
        if (content.resources.length === 0) {
            container.innerHTML = '<div class="empty-state"><div class="empty-state-icon"><i class="bx bx-file"></i></div><h3>Belum ada materi</h3></div>';
            return;
        }
        const icons = { resource: '<i class="bx bx-file"></i>', page: '<i class="bx bx-file-blank"></i>', folder: '<i class="bx bx-folder"></i>', url: '<i class="bx bx-link"></i>', unknown: '<i class="bx bx-paperclip"></i>' };
        container.innerHTML = content.resources.map(r => `
            <div class="module-item" data-url="${r.url}">
                <div class="module-icon">${icons[r.type] || '<i class="bx bx-file"></i>'}</div>
                <div class="module-info">
                    <div class="module-name">${r.name}</div>
                    <div class="module-meta">${r.type}</div>
                </div>
            </div>
        `).join('');
        container.querySelectorAll('.module-item').forEach(item => {
            item.addEventListener('click', () => {
                if (item.dataset.url) window.open(item.dataset.url, '_blank');
            });
        });
    },

    renderCourseAssignments(container, content) {
        if (content.assignments.length === 0) {
            container.innerHTML = '<div class="empty-state"><div class="empty-state-icon"><i class="bx bx-task"></i></div><h3>Belum ada tugas</h3></div>';
            return;
        }
        container.innerHTML = '<div class="loading-spinner"></div>';
        this.loadCourseAssignmentsBulk(container, content.assignments);
    },

    async loadCourseAssignmentsBulk(container, modules) {
        const courseId = this.currentCourse?.id;
        let assignments = [];
        if (courseId) {
            try { assignments = await spada.getAllAssignmentsForCourse(courseId); } catch { }
        }
        if (assignments.length === 0) assignments = modules.map(m => ({ ...m, submissionStatus: '', dueDate: '' }));

        if (assignments.length === 0) {
            container.innerHTML = '<div class="empty-state"><div class="empty-state-icon"><i class="bx bx-task"></i></div><h3>Belum ada tugas</h3></div>';
            return;
        }

        const renderCard = (a, submitted) => `
            <div class="assignment-card ${submitted ? 'assignment-done' : ''}" data-module-id="${a.moduleId}">
                <div class="assignment-header">
                    <div class="assignment-title">${a.name}</div>
                    <span class="module-status ${submitted ? 'status-submitted' : 'status-not-submitted'}">
                        ${submitted ? '<i class="bx bx-check-circle"></i> Done' : '<i class="bx bx-error-circle"></i> Belum'}
                    </span>
                </div>
                ${a.dueDate ? `<div class="assignment-deadline"><i class="bx bx-time"></i> ${a.dueDate}</div>` : ''}
            </div>`;

        container.innerHTML = assignments.map(a => {
            const submitted = this.isAssignmentSubmitted(a.submissionStatus);
            return renderCard(a, submitted);
        }).join('');

        container.querySelectorAll('.assignment-card').forEach(card => {
            card.addEventListener('click', () => {
                this.assignmentOriginPage = 'course-detail';
                this.openAssignmentDetail(card.dataset.moduleId);
            });
        });
    },

    renderCourseAttendance(container, content) {
        if (content.attendance.length === 0) {
            container.innerHTML = '<div class="empty-state"><div class="empty-state-icon"><i class="bx bx-list-check"></i></div><h3>Tidak ada absensi</h3></div>';
            return;
        }
        container.innerHTML = '<div class="loading-spinner"></div>';
        this.loadAttendanceSessions(container, content.attendance);
    },

    async loadAttendanceSessions(container, attendanceModules) {
        let html = '';
        const seenSessions = new Set(); // deduplicate by sessionId
        for (const att of attendanceModules) {
            try {
                const sessions = await spada.getAttendanceSessions(att.moduleId);
                const uniqueSessions = sessions.filter(s => {
                    const key = s.sessionId || `${s.date}-${s.description}`;
                    if (seenSessions.has(key)) return false;
                    seenSessions.add(key);
                    return true;
                });
                if (uniqueSessions.length > 0) {
                    html += `<div class="attendance-course-group"><div class="attendance-course-title">${att.name}</div>`;
                    for (const s of uniqueSessions) {
                        let statusClass = '', statusText = s.status || '-', actionBtn = '';
                        if (s.canSubmit) {
                            statusClass = 'status-pending'; statusText = 'Belum Absen';
                            actionBtn = `<button class="btn-attend" data-session="${s.sessionId}">Absen</button>`;
                        } else if ((s.status || '').toLowerCase().includes('present') || (s.status || '').toLowerCase().includes('hadir')) {
                            statusClass = 'status-present'; statusText = '<i class="bx bx-check-circle"></i> Present';
                        } else if ((s.status || '').toLowerCase().includes('absent')) {
                            statusClass = 'status-absent'; statusText = '<i class="bx bx-x-circle"></i> Absent';
                        }
                        html += `<div class="attendance-session"><div><div class="attendance-date">${s.date}</div><div class="attendance-desc">${s.description}</div></div><div style="display:flex;align-items:center;gap:8px"><span class="module-status ${statusClass}">${statusText}</span>${actionBtn}</div></div>`;
                    }
                    html += '</div>';
                }
            } catch { }
        }

        container.innerHTML = html || '<div class="empty-state"><div class="empty-state-icon"><i class="bx bx-list-check"></i></div><h3>Tidak ada session</h3></div>';

        container.querySelectorAll('.btn-attend').forEach(btn => {
            btn.addEventListener('click', async (e) => {
                e.stopPropagation();
                btn.disabled = true; btn.textContent = '<i class="bx bx-loader-alt bx-spin"></i>';
                const result = await spada.submitAttendance(btn.dataset.session);
                if (result.success) {
                    btn.textContent = '<i class="bx bx-check-circle"></i>'; btn.style.background = 'var(--success)';
                    this.showToast('Berhasil', 'Absen Present!', 'success');
                } else {
                    btn.textContent = '<i class="bx bx-x-circle"></i>'; btn.disabled = false;
                    this.showToast('Gagal', result.error, 'error');
                }
            });
        });
    },

    renderCourseForums(container, content) {
        if (content.forums.length === 0) {
            container.innerHTML = '<div class="empty-state"><div class="empty-state-icon"><i class="bx bx-conversation"></i></div><h3>Tidak ada forum</h3></div>';
            return;
        }
        container.innerHTML = '<div class="loading-spinner"></div>';
        this.loadForumContent(container, content.forums);
    },

    async loadForumContent(container, forums) {
        let html = '';
        for (const f of forums) {
            try {
                const anns = await spada.getAnnouncements(f.moduleId);
                for (const a of anns) {
                    html += `<div class="announcement-item"><div class="announcement-title">${a.title}</div><div class="announcement-meta">${a.author} • ${a.date}</div></div>`;
                }
            } catch { }
        }
        container.innerHTML = html || '<div class="empty-state"><div class="empty-state-icon"><i class="bx bx-conversation"></i></div><h3>Belum ada pengumuman</h3></div>';
    },

    async loadAllAttendance() {
        const container = document.getElementById('attendance-content');
        container.innerHTML = '<div class="loading-spinner"></div>';

        // Collect courses that have attendance modules
        const coursesWithAttendance = [];
        for (const course of this.courses) {
            try {
                const content = course._content || await spada.getCourseContent(course.id);
                course._content = content;
                if (content.attendance.length > 0) {
                    coursesWithAttendance.push(course);
                }
            } catch { }
        }

        if (coursesWithAttendance.length === 0) {
            container.innerHTML = '<div class="empty-state"><div class="empty-state-icon"><i class="bx bx-list-check"></i></div><h3>Tidak ada absensi</h3></div>';
            return;
        }

        // Sort by course ID
        coursesWithAttendance.sort((a, b) => parseInt(b.id) - parseInt(a.id));

        // Show course list
        const colors = ['#00c896', '#3b82f6', '#f59e0b', '#ef4444', '#8b5cf6', '#ec4899', '#06b6d4', '#10b981'];
        container.innerHTML = '<div class="attendance-course-list">' +
            coursesWithAttendance.map((course, i) => `
                <div class="attendance-course-card" data-course-idx="${i}" style="border-left: 4px solid ${colors[i % colors.length]}">
                    <div class="attendance-course-card-info">
                        <div class="attendance-course-card-name">${course.name}</div>
                        <div class="attendance-course-card-meta"><i class="bx bx-book"></i> ${course._content.attendance.length} modul absensi</div>
                    </div>
                    <div class="attendance-course-card-arrow"><i class="bx bx-chevron-right"></i></div>
                </div>
            `).join('') + '</div>';

        container.querySelectorAll('.attendance-course-card').forEach(card => {
            card.addEventListener('click', () => {
                const idx = parseInt(card.dataset.courseIdx);
                this._openCourseAttendance(coursesWithAttendance[idx]);
            });
        });
    },

    async _openCourseAttendance(course) {
        const container = document.getElementById('attendance-content');
        container.innerHTML = '<div class="loading-spinner"></div>';

        const content = course._content || await spada.getCourseContent(course.id);
        let allSessions = [];
        const seenDates = new Set();

        for (const att of content.attendance) {
            try {
                const sessions = await spada.getAttendanceSessions(att.moduleId);
                for (const s of sessions) {
                    // Deduplicate robustly
                    const d = this._parseMoodleDate(s.date);
                    const dateKey = d ? d.getTime() : s.date?.replace(/\s+/g, ' ').trim();
                    if (dateKey && !seenDates.has(dateKey)) {
                        seenDates.add(dateKey);
                        allSessions.push({ ...s, _attModuleId: att.moduleId });
                    }
                }
            } catch { }
        }

        // Sort sessions chronologically (earliest first)
        allSessions.sort((a, b) => {
            const dateA = this._parseMoodleDate(a.date);
            const dateB = this._parseMoodleDate(b.date);
            if (dateA && dateB) return dateA.getTime() - dateB.getTime();
            if (dateA) return -1;
            if (dateB) return 1;
            return 0;
        });

        // Build header + session list
        let html = `
            <div class="attendance-detail-view">
                <div class="attendance-detail-header">
                    <button class="btn-back-attendance" id="btn-back-attendance"><i class="bx bx-arrow-back"></i> Kembali</button>
                    <div class="attendance-detail-title">${course.name}</div>
                </div>`;

        if (allSessions.length === 0) {
            html += '<div class="empty-state"><div class="empty-state-icon"><i class="bx bx-list-check"></i></div><h3>Tidak ada sesi absensi</h3></div>';
        } else {
            html += '<div class="attendance-sessions-list">';
            for (const s of allSessions) {
                let statusClass = '', statusText = s.status || '-', actionBtn = '';
                if (s.canSubmit) {
                    statusClass = 'status-pending';
                    statusText = '<i class="bx bx-loader-alt bx-spin"></i> Belum Absen';
                    actionBtn = `<button class="btn-attend-manual" data-session="${s.sessionId}" data-module="${s._attModuleId}"><i class="bx bx-check-circle"></i> Hadir</button>`;
                } else if ((s.status || '').toLowerCase().includes('present') || (s.status || '').toLowerCase().includes('hadir')) {
                    statusClass = 'status-present';
                    statusText = '<i class="bx bx-check-circle"></i> Present';
                } else if ((s.status || '').toLowerCase().includes('absent')) {
                    statusClass = 'status-absent';
                    statusText = '<i class="bx bx-x-circle"></i> Absent';
                } else if ((s.status || '').toLowerCase().includes('late')) {
                    statusClass = 'status-late';
                    statusText = '<i class="bx bx-time"></i> Late';
                } else {
                    // No status yet - session not opened
                    statusClass = 'status-locked';
                    statusText = '<i class="bx bx-lock-alt"></i> Belum dibuka';
                }

                html += `
                    <div class="attendance-session-card ${statusClass}">
                        <div class="attendance-session-info">
                            <div class="attendance-session-date">${s.date}</div>
                            <div class="attendance-session-desc">${s.description || ''}</div>
                        </div>
                        <div class="attendance-session-action">
                            <span class="attendance-status ${statusClass}">${statusText}</span>
                            ${actionBtn}
                        </div>
                    </div>`;
            }
            html += '</div>';
        }

        html += '</div>';
        container.innerHTML = html;

        // Back button
        document.getElementById('btn-back-attendance')?.addEventListener('click', () => {
            this.loadAllAttendance();
        });

        // Manual attend buttons
        container.querySelectorAll('.btn-attend-manual').forEach(btn => {
            btn.addEventListener('click', async (e) => {
                e.stopPropagation();
                btn.disabled = true;
                btn.textContent = '<i class="bx bx-loader-alt bx-spin"></i> Memproses...';
                try {
                    const result = await spada.submitAttendance(btn.dataset.session, btn.dataset.module);
                    if (result.success) {
                        btn.textContent = '<i class="bx bx-check-circle"></i> Berhasil';
                        btn.style.background = 'var(--success)';
                        btn.style.color = '#fff';
                        this.showToast('Berhasil', 'Absen Present berhasil!', 'success');
                        // Refresh view
                        setTimeout(() => this._openCourseAttendance(course), 1000);
                    } else {
                        btn.textContent = '<i class="bx bx-check-circle"></i> Hadir';
                        btn.disabled = false;
                        this.showToast('Gagal', result.error || 'Gagal absen', 'error');
                    }
                } catch (err) {
                    btn.textContent = '<i class="bx bx-check-circle"></i> Hadir';
                    btn.disabled = false;
                    this.showToast('Gagal', err.message, 'error');
                }
            });
        });
    },

    // ========================
    // ALL ASSIGNMENTS
    // ========================
    async loadAllAssignments() {
        const container = document.getElementById('assignments-content');
        container.innerHTML = '<div class="loading-spinner"></div>';

        const pending = [];
        const done = [];

        for (const course of this.courses) {
            try {
                const assignments = await spada.getAllAssignmentsForCourse(course.id);
                for (const assign of assignments) {
                    const submitted = this.isAssignmentSubmitted(assign.submissionStatus);
                    const card = { ...assign, courseName: course.name };
                    if (submitted) done.push(card);
                    else pending.push(card);
                }
            } catch { }
        }

        const renderCard = (assign, submitted) => `
            <div class="assignment-card ${submitted ? 'assignment-done' : ''}" data-module-id="${assign.moduleId}">
                <div class="assignment-header">
                    <div>
                        <div class="assignment-title">${assign.name}</div>
                        <div class="assignment-course">${assign.courseName}</div>
                    </div>
                    <span class="module-status ${submitted ? 'status-submitted' : 'status-not-submitted'}">
                        ${submitted ? '<i class="bx bx-check-circle"></i>' : '<i class="bx bx-error-circle"></i>'}
                    </span>
                </div>
                ${assign.dueDate ? `<div class="assignment-deadline"><i class="bx bx-time"></i> ${assign.dueDate}</div>` : ''}
            </div>`;

        let html = '';

        // Sort pending by deadline (nearest first)
        const sortByDeadline = (list) => {
            return list.map(a => {
                const date = this._parseMoodleDate(a.dueDate);
                const diff = date ? date.getTime() - Date.now() : Infinity;
                return { ...a, _diff: diff };
            }).sort((a, b) => a._diff - b._diff);
        };
        const sortedPending = sortByDeadline(pending);

        if (sortedPending.length > 0) {
            html += `<div class="assignment-section-header pending-header"><i class="bx bx-pin"></i> Belum Dikerjakan (${sortedPending.length})</div>`;
            html += sortedPending.map(a => renderCard(a, false)).join('');
        }

        if (done.length > 0) {
            html += `<div class="assignment-section-header done-header"><i class="bx bx-check-circle"></i> Sudah Dikerjakan (${done.length})</div>`;
            html += done.map(a => renderCard(a, true)).join('');
        }

        container.innerHTML = html || '<div class="empty-state"><div class="empty-state-icon"><i class="bx bx-task"></i></div><h3>Tidak ada tugas</h3></div>';

        container.querySelectorAll('.assignment-card').forEach(card => {
            card.addEventListener('click', () => {
                this.assignmentOriginPage = 'assignments';
                this.currentCourse = null;
                this.openAssignmentDetail(card.dataset.moduleId);
            });
        });
    },

    // ========================
    // ASSIGNMENT DETAIL
    // ========================
    async openAssignmentDetail(moduleId) {
        this.showPage('assignment-detail');
        const container = document.getElementById('assignment-detail-content');
        container.innerHTML = '<div class="loading-spinner"></div>';

        // Back: go to origin (course-detail tab or assignments page)
        const originPage = this.assignmentOriginPage || 'assignments';
        const originCourse = this.currentCourse;
        document.getElementById('btn-back-assignment').onclick = () => {
            if (originPage === 'course-detail' && originCourse) {
                this.openCourseDetail(originCourse.id);
                // Restore assignments tab
                setTimeout(() => {
                    this.currentTab = 'assignments';
                    document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
                    document.querySelector('.tab-btn[data-tab="assignments"]')?.classList.add('active');
                    this.renderCourseTab();
                }, 50);
            } else {
                this.navigateTo('assignments');
            }
        };

        try {
            const detail = await spada.getAssignmentDetail(moduleId);
            document.getElementById('assignment-detail-title').textContent = detail.title || 'Detail Tugas';

            const isSubmitted = this.isAssignmentSubmitted(detail.submissionStatus);

            // Instructor attached files
            let instructorFilesHtml = '';
            if (detail.instructorFiles?.length > 0) {
                instructorFilesHtml = `
                    <div class="submission-files" style="margin-top:16px">
                        <div class="submission-files-title"><i class="bx bx-paperclip"></i> Lampiran Dosen</div>
                        ${detail.instructorFiles.map(f => `
                            <a href="${f.url}" target="_blank" class="submission-file-item">
                                <span class="file-icon"><i class="bx bx-file"></i></span>
                                <span class="file-name">${f.name}</span>
                                <span class="file-open"><i class="bx bx-link-external"></i></span>
                            </a>`).join('')}
                    </div>`;
            }

            // Student submitted files
            let studentFilesHtml = '';
            if (detail.files?.length > 0) {
                studentFilesHtml = `
                    <div class="submission-files">
                        <div class="submission-files-title"><i class="bx bx-upload"></i> File yang Saya Submit</div>
                        ${detail.files.map(f => `
                            <a href="${f.url}" target="_blank" class="submission-file-item student-file">
                                <span class="file-icon"><i class="bx bx-paperclip"></i></span>
                                <span class="file-name">${f.name}</span>
                                <span class="file-open"><i class="bx bx-link-external"></i></span>
                            </a>`).join('')}
                    </div>`;
            }

            // Submitted text content
            let textHtml = '';
            if (detail.submittedText) {
                textHtml = `
                    <div class="submission-text">
                        <div class="submission-text-title"><i class="bx bx-task"></i> Teks yang Saya Submit</div>
                        <div class="submission-text-content">${detail.submittedText}</div>
                    </div>`;
            }

            // Build submission form UI
            let submissionFormHtml = '';
            if (detail.canSubmit) {
                const buttonLabel = isSubmitted ? '<i class="bx bx-edit"></i> Edit Submisi' : '<i class="bx bx-upload"></i> Submit Tugas';
                const buttonClass = isSubmitted ? 'btn-edit-submit' : 'btn-submit-assignment';
                submissionFormHtml = `
                    <div class="submission-form" id="submission-form-area">
                        <div class="submission-form-title">${isSubmitted ? '<i class="bx bx-edit"></i> Edit Submisi' : '<i class="bx bx-upload"></i> Kirim Tugas'}</div>
                        <div class="submission-form-fields">
                            <div class="file-upload-area" id="file-upload-area">
                                <input type="file" id="submission-file-input" style="display:none" multiple>
                                <button class="btn-pick-file" id="btn-pick-file"><i class="bx bx-folder"></i> Pilih File</button>
                                <div class="selected-files" id="selected-files-list"></div>
                            </div>
                            <div class="text-submit-area">
                                <textarea id="submission-text-input" placeholder="Tulis teks submisi di sini (opsional)..." rows="4">${detail.submittedText ? '' : ''}</textarea>
                            </div>
                        </div>
                        <div id="upload-progress" style="display:none">
                            <div class="upload-progress-bar"><div class="upload-progress-fill" id="upload-fill"></div></div>
                            <div class="upload-status" id="upload-status">Mengupload...</div>
                        </div>
                        <button class="btn-action ${buttonClass}" id="btn-do-submit">${buttonLabel}</button>
                    </div>`;
            }

            // Direct link to SPADA page
            const spadaViewUrl = `https://spada.upnyk.ac.id/mod/assign/view.php?id=${moduleId}`;

            container.innerHTML = `
                <div class="assignment-detail-card">
                    <div class="detail-status-banner ${isSubmitted ? 'banner-submitted' : 'banner-pending'}">
                        ${isSubmitted ? '<i class="bx bx-check-circle"></i> Sudah Dikerjakan' : '<i class="bx bx-error-circle"></i> Belum Dikerjakan'}
                    </div>
                    <div class="detail-row"><span class="detail-label">Status Pengiriman</span><span class="detail-value">${detail.submissionStatus || '-'}</span></div>
                    <div class="detail-row"><span class="detail-label">Status Penilaian</span><span class="detail-value">${detail.gradingStatus || '-'}</span></div>
                    <div class="detail-row"><span class="detail-label">Batas Waktu</span><span class="detail-value">${detail.dueDate || '-'}</span></div>
                    <div class="detail-row"><span class="detail-label">Waktu Tersisa</span><span class="detail-value">${detail.timeRemaining || '-'}</span></div>
                    ${detail.description ? `<div class="assignment-description">${detail.description}</div>` : ''}
                    ${instructorFilesHtml}
                    ${studentFilesHtml}
                    ${textHtml}
                    ${submissionFormHtml}
                    <a href="${spadaViewUrl}" target="_blank" class="btn-open-spada"><i class="bx bx-globe"></i> Buka di SPADA</a>
                </div>`;

            // Bind submission events
            if (detail.canSubmit) {
                this._bindSubmissionEvents(moduleId);
            }
        } catch (error) {
            container.innerHTML = '<div class="empty-state"><div class="empty-state-icon"><i class="bx bx-x-circle"></i></div><h3>Gagal memuat detail</h3></div>';
        }
    },

    _selectedFiles: [],

    _bindSubmissionEvents(moduleId) {
        const fileInput = document.getElementById('submission-file-input');
        const btnPick = document.getElementById('btn-pick-file');
        const filesList = document.getElementById('selected-files-list');
        const btnSubmit = document.getElementById('btn-do-submit');

        this._selectedFiles = [];

        if (btnPick && fileInput) {
            btnPick.addEventListener('click', () => fileInput.click());
            fileInput.addEventListener('change', () => {
                this._selectedFiles = Array.from(fileInput.files);
                filesList.innerHTML = this._selectedFiles.map(f =>
                    `<div class="selected-file-item"><i class="bx bx-file"></i> ${f.name} <span class="file-size">(${(f.size / 1024).toFixed(1)} KB)</span></div>`
                ).join('');
            });
        }

        if (btnSubmit) {
            btnSubmit.addEventListener('click', async () => {
                btnSubmit.disabled = true;
                btnSubmit.textContent = '<i class="bx bx-loader-alt bx-spin"></i> Memproses...';
                const progressDiv = document.getElementById('upload-progress');
                const statusDiv = document.getElementById('upload-status');
                const fillDiv = document.getElementById('upload-fill');

                try {
                    // Step 1: Get form tokens
                    if (statusDiv) statusDiv.textContent = 'Mengambil form...';
                    if (progressDiv) progressDiv.style.display = 'block';
                    if (fillDiv) fillDiv.style.width = '10%';
                    const formTokens = await spada.getSubmissionForm(moduleId);

                    // Step 2: Upload files
                    if (this._selectedFiles.length > 0 && formTokens.hasFileUpload) {
                        for (let i = 0; i < this._selectedFiles.length; i++) {
                            const file = this._selectedFiles[i];
                            if (statusDiv) statusDiv.textContent = `Mengupload ${file.name}...`;
                            const pct = 10 + ((i + 1) / this._selectedFiles.length) * 60;
                            if (fillDiv) fillDiv.style.width = `${pct}%`;
                            await spada.uploadFileToMoodle(file, formTokens);
                        }
                    }

                    // Step 3: Submit
                    if (statusDiv) statusDiv.textContent = 'Mengirim submisi...';
                    if (fillDiv) fillDiv.style.width = '85%';
                    const textInput = document.getElementById('submission-text-input');
                    const onlineText = textInput?.value?.trim() || null;
                    await spada.submitAssignment(moduleId, formTokens, onlineText);

                    if (fillDiv) fillDiv.style.width = '100%';
                    if (statusDiv) statusDiv.textContent = '<i class="bx bx-check-circle"></i> Berhasil!';
                    this.showToast('Berhasil', 'Tugas berhasil disubmit!', 'success');

                    // Refresh detail after 1s
                    setTimeout(() => this.openAssignmentDetail(moduleId), 1000);
                } catch (error) {
                    if (statusDiv) statusDiv.textContent = `<i class="bx bx-x-circle"></i> ${error.message}`;
                    btnSubmit.disabled = false;
                    btnSubmit.textContent = '<i class="bx bx-upload"></i> Coba Lagi';
                    this.showToast('Gagal', error.message, 'error');
                }
            });
        }
    },

    // Helper: check if assignment is submitted
    isAssignmentSubmitted(status) {
        if (!status) return false;
        const s = status.toLowerCase();
        return s.includes('submitted') || s.includes('terkirim') || s.includes('grading');
    },
    // ========================
    // SETTINGS
    // ========================
    bindSettings() {
        document.getElementById('setting-auto-attendance').addEventListener('change', (e) => {
            this.saveSettings({ autoAttendance: e.target.checked });
            this.showToast('Settings', `Auto Absen: ${e.target.checked ? 'ON' : 'OFF'}`, 'info');
        });

        document.getElementById('setting-notifications').addEventListener('change', (e) => {
            this.saveSettings({ notifications: e.target.checked });
        });
    },

    loadSettings() {
        const settings = this.getSettings();
        document.getElementById('setting-auto-attendance').checked = settings.autoAttendance;
        document.getElementById('setting-notifications').checked = settings.notifications;

        const creds = this.getCredentials();
        if (creds) document.getElementById('setting-username').textContent = creds.username;
    },

    // ========================
    // ACTIONS
    // ========================
    bindActions() {
        document.getElementById('btn-refresh-dashboard')?.addEventListener('click', () => this.loadDashboard());
        document.getElementById('btn-refresh-courses')?.addEventListener('click', () => this.loadCourses());
        document.getElementById('btn-refresh-attendance')?.addEventListener('click', () => this.loadAllAttendance());
        document.getElementById('btn-refresh-assignments')?.addEventListener('click', () => this.loadAllAssignments());
    },

    // ========================
    // TOAST
    // ========================
    showToast(title, body, type = 'info') {
        const container = document.getElementById('toast-container');
        const toast = document.createElement('div');
        toast.className = `toast toast-${type}`;
        toast.innerHTML = `<div class="toast-title">${title}</div><div class="toast-body">${body}</div>`;
        container.appendChild(toast);
        setTimeout(() => toast.remove(), 3500);
    }
};

document.addEventListener('DOMContentLoaded', () => App.init());

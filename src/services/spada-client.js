// SPADA Client - Universal (Browser + Capacitor)
// Uses correct SPADA/Moodle HTML selectors

const SPADA_URL = 'https://spada.upnyk.ac.id';
const isDevMode = typeof window !== 'undefined' &&
    (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1');

function isCapacitor() {
    return typeof window !== 'undefined' && window.Capacitor && window.Capacitor.isNativePlatform();
}

class SpadaClient {
    constructor() {
        this.sesskey = null;
        this.userId = null;
        this.userInfo = null;
    }

    // ========================
    // HTTP LAYER
    // ========================
    async request(path, options = {}) {
        if (isCapacitor()) {
            return this._nativeRequest(path, options);
        } else {
            return this._browserRequest(path, options);
        }
    }

    async _nativeRequest(path, options = {}) {
        const url = path.startsWith('http') ? path : `${SPADA_URL}${path}`;
        const reqOptions = {
            url, method: options.method || 'GET',
            headers: {
                'User-Agent': 'Mozilla/5.0 (Linux; Android 13) AppleWebKit/537.36',
                ...(options.headers || {})
            },
            webFetchExtra: { credentials: 'include' },
            disableRedirects: false
        };
        if (options.body) {
            reqOptions.data = options.body;
            if (!reqOptions.headers['Content-Type']) reqOptions.headers['Content-Type'] = 'application/x-www-form-urlencoded';
        }
        try {
            const { CapacitorHttp } = await import('@capacitor/core');
            const response = await CapacitorHttp.request(reqOptions);
            return { statusCode: response.status, data: response.data, url: response.url || url };
        } catch (error) {
            throw new Error(`Network error: ${error.message || error}`);
        }
    }

    async _browserRequest(path, options = {}) {
        let url = path.startsWith('http') ? path.replace(SPADA_URL, '/spada') : `/spada${path}`;
        const fetchOptions = {
            method: options.method || 'GET', credentials: 'include', redirect: 'manual',
            headers: { ...(options.headers || {}) }
        };
        if (options.body) fetchOptions.body = options.body;

        let response = await fetch(url, fetchOptions);
        let redirectCount = 0;
        while ([301, 302, 303].includes(response.status) && redirectCount < 10) {
            redirectCount++;
            let location = response.headers.get('location');
            if (!location) break;
            if (location.startsWith(SPADA_URL)) location = location.replace(SPADA_URL, '/spada');
            else if (location.startsWith('/')) location = `/spada${location}`;
            response = await fetch(location, { method: 'GET', credentials: 'include', redirect: 'manual' });
        }
        const data = await response.text();
        return { statusCode: response.status, data, url: response.url };
    }

    async get(path) { return this.request(path); }
    async post(path, body) {
        return this.request(path, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body });
    }

    parseHTML(html) {
        return new DOMParser().parseFromString(html, 'text/html');
    }

    // ========================
    // AUTH
    // ========================
    async login(username, password) {
        try {
            const loginPage = await this.get('/login/index.php');
            const doc = this.parseHTML(loginPage.data);
            const logintoken = doc.querySelector('input[name="logintoken"]')?.value || '';

            const params = new URLSearchParams();
            params.append('anchor', '');
            params.append('logintoken', logintoken);
            params.append('username', username);
            params.append('password', password);

            const res = await this.post('/login/index.php', params.toString());
            const $d = this.parseHTML(res.data);

            const err = $d.querySelector('.loginerrors');
            if (err) return { success: false, error: err.textContent.trim() };
            if (res.data.includes('invalidlogin') || res.data.includes('loginerrormessage'))
                return { success: false, error: 'Username atau password salah' };

            // sesskey
            const m1 = res.data.match(/"sesskey":"([^"]+)"/);
            if (m1) this.sesskey = m1[1];
            else { const m2 = res.data.match(/sesskey=([a-zA-Z0-9]+)/); if (m2) this.sesskey = m2[1]; }

            // user info
            const userText = $d.querySelector('.usertext')?.textContent.trim() || '';
            const pm = res.data.match(/user\/profile\.php\?id=(\d+)/);
            if (pm) this.userId = pm[1];
            this.userInfo = { name: userText || username, id: this.userId, username };

            return { success: true, userInfo: this.userInfo };
        } catch (error) {
            return { success: false, error: `Login failed: ${error.message}` };
        }
    }

    // ========================
    // COURSES - Use nav-drawer sidebar (fast, no AJAX)
    // ========================
    async getCourses() {
        try {
            const response = await this.get('/my/');
            const doc = this.parseHTML(response.data);
            const courses = [];
            const seen = new Set();

            // Method 1: Nav drawer sidebar (fastest, pre-rendered)
            doc.querySelectorAll('#nav-drawer a[href*="course/view.php"]').forEach(el => {
                const href = el.getAttribute('href');
                const name = el.textContent.trim();
                const idMatch = href.match(/id=(\d+)/);
                if (idMatch && name && name.length > 2 && !seen.has(idMatch[1])) {
                    seen.add(idMatch[1]);
                    courses.push({ id: idMatch[1], name, url: href });
                }
            });

            // Method 2: Any course links on page
            if (courses.length === 0) {
                doc.querySelectorAll('a[href*="course/view.php"]').forEach(el => {
                    const href = el.getAttribute('href');
                    const name = el.textContent.trim();
                    const idMatch = href.match(/id=(\d+)/);
                    if (idMatch && name && name.length > 2 && !seen.has(idMatch[1])) {
                        seen.add(idMatch[1]);
                        courses.push({ id: idMatch[1], name, url: href });
                    }
                });
            }

            // Method 3: data-courseid
            if (courses.length === 0) {
                doc.querySelectorAll('[data-courseid]').forEach(el => {
                    const courseId = el.getAttribute('data-courseid');
                    const nameEl = el.querySelector('.coursename, .multiline, .course-title');
                    const name = nameEl?.textContent.trim();
                    if (courseId && name && !seen.has(courseId)) {
                        seen.add(courseId);
                        courses.push({ id: courseId, name, url: `${SPADA_URL}/course/view.php?id=${courseId}` });
                    }
                });
            }

            return courses;
        } catch (error) {
            throw new Error(`Failed to get courses: ${error.message}`);
        }
    }

    // ========================
    // COURSE CONTENT
    // ========================
    async getCourseContent(courseId) {
        try {
            const response = await this.get(`/course/view.php?id=${courseId}`);
            const doc = this.parseHTML(response.data);
            const content = {
                courseName: doc.querySelector('h1')?.textContent.trim() ||
                    doc.querySelector('.page-header-headings h1')?.textContent.trim() || '',
                sections: [], attendance: [], assignments: [], forums: [], resources: []
            };

            // Parse sections and activities
            doc.querySelectorAll('li.section, .section').forEach((section, i) => {
                const sectionName = section.querySelector('.sectionname, h3.sectionname')?.textContent.trim() || `Section ${i}`;
                const modules = [];

                section.querySelectorAll('li.activity, .activity').forEach(activity => {
                    const link = activity.querySelector('a.aalink, a[href*="/mod/"]');
                    if (!link) return;
                    const href = link.getAttribute('href') || '';
                    // Get the activity name from instancename or direct text
                    let name = '';
                    const instanceName = activity.querySelector('.instancename');
                    if (instanceName) {
                        // Clone to remove accesshide content
                        const clone = instanceName.cloneNode(true);
                        const accesshide = clone.querySelector('.accesshide');
                        if (accesshide) accesshide.remove();
                        name = clone.textContent.trim();
                    }
                    if (!name) name = link.textContent.trim();
                    if (!name || !href) return;

                    let type = 'unknown';
                    if (href.includes('mod/attendance')) type = 'attendance';
                    else if (href.includes('mod/assign')) type = 'assignment';
                    else if (href.includes('mod/forum')) type = 'forum';
                    else if (href.includes('mod/resource')) type = 'resource';
                    else if (href.includes('mod/url')) type = 'url';
                    else if (href.includes('mod/page')) type = 'page';
                    else if (href.includes('mod/quiz')) type = 'quiz';
                    else if (href.includes('mod/folder')) type = 'folder';

                    const idMatch = href.match(/id=(\d+)/);
                    const moduleId = idMatch ? idMatch[1] : null;
                    const moduleData = { name, type, url: href, moduleId };
                    modules.push(moduleData);

                    if (type === 'attendance') content.attendance.push(moduleData);
                    else if (type === 'assignment') content.assignments.push(moduleData);
                    else if (type === 'forum') content.forums.push(moduleData);
                    else if (['resource', 'page', 'folder', 'url'].includes(type)) content.resources.push(moduleData);
                });

                if (modules.length > 0) content.sections.push({ name: sectionName, modules });
            });

            return content;
        } catch (error) {
            throw new Error(`Failed to get course content: ${error.message}`);
        }
    }

    // ========================
    // ATTENDANCE - Use &view=5 for ALL sessions
    // ========================
    async getAttendanceSessions(moduleId) {
        try {
            // view=5 = All sessions
            const response = await this.get(`/mod/attendance/view.php?id=${moduleId}&view=5`);
            const doc = this.parseHTML(response.data);
            const sessions = [];

            doc.querySelectorAll('table tbody tr').forEach(row => {
                const cells = row.querySelectorAll('td');
                if (cells.length < 3) return;

                const date = cells[0].textContent.trim();
                const description = cells[1].textContent.trim();

                // Status might be in different columns
                let status = '';
                let submitLink = null;
                let sessionId = null;

                // Check all cells for status and submit links
                for (let j = 2; j < cells.length; j++) {
                    const cellText = cells[j].textContent.trim();
                    const link = cells[j].querySelector('a[href*="attendance.php"]');
                    if (link) {
                        submitLink = link.getAttribute('href');
                        const m = submitLink.match(/sessid=(\d+)/);
                        if (m) sessionId = m[1];
                    }
                    if (cellText && !status) {
                        status = cellText;
                    }
                }

                if (date) {
                    sessions.push({ date, description, status, canSubmit: !!submitLink, submitUrl: submitLink, sessionId });
                }
            });

            return sessions;
        } catch (error) {
            throw new Error(`Failed to get attendance: ${error.message}`);
        }
    }

    async submitAttendance(sessionId) {
        try {
            const formPage = await this.get(`/mod/attendance/attendance.php?sessid=${sessionId}&sesskey=${this.sesskey}`);
            const doc = this.parseHTML(formPage.data);

            const form = doc.querySelector('form[action*="attendance.php"]');
            if (!form) return { success: false, error: 'Form absen tidak ditemukan. Sesi mungkin belum bisa diakses.' };

            const fp = new URLSearchParams();

            // Extract all hidden inputs and default values (e.g sessid, sesskey, _qf, etc)
            form.querySelectorAll('input[type="hidden"], input[type="submit"]').forEach(el => {
                if (el.name) fp.append(el.name, el.value || '');
            });

            // Find the radio button for 'Present' or 'Hadir'
            let statusName = null;
            let presentValue = null;

            form.querySelectorAll('input[type="radio"]').forEach(el => {
                let labelText = '';
                // Check if there is an explicit <label for="id">
                if (el.id) {
                    const lbl = form.querySelector(`label[for="${el.id}"]`);
                    if (lbl) labelText = lbl.textContent.toLowerCase();
                }
                // Fallback to parent text
                if (!labelText && el.parentElement) labelText = el.parentElement.textContent.toLowerCase();

                if (labelText.includes('hadir') || labelText.includes('present')) {
                    presentValue = el.value;
                    statusName = el.name;
                }
            });

            // Fallback: If no "Hadir" label found, pick the first radio button in the form
            if (!presentValue) {
                const firstRadio = form.querySelector('input[type="radio"]');
                if (firstRadio) {
                    presentValue = firstRadio.value;
                    statusName = firstRadio.name;
                }
            }

            if (!presentValue || !statusName) {
                return { success: false, error: 'Pilihan absen (Hadir/Present) tidak ditemukan di SPADA.' };
            }

            fp.append(statusName, presentValue);

            // POST to the form action
            const actionUrl = form.getAttribute('action') || '/mod/attendance/attendance.php';
            await this.post(actionUrl, fp.toString());
            return { success: true };
        } catch (error) {
            return { success: false, error: error.message };
        }
    }

    // ========================
    // ASSIGNMENTS - Fast method using index page
    // ========================
    async getAllAssignmentsForCourse(courseId) {
        try {
            const response = await this.get(`/mod/assign/index.php?id=${courseId}`);
            const doc = this.parseHTML(response.data);
            const assignments = [];

            doc.querySelectorAll('table.generaltable tbody tr').forEach(row => {
                const cells = row.querySelectorAll('td');
                if (cells.length < 3) return;

                const link = row.querySelector('a[href*="mod/assign/view.php"]');
                if (!link) return;
                const href = link.getAttribute('href');
                const name = link.textContent.trim();
                const idMatch = href.match(/id=(\d+)/);
                const moduleId = idMatch ? idMatch[1] : null;

                // Table: Topic[0], Assignment[1], Due date[2], Submission[3], Grade[4]
                let dueDate = '';
                let submissionStatus = '';
                if (cells.length >= 3) dueDate = cells[2].textContent.trim();
                if (cells.length >= 4) submissionStatus = cells[3].textContent.trim();

                if (name && moduleId) {
                    assignments.push({ name, moduleId, url: href, dueDate, submissionStatus });
                }
            });

            return assignments;
        } catch (error) {
            return [];
        }
    }

    async getAssignmentDetail(moduleId) {
        try {
            const response = await this.get(`/mod/assign/view.php?id=${moduleId}`);
            const doc = this.parseHTML(response.data);
            const detail = {
                title: doc.querySelector('h2')?.textContent.trim() ||
                    doc.querySelector('.page-header-headings h1')?.textContent.trim() || '',
                description: '', dueDate: '', submissionStatus: '', gradingStatus: '',
                timeRemaining: '', files: [], instructorFiles: [], submittedText: '',
                canSubmit: false, editSubmissionUrl: ''
            };

            // Collect instructor file URLs first (from #intro area)
            const instructorUrls = new Set();
            const introArea = doc.querySelector('#intro');
            if (introArea) {
                detail.description = introArea.innerHTML || '';
                introArea.querySelectorAll('a[href*="pluginfile.php"]').forEach(el => {
                    const url = el.getAttribute('href');
                    const fname = el.textContent.trim();
                    if (url && fname) {
                        instructorUrls.add(url);
                        detail.instructorFiles.push({ name: fname, url });
                    }
                });
            }
            if (!detail.description) {
                detail.description = doc.querySelector('.no-overflow')?.innerHTML || '';
            }

            // Parse status table rows
            doc.querySelectorAll('table.submissionsummarytable tr, table.generaltable tr').forEach(row => {
                const th = row.querySelector('th, td:first-child');
                const td = row.querySelector('td:last-child');
                if (!th || !td || th === td) return;
                const header = th.textContent.trim().toLowerCase();
                const value = td.textContent.trim();

                if (header.includes('submission status') || header.includes('status pengiriman')) detail.submissionStatus = value;
                else if (header.includes('grading status') || header.includes('status penilaian')) detail.gradingStatus = value;
                else if (header.includes('due date') || header.includes('batas waktu')) detail.dueDate = value;
                else if (header.includes('time remaining') || header.includes('waktu tersisa')) detail.timeRemaining = value;
                // File submissions row — student files only
                else if (header.includes('file submission') || header.includes('pengiriman file')) {
                    td.querySelectorAll('a[href]').forEach(el => {
                        const url = el.getAttribute('href');
                        const fname = el.textContent.trim();
                        if (url && fname && !instructorUrls.has(url)) {
                            detail.files.push({ name: fname, url });
                        }
                    });
                }
                // Online text row
                else if (header.includes('online text') || header.includes('teks online')) {
                    const text = td.textContent.trim();
                    if (text) detail.submittedText = td.innerHTML;
                }
            });

            // Edit/submit submission link
            const editLink = doc.querySelector('a[href*="action=editsubmission"]');
            if (editLink) {
                detail.canSubmit = true;
                detail.editSubmissionUrl = editLink.getAttribute('href');
                if (!detail.editSubmissionUrl.startsWith('http')) {
                    detail.editSubmissionUrl = `${SPADA_URL}${detail.editSubmissionUrl}`;
                }
            }

            // Fallback: scrape student files from file upload area (only if not found in table)
            if (detail.files.length === 0) {
                const seenUrls = new Set();
                doc.querySelectorAll('.fileuploadsubmission a[href], a[href*="assignsubmission_file"]').forEach(el => {
                    const url = el.getAttribute('href');
                    const fname = el.textContent.trim() || url?.split('/').pop() || 'File';
                    // Exclude instructor files
                    if (url && !seenUrls.has(url) && !instructorUrls.has(url)) {
                        seenUrls.add(url);
                        detail.files.push({ name: fname, url });
                    }
                });
            }

            return detail;
        } catch (error) {
            throw new Error(`Failed to get assignment: ${error.message}`);
        }
    }

    // ========================
    // ASSIGNMENT SUBMISSION
    // ========================

    // Step 1: Get submission form tokens
    async getSubmissionForm(moduleId) {
        const response = await this.get(`/mod/assign/view.php?id=${moduleId}&action=editsubmission`);
        const doc = this.parseHTML(response.data);

        const form = {
            sesskey: doc.querySelector('input[name="sesskey"]')?.value || this.sesskey,
            itemid: doc.querySelector('input[name="files_filemanager"]')?.value || '',
            contextId: '',
            repoId: '4', // Upload repository
            hasFileUpload: !!doc.querySelector('.filemanager'),
            hasOnlineText: !!doc.querySelector('[name="onlinetext_editor[text]"]'),
            onlineTextItemId: doc.querySelector('input[name="onlinetext_editor[itemid]"]')?.value || '',
            currentText: doc.querySelector('[name="onlinetext_editor[text]"]')?.value || '',
        };

        // Extract context id from M.cfg or hidden fields
        const html = response.data;
        const ctxMatch = html.match(/"contextid"\s*:\s*(\d+)/);
        if (ctxMatch) form.contextId = ctxMatch[1];

        return form;
    }

    // Step 2: Upload a file to Moodle draft area
    async uploadFileToMoodle(file, formTokens) {
        const formData = new FormData();
        formData.append('repo_upload_file', file);
        formData.append('sesskey', formTokens.sesskey);
        formData.append('repo_id', formTokens.repoId);
        formData.append('itemid', formTokens.itemid);
        formData.append('author', this.userInfo?.name || 'Student');
        formData.append('savepath', '/');
        formData.append('title', file.name || 'file');
        formData.append('ctx_id', formTokens.contextId);
        formData.append('overwrite', '1');

        const url = `${SPADA_URL}/repository/repository_ajax.php?action=upload`;

        if (isCapacitor()) {
            // On Capacitor: read file as base64 and use CapacitorHttp
            const base64 = await this._fileToBase64(file);
            const boundary = '----FormBoundary' + Math.random().toString(36).substr(2);
            let body = '';
            const fields = {
                sesskey: formTokens.sesskey, repo_id: formTokens.repoId,
                itemid: formTokens.itemid, author: this.userInfo?.name || 'Student',
                savepath: '/', title: file.name || 'file', ctx_id: formTokens.contextId, overwrite: '1'
            };
            for (const [key, val] of Object.entries(fields)) {
                body += `--${boundary}\r\nContent-Disposition: form-data; name="${key}"\r\n\r\n${val}\r\n`;
            }
            body += `--${boundary}\r\nContent-Disposition: form-data; name="repo_upload_file"; filename="${file.name}"\r\nContent-Type: ${file.type || 'application/octet-stream'}\r\nContent-Transfer-Encoding: base64\r\n\r\n${base64}\r\n--${boundary}--`;

            const { CapacitorHttp } = await import('@capacitor/core');
            const resp = await CapacitorHttp.request({
                url, method: 'POST',
                headers: {
                    'Content-Type': `multipart/form-data; boundary=${boundary}`,
                    'User-Agent': 'Mozilla/5.0 (Linux; Android 13) AppleWebKit/537.36'
                },
                data: body,
                webFetchExtra: { credentials: 'include' }
            });
            const result = typeof resp.data === 'string' ? JSON.parse(resp.data) : resp.data;
            if (result.error) throw new Error(result.error);
            return result;
        } else {
            // Browser mode: use fetch with FormData
            const resp = await fetch(url.replace(SPADA_URL, '/spada'), {
                method: 'POST', credentials: 'include', body: formData
            });
            const result = await resp.json();
            if (result.error) throw new Error(result.error);
            return result;
        }
    }

    _fileToBase64(file) {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve(reader.result.split(',')[1]);
            reader.onerror = reject;
            reader.readAsDataURL(file);
        });
    }

    // Step 3: Submit the assignment form
    async submitAssignment(moduleId, formTokens, onlineText = null) {
        const params = new URLSearchParams();
        params.append('id', moduleId);
        params.append('action', 'savesubmission');
        params.append('sesskey', formTokens.sesskey);
        params.append('_qf__mod_assign_submission_form', '1');
        params.append('mform_isexpanded_id_header_default', '1');

        if (formTokens.hasFileUpload) {
            params.append('files_filemanager', formTokens.itemid);
        }
        if (formTokens.hasOnlineText && onlineText !== null) {
            params.append('onlinetext_editor[text]', onlineText);
            params.append('onlinetext_editor[format]', '1');
            if (formTokens.onlineTextItemId) {
                params.append('onlinetext_editor[itemid]', formTokens.onlineTextItemId);
            }
        }
        params.append('submitbutton', 'Save changes');

        const response = await this.post(`/mod/assign/view.php?id=${moduleId}&action=savesubmission`, params.toString());

        // Check if submission was successful
        const doc = this.parseHTML(response.data);
        const errorMsg = doc.querySelector('.alert-danger, .error, .notifyproblem');
        if (errorMsg) {
            throw new Error(errorMsg.textContent.trim());
        }
        return { success: true };
    }

    // ========================
    // FORUMS
    // ========================
    async getAnnouncements(forumId) {
        try {
            const response = await this.get(`/mod/forum/view.php?id=${forumId}`);
            const doc = this.parseHTML(response.data);
            const announcements = [];

            doc.querySelectorAll('.forumthread, .discussion, table.forumheaderlist tbody tr, .forum-post-container, .discussionname').forEach(el => {
                const link = el.querySelector('a[href*="discuss.php"]') || el.closest('a[href*="discuss.php"]') || el.querySelector('a');
                if (!link) return;
                const title = link.textContent.trim();
                const href = link.getAttribute('href');
                const author = el.querySelector('.author, td.author, .by')?.textContent.trim() || '';
                const date = el.querySelector('.lastpost, td.lastpost, .post-date')?.textContent.trim() || '';
                if (title && href) {
                    announcements.push({ title, url: href, author, date, discussionId: href.match(/d=(\d+)/)?.[1] });
                }
            });

            return announcements;
        } catch (error) {
            throw new Error(`Failed to get announcements: ${error.message}`);
        }
    }
}

export default SpadaClient;

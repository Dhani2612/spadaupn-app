const cron = require('node-cron');

class Scheduler {
    constructor(spadaClient, notifyFn, store) {
        this.client = spadaClient;
        this.notify = notifyFn;
        this.store = store;
        this.jobs = [];
        this.checkedAttendance = new Set();
        this.notifiedDeadlines = new Set();
        this.notifiedAnnouncements = new Set();
    }

    start() {
        // Auto-attendance check every 5 minutes
        const attendanceJob = cron.schedule('*/5 * * * *', () => {
            this.checkAttendance();
        });
        this.jobs.push(attendanceJob);

        // Deadline check every 15 minutes
        const deadlineJob = cron.schedule('*/15 * * * *', () => {
            this.checkDeadlines();
        });
        this.jobs.push(deadlineJob);

        // Announcement check every 30 minutes
        const announcementJob = cron.schedule('*/30 * * * *', () => {
            this.checkAnnouncements();
        });
        this.jobs.push(announcementJob);

        // Initial check on start
        setTimeout(() => {
            this.checkAttendance();
            this.checkDeadlines();
        }, 5000);

        console.log('[Scheduler] Started all jobs');
    }

    stop() {
        this.jobs.forEach(job => job.stop());
        this.jobs = [];
        console.log('[Scheduler] Stopped all jobs');
    }

    updateSettings(settings) {
        // Restart with new settings if needed
        this.stop();
        this.start();
    }

    async checkAttendance() {
        const autoAttendance = this.store.get('autoAttendance', true);
        const notifications = this.store.get('notifications', true);

        // If neither is enabled, there's nothing to do here
        if (!autoAttendance && !notifications) return;

        console.log('[Scheduler] Checking attendance...');
        try {
            const attendanceModules = await this.client.getAllAttendanceModules();

            for (const module of attendanceModules) {
                try {
                    const sessions = await this.client.getAttendanceSessions(module.moduleId);

                    for (const session of sessions) {
                        if (session.canSubmit && session.sessionId && !this.checkedAttendance.has(session.sessionId)) {
                            console.log(`[Scheduler] Found submittable attendance: ${module.courseName} - ${session.date}`);

                            // Notify about available attendance if notifications are on
                            if (notifications) {
                                this.notify(
                                    '📋 Waktunya Absensi!',
                                    `${module.courseName}\nSegera absen untuk sesi: ${session.date}`
                                );
                            }

                            // Auto submit attendance if autoAttendance is on
                            if (autoAttendance) {
                                const result = await this.client.submitAttendance(session.sessionId, module.moduleId);
                                if (result.success) {
                                    if (notifications) {
                                        this.notify(
                                            '✅ Auto-Absen Berhasil!',
                                            `${module.courseName}\nBerhasil absen \'Present\' secara otomatis.`
                                        );
                                    }
                                    console.log(`[Scheduler] Auto-attended: ${module.courseName}`);
                                } else {
                                    if (notifications) {
                                        this.notify(
                                            '❌ Gagal Auto-Absen',
                                            `${module.courseName}\n${result.error}`
                                        );
                                    }
                                }
                            }

                            // Mark as checked so we don't notify/submit again
                            this.checkedAttendance.add(session.sessionId);
                        }
                    }
                } catch (e) {
                    console.error(`[Scheduler] Error checking attendance for ${module.courseName}:`, e.message);
                }
            }
        } catch (error) {
            console.error('[Scheduler] Attendance check error:', error.message);
        }
    }

    async checkDeadlines() {
        const notifications = this.store.get('notifications', true);
        if (!notifications) return;

        const reminderHours = this.store.get('deadlineReminder', 3);
        console.log('[Scheduler] Checking deadlines...');

        try {
            const courses = await this.client.getCourses();

            for (const course of courses) {
                try {
                    const content = await this.client.getCourseContent(course.id);

                    for (const assign of content.assignments) {
                        try {
                            const detail = await this.client.getAssignmentDetail(assign.moduleId);

                            if (detail.dueDate && detail.submissionStatus) {
                                const isNotSubmitted = detail.submissionStatus.toLowerCase().includes('no submission') ||
                                    detail.submissionStatus.toLowerCase().includes('belum ada') ||
                                    detail.submissionStatus.toLowerCase().includes('not submitted');

                                if (isNotSubmitted) {
                                    // Parse due date and check if within reminder window
                                    const dueDate = this.parseMoodleDate(detail.dueDate);
                                    if (dueDate) {
                                        const now = new Date();
                                        const hoursLeft = (dueDate - now) / (1000 * 60 * 60);
                                        const notifKey = `${assign.moduleId}_${reminderHours}h`;

                                        if (hoursLeft > 0 && hoursLeft <= reminderHours && !this.notifiedDeadlines.has(notifKey)) {
                                            this.notify(
                                                `⚠️ Deadline ${Math.round(hoursLeft)} Jam Lagi!`,
                                                `${course.name}\n${assign.name}\nDue: ${detail.dueDate}`
                                            );
                                            this.notifiedDeadlines.add(notifKey);
                                        }

                                        // Also warn at 1 hour
                                        const notifKey1h = `${assign.moduleId}_1h`;
                                        if (hoursLeft > 0 && hoursLeft <= 1 && !this.notifiedDeadlines.has(notifKey1h)) {
                                            this.notify(
                                                `🚨 URGENT! Deadline 1 Jam Lagi!`,
                                                `${course.name}\n${assign.name}\nDue: ${detail.dueDate}`
                                            );
                                            this.notifiedDeadlines.add(notifKey1h);
                                        }
                                    }
                                }
                            }
                        } catch (e) {
                            // Skip individual assignment errors
                        }
                    }
                } catch (e) {
                    console.error(`[Scheduler] Error checking deadlines for ${course.name}:`, e.message);
                }
            }
        } catch (error) {
            console.error('[Scheduler] Deadline check error:', error.message);
        }
    }

    async checkAnnouncements() {
        const notifications = this.store.get('notifications', true);
        if (!notifications) return;

        console.log('[Scheduler] Checking announcements...');
        try {
            const courses = await this.client.getCourses();

            for (const course of courses) {
                try {
                    const content = await this.client.getCourseContent(course.id);

                    for (const forum of content.forums) {
                        try {
                            const announcements = await this.client.getAnnouncements(forum.moduleId);
                            for (const ann of announcements) {
                                const annKey = `${ann.discussionId}`;
                                if (annKey && !this.notifiedAnnouncements.has(annKey)) {
                                    // Only notify for new announcements (first run will capture all, then only new ones)
                                    if (this.notifiedAnnouncements.size > 0) {
                                        this.notify(
                                            '📢 Pengumuman Baru!',
                                            `${course.name}\n${ann.title}`
                                        );
                                    }
                                    this.notifiedAnnouncements.add(annKey);
                                }
                            }
                        } catch (e) {
                            // Skip individual forum errors
                        }
                    }
                } catch (e) {
                    console.error(`[Scheduler] Error checking announcements for ${course.name}:`, e.message);
                }
            }
        } catch (error) {
            console.error('[Scheduler] Announcement check error:', error.message);
        }
    }

    parseMoodleDate(dateStr) {
        try {
            // Moodle date formats: "Thursday, 27 February 2026, 11:59 PM" or various localized formats
            // Try direct parsing first
            let date = new Date(dateStr);
            if (!isNaN(date.getTime())) return date;

            // Try Indonesian format: "Kamis, 27 Februari 2026, 23:59"
            const months = {
                'januari': 0, 'februari': 1, 'maret': 2, 'april': 3,
                'mei': 4, 'juni': 5, 'juli': 6, 'agustus': 7,
                'september': 8, 'oktober': 9, 'november': 10, 'desember': 11,
                'january': 0, 'february': 1, 'march': 2, 'may': 4,
                'june': 5, 'july': 6, 'august': 7, 'october': 9, 'december': 11
            };

            const match = dateStr.match(/(\d{1,2})\s+(\w+)\s+(\d{4}),?\s+(\d{1,2})[:\.](\d{2})\s*(AM|PM)?/i);
            if (match) {
                const day = parseInt(match[1]);
                const month = months[match[2].toLowerCase()];
                const year = parseInt(match[3]);
                let hour = parseInt(match[4]);
                const minute = parseInt(match[5]);
                const ampm = match[6];

                if (ampm) {
                    if (ampm.toUpperCase() === 'PM' && hour < 12) hour += 12;
                    if (ampm.toUpperCase() === 'AM' && hour === 12) hour = 0;
                }

                if (month !== undefined) {
                    return new Date(year, month, day, hour, minute);
                }
            }

            return null;
        } catch (e) {
            return null;
        }
    }
}

module.exports = Scheduler;

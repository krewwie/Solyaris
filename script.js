'use strict';

/* ============ STATE ============ */
let currentDayIndex = 0;
let currentLang = 'ru';
let editMode = false;
let saveTimeout = null;
let booksFilter = 'all';
let booksSearch = '';
let studentsSearch = '';
let studentsActivityFilter = '';
let teachersSearch = '';
let teachersSubjectFilter = '';
let qrLoaded = false;

let settings = {
    theme: 'light',
    lang: 'ru',
    largeFont: false,
    highContrast: false,
    reduceMotion: false,
    mobileNavOnDesktop: false
};

const CARD_COLORS = ['#e74c3c', '#16a085', '#9b59b6', '#e67e22', '#e84393', '#4caf1e', '#9b59b6', '#3498db', '#2ecc71', '#e74c3c', '#fb9841', '#27ceac', '#4040bf'];

const LS = {
    SETTINGS: 'appSettings',
    LANGUAGE: 'language',
    SCHEDULE: 'scheduleDataOverrides',
    SCHEDULE_DAY: 'scheduleCurrentDay',
    SCHEDULE_EDIT: 'scheduleEditMode',
    BOOKS: 'summerBooksReadState',
    BOOKS_OLD: 'summerBooks',
    BOOKS_FILTER: 'booksFilter'
};

/* ============ UTILS ============ */
function escapeHtml(str) {
    return String(str == null ? '' : str).replace(/[&<>"']/g, c => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[c]));
}

function getStableColor(key) {
    const s = String(key || '');
    let h = 0;
    for (let i = 0; i < s.length; i++) h = ((h << 5) - h + s.charCodeAt(i)) | 0;
    return CARD_COLORS[Math.abs(h) % CARD_COLORS.length];
}

function debounce(fn, wait) {
    let t = null;
    return function(...args) {
        clearTimeout(t);
        t = setTimeout(() => fn.apply(this, args), wait);
    };
}

/* ============ SETTINGS ============ */
function loadSettings() {
    const saved = localStorage.getItem(LS.SETTINGS);
    if (saved) {
        try { settings = Object.assign({}, settings, JSON.parse(saved)); } catch (e) {}
    } else {
        const oldTheme = localStorage.getItem('theme');
        if (oldTheme) settings.theme = oldTheme;
        const oldLang = localStorage.getItem(LS.LANGUAGE);
        if (oldLang) settings.lang = oldLang;
    }
}

function saveSettings() {
    localStorage.setItem(LS.SETTINGS, JSON.stringify(settings));
    localStorage.setItem(LS.LANGUAGE, settings.lang);
}

function getEffectiveTheme() {
    if (settings.theme === 'system') {
        return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
    }
    return settings.theme;
}

function applySettings() {
    const theme = getEffectiveTheme();
    document.body.classList.toggle('dark-theme', theme === 'dark');
    document.body.classList.toggle('font-large', settings.largeFont);
    document.body.classList.toggle('high-contrast', settings.highContrast);
    document.body.classList.toggle('reduce-motion', settings.reduceMotion);
    document.body.classList.toggle('mobile-nav-active', !!settings.mobileNavOnDesktop);

    document.querySelectorAll('.settings-option[data-theme]').forEach(btn => {
        btn.classList.toggle('active', btn.getAttribute('data-theme') === settings.theme);
    });
    document.querySelectorAll('.settings-option[data-lang]').forEach(btn => {
        btn.classList.toggle('active', btn.getAttribute('data-lang') === settings.lang);
    });
    document.querySelectorAll('.settings-toggle-row[data-setting]').forEach(row => {
        const key = row.getAttribute('data-setting');
        const on = !!settings[key];
        row.setAttribute('aria-checked', on ? 'true' : 'false');
        const toggle = row.querySelector('.settings-toggle');
        if (toggle) toggle.classList.toggle('on', on);
    });
}

function setTheme(theme) { settings.theme = theme; saveSettings(); applySettings(); }
function setLang(lang) { settings.lang = lang; saveSettings(); changeLanguage(lang); applySettings(); }
function toggleSetting(key) { settings[key] = !settings[key]; saveSettings(); applySettings(); }

/* ============ LANGUAGE ============ */
function renderLanguageOptions() {
    const container = document.getElementById('language-options');
    if (!container) return;
    const preferredOrder = ['ru', 'en', 'zh', 'ar', 'ja'];
    const available = Object.keys(window.translations || {});
    const ordered = [...preferredOrder.filter(c => available.includes(c)), ...available.filter(c => !preferredOrder.includes(c))];
    container.innerHTML = '';
    ordered.forEach(code => {
        const t = window.translations[code];
        if (!t) return;
        const name = (t._meta && t._meta.name) || code;
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'settings-option';
        btn.setAttribute('data-lang', code);
        btn.innerHTML = `<i class="fas fa-flag"></i><span>${escapeHtml(name)}</span>`;
        btn.addEventListener('click', () => setLang(code));
        if (code === settings.lang) btn.classList.add('active');
        container.appendChild(btn);
    });
}

function changeLanguage(lang) {
    currentLang = lang;
    settings.lang = lang;

    const dict = window.translations[lang];
    if (!dict) return;

    document.querySelectorAll('[data-key]').forEach(el => {
        const key = el.getAttribute('data-key');
        if (dict[key] !== undefined) el.innerHTML = dict[key];
    });

    document.querySelectorAll('.settings-option[data-lang]').forEach(btn => {
        btn.classList.toggle('active', btn.getAttribute('data-lang') === lang);
    });

    // RTL для арабского
    document.documentElement.lang = lang === 'zh' ? 'zh' : lang;
    document.documentElement.dir = (lang === 'ar') ? 'rtl' : 'ltr';

    saveSettings();

    if (document.getElementById('schedule')?.classList.contains('active')) updateScheduleDisplay();
    if (document.getElementById('books')?.classList.contains('active')) applyBooksFilter();
}

window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
    if (settings.theme === 'system') applySettings();
});

/* ============ HASH ROUTING ============ */
const VALID_SECTIONS = ['main', 'students', 'teachers', 'schedule', 'textbooks', 'books', 'oge', 'settings', 'authors'];

function getSectionFromHash() {
    const hash = (location.hash || '').replace('#', '');
    return VALID_SECTIONS.includes(hash) ? hash : 'main';
}

function showContent(id, updateHash = true) {
    if (!VALID_SECTIONS.includes(id)) id = 'main';

    document.querySelectorAll('.content-section').forEach(s => s.classList.remove('active'));
    const section = document.getElementById(id);
    if (!section) return;
    section.classList.add('active');

    if (id === 'students') renderStudents();
    else if (id === 'teachers') renderTeachers();
    else if (id === 'schedule') renderSchedule();
    else if (id === 'textbooks') renderTextbooks();
    else if (id === 'books') renderSummerBooks();
    else if (id === 'oge') renderOgeSubjects();

    // Обновляем навигацию
    document.querySelectorAll('[data-content-link]').forEach(el => {
        const isActive = el.getAttribute('data-content-link') === id;
        el.classList.toggle('active', isActive);
        if (el.tagName === 'A') {
            if (isActive) el.setAttribute('aria-current', 'page');
            else el.removeAttribute('aria-current');
        }
        if (el.tagName === 'BUTTON') {
            if (isActive) el.setAttribute('aria-current', 'page');
            else el.removeAttribute('aria-current');
        }
    });

    // Фокус на заголовок для доступности
    const h2 = section.querySelector('h2[tabindex]');
    if (h2) {
        h2.focus({ preventScroll: true });
        section.setAttribute('tabindex', '-1');
    }

    if (window.innerWidth <= 768) window.scrollTo({ top: 0, behavior: 'smooth' });

    changeLanguage(currentLang);

    if (updateHash && location.hash !== '#' + id) {
        history.replaceState(null, '', '#' + id);
    }
}

window.addEventListener('hashchange', () => {
    showContent(getSectionFromHash(), false);
});

/* ============ SCHEDULE STORAGE ============ */
function loadScheduleFromStorage() {
    const raw = localStorage.getItem(LS.SCHEDULE);
    if (!raw || !window.scheduleData) return;
    try {
        const parsed = JSON.parse(raw);
        Object.keys(parsed).forEach(dayKey => {
            if (window.scheduleData[dayKey]) {
                const saved = parsed[dayKey];
                if (saved && Array.isArray(saved.subjects)) {
                    saved.subjects.forEach((subj, i) => {
                        const target = window.scheduleData[dayKey].subjects[i];
                        if (!target) return;
                        if (Array.isArray(subj.names)) target.names = subj.names.slice();
                        if (typeof subj.homework === 'string') target.homework = subj.homework;
                        if (subj.cancelled) target.cancelled = Object.assign({}, subj.cancelled);
                    });
                }
            }
        });
    } catch (e) { /* ignore */ }
}

function saveScheduleToStorage() {
    if (!window.scheduleData) return;
    const overrides = {};
    Object.keys(window.scheduleData).forEach(dayKey => {
        const day = window.scheduleData[dayKey];
        if (!day || !Array.isArray(day.subjects)) return;
        overrides[dayKey] = {
            subjects: day.subjects.map(s => ({
                names: Array.isArray(s.names) ? s.names.slice() : [],
                homework: typeof s.homework === 'string' ? s.homework : '',
                cancelled: s.cancelled ? Object.assign({}, s.cancelled) : {}
            }))
        };
    });
    localStorage.setItem(LS.SCHEDULE, JSON.stringify(overrides));
    showSaveIndicator();
}

function showSaveIndicator() {
    const el = document.getElementById('save-indicator');
    if (!el) return;
    el.textContent = (window.translations[currentLang] && window.translations[currentLang].saved_label) || 'Сохранено';
    el.classList.add('visible');
    clearTimeout(saveTimeout);
    saveTimeout = setTimeout(() => el.classList.remove('visible'), 1500);
}

function resetSchedule() {
    const msg = (window.translations[currentLang] && window.translations[currentLang].reset_schedule_confirm) || 'Сбросить все изменения расписания?';
    if (!confirm(msg)) return;
    localStorage.removeItem(LS.SCHEDULE);
    location.reload();
}

/* ============ EDIT MODE ============ */
function loadEditMode() {
    editMode = localStorage.getItem(LS.SCHEDULE_EDIT) === 'true';
    updateEditModeButton();
}

function toggleEditMode() {
    editMode = !editMode;
    localStorage.setItem(LS.SCHEDULE_EDIT, editMode ? 'true' : 'false');
    updateEditModeButton();
    if (document.getElementById('schedule')?.classList.contains('active')) updateScheduleDisplay();
}

function updateEditModeButton() {
    const btn = document.getElementById('edit-mode-toggle');
    if (!btn) return;
    btn.classList.toggle('active', editMode);
    btn.setAttribute('aria-pressed', editMode ? 'true' : 'false');
}

/* ============ SUBJECT EDITOR POPUP ============ */
let outsideClickHandler = null;

function closeAllSubjectEditors() {
    document.querySelectorAll('.subject-editor-popup').forEach(p => p.remove());
    if (outsideClickHandler) {
        document.removeEventListener('mousedown', outsideClickHandler);
        outsideClickHandler = null;
    }
}

function openSubjectEditor(anchorEl, day, index, nameIndex) {
    closeAllSubjectEditors();
    if (!editMode) return;

    const subject = window.scheduleData[day].subjects[index];
    if (!subject) return;

    const originalName = (window.__originalScheduleData?.[day]?.subjects?.[index]?.names?.[nameIndex]) ?? subject.names[nameIndex];
    const currentRaw = subject.names[nameIndex] || '';
    const isCancelled = !!(subject.cancelled && subject.cancelled[nameIndex]);
    const displayName = currentRaw.replace(/^-\s*/, '');

    const popup = document.createElement('div');
    popup.className = 'subject-editor-popup';
    popup.setAttribute('role', 'dialog');
    popup.setAttribute('aria-label', 'Редактор урока');
    popup.innerHTML = `
        <div class="subject-editor-title">Изменить урок</div>
        <input type="text" class="subject-editor-input" value="${escapeHtml(displayName)}">
        <div class="subject-editor-buttons">
            <button type="button" class="subject-editor-btn cancel-toggle ${isCancelled ? 'active' : ''}">
                ${isCancelled ? 'Вернуть урок' : 'Отменить урок'}
            </button>
            <button type="button" class="subject-editor-btn reset-btn">Сделать обычным</button>
            <button type="button" class="subject-editor-btn save-btn">Сохранить</button>
        </div>
    `;
    document.body.appendChild(popup);

    // Позиционирование
    const rect = anchorEl.getBoundingClientRect();
    const pw = popup.offsetWidth || 320;
    const ph = popup.offsetHeight || 160;
    let left = rect.left;
    let top = rect.bottom + 6;
    if (left + pw > window.innerWidth - 10) left = window.innerWidth - pw - 10;
    if (left < 10) left = 10;
    if (top + ph > window.innerHeight - 10) top = rect.top - ph - 6;
    if (top < 10) top = 10;
    popup.style.left = left + 'px';
    popup.style.top = top + 'px';

    const input = popup.querySelector('.subject-editor-input');
    input.focus();
    input.select();

    // Сохранение
    const doSave = () => {
        const newName = input.value.trim();
        if (newName) {
            subject.names[nameIndex] = newName;
            if (subject.cancelled) subject.cancelled[nameIndex] = false;
            saveScheduleToStorage();
            updateScheduleDisplay();
        }
        closeAllSubjectEditors();
    };

    popup.querySelector('.save-btn').addEventListener('click', doSave);
    input.addEventListener('keydown', e => {
        if (e.key === 'Enter') { e.preventDefault(); doSave(); }
        else if (e.key === 'Escape') { closeAllSubjectEditors(); }
    });

    popup.querySelector('.cancel-toggle').addEventListener('click', () => {
        if (!subject.cancelled) subject.cancelled = {};
        subject.cancelled[nameIndex] = !subject.cancelled[nameIndex];
        saveScheduleToStorage();
        updateScheduleDisplay();
        const newAnchor = document.querySelector(`.subject-name-main[data-day="${CSS.escape(day)}"][data-index="${index}"][data-name-index="${nameIndex}"]`);
        if (newAnchor) setTimeout(() => openSubjectEditor(newAnchor, day, index, nameIndex), 0);
    });

    popup.querySelector('.reset-btn').addEventListener('click', () => {
        subject.names[nameIndex] = originalName;
        if (subject.cancelled) subject.cancelled[nameIndex] = false;
        saveScheduleToStorage();
        updateScheduleDisplay();
        closeAllSubjectEditors();
    });

    // Закрытие по клику вне попапа
    setTimeout(() => {
        outsideClickHandler = (e) => {
            if (!popup.contains(e.target)) closeAllSubjectEditors();
        };
        document.addEventListener('mousedown', outsideClickHandler);
    }, 0);
}

/* ============ SCHEDULE RENDER ============ */
function getTodayIndex() {
    if (!Array.isArray(window.daysOrder) || !window.daysOrder.length) return 0;
    const jsDay = new Date().getDay(); // 0 = Sunday
    // Предполагаем, что daysOrder начинается с понедельника
    const idx = (jsDay === 0) ? 5 : (jsDay - 1); // Sunday -> Saturday (последний), else Mon..Sat
    return (idx >= 0 && idx < window.daysOrder.length) ? idx : 0;
}

function createSubjectNameElement(name, day, index, nameIndex) {
    const subject = window.scheduleData[day].subjects[index];
    const el = document.createElement('div');
    el.className = 'subject-name-main';
    el.dataset.day = day;
    el.dataset.index = String(index);
    el.dataset.nameIndex = String(nameIndex);

    const displayName = (name || '').replace(/^-\s*/, '');
    el.textContent = displayName;

    const isCancelled = !!(subject.cancelled && subject.cancelled[nameIndex]);
    const originalName = (window.__originalScheduleData?.[day]?.subjects?.[index]?.names?.[nameIndex]) ?? name;
    const isModified = !isCancelled && originalName !== name;

    if (isCancelled) el.classList.add('strikethrough');
    else if (isModified) el.classList.add('red');

    if (editMode) {
        el.classList.add('editable');
        el.setAttribute('role', 'button');
        el.setAttribute('tabindex', '0');
        el.setAttribute('title', 'Нажмите, чтобы изменить');
        const activate = () => openSubjectEditor(el, day, index, nameIndex);
        el.addEventListener('click', activate);
        el.addEventListener('keydown', e => {
            if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); activate(); }
        });
    }

    return el;
}

function createHomeworkBlock(subject, day, index) {
    const isMobile = window.innerWidth <= 768;
    const hw = subject.homework || '';

    // На мобильном без режима редактирования и без ДЗ — не показываем вообще
    if (!editMode && isMobile && !hw) return null;

    if (editMode) {
        const wrapper = document.createElement('div');
        wrapper.className = 'homework-section';
        const ta = document.createElement('textarea');
        ta.className = 'homework-input';
        ta.value = hw;
        ta.placeholder = 'Домашнее задание…';
        ta.setAttribute('aria-label', 'Домашнее задание');
        const onInput = debounce(() => {
            subject.homework = ta.value;
            saveScheduleToStorage();
        }, 400);
        ta.addEventListener('input', () => { autoResizeTextarea(ta); onInput(); });
        wrapper.appendChild(ta);
        requestAnimationFrame(() => autoResizeTextarea(ta));
        return wrapper;
    }

    // Не в режиме редактирования — просто текст
    if (!hw) return null;
    const wrapper = document.createElement('div');
    wrapper.className = 'homework-section homework-display';
    const div = document.createElement('div');
    div.className = 'homework-text';
    div.textContent = hw;
    wrapper.appendChild(div);
    return wrapper;
}

function updateScheduleDisplay() {
    const container = document.getElementById('schedule-days-container');
    if (!container) return;

    const currentDayInfo = document.getElementById('current-day-info');
    const currentDay = window.daysOrder[currentDayIndex];
    const dayData = window.scheduleData[currentDay];

    const dict = window.translations[currentLang] || window.translations.ru || {};
    const dayNamesArray = dict.day_names || [];
    const translatedDayTitle = dayNamesArray[currentDayIndex] || currentDay;

    if (currentDayInfo) currentDayInfo.textContent = translatedDayTitle;

    container.innerHTML = '';

    if (!dayData) {
        container.innerHTML = `<div class="error-message">Не удалось загрузить данные расписания.</div>`;
        return;
    }

    const dayElement = document.createElement('div');
    dayElement.className = 'schedule-day';

    const lightGradients = [
        ['#9b59b6', '#753790'], ['#3498db', '#236d9f'], ['#2ecc71', '#1d8c4b'],
        ['#e74c3c', '#9a1919'], ['#fb9841', '#a34100'], ['#27ceac', '#0d7863'], ['#4040bf', '#1274b5']
    ];
    const darkGradients = [
        ['#6c3483', '#41234d'], ['#1a5276', '#123b54'], ['#196f3d', '#0c4625'],
        ['#ae1a0a', '#6b230b'], ['#ab6e0d', '#68380d'], ['#1f7a6f', '#0b413b'], ['#2c2c90', '#0d5c91']
    ];
    const idx = Math.abs(currentDayIndex) % lightGradients.length;
    const isDark = document.body.classList.contains('dark-theme');
    const [g1, g2] = isDark ? darkGradients[idx] : lightGradients[idx];
    const accent = isDark ? darkGradients[idx][0] : lightGradients[idx][0];

    const title = document.createElement('div');
    title.className = 'day-title';
    title.style.background = `linear-gradient(135deg, ${g1} 0%, ${g2} 100%)`;
    title.textContent = translatedDayTitle;
    dayElement.appendChild(title);

    dayData.subjects.forEach((subject, index) => {
        const item = document.createElement('div');
        item.className = 'subject-item';

        const info = document.createElement('div');
        info.className = 'subject-info';

        const header = document.createElement('div');
        header.className = 'subject-header';

        const num = document.createElement('div');
        num.className = 'lesson-number';
        num.style.color = accent;
        num.textContent = subject.lessonNumber || '';

        const right = document.createElement('div');
        right.className = 'subject-content';

        const names = Array.isArray(subject.names) ? subject.names : [];
        names.forEach((n, ni) => {
            right.appendChild(createSubjectNameElement(n, currentDay, index, ni));
        });

        const time = document.createElement('div');
        time.className = 'subject-time';
        time.style.color = accent;
        time.textContent = subject.time || '';
        right.appendChild(time);

        header.appendChild(num);
        header.appendChild(right);
        info.appendChild(header);

        item.appendChild(info);

        const hwBlock = createHomeworkBlock(subject, currentDay, index);
        if (hwBlock) item.appendChild(hwBlock);

        dayElement.appendChild(item);
    });

    container.appendChild(dayElement);
}

function autoResizeTextarea(textarea) {
    if (!textarea) return;
    textarea.style.height = 'auto';
    textarea.style.height = Math.max(40, textarea.scrollHeight) + 'px';
}

function changeDay(direction) {
    currentDayIndex += direction;
    if (currentDayIndex < 0) currentDayIndex = window.daysOrder.length - 1;
    else if (currentDayIndex >= window.daysOrder.length) currentDayIndex = 0;
    localStorage.setItem(LS.SCHEDULE_DAY, String(currentDayIndex));
    updateScheduleDisplay();
}

function renderSchedule() {
    // Восстановить текущий день из localStorage
    const saved = localStorage.getItem(LS.SCHEDULE_DAY);
    if (saved !== null) {
        const n = parseInt(saved, 10);
        if (!isNaN(n) && n >= 0 && n < window.daysOrder.length) currentDayIndex = n;
    } else {
        currentDayIndex = getTodayIndex();
    }
    updateScheduleDisplay();
}

/* ============ STUDENTS ============ */
function renderStudents() {
    const container = document.getElementById('students-container');
    if (!container) return;

    const data = window.studentsData || [];
    if (!data.length) {
        container.innerHTML = `<div class="error-message">Не удалось загрузить список учеников.</div>`;
        return;
    }

    // Заполнить фильтр по кружкам
    const sel = document.getElementById('students-activity-filter');
    if (sel && sel.options.length <= 1) {
        const allActivities = new Set();
        data.forEach(s => (s.activities || []).forEach(a => { if (a) allActivities.add(a); }));
        Array.from(allActivities).sort().forEach(a => {
            const opt = document.createElement('option');
            opt.value = a; opt.textContent = a;
            sel.appendChild(opt);
        });
    }

    container.innerHTML = '';
    const grid = document.createElement('div');
    grid.className = 'students-grid';

    data.forEach(student => {
        const card = document.createElement('div');
        card.className = 'student-card';
        card.style.borderTopColor = getStableColor(student.name);
        card.dataset.name = student.name || '';
        card.dataset.activities = (student.activities || []).join('|');

        if (student.secret) {
            card.classList.add('secret-item');
            card.style.display = 'none';
        }

        const activitiesHTML = (student.activities || [])[0] === '' || !(student.activities || []).length
            ? '<div class="no-activities" data-key="without_activities_title_tran">Не посещает дополнительные занятия</div>'
            : (student.activities || []).map(a => `<div class="activity-item">${escapeHtml(a)}</div>`).join('');

        card.innerHTML = `
            <div class="student-name">${escapeHtml(student.name)}</div>
            <div class="student-activities">
                <div class="activities-title" data-key="activities_title_tran">Кружки и секции:</div>
                ${activitiesHTML}
            </div>`;

        grid.appendChild(card);
    });

    container.appendChild(grid);
    changeLanguage(currentLang);
    applyStudentsFilter();
}

function applyStudentsFilter() {
    const q = studentsSearch.trim().toLowerCase();
    const act = studentsActivityFilter;
    document.querySelectorAll('#students-container .student-card').forEach(card => {
        const isSecret = card.classList.contains('secret-item');
        const name = (card.dataset.name || '').toLowerCase();
        const activities = card.dataset.activities || '';

        if (isSecret) {
            // Секретные показываем только если запрос совпадает с именем (от 2 символов)
            const reveal = q.length >= 2 && name.includes(q);
            card.style.display = reveal ? '' : 'none';
            card.classList.toggle('revealed', reveal);
            return;
        }

        const matchSearch = !q || name.includes(q);
        const matchAct = !act || activities.split('|').includes(act);
        card.style.display = (matchSearch && matchAct) ? '' : 'none';
    });
}

/* ============ TEACHERS ============ */
function renderTeachers() {
    const container = document.getElementById('teachers-container');
    if (!container) return;

    const data = window.teachersData || [];
    if (!data.length) {
        container.innerHTML = `<div class="error-message">Не удалось загрузить список учителей.</div>`;
        return;
    }

    const sel = document.getElementById('teachers-subject-filter');
    if (sel && sel.options.length <= 1) {
        const allSubjects = new Set();
        data.forEach(t => (t.subjects || []).forEach(s => { if (s) allSubjects.add(s); }));
        Array.from(allSubjects).sort().forEach(s => {
            const opt = document.createElement('option');
            opt.value = s; opt.textContent = s;
            sel.appendChild(opt);
        });
    }

    container.innerHTML = '';

    data.forEach(teacher => {
        const card = document.createElement('div');
        card.className = 'teacher-item-card';
        card.style.borderTopColor = getStableColor(teacher.name);
        card.dataset.name = teacher.name || '';
        card.dataset.subjects = (teacher.subjects || []).join('|');

        card.innerHTML = `
            <div class="teacher-item-name">${escapeHtml(teacher.name)}</div>
            <div class="teacher-subjects">
                <div class="subjects-title" data-key="teacher_subject_tran">Предметы:</div>
                ${(teacher.subjects || []).map(s => `<div class="subject-item-teacher">${escapeHtml(s)}</div>`).join('')}
            </div>
            <div class="teacher-cabinet">
                <div class="cabinet-title" data-key="teacher_cabinet_tran">Кабинет:</div>
                <div class="cabinet-number">${escapeHtml(teacher.cabinet || '—')}</div>
            </div>`;

        container.appendChild(card);
    });

    changeLanguage(currentLang);
    applyTeachersFilter();
}

function applyTeachersFilter() {
    const q = teachersSearch.trim().toLowerCase();
    const subj = teachersSubjectFilter;
    document.querySelectorAll('#teachers-container .teacher-item-card').forEach(card => {
        const name = (card.dataset.name || '').toLowerCase();
        const subjects = card.dataset.subjects || '';
        const matchSearch = !q || name.includes(q);
        const matchSubj = !subj || subjects.split('|').includes(subj);
        card.style.display = (matchSearch && matchSubj) ? '' : 'none';
    });
}

/* ============ TEXTBOOKS ============ */
function renderTextbooks() {
    const container = document.getElementById('subjects-container');
    if (!container) return;

    const data = window.subjectsData || [];
    if (!data.length) {
        container.innerHTML = `<div class="error-message">Не удалось загрузить список учебников.</div>`;
        return;
    }

    container.innerHTML = '';
    const grid = document.createElement('div');
    grid.className = 'subjects-grid';

    data.forEach(subject => {
        const card = document.createElement('div');
        card.className = 'subject-card';
        card.style.borderTopColor = getStableColor(subject.name);

        const extraLink = subject.textbook2
            ? `<a href="${escapeHtml(subject.textbook2)}" target="_blank" rel="noopener" class="textbook-link" data-key="teacher_additional_book_open_tr">Открыть дополнительное пособие</a>`
            : '';

        card.innerHTML = `
            <div class="subject-name">${escapeHtml(subject.name)}</div>
            <div class="teacher-info">
                <div class="teacher-title" data-key="teacher_title_book_tr">Учитель:</div>
                <div class="teacher-name">${escapeHtml(subject.teacher)}</div>
            </div>
            <a href="${escapeHtml(subject.textbook || '#')}" target="_blank" rel="noopener" class="textbook-link" data-key="teacher_book_open_tr">Открыть учебник</a>
            ${extraLink}`;

        grid.appendChild(card);
    });

    container.appendChild(grid);
    changeLanguage(currentLang);
}

/* ============ BOOKS ============ */
const SUMMER_BOOKS_STATE_KEY = LS.BOOKS;
const SUMMER_BOOKS_OLD_KEY = LS.BOOKS_OLD;

function getBookParts(title) {
    return String(title || '').split(',').map(s => s.trim()).filter(Boolean);
}
function getBookKey(title, author) {
    return `${title}|||${author || ''}`;
}

function loadBooks() {
    let state = {};
    const savedState = localStorage.getItem(SUMMER_BOOKS_STATE_KEY);
    if (savedState) {
        try { state = JSON.parse(savedState) || {}; } catch (e) { state = {}; }
    } else {
        const oldSaved = localStorage.getItem(SUMMER_BOOKS_OLD_KEY);
        if (oldSaved) {
            try {
                const oldArr = JSON.parse(oldSaved);
                if (Array.isArray(oldArr)) {
                    (window.summerBooks || []).forEach((book, i) => {
                        const old = oldArr[i];
                        if (!old) return;
                        const parts = getBookParts(book.title);
                        if (parts.length > 1) parts.forEach(p => state[getBookKey(p, book.author)] = !!old.read);
                        else state[getBookKey(book.title, book.author)] = !!old.read;
                    });
                }
            } catch (e) {}
        }
    }
    window.__summerBookReadState = state;
}

function saveBooks() {
    localStorage.setItem(SUMMER_BOOKS_STATE_KEY, JSON.stringify(window.__summerBookReadState || {}));
}

function createBookItem(book, options = {}) {
    const { isSub = false, showAuthor = true } = options;
    const dict = window.translations[currentLang] || window.translations.ru || {};

    const item = document.createElement('div');
    item.className = 'book-item' + (isSub ? ' book-subitem' : '');
    item.dataset.read = book.read ? 'true' : 'false';
    item.dataset.search = ((book.title || '') + ' ' + (book.author || '')).toLowerCase();

    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.className = 'book-checkbox';
    checkbox.checked = book.read;
    checkbox.setAttribute('aria-label', 'Отметить как прочитанную: ' + book.title);

    const info = document.createElement('div');
    info.className = 'book-info';

    const title = document.createElement('div');
    title.className = 'book-title';
    title.textContent = book.title;
    if (book.read) title.classList.add('book-read');
    info.appendChild(title);

    if (showAuthor && book.author) {
        const author = document.createElement('div');
        author.className = 'book-author';
        author.textContent = book.author;
        info.appendChild(author);
    }

    const status = document.createElement('div');
    status.className = 'book-status';
    if (book.read) {
        status.textContent = dict.book_read_status || 'Прочитана';
        status.classList.add('read');
    } else {
        status.textContent = dict.book_not_read_status || 'Не прочитана';
    }

    // Обновляем только этот элемент — без перерисовки списка
    checkbox.addEventListener('change', e => {
        const checked = e.target.checked;
        window.__summerBookReadState[book.key] = checked;
        saveBooks();

        if (checked) {
            title.classList.add('book-read');
            status.textContent = dict.book_read_status || 'Прочитана';
            status.classList.add('read');
            item.dataset.read = 'true';
        } else {
            title.classList.remove('book-read');
            status.textContent = dict.book_not_read_status || 'Не прочитана';
            status.classList.remove('read');
            item.dataset.read = 'false';
        }

        updateBooksCounter();
        applyBooksFilter();
    });

    item.appendChild(checkbox);
    item.appendChild(info);
    item.appendChild(status);
    return item;
}

function updateBooksCounter() {
    const counter = document.getElementById('books-counter');
    if (!counter) return;
    const total = document.querySelectorAll('#summer-books-container .book-item').length;
    const read = document.querySelectorAll('#summer-books-container .book-item[data-read="true"]').length;
    const dict = window.translations[currentLang] || window.translations.ru || {};
    let tpl = dict.books_list_ready_tr || 'Прочитано: {readCount} из {total}';
    counter.textContent = tpl.replace('{readCount}', read).replace('{total}', total);

    const bar = document.getElementById('books-progress-fill');
    if (bar) {
        const pct = total ? (read / total) * 100 : 0;
        bar.style.width = pct + '%';
    }
}

function applyBooksFilter() {
    const q = booksSearch.trim().toLowerCase();
    const filter = booksFilter;

    document.querySelectorAll('#summer-books-container .book-item').forEach(item => {
        const isRead = item.dataset.read === 'true';
        const hay = item.dataset.search || '';
        const matchFilter = filter === 'all' || (filter === 'read' && isRead) || (filter === 'unread' && !isRead);
        const matchSearch = !q || hay.includes(q);
        item.style.display = (matchFilter && matchSearch) ? '' : 'none';
    });

    document.querySelectorAll('#summer-books-container .book-group').forEach(group => {
        const hasVisible = Array.from(group.querySelectorAll('.book-item')).some(i => i.style.display !== 'none');
        group.style.display = hasVisible ? '' : 'none';
    });
}

function renderSummerBooks() {
    const container = document.getElementById('summer-books-container');
    if (!container) return;

    loadBooks();
    const state = window.__summerBookReadState || {};

    const list = document.createElement('div');
    list.className = 'books-list';

    const header = document.createElement('div');
    header.className = 'books-header';
    const dict = window.translations[currentLang] || window.translations.ru || {};
    header.innerHTML = `<span>${dict.books_list_tr || 'Список книг'}</span><span id="books-counter"></span>`;
    list.appendChild(header);

    const progress = document.createElement('div');
    progress.className = 'books-progress';
    progress.innerHTML = `<div class="books-progress-fill" id="books-progress-fill"></div>`;
    list.appendChild(progress);

    const groups = [];
    let total = 0, read = 0;

    (window.summerBooks || []).forEach(book => {
        const parts = getBookParts(book.title);
        if (parts.length > 1) {
            const items = parts.map(part => {
                const key = getBookKey(part, book.author);
                const r = !!state[key];
                total++; if (r) read++;
                return { title: part, author: book.author, key, read: r };
            });
            groups.push({ type: 'multi', author: book.author, items });
        } else {
            const title = parts[0] || book.title || '';
            const key = getBookKey(title, book.author);
            const r = !!state[key];
            total++; if (r) read++;
            groups.push({ type: 'single', book: { title, author: book.author, key, read: r } });
        }
    });

    groups.forEach(group => {
        if (group.type === 'single') {
            list.appendChild(createBookItem(group.book));
        } else {
            const groupEl = document.createElement('div');
            groupEl.className = 'book-group';
            const groupHeader = document.createElement('div');
            groupHeader.className = 'book-group-header';
            groupHeader.textContent = group.author
                ? `${dict.book_author_label || 'Автор'}: ${group.author}`
                : (dict.books_group_title || 'Несколько книг');
            groupEl.appendChild(groupHeader);
            group.items.forEach(item => groupEl.appendChild(createBookItem(item, { isSub: true, showAuthor: false })));
            list.appendChild(groupEl);
        }
    });

    container.innerHTML = '';
    container.appendChild(list);

    updateBooksCounter();
    applyBooksFilter();
}

function resetBookMarks() {
    const dict = window.translations[currentLang] || window.translations.ru || {};
    const msg = dict.reset_marks_confirm || 'Сбросить все отметки о прочитанном?';
    if (!confirm(msg)) return;
    localStorage.removeItem(SUMMER_BOOKS_STATE_KEY);
    localStorage.removeItem(SUMMER_BOOKS_OLD_KEY);
    renderSummerBooks();
}

/* ============ OGE ============ */
function renderOgeSubjects() {
    const container = document.getElementById('oge-subjects-container');
    if (!container) return;

    const data = window.ogeSubjects || [];
    if (!data.length) {
        container.innerHTML = `<div class="error-message">Не удалось загрузить материалы ОГЭ.</div>`;
        return;
    }

    container.innerHTML = '';
    data.forEach(subject => {
        const card = document.createElement('div');
        card.className = 'subject-card oge-subject-card';
        card.style.borderTopColor = getStableColor(subject.name);

        const linksHTML = (subject.links || []).map(link => `
            <a href="${escapeHtml(link.url)}" target="_blank" rel="noopener" class="oge-link-item">
                <i class="fas fa-arrow-up-right-from-square"></i>
                <div>
                    <span>${escapeHtml(link.text)}</span>
                    ${link.desc ? `<span class="link-desc">${escapeHtml(link.desc)}</span>` : ''}
                </div>
            </a>`).join('');

        card.innerHTML = `
            <div class="subject-name">${escapeHtml(subject.name)}</div>
            <div class="oge-links-list">${linksHTML}</div>`;
        container.appendChild(card);
    });
}

/* ============ QR (lazy) ============ */
const QR_FALLBACK_URL = 'https://solaris-9-5.example.com';

function getSiteUrl() {
    if (location.protocol === 'http:' || location.protocol === 'https:') {
        return location.origin + location.pathname;
    }
    return QR_FALLBACK_URL;
}

function loadQrLib() {
    if (qrLoaded) return Promise.resolve();
    return new Promise((resolve, reject) => {
        const s = document.createElement('script');
        s.src = 'https://cdnjs.cloudflare.com/ajax/libs/qrcodejs/1.0.0/qrcode.min.js';
        s.onload = () => { qrLoaded = true; resolve(); };
        s.onerror = reject;
        document.head.appendChild(s);
    });
}

function buildQrInto(box, url) {
    if (!box) return;
    box.innerHTML = '';

    if (typeof QRCode !== 'undefined') {
        new QRCode(box, {
            text: url, width: 120, height: 120,
            colorDark: '#2c3e50', colorLight: '#ffffff',
            correctLevel: QRCode.CorrectLevel.M
        });
        return;
    }

    const img = document.createElement('img');
    img.width = 120; img.height = 120; img.alt = 'QR';
    img.src = 'https://api.qrserver.com/v1/create-qr-code/?size=120x120&data=' + encodeURIComponent(url);
    box.appendChild(img);
}

function openQrPanel() {
    const url = getSiteUrl();
    loadQrLib().catch(() => {}).finally(() => {
        document.querySelectorAll('.qr-panel').forEach(panel => {
            const box = panel.querySelector('.qr-panel-code');
            if (!box) return;
            if (box.dataset.built !== '1') {
                buildQrInto(box, url);
                box.dataset.built = '1';
            }
            panel.classList.add('open');
        });
    });
}

function closeQrPanel() {
    document.querySelectorAll('.qr-panel').forEach(p => p.classList.remove('open'));
}

/* ============ SECRET WORDS ============ */
let keyBuffer = '';
let keyBufferTimer = null;
const secretWords = ['key', 'лун', 'krewwie', 'лкуццшу'];
const qrWords = ['ссылка', 'ccskrf'];

function resetKeyBuffer() { keyBuffer = ''; clearTimeout(keyBufferTimer); }

document.addEventListener('keydown', e => {
    if (typeof e.key !== 'string') {
        if (['Enter', 'Escape', 'Tab'].includes(e.key)) resetKeyBuffer();
        return;
    }
    if (e.key.length !== 1) return;

    const el = e.target;
    if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable)) {
        resetKeyBuffer();
        return;
    }

    keyBuffer = (keyBuffer + e.key.toLowerCase()).slice(-20);
    clearTimeout(keyBufferTimer);
    keyBufferTimer = setTimeout(resetKeyBuffer, 2000);

    if (qrWords.some(w => keyBuffer.endsWith(w))) { resetKeyBuffer(); openQrPanel(); return; }
    if (secretWords.some(w => keyBuffer.endsWith(w))) { resetKeyBuffer(); showContent('authors'); }
});

document.addEventListener('click', resetKeyBuffer);

/* ============ BOOT ============ */
document.addEventListener('DOMContentLoaded', () => {
    // Снимок оригинала расписания для функции "сделать обычным"
    try {
        window.__originalScheduleData = JSON.parse(JSON.stringify(window.scheduleData || {}));
    } catch (e) { window.__originalScheduleData = {}; }

    loadSettings();
    loadEditMode();
    loadScheduleFromStorage();
    renderLanguageOptions();
    applySettings();
    changeLanguage(settings.lang);

    // Показать раздел из хэша
    showContent(getSectionFromHash(), false);

    // Навигация — по клику, но с обновлением хэша
    document.querySelectorAll('[data-content-link]').forEach(el => {
        el.addEventListener('click', e => {
            e.preventDefault();
            const id = el.getAttribute('data-content-link');
            if (location.hash === '#' + id) showContent(id);
            else location.hash = id;
        });
    });

    // Кнопки тем / настроек
    document.querySelectorAll('.settings-option[data-theme]').forEach(btn => {
        btn.addEventListener('click', () => setTheme(btn.getAttribute('data-theme')));
    });
    document.querySelectorAll('.settings-toggle-row[data-setting]').forEach(row => {
        row.addEventListener('click', () => toggleSetting(row.getAttribute('data-setting')));
        row.addEventListener('keydown', e => {
            if (e.key === ' ' || e.key === 'Enter') {
                e.preventDefault();
                toggleSetting(row.getAttribute('data-setting'));
            }
        });
    });

    // Расписание
    const editBtn = document.getElementById('edit-mode-toggle');
    if (editBtn) editBtn.addEventListener('click', toggleEditMode);
    const resetBtn = document.getElementById('reset-schedule-btn');
    if (resetBtn) resetBtn.addEventListener('click', resetSchedule);
    document.querySelector('.nav-button.prev')?.addEventListener('click', () => changeDay(-1));
    document.querySelector('.nav-button.next')?.addEventListener('click', () => changeDay(1));

    // Книги
    const booksSearchInput = document.getElementById('books-search');
    if (booksSearchInput) booksSearchInput.addEventListener('input', debounce(e => {
        booksSearch = e.target.value;
        applyBooksFilter();
    }, 200));
    document.querySelectorAll('.books-filter-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            document.querySelectorAll('.books-filter-btn').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            booksFilter = btn.getAttribute('data-filter');
            localStorage.setItem(LS.BOOKS_FILTER, booksFilter);
            applyBooksFilter();
        });
    });
    const savedBooksFilter = localStorage.getItem(LS.BOOKS_FILTER);
    if (savedBooksFilter) {
        booksFilter = savedBooksFilter;
        document.querySelectorAll('.books-filter-btn').forEach(b => {
            b.classList.toggle('active', b.getAttribute('data-filter') === booksFilter);
        });
    }
    document.getElementById('reset-books-btn')?.addEventListener('click', resetBookMarks);

    // Ученики
    const stSearch = document.getElementById('students-search');
    if (stSearch) stSearch.addEventListener('input', debounce(e => { studentsSearch = e.target.value; applyStudentsFilter(); }, 150));
    const stAct = document.getElementById('students-activity-filter');
    if (stAct) stAct.addEventListener('change', e => { studentsActivityFilter = e.target.value; applyStudentsFilter(); });

    // Учителя
    const tSearch = document.getElementById('teachers-search');
    if (tSearch) tSearch.addEventListener('input', debounce(e => { teachersSearch = e.target.value; applyTeachersFilter(); }, 150));
    const tSubj = document.getElementById('teachers-subject-filter');
    if (tSubj) tSubj.addEventListener('change', e => { teachersSubjectFilter = e.target.value; applyTeachersFilter(); });

    // QR закрытие
    document.querySelectorAll('.qr-close-btn').forEach(btn => {
        btn.addEventListener('click', closeQrPanel);
    });

    // Service worker — оффлайн
    if ('serviceWorker' in navigator) {
        window.addEventListener('load', () => {
            navigator.serviceWorker.register('service-worker.js').catch(() => {});
        });
    }

    // Обновление расписания при ресайзе (пересчёт «мобильный/не мобильный»)
    let resizeTimer = null;
    window.addEventListener('resize', () => {
        clearTimeout(resizeTimer);
        resizeTimer = setTimeout(() => {
            if (document.getElementById('schedule')?.classList.contains('active')) updateScheduleDisplay();
        }, 250);
    });
});

// Экспорт для инлайн-обработчиков
window.showContent = showContent;
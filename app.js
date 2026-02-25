/**
 * ╔══════════════════════════════════════════════════════════╗
 * ║           ExamPortal — app.js  (Multi-Test v2)          ║
 * ║  Login, test selection, exam, scoring, admin panel      ║
 * ║  with question editor, user manager, and results.       ║
 * ╚══════════════════════════════════════════════════════════╝
 */

'use strict';

const App = (() => {

  /* ── State ─────────────────────────────────────── */
  let endpoint = '';
  let allUsers = [];
  let allTests = [];
  let currentUser = null;
  let questions = [];
  let currentTest = null;
  let adminData = {};
  let allResults = [];
  let editQuestions = [];  // questions being edited
  let editTestSheet = '';  // sheet name being edited

  /* ── Utility: SHA-256 ───────────────────────────── */
  async function sha256(str) {
    const buffer = new TextEncoder().encode(str);
    const hash = await crypto.subtle.digest('SHA-256', buffer);
    return Array.from(new Uint8Array(hash))
      .map(b => b.toString(16).padStart(2, '0'))
      .join('');
  }

  /* ── Utility: base64 decode ─────────────────────── */
  function b64decode(str) {
    return decodeURIComponent(
      atob(str)
        .split('')
        .map(c => '%' + c.charCodeAt(0).toString(16).padStart(2, '0'))
        .join('')
    );
  }

  /* ── Utility: shuffle array ─────────────────────── */
  function shuffle(arr) {
    const a = [...arr];
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }

  /* ── Utility: escape HTML ───────────────────────── */
  function escapeHtml(str) {
    return String(str ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  /* ── Utility: view switcher ─────────────────────── */
  function showView(id) {
    document.querySelectorAll('.view').forEach(v => {
      v.classList.toggle('active', v.id === id);
    });
  }

  /* ── Utility: GAS fetch helpers ─────────────────── */
  async function gasGet(action, params = {}) {
    const url = new URL(endpoint);
    url.searchParams.set('action', action);
    Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v));
    const res = await fetch(url.toString());
    return res.json();
  }

  async function gasPost(payload) {
    const res = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain' },
      body: JSON.stringify(payload),
    });
    return res.json();
  }

  // ════════════════════════════════════════════════════
  //  INIT
  // ════════════════════════════════════════════════════
  async function init() {
    try {
      const res = await fetch('./data.json');
      if (!res.ok) throw new Error('Cannot load data.json');
      const config = await res.json();
      endpoint = b64decode(config.endpoint);
    } catch (err) {
      alert('Failed to load configuration.\n' + err.message);
    }

    ['username', 'password'].forEach(id => {
      document.getElementById(id).addEventListener('keydown', e => {
        if (e.key === 'Enter') login();
      });
    });

    ['filter-user', 'filter-test', 'filter-passed'].forEach(id => {
      document.getElementById(id).addEventListener('change', filterResults);
    });
  }

  // ════════════════════════════════════════════════════
  //  LOGIN
  // ════════════════════════════════════════════════════
  async function login() {
    const usernameInput = document.getElementById('username').value.trim();
    const passwordInput = document.getElementById('password').value;
    const errorEl = document.getElementById('login-error');
    const loginBtn = document.getElementById('login-btn');

    errorEl.classList.remove('visible');

    if (!usernameInput || !passwordInput) {
      errorEl.textContent = 'Please enter both username and password.';
      errorEl.classList.add('visible');
      return;
    }

    loginBtn.disabled = true;
    loginBtn.textContent = 'Verifying…';

    try {
      const data = await gasGet('getUsers');
      allUsers = data.users || [];
      allTests = data.tests || [];

      const hash = await sha256(passwordInput);
      const user = allUsers.find(u => u.username === usernameInput && u.passwordHash === hash);

      if (!user) {
        errorEl.textContent = 'Invalid username or password. Please try again.';
        errorEl.classList.add('visible');
        loginBtn.disabled = false;
        loginBtn.textContent = 'Login';
        return;
      }

      const isAdmin = usernameInput === 'Admin';
      currentUser = {
        username: user.username,
        fullName: user.fullName,
        tests: user.tests || [],
        isAdmin: isAdmin,
      };

      loginBtn.textContent = 'Loading…';

      if (isAdmin) {
        await loadAdminPanel();
      } else {
        renderTestSelection();
      }

    } catch (err) {
      errorEl.textContent = 'Connection error. Please try again.';
      errorEl.classList.add('visible');
      loginBtn.disabled = false;
      loginBtn.textContent = 'Login';
    }
  }

  // ════════════════════════════════════════════════════
  //  TEST SELECTION
  // ════════════════════════════════════════════════════
  function renderTestSelection() {
    document.getElementById('select-username').textContent = currentUser.fullName || currentUser.username;

    const grid = document.getElementById('test-grid');
    grid.innerHTML = '';

    const userTests = allTests.filter(t => currentUser.tests.includes(t.sheetName));
    const testsToShow = currentUser.isAdmin ? allTests : userTests;

    if (testsToShow.length === 0) {
      grid.innerHTML = '<div class="no-tests-msg">No tests assigned to your account. Contact your administrator.</div>';
      showView('select-view');
      return;
    }

    const icons = ['📘', '📗', '📙', '📕', '📓', '📔', '🔬', '✈️', '🛡️', '⚙️'];

    testsToShow.forEach((test, idx) => {
      const card = document.createElement('div');
      card.className = 'test-card';
      card.style.animationDelay = `${idx * 0.08}s`;
      card.innerHTML = `
        <div class="test-card-icon">${icons[idx % icons.length]}</div>
        <div class="test-card-title">${escapeHtml(test.title)}</div>
        <div class="test-card-meta">Sheet: ${escapeHtml(test.sheetName)}</div>
        <button class="btn-start-test" onclick="App.startTest('${escapeHtml(test.sheetName)}')">Start Test →</button>
      `;
      grid.appendChild(card);
    });

    showView('select-view');
  }

  // ════════════════════════════════════════════════════
  //  START TEST
  // ════════════════════════════════════════════════════
  async function startTest(sheetName) {
    const test = allTests.find(t => t.sheetName === sheetName);
    if (!test) { alert('Test not found: ' + sheetName); return; }

    currentTest = test;
    document.getElementById('exam-title').textContent = test.title;
    document.getElementById('question-count').textContent = 'Loading…';
    document.getElementById('questions-container').innerHTML =
      '<div class="loading-overlay"><div class="spinner"></div><span>Loading questions…</span></div>';
    showView('exam-view');

    try {
      const data = await gasGet('getQuestions', { test: sheetName });
      if (data.error) throw new Error(data.error);
      questions = shuffle(data.questions || []);
      if (questions.length === 0) throw new Error('No questions found in this test.');
      renderExam();
    } catch (err) {
      alert('Failed to load questions:\n' + err.message);
      if (currentUser.isAdmin && !currentUser._takingTests) {
        showView('admin-view');
      } else {
        renderTestSelection();
      }
    }
  }

  // ════════════════════════════════════════════════════
  //  RENDER EXAM
  // ════════════════════════════════════════════════════
  function renderExam() {
    document.getElementById('exam-username').textContent = currentUser.fullName || currentUser.username;
    document.getElementById('exam-title').textContent = currentTest.title;
    document.getElementById('question-count').textContent =
      `${questions.length} question${questions.length !== 1 ? 's' : ''}`;

    const container = document.getElementById('questions-container');
    container.innerHTML = '';

    const examBody = document.querySelector('.exam-body');
    examBody.addEventListener('copy', e => e.preventDefault());
    examBody.addEventListener('cut', e => e.preventDefault());
    examBody.addEventListener('contextmenu', e => e.preventDefault());

    const submitBtn = document.getElementById('submit-btn');
    submitBtn.disabled = false;
    submitBtn.textContent = 'Submit Exam';

    questions.forEach((q, idx) => {
      const allOptions = [
        { key: 'A', text: q.option_a },
        { key: 'B', text: q.option_b },
        { key: 'C', text: q.option_c },
        { key: 'D', text: q.option_d },
      ];
      const options = allOptions.filter(opt => opt.text && opt.text.trim() !== '');

      const card = document.createElement('div');
      card.className = 'q-card';
      card.style.animationDelay = `${idx * 0.05}s`;
      card.dataset.qid = q.question_id;
      card.dataset.correct = q.correct_answer;

      card.innerHTML = `
        <div class="q-num">Question ${idx + 1}</div>
        <div class="q-text">${escapeHtml(q.question_text)}</div>
        <div class="options">
          ${options.map(opt => `
            <label class="option-label">
              <input type="radio" name="q_${q.question_id}" value="${opt.key}" />
              <span class="option-key">${opt.key}</span>
              <span>${escapeHtml(opt.text)}</span>
            </label>
          `).join('')}
        </div>
      `;

      container.appendChild(card);
    });

    showView('exam-view');
  }

  // ════════════════════════════════════════════════════
  //  SUBMIT EXAM
  // ════════════════════════════════════════════════════
  async function submit() {
    const cards = document.querySelectorAll('.q-card');
    const answers = {};
    let missing = false;

    cards.forEach(card => {
      const qid = card.dataset.qid;
      const checked = card.querySelector('input[type="radio"]:checked');
      if (!checked) { missing = true; return; }
      answers[qid] = checked.value;
    });

    if (missing) {
      alert('Please answer all questions before submitting.');
      return;
    }

    const btn = document.getElementById('submit-btn');
    btn.disabled = true;
    btn.textContent = 'Submitting…';

    let correct = 0;
    const answerDetail = [];

    cards.forEach(card => {
      const qid = card.dataset.qid;
      const userAnswer = answers[qid];
      const rightAnswer = card.dataset.correct;
      const isCorrect = userAnswer === rightAnswer;
      if (isCorrect) correct++;

      answerDetail.push({
        question_id: qid,
        user_answer: userAnswer,
        correct_answer: rightAnswer,
        is_correct: isCorrect,
      });
    });

    const total = questions.length;
    const score = Math.round((correct / total) * 100);
    const nowISO = new Date().toISOString();

    const payload = {
      action: 'submitResult',
      username: currentUser.username,
      date: nowISO,
      test: currentTest ? currentTest.title : '',
      score: score,
      correct: correct,
      total: total,
      answers: answerDetail,
    };

    try {
      await gasPost(payload);
    } catch (err) {
      console.warn('Result save failed:', err);
    }

    showResult(score, correct, total);
  }

  // ════════════════════════════════════════════════════
  //  SHOW RESULT
  // ════════════════════════════════════════════════════
  function showResult(score, correct, total) {
    const PASS_THRESHOLD = 80;
    const passed = score >= PASS_THRESHOLD;

    document.getElementById('result-username').textContent = currentUser.fullName || currentUser.username;
    document.getElementById('result-score-num').textContent = score + '%';

    const ring = document.getElementById('result-ring');
    ring.classList.remove('pass', 'fail');
    ring.classList.add(passed ? 'pass' : 'fail');
    ring.style.setProperty('--score-pct', score + '%');

    document.getElementById('result-title').textContent =
      passed ? 'Exam Passed! 🎉' : 'Exam Not Passed';

    document.getElementById('result-verdict').innerHTML = passed
      ? `<div class="verdict pass">✅ Congratulations, you passed the test!</div>`
      : `<div class="verdict fail">❌ Unfortunately, you did not pass the test, please try again!</div>`;

    document.getElementById('result-sub').textContent =
      `Test: ${currentTest ? currentTest.title : 'Unknown'} — Passing score: ${PASS_THRESHOLD}%`;

    document.getElementById('result-stats').innerHTML = `
      <div class="stat-pill"><strong>${score}%</strong>Your Score</div>
      <div class="stat-pill"><strong>${correct}</strong>Correct</div>
      <div class="stat-pill"><strong>${total - correct}</strong>Incorrect</div>
      <div class="stat-pill"><strong>${total}</strong>Total Qs</div>
    `;

    showView('result-view');
  }

  function backToTests() {
    questions = [];
    currentTest = null;
    if (currentUser.isAdmin && !currentUser._takingTests) {
      showView('admin-view');
    } else {
      renderTestSelection();
    }
  }

  function adminTakeTests() {
    currentUser._takingTests = true;
    renderTestSelection();
  }

  // ════════════════════════════════════════════════════
  //  ADMIN PANEL
  // ════════════════════════════════════════════════════

  async function loadAdminPanel() {
    document.getElementById('admin-username').textContent = currentUser.username;
    showView('admin-view');
    await refreshAdminData();
    renderAdminTests();
    renderAdminUsers();
    populateTestSelector();
  }

  async function refreshAdminData() {
    try {
      const data = await gasGet('getUsers');
      adminData.users = data.users || [];
      adminData.tests = data.tests || [];
      allUsers = adminData.users;
      allTests = adminData.tests;
    } catch (err) {
      console.warn('Failed to load admin data:', err);
    }
  }

  /* ── Admin Tab Switching ──────────────────────── */
  function switchAdminTab(tabName, btnEl) {
    document.querySelectorAll('.admin-tab').forEach(t => t.classList.remove('active'));
    btnEl.classList.add('active');
    document.querySelectorAll('.admin-panel').forEach(p => p.classList.remove('active'));
    document.getElementById('admin-' + tabName).classList.add('active');

    if (tabName === 'results') {
      loadAdminResults();
    }
    if (tabName === 'questions') {
      populateTestSelector();
    }
  }

  /* ── Admin: Tests Management ──────────────────── */
  function renderAdminTests() {
    const container = document.getElementById('admin-test-list');

    if (adminData.tests.length === 0) {
      container.innerHTML = '<div class="no-tests-msg">No tests created yet. Create one above.</div>';
      return;
    }

    container.innerHTML = adminData.tests.map(test => `
      <div class="test-item">
        <span class="test-item-name">📋 ${escapeHtml(test.title)}</span>
        <div class="test-item-actions">
          <button class="btn-admin danger" onclick="App.deleteTest('${escapeHtml(test.title)}')">Delete</button>
        </div>
      </div>
    `).join('');
  }

  async function createTest() {
    const input = document.getElementById('new-test-name');
    const name = input.value.trim();
    if (!name) { alert('Please enter a test name.'); return; }

    try {
      await gasPost({ action: 'createTest', testName: name });
      input.value = '';
      await refreshAdminData();
      renderAdminTests();
      renderAdminUsers();
      populateTestSelector();
      alert(`Test "${name}" created successfully!`);
    } catch (err) {
      alert('Failed to create test: ' + err.message);
    }
  }

  async function deleteTest(testName) {
    if (!confirm(`Delete test "${testName}"? This removes the sheet and all questions.`)) return;

    try {
      await gasPost({ action: 'deleteTest', testName: testName });
      await refreshAdminData();
      renderAdminTests();
      renderAdminUsers();
      populateTestSelector();
      alert(`Test "${testName}" deleted.`);
    } catch (err) {
      alert('Failed to delete test: ' + err.message);
    }
  }

  /* ── Admin: Question Editor ───────────────────── */
  function populateTestSelector() {
    const sel = document.getElementById('qe-test-select');
    sel.innerHTML = '<option value="">— Select a test —</option>';
    (adminData.tests || []).forEach(t => {
      sel.innerHTML += `<option value="${escapeHtml(t.sheetName)}">${escapeHtml(t.title)}</option>`;
    });
  }

  async function loadQuestionsForEdit() {
    const sel = document.getElementById('qe-test-select');
    const sheetName = sel.value;
    if (!sheetName) { alert('Please select a test first.'); return; }

    editTestSheet = sheetName;
    const container = document.getElementById('qe-container');
    container.innerHTML = '<div class="loading-overlay"><div class="spinner"></div><span>Loading questions…</span></div>';
    document.getElementById('qe-actions').style.display = 'none';

    try {
      const data = await gasGet('getQuestions', { test: sheetName });
      if (data.error) throw new Error(data.error);
      editQuestions = data.questions || [];
      renderQuestionEditor();
    } catch (err) {
      container.innerHTML = `<div class="no-tests-msg">Failed to load: ${escapeHtml(err.message)}</div>`;
    }
  }

  function renderQuestionEditor() {
    const container = document.getElementById('qe-container');
    document.getElementById('qe-actions').style.display = 'block';

    if (editQuestions.length === 0) {
      container.innerHTML = '<div class="no-tests-msg">No questions yet. Click "+ Add Question" below.</div>';
      return;
    }

    container.innerHTML = editQuestions.map((q, idx) => `
      <div class="qe-row" data-idx="${idx}">
        <div class="qe-row-header">
          <span class="qe-row-num">Question ${idx + 1} (ID: ${escapeHtml(q.question_id)})</span>
          <button class="btn-admin danger" onclick="App.removeQuestionRow(${idx})" style="padding:.3rem .7rem;font-size:.75rem;">✕ Remove</button>
        </div>
        <div class="qe-grid">
          <div class="qe-full">
            <span class="qe-label">Question Text</span>
            <input class="qe-input" data-field="question_text" value="${escapeHtml(q.question_text)}" placeholder="Enter question…" />
          </div>
          <div>
            <span class="qe-label">Option A *</span>
            <input class="qe-input" data-field="option_a" value="${escapeHtml(q.option_a)}" placeholder="Option A" />
          </div>
          <div>
            <span class="qe-label">Option B *</span>
            <input class="qe-input" data-field="option_b" value="${escapeHtml(q.option_b)}" placeholder="Option B" />
          </div>
          <div>
            <span class="qe-label">Option C (optional)</span>
            <input class="qe-input" data-field="option_c" value="${escapeHtml(q.option_c)}" placeholder="Option C" />
          </div>
          <div>
            <span class="qe-label">Option D (optional)</span>
            <input class="qe-input" data-field="option_d" value="${escapeHtml(q.option_d)}" placeholder="Option D" />
          </div>
          <div>
            <span class="qe-label">Correct Answer (A/B/C/D)</span>
            <input class="qe-input" data-field="correct_answer" value="${escapeHtml(q.correct_answer)}" placeholder="A" maxlength="1" style="text-transform:uppercase;" />
          </div>
          <div>
            <span class="qe-label">Question ID</span>
            <input class="qe-input" data-field="question_id" value="${escapeHtml(q.question_id)}" placeholder="1" />
          </div>
        </div>
      </div>
    `).join('');
  }

  function addQuestionRow() {
    const nextId = editQuestions.length > 0
      ? Math.max(...editQuestions.map(q => parseInt(q.question_id) || 0)) + 1
      : 1;

    editQuestions.push({
      question_id: String(nextId),
      question_text: '',
      option_a: '',
      option_b: '',
      option_c: '',
      option_d: '',
      correct_answer: 'A',
    });

    renderQuestionEditor();

    // Scroll to the new row
    const container = document.getElementById('qe-container');
    container.lastElementChild?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }

  function removeQuestionRow(idx) {
    if (!confirm('Remove this question?')) return;
    editQuestions.splice(idx, 1);
    renderQuestionEditor();
  }

  function collectQuestionsFromUI() {
    const rows = document.querySelectorAll('.qe-row');
    const qs = [];
    rows.forEach(row => {
      const q = {};
      row.querySelectorAll('.qe-input').forEach(input => {
        q[input.dataset.field] = input.value.trim();
      });
      q.correct_answer = (q.correct_answer || 'A').toUpperCase();
      qs.push(q);
    });
    return qs;
  }

  async function saveAllQuestions() {
    if (!editTestSheet) { alert('No test selected.'); return; }

    const qs = collectQuestionsFromUI();
    editQuestions = qs;

    // Validate
    for (let i = 0; i < qs.length; i++) {
      if (!qs[i].question_text) {
        alert(`Question ${i + 1}: text is required.`);
        return;
      }
      if (!qs[i].option_a || !qs[i].option_b) {
        alert(`Question ${i + 1}: at least options A and B are required.`);
        return;
      }
    }

    try {
      const result = await gasPost({
        action: 'saveQuestions',
        testSheetName: editTestSheet,
        questions: qs,
      });
      if (result.error) throw new Error(result.error);
      alert(`Saved ${qs.length} question(s) successfully!`);
    } catch (err) {
      alert('Failed to save: ' + err.message);
    }
  }

  /* ── Admin: User Management ───────────────────── */
  function renderAdminUsers() {
    const container = document.getElementById('admin-users-table');
    const users = adminData.users || [];
    const tests = adminData.tests || [];

    if (users.length === 0) {
      container.innerHTML = '<div class="no-tests-msg">No users found in the Users sheet.</div>';
      return;
    }

    let html = '<table class="admin-table"><thead><tr>';
    html += '<th>Full Name</th><th>Username</th><th>Actions</th>';
    tests.forEach(t => {
      html += `<th style="text-align:center">${escapeHtml(t.title)}</th>`;
    });
    html += '</tr></thead><tbody>';

    users.forEach(user => {
      if (user.username === 'Admin') return;
      html += '<tr>';
      html += `<td>${escapeHtml(user.fullName)}</td>`;
      html += `<td><strong>${escapeHtml(user.username)}</strong></td>`;
      html += `<td style="white-space:nowrap;">`;
      html += `<button class="btn-admin warning" onclick="App.editUser('${escapeHtml(user.username)}')" style="padding:.25rem .6rem;font-size:.72rem;margin-right:.3rem;">Edit</button>`;
      html += `<button class="btn-admin danger" onclick="App.deleteUser('${escapeHtml(user.username)}')" style="padding:.25rem .6rem;font-size:.72rem;">Del</button>`;
      html += `</td>`;
      tests.forEach(t => {
        const checked = user.tests.includes(t.sheetName) ? 'checked' : '';
        html += `<td style="text-align:center"><input type="checkbox" data-username="${escapeHtml(user.username)}" data-test="${escapeHtml(t.sheetName)}" ${checked} /></td>`;
      });
      html += '</tr>';
    });

    html += '</tbody></table>';
    container.innerHTML = html;
  }

  async function createUser() {
    const fullName = document.getElementById('new-user-fullname').value.trim();
    const username = document.getElementById('new-user-username').value.trim();
    const password = document.getElementById('new-user-password').value;

    if (!fullName || !username || !password) {
      alert('Please fill in all fields (Full Name, Username, Password).');
      return;
    }

    const passwordHash = await sha256(password);

    try {
      const result = await gasPost({
        action: 'createUser',
        user: { fullName, username, passwordHash },
      });
      if (result.error) {
        alert('Error: ' + result.error);
        return;
      }

      document.getElementById('new-user-fullname').value = '';
      document.getElementById('new-user-username').value = '';
      document.getElementById('new-user-password').value = '';

      await refreshAdminData();
      renderAdminUsers();
      alert(`User "${username}" created successfully!`);
    } catch (err) {
      alert('Failed to create user: ' + err.message);
    }
  }

  function editUser(username) {
    const user = adminData.users.find(u => u.username === username);
    if (!user) return;

    const newFullName = prompt('Full Name:', user.fullName);
    if (newFullName === null) return;

    const newPassword = prompt('New password (leave empty to keep current):');

    (async () => {
      try {
        const updateData = {
          action: 'updateUser',
          user: {
            username: username,
            fullName: newFullName,
          },
        };

        if (newPassword) {
          updateData.user.passwordHash = await sha256(newPassword);
        }

        const result = await gasPost(updateData);
        if (result.error) {
          alert('Error: ' + result.error);
          return;
        }

        await refreshAdminData();
        renderAdminUsers();
        alert('User updated!');
      } catch (err) {
        alert('Failed to update user: ' + err.message);
      }
    })();
  }

  async function deleteUser(username) {
    if (!confirm(`Delete user "${username}"? This cannot be undone.`)) return;

    try {
      const result = await gasPost({ action: 'deleteUser', username: username });
      if (result.error) {
        alert('Error: ' + result.error);
        return;
      }
      await refreshAdminData();
      renderAdminUsers();
      alert(`User "${username}" deleted.`);
    } catch (err) {
      alert('Failed to delete user: ' + err.message);
    }
  }

  async function saveAssignments() {
    const checkboxes = document.querySelectorAll('#admin-users-table input[type="checkbox"]');
    const assignmentMap = {};

    checkboxes.forEach(cb => {
      const username = cb.dataset.username;
      const testName = cb.dataset.test;
      if (!assignmentMap[username]) assignmentMap[username] = [];
      if (cb.checked) assignmentMap[username].push(testName);
    });

    const assignments = Object.entries(assignmentMap).map(([username, tests]) => ({
      username, tests,
    }));

    try {
      await gasPost({ action: 'updateUserTests', assignments: assignments });
      await refreshAdminData();
      alert('Assignments saved successfully!');
    } catch (err) {
      alert('Failed to save assignments: ' + err.message);
    }
  }

  /* ── Admin: Results ───────────────────────────── */
  async function loadAdminResults() {
    const container = document.getElementById('admin-results-table');
    container.innerHTML = '<div class="loading-overlay"><div class="spinner"></div><span>Loading results…</span></div>';

    try {
      const data = await gasGet('getResults');
      allResults = data.results || [];
      populateResultFilters();
      filterResults();
    } catch (err) {
      container.innerHTML = '<div class="no-tests-msg">Failed to load results.</div>';
    }
  }

  function populateResultFilters() {
    const userSelect = document.getElementById('filter-user');
    const testSelect = document.getElementById('filter-test');

    const uniqueUsers = [...new Set(allResults.map(r => r.username).filter(Boolean))];
    userSelect.innerHTML = '<option value="">All Users</option>' +
      uniqueUsers.map(u => `<option value="${escapeHtml(u)}">${escapeHtml(u)}</option>`).join('');

    const uniqueTests = [...new Set(allResults.map(r => r.test).filter(Boolean))];
    testSelect.innerHTML = '<option value="">All Tests</option>' +
      uniqueTests.map(t => `<option value="${escapeHtml(t)}">${escapeHtml(t)}</option>`).join('');
  }

  function filterResults() {
    const userFilter = document.getElementById('filter-user').value;
    const testFilter = document.getElementById('filter-test').value;
    const passedFilter = document.getElementById('filter-passed').value;

    let filtered = allResults;
    if (userFilter) filtered = filtered.filter(r => r.username === userFilter);
    if (testFilter) filtered = filtered.filter(r => r.test === testFilter);
    if (passedFilter) filtered = filtered.filter(r => String(r.passed).toUpperCase() === passedFilter);

    renderResultsTable(filtered);
  }

  function renderResultsTable(results) {
    const container = document.getElementById('admin-results-table');

    if (results.length === 0) {
      container.innerHTML = '<div class="no-tests-msg">No results found.</div>';
      return;
    }

    let html = '<table class="admin-table"><thead><tr>';
    html += '<th>Username</th><th>Test</th><th>Date</th><th>Score</th><th>Correct</th><th>Total</th><th>Status</th>';
    html += '</tr></thead><tbody>';

    const sorted = [...results].reverse();

    sorted.forEach((r, idx) => {
      const passedStr = String(r.passed).toUpperCase().trim();
      const passClass = passedStr === 'YES' ? 'pass' : 'fail';
      const passLabel = passedStr === 'YES' ? 'PASSED' : 'FAILED';

      let dateStr = '';
      if (r.date) {
        try {
          const d = new Date(r.date);
          dateStr = d.toLocaleString();
        } catch (e) {
          dateStr = String(r.date);
        }
      }

      const resultIdx = results.length - 1 - idx; // original index in reversed order
      html += `<tr class="clickable" onclick="App.showAnswerDetail(${sorted.length - 1 - idx})" title="Click to view answers">`;
      html += `<td><strong>${escapeHtml(r.username)}</strong></td>`;
      html += `<td>${escapeHtml(r.test)}</td>`;
      html += `<td>${escapeHtml(dateStr)}</td>`;
      html += `<td>${escapeHtml(String(r.score))}</td>`;
      html += `<td>${r.correct}</td>`;
      html += `<td>${r.total}</td>`;
      html += `<td><span class="badge ${passClass}">${passLabel}</span></td>`;
      html += '</tr>';
    });

    html += '</tbody></table>';
    container.innerHTML = html;
  }

  /* ── Answer Detail Modal ──────────────────────── */
  function showAnswerDetail(resultIndex) {
    const r = allResults[resultIndex];
    if (!r) return;

    const answers = r.answers || [];

    let dateStr = '';
    if (r.date) {
      try { dateStr = new Date(r.date).toLocaleString(); } catch (e) { dateStr = String(r.date); }
    }

    document.getElementById('modal-title').textContent =
      `${r.username} — ${r.test} (${r.score}, ${dateStr})`;

    let html = '';

    if (answers.length === 0) {
      html = '<div class="no-tests-msg">No answer details available for this result.</div>';
    } else {
      html += `<div style="margin-bottom:.8rem;font-size:.85rem;color:var(--muted);">
        ${answers.filter(a => a.is_correct).length} correct out of ${answers.length} questions
      </div>`;

      answers.forEach(a => {
        const isCorrect = a.is_correct;
        const rowClass = isCorrect ? 'correct' : 'incorrect';
        const icon = isCorrect ? '✅' : '❌';

        html += `
          <div class="answer-row ${rowClass}">
            <span class="answer-icon">${icon}</span>
            <span class="q-id">Q#${escapeHtml(a.question_id)}</span>
            <span class="answer-info">
              Answer: <strong>${escapeHtml(a.user_answer)}</strong>
              ${!isCorrect ? ` → Correct: <strong>${escapeHtml(a.correct_answer)}</strong>` : ''}
            </span>
          </div>
        `;
      });
    }

    document.getElementById('modal-body').innerHTML = html;
    document.getElementById('modal-overlay').classList.add('active');
  }

  function closeModal(event) {
    if (event && event.target !== document.getElementById('modal-overlay')) return;
    document.getElementById('modal-overlay').classList.remove('active');
  }

  // ════════════════════════════════════════════════════
  //  LOGOUT
  // ════════════════════════════════════════════════════
  function logout() {
    currentUser = null;
    questions = [];
    currentTest = null;
    allUsers = [];
    allTests = [];
    adminData = {};
    allResults = [];
    editQuestions = [];
    editTestSheet = '';

    document.getElementById('username').value = '';
    document.getElementById('password').value = '';
    document.getElementById('login-btn').disabled = false;
    document.getElementById('login-btn').textContent = 'Login';
    document.getElementById('login-error').classList.remove('visible');
    document.getElementById('questions-container').innerHTML = '';
    document.getElementById('test-grid').innerHTML = '';

    showView('login-view');
  }

  /* ── Bootstrap ────────────────────────────────── */
  document.addEventListener('DOMContentLoaded', init);

  /* ── Public API ─────────────────────────────────── */
  return {
    login,
    submit,
    logout,
    backToTests,
    startTest,
    adminTakeTests,
    switchAdminTab,
    createTest,
    deleteTest,
    saveAssignments,
    loadAdminResults,
    showAnswerDetail,
    closeModal,
    // Question editor
    loadQuestionsForEdit,
    addQuestionRow,
    removeQuestionRow,
    saveAllQuestions,
    // User management
    createUser,
    editUser,
    deleteUser,
  };

})();

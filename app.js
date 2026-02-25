/**
 * ╔══════════════════════════════════════════════════════════╗
 * ║           ExamPortal — app.js  (Multi-Test)             ║
 * ║  Login, test selection, exam, scoring, admin panel,     ║
 * ║  and result submission via Google Apps Script.           ║
 * ╚══════════════════════════════════════════════════════════╝
 */

'use strict';

const App = (() => {

  /* ── State ─────────────────────────────────────── */
  let endpoint = '';       // decoded GAS URL
  let allUsers = [];       // fetched from GAS Users sheet
  let allTests = [];       // { sheetName, title }
  let currentUser = null;     // { username, fullName, tests, isAdmin }
  let questions = [];       // current test questions
  let currentTest = null;     // { sheetName, title } of the active test
  let adminData = {};       // cached admin data

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

  /* ── Utility: shuffle array (Fisher-Yates) ──────── */
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
    await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain' },
      body: JSON.stringify(payload),
    });
  }

  // ════════════════════════════════════════════════════
  //  INIT — load config
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

    // Enter key → login
    ['username', 'password'].forEach(id => {
      document.getElementById(id).addEventListener('keydown', e => {
        if (e.key === 'Enter') login();
      });
    });

    // Admin filter listeners
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
      // Fetch users from GAS
      const data = await gasGet('getUsers');
      allUsers = data.users || [];
      allTests = data.tests || [];

      // Hash input password
      const hash = await sha256(passwordInput);

      // Find matching user
      const user = allUsers.find(u => u.username === usernameInput && u.passwordHash === hash);

      if (!user) {
        errorEl.textContent = 'Invalid username or password. Please try again.';
        errorEl.classList.add('visible');
        loginBtn.disabled = false;
        loginBtn.textContent = 'Login';
        return;
      }

      // Store current user
      const isAdmin = usernameInput === 'Admin';
      currentUser = {
        username: user.username,
        fullName: user.fullName,
        tests: user.tests || [],
        isAdmin: isAdmin,
      };

      loginBtn.textContent = 'Loading…';

      // Route to admin or test selection
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

    // Filter tests that the user has access to
    const userTests = allTests.filter(t => currentUser.tests.includes(t.sheetName));

    // For Admin, show all tests
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
  //  START TEST — load questions for a specific test
  // ════════════════════════════════════════════════════
  async function startTest(sheetName) {
    const test = allTests.find(t => t.sheetName === sheetName);
    if (!test) {
      alert('Test not found: ' + sheetName);
      return;
    }

    currentTest = test;

    // Show loading state
    document.getElementById('exam-title').textContent = test.title;
    document.getElementById('question-count').textContent = 'Loading…';
    document.getElementById('questions-container').innerHTML =
      '<div class="loading-overlay"><div class="spinner"></div><span>Loading questions…</span></div>';
    showView('exam-view');

    try {
      const data = await gasGet('getQuestions', { test: sheetName });

      if (data.error) throw new Error(data.error);

      questions = shuffle(data.questions || []);

      if (questions.length === 0) {
        throw new Error('No questions found in this test.');
      }

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

    // Block text copying
    const examBody = document.querySelector('.exam-body');
    examBody.addEventListener('copy', e => e.preventDefault());
    examBody.addEventListener('cut', e => e.preventDefault());
    examBody.addEventListener('contextmenu', e => e.preventDefault());

    // Reset submit button
    const submitBtn = document.getElementById('submit-btn');
    submitBtn.disabled = false;
    submitBtn.textContent = 'Submit Exam';

    questions.forEach((q, idx) => {
      // Build options dynamically — support 2 to 4
      const allOptions = [
        { key: 'A', text: q.option_a },
        { key: 'B', text: q.option_b },
        { key: 'C', text: q.option_c },
        { key: 'D', text: q.option_d },
      ];
      // Filter out empty options
      const options = allOptions.filter(opt => opt.text && opt.text.trim() !== '');

      const card = document.createElement('div');
      card.className = 'q-card';
      card.style.animationDelay = `${idx * 0.05}s`;
      card.dataset.qid = q.question_id;
      card.dataset.correct = q.correct_answer; // A/B/C/D

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

    // Score calculation
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

    // Build payload
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

    // POST to GAS
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

    const verdictEl = document.getElementById('result-verdict');
    verdictEl.innerHTML = passed
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

  // ════════════════════════════════════════════════════
  //  BACK TO TESTS (from result page)
  // ════════════════════════════════════════════════════
  function backToTests() {
    questions = [];
    currentTest = null;

    if (currentUser.isAdmin && !currentUser._takingTests) {
      showView('admin-view');
    } else {
      renderTestSelection();
    }
  }

  // ════════════════════════════════════════════════════
  //  ADMIN: switch to test-taking mode
  // ════════════════════════════════════════════════════
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

    // Load data
    await refreshAdminData();
    renderAdminTests();
    renderAdminUsers();
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
    // Update tab buttons
    document.querySelectorAll('.admin-tab').forEach(t => t.classList.remove('active'));
    btnEl.classList.add('active');

    // Update panels
    document.querySelectorAll('.admin-panel').forEach(p => p.classList.remove('active'));
    document.getElementById('admin-' + tabName).classList.add('active');

    // Lazy load results
    if (tabName === 'results') {
      loadAdminResults();
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
        <button class="btn-admin danger" onclick="App.deleteTest('${escapeHtml(test.title)}')">Delete</button>
      </div>
    `).join('');
  }

  async function createTest() {
    const input = document.getElementById('new-test-name');
    const name = input.value.trim();
    if (!name) {
      alert('Please enter a test name.');
      return;
    }

    try {
      const result = await gasPost({ action: 'createTest', testName: name });
      input.value = '';
      await refreshAdminData();
      renderAdminTests();
      renderAdminUsers();
      alert(`Test "${name}" created successfully!`);
    } catch (err) {
      alert('Failed to create test: ' + err.message);
    }
  }

  async function deleteTest(testName) {
    if (!confirm(`Are you sure you want to delete the test "${testName}"? This will also remove the sheet and all questions.`)) {
      return;
    }

    try {
      await gasPost({ action: 'deleteTest', testName: testName });
      await refreshAdminData();
      renderAdminTests();
      renderAdminUsers();
      alert(`Test "${testName}" deleted.`);
    } catch (err) {
      alert('Failed to delete test: ' + err.message);
    }
  }

  /* ── Admin: User-Test Assignments ─────────────── */
  function renderAdminUsers() {
    const container = document.getElementById('admin-users-table');
    const users = adminData.users || [];
    const tests = adminData.tests || [];

    if (users.length === 0) {
      container.innerHTML = '<div class="no-tests-msg">No users found in the Users sheet.</div>';
      return;
    }

    let html = '<table class="admin-table"><thead><tr>';
    html += '<th>Full Name</th><th>Username</th>';
    tests.forEach(t => {
      html += `<th style="text-align:center">${escapeHtml(t.title)}</th>`;
    });
    html += '</tr></thead><tbody>';

    users.forEach(user => {
      if (user.username === 'Admin') return; // Skip admin in the assignment table
      html += '<tr>';
      html += `<td>${escapeHtml(user.fullName)}</td>`;
      html += `<td><strong>${escapeHtml(user.username)}</strong></td>`;
      tests.forEach(t => {
        const checked = user.tests.includes(t.sheetName) ? 'checked' : '';
        html += `<td style="text-align:center"><input type="checkbox" data-username="${escapeHtml(user.username)}" data-test="${escapeHtml(t.sheetName)}" ${checked} /></td>`;
      });
      html += '</tr>';
    });

    html += '</tbody></table>';
    container.innerHTML = html;
  }

  async function saveAssignments() {
    const checkboxes = document.querySelectorAll('#admin-users-table input[type="checkbox"]');
    const assignmentMap = {};

    checkboxes.forEach(cb => {
      const username = cb.dataset.username;
      const testName = cb.dataset.test;
      if (!assignmentMap[username]) {
        assignmentMap[username] = [];
      }
      if (cb.checked) {
        assignmentMap[username].push(testName);
      }
    });

    const assignments = Object.entries(assignmentMap).map(([username, tests]) => ({
      username,
      tests,
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
  let allResults = [];

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

    // Unique users
    const uniqueUsers = [...new Set(allResults.map(r => r.username).filter(Boolean))];
    userSelect.innerHTML = '<option value="">All Users</option>' +
      uniqueUsers.map(u => `<option value="${escapeHtml(u)}">${escapeHtml(u)}</option>`).join('');

    // Unique tests
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
    if (passedFilter) filtered = filtered.filter(r => String(r.passed) === passedFilter);

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

    // Show newest first
    const sorted = [...results].reverse();

    sorted.forEach(r => {
      const passClass = String(r.passed) === 'YES' ? 'pass' : 'fail';
      const passLabel = String(r.passed) === 'YES' ? 'PASSED' : 'FAILED';
      const dateStr = r.date ? new Date(r.date).toLocaleString() : '';

      html += '<tr>';
      html += `<td><strong>${escapeHtml(r.username)}</strong></td>`;
      html += `<td>${escapeHtml(r.test || '')}</td>`;
      html += `<td>${escapeHtml(dateStr)}</td>`;
      html += `<td>${escapeHtml(String(r.score || ''))}</td>`;
      html += `<td>${escapeHtml(String(r.correct || ''))}</td>`;
      html += `<td>${escapeHtml(String(r.total || ''))}</td>`;
      html += `<td><span class="badge ${passClass}">${passLabel}</span></td>`;
      html += '</tr>';
    });

    html += '</tbody></table>';
    container.innerHTML = html;
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

    document.getElementById('username').value = '';
    document.getElementById('password').value = '';
    document.getElementById('login-btn').disabled = false;
    document.getElementById('login-btn').textContent = 'Login';
    document.getElementById('login-error').classList.remove('visible');
    document.getElementById('questions-container').innerHTML = '';
    document.getElementById('test-grid').innerHTML = '';

    showView('login-view');
  }

  /* ── Bootstrap ──────────────────────────────────── */
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
  };

})();
